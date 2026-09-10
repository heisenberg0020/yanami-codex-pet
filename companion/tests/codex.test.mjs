import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCodexState, validateCodex, applyCodexEvent, codexView, codexEntitlements, CODEX_STALE_MS } from '../codex.mjs';
import { createCodexIngestor } from '../codex-ingest.mjs';
import { createInitialState, applyAction, validateState } from '../domain.mjs';
import { createStore } from '../store.mjs';

const T = Date.UTC(2026, 8, 10, 12);
const hash = value => createHash('sha256').update(String(value)).digest('hex');
function event(kind, session = 'session', turn = 'turn', at = T, salt = '') {
  return { schemaVersion: 1, id: hash(`${kind}:${session}:${turn}:${at}:${salt}`), kind,
    sessionId: hash(session), turnId: turn === null ? null : hash(turn), at };
}
function round(session, turn, at = T) {
  return ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'].map((kind, i) => event(kind, session, turn, at + i));
}
function fold(events, state = createCodexState(), now = T + 10_000) {
  return events.reduce((current, item) => applyCodexEvent(current, item, now), state);
}
function action(id, type, expectedRevision, payload = {}) { return { id, type, expectedRevision, payload }; }
const total = inventory => Object.values(inventory).reduce((sum, value) => sum + value, 0);

async function fixture(t, { io, initial, now = () => T + 10_000 } = {}) {
  const directory = await fs.mkdtemp(join(tmpdir(), 'yanami-codex-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const dataFile = join(directory, 'state.json');
  const spoolDir = join(directory, 'codex-events');
  await fs.mkdir(spoolDir);
  if (initial) await fs.writeFile(dataFile, JSON.stringify(initial));
  const store = await createStore({ dataFile, now, ...(io ? { io } : {}) });
  return { directory, dataFile, spoolDir, store };
}
async function enqueue(spoolDir, events) {
  await Promise.all(events.map(item => fs.writeFile(join(spoolDir, `${item.id}.json`), JSON.stringify(item))));
}

test('three observed work rounds create one claimable snack, with zero human-focus minutes', async (t) => {
  const { store } = await fixture(t);
  const events = [0, 1, 2].flatMap(i => round('main', `round-${i}`, T + i * 10));
  const observed = await store.ingest(events, T + 10_000);
  assert.equal(observed.revision, 0);
  assert.equal(observed.recentActions.length, 0);
  assert.equal(observed.codex.credits.length, 3);
  assert.equal(total(observed.inventory), 6);
  assert.equal(codexView(observed.codex, observed.receipts, T + 10_000).pendingRewards, 1);
  const claim = action('claim-work', 'claimCodex', 0);
  const result = await store.dispatch(claim, T + 10_001);
  assert.equal(result.state.revision, 1);
  assert.equal(total(result.state.inventory), 7);
  assert.equal(result.state.receipts.length, 1);
  assert.equal(result.state.receipts[0].mode, 'codex');
  assert.equal(result.state.receipts[0].focusMinutes, 0);
  assert.equal(result.state.receipts[0].durationMs, 0);
  assert.equal(result.feedback.kind, 'claimCodex');
  const retry = await store.dispatch(claim, T + 10_002);
  assert.deepEqual(retry.feedback, result.feedback);
  assert.equal(total(retry.state.inventory), 7);
  await assert.rejects(store.dispatch(action('another-claim', 'claimCodex', 1), T + 10_003), { code: 'NO_CODEX_REWARD' });
});

test('prompt-only, denied-before-tool and unpaired Stop observations earn nothing', () => {
  for (const kinds of [['UserPromptSubmit', 'Stop'], ['UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'Stop'], ['PostToolUse', 'Stop'], ['Stop']]) {
    const state = fold(kinds.map((kind, i) => event(kind, 'no-work', 'one', T + i)));
    assert.equal(state.credits.length, 0, kinds.join(','));
  }
  assert.throws(() => applyCodexEvent(createCodexState(), event('SubagentStop'), T), { code: 'INVALID_CODEX_EVENT' });
});

test('Interrupt before Stop permanently disqualifies a round, including later duplicate ends', () => {
  const state = fold(['UserPromptSubmit', 'PostToolUse', 'Interrupt', 'Stop', 'UserPromptSubmit', 'PostToolUse', 'Stop'].map((kind, i) => event(kind, 'interrupt', 'one', T + i)));
  assert.equal(state.credits.length, 0);
  assert.equal(state.turns[0].status, 'interrupted');
  assert.equal(codexEntitlements(state).length, 0);
});

test('a credited first Stop is stable: later termination observations neither revoke nor award again', () => {
  const completed = fold(round('complete', 'one'));
  const after = fold([event('Interrupt', 'complete', 'one', T + 8), event('Stop', 'complete', 'one', T + 9, 'different-id')], completed);
  assert.equal(after.credits.length, 1);
  assert.deepEqual(after.credits, completed.credits);
  assert.equal(after.turns[0].status, 'stopped');
});

test('Stop arriving before PostToolUse can settle once the earlier tool observation arrives', () => {
  const start = event('UserPromptSubmit', 'late-tool', 'one', T);
  const stop = event('Stop', 'late-tool', 'one', T + 20);
  const tool = event('PostToolUse', 'late-tool', 'one', T + 10);
  const stopped = fold([start, stop]);
  assert.equal(stopped.credits.length, 0);
  const repaired = fold([tool, stop, { ...stop, id: hash('another-stop') }], stopped);
  assert.equal(repaired.credits.length, 1);
  assert.equal(repaired.turns[0].toolAt, T + 10);
});

test('multiple sessions with the same turn hash stay independent and waiting wins the display', () => {
  let state = fold([
    event('UserPromptSubmit', 'left', 'shared'), event('PostToolUse', 'left', 'shared', T + 1),
    event('UserPromptSubmit', 'right', 'shared'), event('PermissionRequest', 'right', 'shared', T + 2),
  ]);
  const view = codexView(state, [], T + 3);
  assert.equal(view.status, 'waiting');
  assert.equal(view.activeSessions, 2);
  state = fold([
    event('Stop', 'left', 'shared', T + 3), event('PostToolUse', 'right', 'shared', T + 4),
    event('Stop', 'right', 'shared', T + 5), ...round('third', 'shared', T + 6),
  ], state);
  assert.equal(state.turns.length, 3);
  assert.equal(state.credits.length, 3);
  assert.equal(codexEntitlements(state).length, 1);
});

test('replay after more than 128 hook events retains terminal deduplication', () => {
  const events = Array.from({ length: 44 }, (_, i) => round('busy-project', `turn-${i}`, T + i * 5)).flat();
  const state = fold(events);
  assert.equal(events.length, 176);
  assert.equal(state.credits.length, 44);
  const replayed = fold([...events, event('Stop', 'busy-project', 'turn-0', T + 999, 'new-delivery-id')], state);
  assert.deepEqual(replayed.credits, state.credits);
  assert.equal(codexEntitlements(replayed).length, 14);
});

test('hook ingestion preserves human revision and the oldest pending user-action confirmation', async (t) => {
  const { store } = await fixture(t);
  const feed = action('human-before-hooks', 'feed', 0, { snackId: 'pudding' });
  const fed = await store.dispatch(feed, T + 10_000);
  const events = Array.from({ length: 44 }, (_, i) => round('busy-project', `turn-${i}`, T + i * 5)).flat();
  await store.ingest(events, T + 10_001);
  const retry = await store.dispatch(feed, T + 10_002);
  assert.equal(retry.state.revision, 1);
  assert.equal(retry.state.recentActions.length, 1);
  assert.deepEqual(retry.feedback, fed.feedback);
  assert.equal(retry.state.feeds.length, 1);
});

test('quiet and approval-waiting rounds become stale without earning or losing progress', () => {
  const state = fold([event('UserPromptSubmit'), event('PermissionRequest', 'session', 'turn', T + 1)]);
  const before = JSON.stringify(state);
  assert.equal(codexView(state, [], T + 2).status, 'waiting');
  assert.equal(codexView(state, [], T + CODEX_STALE_MS + 2).status, 'stale');
  assert.equal(codexView(state, [], T + CODEX_STALE_MS + 2).pendingRewards, 0);
  assert.equal(JSON.stringify(state), before);
  const resumed = fold([event('PostToolUse', 'session', 'turn', T + CODEX_STALE_MS + 3), event('Stop', 'session', 'turn', T + CODEX_STALE_MS + 4)], state, T + CODEX_STALE_MS + 5);
  assert.equal(resumed.credits.length, 1);
});

test('SessionEnd retires unfinished rounds without granting a reward', () => {
  const state = fold([event('UserPromptSubmit'), event('PostToolUse', 'session', 'turn', T + 1), event('SessionEnd', 'session', null, T + 2)]);
  assert.equal(state.turns[0].status, 'interrupted');
  assert.equal(state.credits.length, 0);
  assert.equal(codexView(state, [], T + 3).status, 'idle');
});

test('v1 migration preserves purchases, feeding, settings, paused timer and retry records', async (t) => {
  let original = createInitialState(T);
  original = applyAction(original, action('old-trial', 'start', 0, { mode: 'trial' }), T).state;
  original = applyAction(original, action('old-claim', 'claim', 1), T + 30_000).state;
  original = applyAction(original, action('old-feed', 'feed', 2, { snackId: 'pudding' }), T + 30_001).state;
  original = applyAction(original, action('old-settings', 'settings', 3, { reducedMotion: true }), T + 30_002).state;
  original = applyAction(original, action('old-focus', 'start', 4, { mode: 'focus', minutes: 25 }), T + 30_003).state;
  original = applyAction(original, action('old-pause', 'pause', 5), T + 31_003).state;
  delete original.codex;
  original.schemaVersion = 1;
  const bytes = JSON.stringify(original);
  const { store, directory, dataFile } = await fixture(t, { initial: original, now: () => T + 100_000 });
  const migrated = await store.read();
  const { codex, ...withoutCodex } = migrated;
  assert.deepEqual({ ...withoutCodex, schemaVersion: 1 }, original);
  assert.deepEqual(codex, createCodexState());
  assert.equal(JSON.parse(await fs.readFile(dataFile, 'utf8')).schemaVersion, 2);
  const old = (await fs.readdir(directory)).find(file => file.startsWith('state.json.v1-'));
  assert.ok(old);
  assert.equal(await fs.readFile(join(directory, old), 'utf8'), bytes);
  assert.equal((await store.dispatch(action('old-feed', 'feed', 2, { snackId: 'pudding' }), T + 100_001)).state.feeds.length, 1);
});

test('future save versions reject without reverting to a valid older backup', async (t) => {
  const { dataFile, store } = await fixture(t);
  const current = await store.read();
  const future = { ...current, schemaVersion: 3, futureField: true };
  const bytes = JSON.stringify(future);
  await fs.writeFile(dataFile, bytes);
  const backupBefore = await fs.readFile(`${dataFile}.bak`, 'utf8');
  assert.throws(() => validateState(future), { code: 'UNSUPPORTED_SAVE_VERSION' });
  await assert.rejects(createStore({ dataFile, now: () => T + 20_000 }), { code: 'UNSUPPORTED_SAVE_VERSION' });
  assert.equal(await fs.readFile(dataFile, 'utf8'), bytes);
  assert.equal(await fs.readFile(`${dataFile}.bak`, 'utf8'), backupBefore);
});

test('malformed digests, missing turn ids and unobserved future times are rejected', () => {
  for (const bad of [
    { ...event('Stop'), id: 'raw-id' }, { ...event('Stop'), turnId: null },
    { ...event('Stop'), sessionId: 'raw-session' }, { ...event('Stop'), privatePrompt: 'must not enter save' },
    { ...event('Stop'), at: T + 60_001 },
  ]) assert.throws(() => applyCodexEvent(createCodexState(), bad, T), { code: 'INVALID_CODEX_EVENT' });
  const complete = fold(round('valid', 'one'));
  complete.credits.push({ ...complete.credits[0] });
  assert.throws(() => validateCodex(complete), { code: 'INVALID_CODEX_EVENT' });
});

test('events remain in spool on disk failure and retry grants the turn only once', async (t) => {
  let fail = false;
  let dataPath;
  const io = { ...fs, async rename(from, to) {
    if (fail && to === dataPath) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
    return fs.rename(from, to);
  } };
  const { dataFile, spoolDir, store } = await fixture(t, { io });
  dataPath = dataFile;
  const events = round('retry', 'one');
  await enqueue(spoolDir, events);
  const ingestor = createCodexIngestor({ store, spoolDir, now: () => T + 10_000 });
  fail = true;
  await ingestor.drain();
  assert.equal((await fs.readdir(spoolDir)).length, events.length);
  assert.equal((await store.read()).codex.credits.length, 0);
  assert.match(ingestor.notice, /重试/);
  fail = false;
  await ingestor.drain();
  assert.equal((await fs.readdir(spoolDir)).length, 0);
  assert.equal((await store.read()).codex.credits.length, 1);
});

test('committed ingestion followed by a lost acknowledgement can be safely replayed after restart', async (t) => {
  const { dataFile, spoolDir, store } = await fixture(t);
  await enqueue(spoolDir, [0, 1, 2].flatMap(i => round('ack-loss', `turn-${i}`, T + i * 10)));
  let loseAck = true;
  const wrapped = { async ingest(...args) {
    const result = await store.ingest(...args);
    if (loseAck) { loseAck = false; throw new Error('acknowledgement lost'); }
    return result;
  } };
  await createCodexIngestor({ store: wrapped, spoolDir, now: () => T + 10_000 }).drain();
  assert.equal((await store.read()).codex.credits.length, 3);
  assert.equal((await fs.readdir(spoolDir)).length, 12);
  const reopened = await createStore({ dataFile, now: () => T + 10_001 });
  await createCodexIngestor({ store: reopened, spoolDir, now: () => T + 10_001 }).drain();
  assert.equal((await reopened.read()).codex.credits.length, 3);
  assert.equal((await fs.readdir(spoolDir)).length, 0);
  assert.equal(codexEntitlements((await reopened.read()).codex).length, 1);
});

test('same-time Interrupt wins before Stop across a spool backlog larger than the batch limit', async (t) => {
  const { spoolDir, store } = await fixture(t);
  const target = ['UserPromptSubmit', 'PostToolUse', 'Stop'].map((kind, i) => ({ ...event(kind, 'backlog-target', 'one', T), id: (i + 1).toString(16).padStart(64, '0') }));
  const fillers = Array.from({ length: 997 }, (_, i) => ({ ...event('SessionEnd', `inactive-${i}`, null, T), id: (i + 4).toString(16).padStart(64, '0') }));
  const interrupt = { ...event('Interrupt', 'backlog-target', 'one', T), id: 'f'.repeat(64) };
  await enqueue(spoolDir, [...target, ...fillers, interrupt]);
  const ingestor = createCodexIngestor({ store, spoolDir, now: () => T + 10_000 });
  await ingestor.drain();
  await ingestor.drain();
  assert.equal((await fs.readdir(spoolDir)).length, 0);
  const state = await store.read();
  assert.equal(state.codex.credits.length, 0);
  assert.equal(state.codex.turns.find(turn => turn.sessionId === hash('backlog-target')).status, 'interrupted');
});
