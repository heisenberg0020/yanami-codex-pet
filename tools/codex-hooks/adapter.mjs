import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const EVENT_KINDS = Object.freeze([
  'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest',
  'Stop', 'Interrupt', 'SessionEnd',
]);
export const DEFAULT_SPOOL = join(homedir(), 'Library/Application Support/YanamiSnackClub/codex-events');
export const MAX_INPUT_BYTES = 1024 * 1024;
const TURN_REQUIRED = new Set(['UserPromptSubmit', 'Stop', 'Interrupt']);
const TOOL_EVENTS = new Set(['PreToolUse', 'PostToolUse']);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const token = (value) => typeof value === 'string' && value.trim().length > 0 && value.length <= 1024;

/** Allowlist projection only. Never return prompts, paths, arguments, or results. */
export function projectEvent(input, { at = Date.now(), nonce = randomUUID() } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const kind = input.hook_event_name;
  if (!EVENT_KINDS.includes(kind) || !token(input.session_id)) return null;
  if (kind === 'Stop' && input.stop_hook_active === true) return null;
  if (!Number.isSafeInteger(at) || at < 0) return null;
  const sessionId = sha256(input.session_id);
  const turnId = token(input.turn_id) ? sha256(input.turn_id) : null;
  if (TURN_REQUIRED.has(kind) && turnId === null) return null;
  // Completion means a turn ended, never that a task succeeded. The consumer
  // decides eligibility and must require a matching start with a non-null turn.
  const discriminator = TURN_REQUIRED.has(kind) ? null
    : TOOL_EVENTS.has(kind) && token(input.tool_use_id) ? sha256(input.tool_use_id)
      : nonce;
  const id = sha256(JSON.stringify([kind, sessionId, turnId, discriminator]));
  return { schemaVersion: 1, id, kind, sessionId, turnId, at };
}

/** A complete private file appears at once; existing identical IDs keep first receipt time. */
export async function publishEvent(event, directory = process.env.YANAMI_CODEX_SPOOL || DEFAULT_SPOOL) {
  if (!event) return false;
  const spool = resolve(directory);
  await fs.mkdir(spool, { recursive: true, mode: 0o700 });
  const info = await fs.lstat(spool);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Invalid spool directory');
  const temporary = join(spool, `.yanami-${randomUUID()}.tmp`);
  const destination = join(spool, `${event.id}.json`);
  let handle;
  try {
    handle = await fs.open(temporary, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(event)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    try {
      // link is atomic and never replaces an existing record from a concurrent hook.
      await fs.link(temporary, destination);
    } catch (error) {
      if (error.code === 'EEXIST') return false;
      throw error;
    }
    return true;
  } finally {
    await handle?.close().catch(() => {});
    await fs.unlink(temporary).catch(() => {});
  }
}

export async function readEvent(stream, options = {}) {
  const chunks = [];
  let length = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += bytes.length;
    if (length > MAX_INPUT_BYTES) return null;
    chunks.push(bytes);
  }
  try { return projectEvent(JSON.parse(Buffer.concat(chunks).toString('utf8')), options); }
  catch { return null; }
}

function argumentSpool(args) {
  const index = args.indexOf('--spool');
  if (index < 0) return undefined;
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error('Missing spool path');
  return args[index + 1];
}

// All failures are advisory and silent. This command cannot approve, block,
// rewrite a tool call, inject context, or continue a stopped Codex turn.
if (process.argv[1] && fileURLToPath(import.meta.url) === await fs.realpath(resolve(process.argv[1])).catch(() => null)) {
  const watchdog = setTimeout(() => process.exit(0), 800);
  try {
    const event = await readEvent(process.stdin, { at: Date.now() });
    if (event) await publishEvent(event, argumentSpool(process.argv.slice(2)));
  } catch { /* Do not leak raw input or local paths into hook diagnostics. */ }
  finally { clearTimeout(watchdog); process.exit(0); }
}
