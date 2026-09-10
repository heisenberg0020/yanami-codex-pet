import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configureHooks, mergeConfig, ownedHandler, OWNER, COMMAND_MARKER, TRUST_NOTICE } from './install.mjs';
import { EVENT_KINDS } from './adapter.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
async function fixture(t) {
  const root = await fs.mkdtemp(join(tmpdir(), "yanami install ' "));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, configFile: join(root, 'codex/hooks.json'), runtimeDir: join(root, 'runtime'), spool: join(root, 'private/events'), markerFile: join(root, 'private/codex-hooks-installed.json') };
}
const theirHandler = { type: 'command', command: '/usr/bin/true', timeout: 2 };
const own = { type: 'command', command: `/some/node /adapter.mjs ${COMMAND_MARKER}`, statusMessage: OWNER };

test('merge keeps others and root metadata intact, and installs exactly seven handlers', () => {
  const original = { description: 'Their metadata', extra: { keep: true }, hooks: { Stop: [{ matcher: 'anything', hooks: [theirHandler] }], CustomEvent: [{ hooks: [] }] } };
  const first = mergeConfig(original, { command: own.command });
  assert.equal(first.config.description, original.description);
  assert.deepEqual(first.config.extra, original.extra);
  assert.deepEqual(first.config.hooks.Stop[0], original.hooks.Stop[0]);
  assert.deepEqual(first.config.hooks.CustomEvent, original.hooks.CustomEvent);
  assert.equal(Object.values(first.config.hooks).flatMap((groups) => groups.flatMap((group) => group.hooks)).filter(ownedHandler).length, 7);
  assert.equal(first.config.hooks.SessionEnd[0].hooks[0].async, undefined);
  assert.ok(EVENT_KINDS.filter((kind) => kind !== 'SessionEnd').every((kind) => first.config.hooks[kind].at(-1).hooks[0].async));
  assert.deepEqual(mergeConfig(first.config, { command: own.command }).config, first.config);
  assert.deepEqual(original.hooks.Stop[0].hooks, [theirHandler]);
});

test('uninstall removes only our exact matching handlers, including mixed groups', () => {
  const similarlyNamed = { ...theirHandler, statusMessage: OWNER };
  const config = { description: 'Keep', hooks: { Stop: [{ matcher: 'x', hooks: [theirHandler, own, similarlyNamed] }], Other: [{ hooks: [own] }], Empty: [{ hooks: [] }] } };
  const result = mergeConfig(config, { mode: 'uninstall' });
  assert.deepEqual(result.config.hooks.Stop, [{ matcher: 'x', hooks: [theirHandler, similarlyNamed] }]);
  assert.equal(result.config.hooks.Other, undefined);
  assert.deepEqual(result.config.hooks.Empty, [{ hooks: [] }]);
  assert.equal(result.removed, 2);
});

test('malformed configuration is rejected rather than reset', () => {
  for (const config of [null, [], { hooks: [] }, { hooks: { Stop: {} } }, { hooks: { Stop: [{}] } }]) assert.throws(() => mergeConfig(config, { command: own.command }));
});

test('dry run returns exact paths and trust notice without writing anything', async (t) => {
  const options = await fixture(t);
  const result = await configureHooks({ ...options, dryRun: true });
  assert.equal(result.changed, true);
  assert.equal(result.trustRequired, true);
  assert.equal(result.notice, TRUST_NOTICE);
  assert.match(result.command, /--yanami-codex-hook-v1/);
  assert.match(result.adapterPath, /adapter-[0-9a-f]{64}\.mjs$/);
  assert.deepEqual(await fs.readdir(options.root), []);
});

test('install creates a content-addressed runtime, marker and private atomic configuration', async (t) => {
  const options = await fixture(t);
  const result = await configureHooks(options);
  assert.equal(result.changed, true);
  assert.equal(result.backupFile, null);
  assert.deepEqual(await fs.readFile(result.adapterPath), await fs.readFile(join(HERE, 'adapter.mjs')));
  assert.equal((await fs.stat(options.configFile)).mode & 0o777, 0o600);
  const marker = JSON.parse(await fs.readFile(options.markerFile, 'utf8'));
  assert.deepEqual(Object.keys(marker).sort(), ['installedAt', 'path', 'schemaVersion']);
  assert.equal(marker.path, options.configFile);
  assert.equal(marker.schemaVersion, 1);
  assert.ok(Number.isSafeInteger(marker.installedAt));
  const config = JSON.parse(await fs.readFile(options.configFile, 'utf8'));
  assert.equal(config.hooks.Stop[0].hooks[0].command, result.command);
});

test('repeated install/uninstall is idempotent, backups preserve exact previous bytes and other hooks', async (t) => {
  const options = await fixture(t);
  await fs.mkdir(dirname(options.configFile), { recursive: true });
  const original = '{"description":"my config","hooks":{"Stop":[{"matcher":".*","hooks":[{"type":"command","command":"/usr/bin/true"}]}]}}\n';
  await fs.writeFile(options.configFile, original);
  const first = await configureHooks(options);
  assert.equal(await fs.readFile(first.backupFile, 'utf8'), original);
  const installed = await fs.readFile(options.configFile, 'utf8');
  const files = await fs.readdir(dirname(options.configFile));
  const second = await configureHooks(options);
  assert.equal(second.changed, false);
  assert.equal(await fs.readFile(options.configFile, 'utf8'), installed);
  assert.deepEqual(await fs.readdir(dirname(options.configFile)), files);
  const removed = await configureHooks({ ...options, mode: 'uninstall' });
  assert.equal(await fs.readFile(removed.backupFile, 'utf8'), installed);
  assert.deepEqual(JSON.parse(await fs.readFile(options.configFile, 'utf8')), JSON.parse(original));
  await assert.rejects(fs.stat(options.markerFile), { code: 'ENOENT' });
  assert.equal((await configureHooks({ ...options, mode: 'uninstall' })).changed, false);
  assert.ok(await fs.stat(first.adapterPath)); // Never remove a file another process may still execute.
});

test('bad JSON, lock contention and symlinks cannot overwrite existing configuration', async (t) => {
  const options = await fixture(t);
  await fs.mkdir(dirname(options.configFile), { recursive: true });
  await fs.writeFile(options.configFile, '{bad');
  await assert.rejects(configureHooks(options), /not valid JSON/);
  assert.equal(await fs.readFile(options.configFile, 'utf8'), '{bad');
  await fs.writeFile(options.configFile, '{}');
  await fs.writeFile(`${options.configFile}.yanami-install.lock`, 'someone else');
  await assert.rejects(configureHooks(options), { code: 'EEXIST' });
  assert.equal(await fs.readFile(options.configFile, 'utf8'), '{}');
  assert.equal(await fs.readFile(`${options.configFile}.yanami-install.lock`, 'utf8'), 'someone else');
  await fs.unlink(`${options.configFile}.yanami-install.lock`);
  await fs.unlink(options.configFile);
  const target = join(options.root, 'target');
  await fs.writeFile(target, '{}');
  await fs.symlink(target, options.configFile);
  await assert.rejects(configureHooks(options), /non-regular/);
  assert.equal(await fs.readFile(target, 'utf8'), '{}');
});

test('content changes select a new runtime path and therefore a newly reviewable definition', async (t) => {
  const options = await fixture(t);
  const first = await configureHooks(options);
  const changedSource = join(options.root, 'changed-adapter.mjs');
  await fs.writeFile(changedSource, `${await fs.readFile(join(HERE, 'adapter.mjs'), 'utf8')}\n// Version change.\n`);
  const second = await configureHooks({ ...options, adapterPath: changedSource });
  assert.notEqual(first.adapterPath, second.adapterPath);
  assert.notEqual(first.command, second.command);
  assert.equal(second.trustRequired, true);
  assert.equal(Object.values(JSON.parse(await fs.readFile(options.configFile, 'utf8')).hooks).flatMap((groups) => groups.flatMap((group) => group.hooks)).filter(ownedHandler).length, 7);
});

test('reinstall detects a modified runtime and restores a missing runtime without altering hook trust definitions', async (t) => {
  const options = await fixture(t);
  const first = await configureHooks(options);
  const config = await fs.readFile(options.configFile, 'utf8');
  await fs.unlink(first.adapterPath);
  const repaired = await configureHooks(options);
  assert.equal(repaired.changed, false);
  assert.deepEqual(await fs.readFile(repaired.adapterPath), await fs.readFile(join(HERE, 'adapter.mjs')));
  assert.equal(await fs.readFile(options.configFile, 'utf8'), config);
  await fs.chmod(first.adapterPath, 0o600);
  await fs.writeFile(first.adapterPath, '// changed after installation');
  await assert.rejects(configureHooks(options), /content hash/);
  assert.equal(await fs.readFile(options.configFile, 'utf8'), config);
});

test('generated shell command handles spaces and apostrophes in paths', async (t) => {
  const options = await fixture(t);
  const result = await configureHooks(options);
  const execution = await new Promise((resolve, reject) => {
    const child = spawn('/bin/sh', ['-c', result.command], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', (data) => { stdout += data; });
    child.stderr.on('data', (data) => { stderr += data; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(JSON.stringify({ hook_event_name: 'Stop', session_id: 'private', turn_id: 'private-turn' }));
  });
  assert.deepEqual(execution, { code: 0, stdout: '', stderr: '' });
  assert.equal((await fs.readdir(options.spool)).length, 1);
});

test('installation touches no config.toml, trust store or native application state', async (t) => {
  const options = await fixture(t);
  await fs.mkdir(dirname(options.configFile), { recursive: true });
  const sentinel = join(dirname(options.configFile), 'config.toml');
  await fs.writeFile(sentinel, '[features]\nhooks = false\n');
  await configureHooks(options);
  assert.equal(await fs.readFile(sentinel, 'utf8'), '[features]\nhooks = false\n');
  assert.deepEqual((await fs.readdir(dirname(options.configFile))).sort(), ['config.toml', 'hooks.json']);
  assert.equal(TRUST_NOTICE.includes('not trusted'), true);
});
