import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SPOOL, EVENT_KINDS } from './adapter.mjs';

export const OWNER = 'Yanami Snack Club · minimal activity event v1';
export const COMMAND_MARKER = '--yanami-codex-hook-v1';
export const TRUST_NOTICE = 'Hooks are configured, not trusted. Review the exact definitions with the official Codex /hooks command before trusting them. New or changed definitions are skipped until trusted. This installer never changes trust state or bypasses review.';
const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_RUNTIME = join(homedir(), 'Library/Application Support/YanamiSnackClub/codex-hook-runtime');
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;

export function ownedHandler(handler) {
  return plain(handler) && handler.type === 'command' && handler.statusMessage === OWNER
    && typeof handler.command === 'string'
    && (handler.command.endsWith(` ${COMMAND_MARKER}`) || handler.command.includes(` ${COMMAND_MARKER} --spool `));
}

function checkConfig(config) {
  if (!plain(config)) throw new Error('hooks.json must contain an object; no files were changed.');
  if (config.hooks !== undefined && !plain(config.hooks)) throw new Error('hooks must be an object; no files were changed.');
  for (const [event, groups] of Object.entries(config.hooks ?? {})) {
    if (!Array.isArray(groups) || groups.some((group) => !plain(group) || !Array.isArray(group.hooks))) {
      throw new Error(`Invalid hook groups for ${event}; no files were changed.`);
    }
  }
}

export function mergeConfig(config, { command, mode = 'install' }) {
  checkConfig(config);
  if (!['install', 'uninstall'].includes(mode)) throw new Error('Unsupported operation.');
  const next = structuredClone(config);
  const eventMap = next.hooks ?? {};
  let removed = 0;
  for (const [event, groups] of Object.entries(eventMap)) {
    eventMap[event] = groups.flatMap((group) => {
      const others = group.hooks.filter((handler) => !ownedHandler(handler));
      const count = group.hooks.length - others.length;
      removed += count;
      // Preserve every unrelated matcher group, even an existing empty group.
      return count === 0 ? [group] : others.length ? [{ ...group, hooks: others }] : [];
    });
    if (eventMap[event].length === 0 && groups.some((group) => group.hooks.some(ownedHandler))) delete eventMap[event];
  }
  if (mode === 'install') {
    if (typeof command !== 'string' || !command) throw new Error('Missing hook command.');
    for (const event of EVENT_KINDS) {
      const handler = { type: 'command', command, timeout: 1, statusMessage: OWNER };
      // SessionEnd is always synchronous by the documented Codex contract.
      if (event !== 'SessionEnd') handler.async = true;
      (eventMap[event] ??= []).push({ hooks: [handler] });
    }
    next.hooks = eventMap;
  } else if (next.hooks !== undefined) next.hooks = eventMap;
  return { config: next, removed, added: mode === 'install' ? EVENT_KINDS.length : 0 };
}

async function readExisting(file) {
  try {
    const metadata = await fs.lstat(file);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error('Refusing a non-regular hooks.json.');
    const raw = await fs.readFile(file, 'utf8');
    let config;
    try { config = JSON.parse(raw); } catch { throw new Error('hooks.json is not valid JSON; no files were changed.'); }
    checkConfig(config);
    return { raw, config, mode: metadata.mode & 0o777 };
  } catch (error) {
    if (error.code === 'ENOENT') return { raw: null, config: {}, mode: 0o600 };
    throw error;
  }
}

async function writePrivate(file, data) {
  const handle = await fs.open(file, 'wx', 0o600);
  try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
}

async function updateMarker(file, configFile, mode) {
  let previous;
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Refusing a non-regular installation marker.');
    previous = JSON.parse(await fs.readFile(file, 'utf8'));
    if (!plain(previous) || previous.schemaVersion !== 1 || previous.path !== configFile
      || Object.keys(previous).sort().join(',') !== 'installedAt,path,schemaVersion') {
      throw new Error('Existing installation marker belongs to another configuration; it was preserved.');
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (mode === 'uninstall') {
    if (previous) await fs.unlink(file);
    return;
  }
  if (previous) return;
  await fs.mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writePrivate(temporary, `${JSON.stringify({ schemaVersion: 1, installedAt: Date.now(), path: configFile }, null, 2)}\n`);
    await fs.link(temporary, file);
  } finally { await fs.unlink(temporary).catch(() => {}); }
}

export async function configureHooks({
  mode = 'install',
  configFile = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'hooks.json'),
  runtimeDir = DEFAULT_RUNTIME,
  nodePath = process.execPath,
  adapterPath = join(HERE, 'adapter.mjs'),
  spool,
  markerFile = join(dirname(resolve(spool || process.env.YANAMI_CODEX_SPOOL || DEFAULT_SPOOL)), 'codex-hooks-installed.json'),
  dryRun = false,
} = {}) {
  if (!['install', 'uninstall'].includes(mode)) throw new Error('Choose install or uninstall.');
  configFile = resolve(configFile);
  const existing = await readExisting(configFile);
  let command;
  let targetAdapter;
  let adapter;
  let runtimeNeeded = false;
  if (mode === 'install') {
    if (!isAbsolute(nodePath)) throw new Error('--node must be an absolute executable path.');
    nodePath = await fs.realpath(nodePath);
    await fs.access(nodePath, fs.constants.X_OK);
    adapter = await fs.readFile(resolve(adapterPath));
    const digest = createHash('sha256').update(adapter).digest('hex');
    targetAdapter = join(resolve(runtimeDir), `adapter-${digest}.mjs`);
    try {
      const metadata = await fs.lstat(targetAdapter);
      if (!metadata.isFile() || metadata.isSymbolicLink() || !adapter.equals(await fs.readFile(targetAdapter))) {
        throw new Error('Existing runtime adapter does not match its content hash.');
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      runtimeNeeded = true;
    }
    command = `${quote(nodePath)} ${quote(targetAdapter)} ${COMMAND_MARKER}`;
    if (spool !== undefined) command += ` --spool ${quote(resolve(spool))}`;
  }
  const merged = mergeConfig(existing.config, { command, mode });
  const changed = JSON.stringify(merged.config) !== JSON.stringify(existing.config);
  markerFile = resolve(markerFile);
  const result = { mode, changed, dryRun, configFile, command: command ?? null, adapterPath: targetAdapter ?? null, eventKinds: EVENT_KINDS, markerFile, backupFile: null, trustRequired: mode === 'install', notice: mode === 'install' ? TRUST_NOTICE : 'Only this integration’s matching handlers were removed. Other hooks and all trust records were left alone.' };
  if (dryRun) return result;
  if (!changed && !runtimeNeeded) { await updateMarker(markerFile, configFile, mode); return result; }

  await fs.mkdir(dirname(configFile), { recursive: true, mode: 0o700 });
  const lock = `${configFile}.yanami-install.lock`;
  let lockHandle;
  let temporary;
  try {
    lockHandle = await fs.open(lock, 'wx', 0o600);
    const latest = await readExisting(configFile);
    if (latest.raw !== existing.raw) throw new Error('hooks.json changed during planning; retry after reviewing the new file.');
    if (mode === 'install') {
      await fs.mkdir(dirname(targetAdapter), { recursive: true, mode: 0o700 });
      const metadata = await fs.lstat(dirname(targetAdapter));
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error('Refusing a non-directory hook runtime.');
      try { await writePrivate(targetAdapter, adapter); await fs.chmod(targetAdapter, 0o400); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const metadata = await fs.lstat(targetAdapter);
        if (!metadata.isFile() || metadata.isSymbolicLink() || !adapter.equals(await fs.readFile(targetAdapter))) throw new Error('Existing runtime adapter does not match its content hash.');
      }
    }
    if (!changed) { await updateMarker(markerFile, configFile, mode); return result; }
    if (existing.raw !== null) {
      result.backupFile = `${configFile}.yanami-backup-${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}`;
      await writePrivate(result.backupFile, existing.raw);
    }
    temporary = `${configFile}.yanami-${randomUUID()}.tmp`;
    await writePrivate(temporary, `${JSON.stringify(merged.config, null, 2)}\n`);
    await fs.chmod(temporary, existing.mode);
    // Recheck after preparing files; unrelated tools do not participate in our lock.
    if ((await readExisting(configFile)).raw !== existing.raw) throw new Error('hooks.json changed while preparing the update; it was not replaced.');
    await fs.rename(temporary, configFile);
    temporary = undefined;
    await updateMarker(markerFile, configFile, mode);
    return result;
  } finally {
    if (temporary) await fs.unlink(temporary).catch(() => {});
    if (lockHandle) { await lockHandle.close(); await fs.unlink(lock).catch(() => {}); }
  }
}

function parseArgs(args) {
  const mode = args.shift();
  if (!['install', 'uninstall'].includes(mode)) throw new Error('Usage: node tools/codex-hooks/install.mjs install|uninstall [--dry-run] [--config FILE] [--node ABSOLUTE_NODE] [--runtime-dir DIR] [--spool DIR] [--marker-file FILE]');
  const options = { mode };
  const flags = { '--config': 'configFile', '--node': 'nodePath', '--runtime-dir': 'runtimeDir', '--spool': 'spool', '--marker-file': 'markerFile' };
  while (args.length) {
    const flag = args.shift();
    if (flag === '--dry-run') { options.dryRun = true; continue; }
    if (!flags[flag] || !args[0] || args[0].startsWith('--')) throw new Error(`Unknown or incomplete option: ${flag}`);
    options[flags[flag]] = args.shift();
  }
  return options;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === await fs.realpath(resolve(process.argv[1])).catch(() => null)) {
  try { console.log(JSON.stringify(await configureHooks(parseArgs(process.argv.slice(2))), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
