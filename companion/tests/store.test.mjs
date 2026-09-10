import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../store.mjs';
import { validateState } from '../domain.mjs';

const START = Date.UTC(2026, 8, 10, 10);
const action = (id, type, expectedRevision, payload = {}) => ({ id, type, expectedRevision, payload });

async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(join(tmpdir(), 'yanami-store-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const dataFile = join(directory, 'private', 'state.json');
  let time = START;
  const store = await createStore({ dataFile, now: () => time, ...options });
  return { store, dataFile, directory, setTime(value) { time = value; } };
}

test('initial save is private and survives a new store; actions preserve a valid previous backup', async (t) => {
  const { store, dataFile } = await fixture(t);
  const initial = await store.read();
  assert.equal(initial.revision, 0);
  const result = await store.dispatch(action('feed-one', 'feed', 0, { snackId: 'pudding' }));
  assert.equal(result.state.inventory.pudding, initial.inventory.pudding - 1);
  const disk = validateState(JSON.parse(await fs.readFile(dataFile, 'utf8')));
  const backup = validateState(JSON.parse(await fs.readFile(`${dataFile}.bak`, 'utf8')));
  assert.equal(disk.revision, 1);
  assert.deepEqual(backup, initial);
  assert.equal((await fs.stat(dataFile)).mode & 0o777, 0o600);
  const reopened = await createStore({ dataFile, now: () => START });
  assert.deepEqual(await reopened.read(), result.state);
});

test('two windows cannot spend the same revision; idempotent retry consumes no extra snack', async (t) => {
  const { store } = await fixture(t);
  const first = action('window-a', 'feed', 0, { snackId: 'pudding' });
  const results = await Promise.allSettled([
    store.dispatch(first),
    store.dispatch(action('window-b', 'feed', 0, { snackId: 'pudding' })),
  ]);
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[1].status, 'rejected');
  assert.equal(results[1].reason.code, 'REVISION_CONFLICT');
  const retry = await store.dispatch(first);
  assert.equal(retry.state.revision, 1);
  assert.equal(retry.state.feeds.length, 1);
  assert.equal(retry.state.inventory.pudding, 0);
});

test('a running trip expires on read without disk churn; later claim persists exactly once', async (t) => {
  const { store, dataFile, setTime } = await fixture(t);
  await store.dispatch(action('trial-one', 'start', 0, { mode: 'trial' }));
  const before = await fs.readFile(dataFile, 'utf8');
  setTime(START + 30_001);
  assert.equal((await store.read()).activeTrip.status, 'ready');
  assert.equal(await fs.readFile(dataFile, 'utf8'), before);
  const claim = action('claim-one', 'claim', 1);
  const result = await store.dispatch(claim);
  assert.equal(result.state.activeTrip, null);
  assert.equal(result.state.receipts.length, 1);
  assert.equal(result.state.receipts[0].focusMinutes, 0);
  assert.equal((await store.dispatch(claim)).state.receipts.length, 1);
  const reopened = await createStore({ dataFile, now: () => START + 31_000 });
  assert.equal((await reopened.read()).receipts.length, 1);
});

test('corrupt main restores a validated backup and keeps the exact damaged bytes', async (t) => {
  const { store, dataFile } = await fixture(t);
  await store.dispatch(action('feed-before-damage', 'feed', 0, { snackId: 'pudding' }));
  const damaged = '{ broken but must be preserved';
  await fs.writeFile(dataFile, damaged);
  const restored = await createStore({ dataFile, now: () => START + 1 });
  assert.match(restored.recoveryNotice, /恢复/);
  assert.equal((await restored.read()).revision, 0);
  const files = await fs.readdir(join(dataFile, '..'));
  const corrupt = files.find(name => name.startsWith('state.json.corrupt-'));
  assert.ok(corrupt);
  assert.equal(await fs.readFile(join(dataFile, '..', corrupt), 'utf8'), damaged);
  assert.equal(validateState(JSON.parse(await fs.readFile(dataFile, 'utf8'))).revision, 0);
});

test('missing main uses backup; two damaged files fail closed and stay untouched', async (t) => {
  const { dataFile } = await fixture(t);
  await fs.unlink(dataFile);
  const restored = await createStore({ dataFile, now: () => START });
  assert.match(restored.recoveryNotice, /缺失/);
  await fs.writeFile(dataFile, 'bad main');
  await fs.writeFile(`${dataFile}.bak`, 'bad backup');
  await assert.rejects(createStore({ dataFile, now: () => START }), { code: 'SAVE_CORRUPT' });
  assert.equal(await fs.readFile(dataFile, 'utf8'), 'bad main');
  assert.equal(await fs.readFile(`${dataFile}.bak`, 'utf8'), 'bad backup');
});

test('failed main replacement does not publish success or consume inventory; same id can retry', async (t) => {
  let failTarget;
  const io = { ...fs, async rename(from, to) {
    if (to === failTarget) throw Object.assign(new Error('Disk full'), { code: 'ENOSPC' });
    return fs.rename(from, to);
  } };
  const { store, dataFile } = await fixture(t, { io });
  const before = await fs.readFile(dataFile, 'utf8');
  failTarget = dataFile;
  const feed = action('retry-on-disk-full', 'feed', 0, { snackId: 'pudding' });
  await assert.rejects(store.dispatch(feed), { code: 'SAVE_FAILED', status: 503 });
  assert.equal((await store.read()).revision, 0);
  assert.equal((await store.read()).inventory.pudding, 1);
  assert.equal(await fs.readFile(dataFile, 'utf8'), before);
  assert.equal((await fs.readdir(join(dataFile, '..'))).filter(name => name.includes('.tmp-')).length, 0);
  failTarget = undefined;
  assert.equal((await store.dispatch(feed)).state.revision, 1);
});

test('backup write failure leaves main intact and reports failure', async (t) => {
  let fail = false;
  const io = { ...fs, async rename(from, to) {
    if (fail && to.endsWith('.bak')) throw Object.assign(new Error('Read-only disk'), { code: 'EROFS' });
    return fs.rename(from, to);
  } };
  const { store, dataFile } = await fixture(t, { io });
  const before = await fs.readFile(dataFile, 'utf8');
  fail = true;
  await assert.rejects(store.dispatch(action('backup-fail', 'feed', 0, { snackId: 'pudding' })), { code: 'SAVE_FAILED' });
  assert.equal(await fs.readFile(dataFile, 'utf8'), before);
  assert.equal((await store.read()).revision, 0);
});

test('failure after main rename reconciles the committed id before retry', async (t) => {
  let fail = false;
  let renamedMain = false;
  let dataPath;
  const io = { ...fs,
    async rename(from, to) {
      await fs.rename(from, to);
      if (fail && to === dataPath) renamedMain = true;
    },
    async open(file, ...args) {
      if (renamedMain && file === join(dataPath, '..')) {
        renamedMain = false;
        throw Object.assign(new Error('Directory sync unavailable'), { code: 'EIO' });
      }
      return fs.open(file, ...args);
    },
  };
  const { store, dataFile } = await fixture(t, { io });
  dataPath = dataFile;
  fail = true;
  const feed = action('ambiguous-commit', 'feed', 0, { snackId: 'pudding' });
  await assert.rejects(store.dispatch(feed), { code: 'SAVE_FAILED' });
  const retry = await store.dispatch(feed);
  assert.equal(retry.state.revision, 1);
  assert.equal(retry.state.feeds.length, 1);
});
