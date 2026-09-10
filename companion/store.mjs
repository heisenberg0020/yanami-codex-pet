import * as fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { createInitialState, applyAction, viewState, validateState } from './domain.mjs';

export const DEFAULT_DATA_FILE = resolve(homedir(), 'Library/Application Support/YanamiSnackClub/state.json');

export class StoreError extends Error {
  constructor(code, message, status = 503, options) {
    super(message, options);
    this.name = 'StoreError';
    this.code = code;
    this.status = status;
  }
}

/** One store owns one file. The HTTP process is its sole writer. */
export async function createStore({ dataFile = DEFAULT_DATA_FILE, now = Date.now, io = fs } = {}) {
  dataFile = resolve(dataFile);
  const backupFile = `${dataFile}.bak`;
  let state;
  let recoveryNotice;
  let queue = Promise.resolve();

  async function inspect(file) {
    let raw;
    try {
      raw = await io.readFile(file, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return { kind: 'missing' };
      throw new StoreError('SAVE_UNREADABLE', '无法读取本地存档，请检查文件访问权限。', 503, { cause: error });
    }
    try {
      return { kind: 'valid', state: validateState(JSON.parse(raw)) };
    } catch {
      return { kind: 'invalid' };
    }
  }

  async function atomicWrite(file, value) {
    const temporary = `${file}.tmp-${randomUUID()}`;
    let handle;
    try {
      handle = await io.open(temporary, 'wx', 0o600);
      await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
      await handle.sync();
      await handle.close();
      handle = undefined;
      await io.rename(temporary, file);
      // Sync the rename as well as the file contents on the target macOS filesystem.
      const directory = await io.open(dirname(file), 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    } finally {
      if (handle) await handle.close().catch(() => {});
      await io.unlink(temporary).catch(() => {});
    }
  }

  async function save(next, previous) {
    try {
      // A validated previous version remains recoverable if writing the new main file fails.
      await atomicWrite(backupFile, previous ?? next);
      await atomicWrite(dataFile, next);
    } catch (error) {
      // A rename may have succeeded before directory fsync failed. Reconcile the
      // in-memory state so a retry with the same action id cannot apply twice.
      try {
        const disk = await inspect(dataFile);
        if (disk.kind === 'valid') state = disk.state;
      } catch { /* Keep the last known state; still report failure. */ }
      throw new StoreError('SAVE_FAILED', '这次操作未能确认保存，请检查磁盘后重试。', 503, { cause: error });
    }
  }

  await io.mkdir(dirname(dataFile), { recursive: true, mode: 0o700 });
  const main = await inspect(dataFile);
  if (main.kind === 'valid') {
    state = main.state;
  } else {
    const backup = await inspect(backupFile);
    if (main.kind === 'missing' && backup.kind === 'missing') {
      const initial = validateState(createInitialState(now()));
      await save(initial);
      state = initial;
    } else if (backup.kind === 'valid') {
      try {
        if (main.kind === 'invalid') {
          // Keep the exact damaged bytes; never overwrite them during recovery.
          const damagedFile = `${dataFile}.corrupt-${now()}-${randomUUID()}`;
          await io.copyFile(dataFile, damagedFile, 1 /* COPYFILE_EXCL */);
          await io.chmod(damagedFile, 0o600);
        }
        await atomicWrite(dataFile, backup.state);
      } catch (error) {
        throw new StoreError('RECOVERY_FAILED', '发现可用备份，但恢复失败；原存档与备份已保留。', 503, { cause: error });
      }
      state = backup.state;
      recoveryNotice = main.kind === 'invalid'
        ? '存档损坏，已恢复上一份有效备份，并保留损坏文件。最近一次操作可能需要重新确认。'
        : '主存档缺失，已恢复有效备份。最近一次操作可能需要重新确认。';
    } else {
      throw new StoreError('SAVE_CORRUPT', '存档与备份没有可用版本，已保留原文件；请先修复或找回存档。', 503);
    }
  }

  function serial(operation) {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  }

  return {
    dataFile,
    backupFile,
    get recoveryNotice() { return recoveryNotice; },
    read(at) {
      return serial(() => viewState(structuredClone(state), at ?? now()));
    },
    dispatch(action, at) {
      return serial(async () => {
        const result = applyAction(structuredClone(state), structuredClone(action), at ?? now());
        const next = validateState(result.state);
        // Idempotent replays may derive an expired timer but must not rotate backups.
        if (next.revision !== state.revision) {
          await save(next, state);
          state = next;
        }
        return { ...result, state: structuredClone(next) };
      });
    },
  };
}
