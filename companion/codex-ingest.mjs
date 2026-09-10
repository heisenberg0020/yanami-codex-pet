import * as fs from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { validateCodexEvent } from './codex.mjs';

const ORDER = ['UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'Interrupt', 'Stop', 'SessionEnd'];

/** A private file inbox keeps hook delivery independent of app/server uptime. */
export function createCodexIngestor({ store, spoolDir, now = Date.now }) {
  let pending;
  let notice = null;
  let installed = false;
  async function consume() {
    try {
      const marker = JSON.parse(await fs.readFile(join(dirname(spoolDir), 'codex-hooks-installed.json'), 'utf8').catch(() => 'null'));
      installed = marker?.schemaVersion === 1;
      const names = await fs.readdir(spoolDir).catch(error => {
        if (error.code === 'ENOENT') return [];
        throw error;
      });
      const items = [];
      for (const name of names.filter(name => /^[a-f0-9]{64}\.json$/.test(name)).sort()) {
        const file = join(spoolDir, name);
        try {
          const stat = await fs.lstat(file);
          if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) throw new Error('Invalid inbox file');
          const event = validateCodexEvent(JSON.parse(await fs.readFile(file, 'utf8')));
          if (name !== `${event.id}.json` || event.at > now() + 60_000) throw new Error('Invalid inbox event');
          items.push({ file, event });
        } catch (error) {
          if (error.code === 'ENOENT') continue;
          if (['EACCES', 'EPERM', 'EIO'].includes(error.code)) throw error;
          // Keep malformed bytes for diagnosis; never render their contents.
          await fs.rename(file, `${file}.rejected`);
          notice = '有一条格式异常的联动记录已跳过，原文件已保留。';
        }
      }
      items.sort((a, b) => a.event.at - b.event.at || ORDER.indexOf(a.event.kind) - ORDER.indexOf(b.event.kind) || a.event.id.localeCompare(b.event.id));
      const batch = items.slice(0, 1000);
      if (batch.length) {
        await store.ingest(batch.map(item => item.event), now());
        // The save commits before acknowledgement. Replays cannot credit a turn twice.
        for (const item of batch) await fs.unlink(item.file).catch(error => { if (error.code !== 'ENOENT') throw error; });
      }
    } catch {
      notice = '工作记录暂未同步成功，已留待重试；已有点心和收藏不会改变。';
    }
  }
  return {
    get installed() { return installed; },
    get notice() { return notice; },
    drain() {
      pending ??= consume().finally(() => { pending = undefined; });
      return pending;
    },
  };
}
