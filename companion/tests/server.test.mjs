import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer, SERVICE_ID } from '../server.mjs';
import { createStore } from '../store.mjs';

const START = Date.UTC(2026, 8, 10, 10);
const action = (id, type, expectedRevision, payload = {}) => ({ id, type, expectedRevision, payload });

async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(join(tmpdir(), 'yanami-server-test-'));
  const distDir = join(directory, 'dist');
  const dataFile = join(directory, 'private', 'state.json');
  await fs.mkdir(distDir);
  await fs.writeFile(join(distDir, 'index.html'), '<!doctype html><title>八奈见的小卖部</title>');
  await fs.writeFile(join(distDir, 'app.js'), 'export const ready = true;');
  await fs.writeFile(join(directory, 'secret.txt'), 'private secret');
  await fs.symlink(join(directory, 'secret.txt'), join(distDir, 'leak.txt'));
  let time = START;
  const server = await startServer({ port: 0, dataFile, distDir, now: () => time, ...options });
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolveClose => server.close(resolveClose));
    await fs.rm(directory, { recursive: true, force: true });
  });
  return { server, base, dataFile, distDir, directory, setTime(value) { time = value; } };
}

function request(base, path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolveResponse, reject) => {
    const req = http.request(base, { path, method, headers }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolveResponse({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

const post = (base, value, headers = {}) => request(base, '/api/actions', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base, ...headers }, body: JSON.stringify(value),
});

test('GET identifies the service and POST returns committed state, catalog and feedback', async (t) => {
  const { base, server } = await fixture(t);
  assert.equal(server.address().address, '127.0.0.1');
  const response = await request(base, '/api/state');
  assert.equal(response.status, 200);
  assert.equal(response.headers['x-yanami-service'], SERVICE_ID);
  assert.equal(response.headers['cache-control'], 'no-store');
  const initial = JSON.parse(response.body);
  assert.equal(initial.now, START);
  assert.equal(initial.catalog.snacks.length, 6);
  assert.equal(initial.state.revision, 0);
  const fed = await post(base, action('http-feed', 'feed', 0, { snackId: 'pudding' }));
  assert.equal(fed.status, 200);
  const result = JSON.parse(fed.body);
  assert.equal(result.state.revision, 1);
  assert.equal(result.state.inventory.pudding, 0);
  assert.ok(result.feedback.message);
  assert.equal(result.catalog.snacks.length, 6);
});

test('two stale windows produce one success and one 409 with the newest state', async (t) => {
  const { base } = await fixture(t);
  const responses = await Promise.all([
    post(base, action('http-a', 'feed', 0, { snackId: 'pudding' })),
    post(base, action('http-b', 'feed', 0, { snackId: 'melonpan' })),
  ]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
  const conflict = JSON.parse(responses.find(r => r.status === 409).body);
  assert.equal(conflict.error.code, 'REVISION_CONFLICT');
  assert.equal(conflict.state.revision, 1);
});

test('cross-site and foreign Host writes are rejected without private state', async (t) => {
  const { base } = await fixture(t);
  const feed = action('cross-site', 'feed', 0, { snackId: 'pudding' });
  for (const headers of [{ Origin: 'https://example.com' }, { Origin: 'null' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    const res = await post(base, feed, headers);
    assert.equal(res.status, 403);
    assert.equal(JSON.parse(res.body).state, undefined);
  }
  const foreignHost = await post(base, feed, { Host: 'evil.test:17653' });
  assert.equal(foreignHost.status, 421);
  assert.equal(JSON.parse(foreignHost.body).state, undefined);
  const wrongPort = await request(base, '/api/state', { headers: { Host: 'localhost:1' } });
  assert.equal(wrongPort.status, 421);
  const state = JSON.parse((await request(base, '/api/state')).body).state;
  assert.equal(state.revision, 0);
  // Native clients without browser Origin are permitted on the validated loopback Host.
  const native = await request(base, '/api/actions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(feed) });
  assert.equal(native.status, 200);
});

test('JSON, body size, malformed actions and methods cannot mutate the store', async (t) => {
  const { base } = await fixture(t, { bodyLimit: 512 });
  const feed = action('bad-payload', 'feed', 0, { snackId: 'pudding' });
  assert.equal((await post(base, feed, { 'Content-Type': 'text/plain' })).status, 415);
  const invalid = await request(base, '/api/actions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(invalid.status, 400);
  const large = await request(base, '/api/actions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ padding: 'x'.repeat(600) }) });
  assert.equal(large.status, 413);
  assert.equal((await post(base, null)).status, 400);
  assert.equal((await request(base, '/api/actions')).status, 405);
  assert.equal((await request(base, '/', { method: 'POST' })).status, 405);
  assert.equal(JSON.parse((await request(base, '/api/state')).body).state.revision, 0);
});

test('static routes serve the app while traversal, dotfiles and escaping symlinks cannot leak files', async (t) => {
  const { base } = await fixture(t);
  const index = await request(base, '/');
  assert.equal(index.status, 200);
  assert.match(index.body, /八奈见的小卖部/);
  assert.match(index.headers['content-security-policy'], /frame-ancestors 'none'/);
  const script = await request(base, '/app.js');
  assert.equal(script.status, 200);
  assert.match(script.headers['content-type'], /javascript/);
  assert.equal((await request(base, '/collection')).status, 200);
  assert.equal((await request(base, '/app.js', { method: 'HEAD' })).body, '');
  for (const path of ['/../secret.txt', '/%2e%2e/secret.txt', '/.env', '/%00', '/a%5cb']) {
    const response = await request(base, path);
    assert.equal(response.status, 400, path);
    assert.doesNotMatch(response.body, /private secret/);
  }
  assert.equal((await request(base, '/leak.txt')).status, 404);
  assert.equal((await request(base, '/missing.png')).status, 404);
});

test('expired GET has no write; claim and identical retry award only one receipt', async (t) => {
  const { base, dataFile, setTime } = await fixture(t);
  assert.equal((await post(base, action('http-trial', 'start', 0, { mode: 'trial' }))).status, 200);
  const before = await fs.readFile(dataFile, 'utf8');
  setTime(START + 30_001);
  const expired = JSON.parse((await request(base, '/api/state')).body);
  assert.equal(expired.state.activeTrip.status, 'ready');
  assert.equal(await fs.readFile(dataFile, 'utf8'), before);
  const claim = action('http-claim', 'claim', 1);
  const results = await Promise.all([post(base, claim), post(base, claim)]);
  assert.deepEqual(results.map(r => r.status), [200, 200]);
  assert.equal(JSON.parse(results[1].body).state.receipts.length, 1);
});

test('persistence failure returns 503 and uncommitted state, never successful feedback', async (t) => {
  const dir = await fs.mkdtemp(join(tmpdir(), 'yanami-failing-store-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const dataFile = join(dir, 'state.json');
  let fail = false;
  const io = { ...fs, async rename(from, to) {
    if (fail && to === dataFile) throw Object.assign(new Error('Disk full'), { code: 'ENOSPC' });
    return fs.rename(from, to);
  } };
  const store = await createStore({ dataFile, now: () => START, io });
  const { base } = await fixture(t, { store });
  fail = true;
  const res = await post(base, action('http-disk-full', 'feed', 0, { snackId: 'pudding' }));
  assert.equal(res.status, 503);
  const value = JSON.parse(res.body);
  assert.equal(value.error.code, 'SAVE_FAILED');
  assert.equal(value.state.inventory.pudding, 1);
  assert.equal(value.state.revision, 0);
  assert.equal(value.feedback, undefined);
});

test('backup recovery notice is visible through GET', async (t) => {
  const dir = await fs.mkdtemp(join(tmpdir(), 'yanami-recovery-server-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const dataFile = join(dir, 'state.json');
  await createStore({ dataFile, now: () => START });
  await fs.writeFile(dataFile, 'corrupt');
  const store = await createStore({ dataFile, now: () => START });
  const { base } = await fixture(t, { store });
  const response = JSON.parse((await request(base, '/api/state')).body);
  assert.match(response.recoveryNotice, /恢复/);
});
