import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { EVENT_KINDS, MAX_INPUT_BYTES, projectEvent, publishEvent, readEvent } from './adapter.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const packet = (kind = 'UserPromptSubmit') => ({ hook_event_name: kind, session_id: 'session-private', turn_id: 'turn-private', tool_use_id: 'call-private' });
async function directory(t) {
  const path = await fs.mkdtemp(join(tmpdir(), 'yanami-hook-'));
  t.after(() => fs.rm(path, { recursive: true, force: true }));
  return path;
}
function run(input, spool, { close = true, args = [] } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(HERE, 'adapter.mjs'), '--yanami-codex-hook-v1', ...args], { env: { ...process.env, YANAMI_CODEX_SPOOL: spool }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', (data) => { stdout += data; });
    child.stderr.on('data', (data) => { stderr += data; });
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
    child.stdin.on('error', () => {});
    child.stdin.write(input);
    if (close) child.stdin.end();
  });
}

test('projects only six fields and hashes identifiers, never prompt/tool/path/result data', () => {
  const event = projectEvent({ ...packet('PostToolUse'), prompt: 'TOP-SECRET', tool_input: { command: 'SECRET-COMMAND' }, tool_response: 'SECRET-RESULT', transcript_path: '/secret/path', cwd: '/private/work', model: 'private-model' }, { at: 100, nonce: 'stable' });
  assert.deepEqual(Object.keys(event), ['schemaVersion', 'id', 'kind', 'sessionId', 'turnId', 'at']);
  assert.equal(event.sessionId, sha256('session-private'));
  assert.equal(event.turnId, sha256('turn-private'));
  assert.match(event.id, /^[0-9a-f]{64}$/);
  for (const secret of ['TOP-SECRET', 'SECRET-COMMAND', 'SECRET-RESULT', '/secret/path', '/private/work', 'private-model', 'session-private', 'turn-private', 'call-private']) assert.equal(JSON.stringify(event).includes(secret), false);
});

test('start, stop and interrupt use stable IDs; different turns and event kinds differ', () => {
  for (const kind of ['UserPromptSubmit', 'Stop', 'Interrupt']) {
    const first = projectEvent(packet(kind), { at: 100, nonce: 'one' });
    const repeated = projectEvent(packet(kind), { at: 200, nonce: 'two' });
    assert.equal(first.id, repeated.id);
    assert.notEqual(first.id, projectEvent({ ...packet(kind), turn_id: 'other' }).id);
  }
  assert.equal(new Set(['UserPromptSubmit', 'Stop', 'Interrupt'].map((kind) => projectEvent(packet(kind)).id)).size, 3);
});

test('tool use IDs deduplicate individual pre/post calls without storing the tool ID', () => {
  for (const kind of ['PreToolUse', 'PostToolUse']) {
    assert.equal(projectEvent(packet(kind)).id, projectEvent(packet(kind)).id);
    assert.notEqual(projectEvent(packet(kind)).id, projectEvent({ ...packet(kind), tool_use_id: 'other' }).id);
  }
  assert.notEqual(projectEvent(packet('PreToolUse')).id, projectEvent(packet('PostToolUse')).id);
});

test('turnless rewards and continued Stop hooks are dropped; session events remain advisory', () => {
  for (const kind of ['UserPromptSubmit', 'Stop', 'Interrupt']) assert.equal(projectEvent({ ...packet(kind), turn_id: null }), null);
  assert.equal(projectEvent({ ...packet('Stop'), stop_hook_active: true }), null);
  assert.equal(projectEvent({ ...packet('SessionEnd'), turn_id: undefined }).turnId, null);
  assert.equal(projectEvent({ ...packet('PermissionRequest'), turn_id: undefined }).turnId, null);
  assert.equal(projectEvent(packet('SubagentStop')), null);
});

test('rejects unknown events, arrays, malformed IDs and invalid reception times', () => {
  for (const bad of [null, [], 'text', {}, packet('BadEvent'), { ...packet(), session_id: '' }, { ...packet(), session_id: ' '.repeat(4) }, { ...packet(), session_id: 'x'.repeat(1025) }]) assert.equal(projectEvent(bad), null);
  assert.equal(projectEvent(packet(), { at: NaN }), null);
  assert.equal(projectEvent(packet(), { at: -1 }), null);
});

test('readEvent accepts chunked UTF-8 JSON and drops invalid or over-limit input', async () => {
  assert.equal((await readEvent(Readable.from(['{"hook_event_name":"Stop",', '"session_id":"a","turn_id":"b"}']))).kind, 'Stop');
  assert.equal(await readEvent(Readable.from(['not json'])), null);
  assert.equal(await readEvent(Readable.from(['x'.repeat(MAX_INPUT_BYTES + 1)])), null);
});

test('atomic publication deduplicates concurrent hooks and retains first reception time', async (t) => {
  const spool = await directory(t);
  const event = projectEvent(packet('Stop'), { at: 100 });
  assert.equal(await publishEvent(event, spool), true);
  await Promise.all(Array.from({ length: 12 }, () => publishEvent({ ...event, at: 200 }, spool)));
  assert.deepEqual(await fs.readdir(spool), [`${event.id}.json`]);
  assert.deepEqual(JSON.parse(await fs.readFile(join(spool, `${event.id}.json`), 'utf8')), event);
  assert.equal((await fs.stat(join(spool, `${event.id}.json`))).mode & 0o777, 0o600);
});

test('real stdin adapter exits silently with zero and writes the clipped event', async (t) => {
  const spool = join(await directory(t), 'spool');
  assert.deepEqual(await run(JSON.stringify({ ...packet(), prompt: 'PRIVATE-PROMPT' }), spool), { code: 0, signal: null, stdout: '', stderr: '' });
  const files = await fs.readdir(spool);
  assert.equal(files.length, 1);
  const raw = await fs.readFile(join(spool, files[0]), 'utf8');
  assert.equal(raw.includes('PRIVATE-PROMPT'), false);
  assert.equal(JSON.parse(raw).kind, 'UserPromptSubmit');
});

test('bad stdin, oversized inputs and filesystem failures are silent non-blocking failures', async (t) => {
  const root = await directory(t);
  const blocked = join(root, 'ordinary-file');
  await fs.writeFile(blocked, 'not a directory');
  for (const [input, spool] of [['{', join(root, 'bad-json')], ['x'.repeat(MAX_INPUT_BYTES + 1), join(root, 'too-large')], [JSON.stringify(packet()), blocked], [JSON.stringify(packet()), join(root, 'missing-arg')]]) {
    const result = await run(input, spool, { args: spool.endsWith('missing-arg') ? ['--spool'] : [] });
    assert.deepEqual(result, { code: 0, signal: null, stdout: '', stderr: '' });
  }
});

test('an unclosed stdin cannot hold up Codex indefinitely', async (t) => {
  const root = await directory(t);
  const started = performance.now();
  assert.deepEqual(await run('{', root, { close: false }), { code: 0, signal: null, stdout: '', stderr: '' });
  assert.ok(performance.now() - started < 2500);
});

test('only the seven requested official events are supported', () => {
  assert.deepEqual(EVENT_KINDS, ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest', 'Stop', 'Interrupt', 'SessionEnd']);
});
