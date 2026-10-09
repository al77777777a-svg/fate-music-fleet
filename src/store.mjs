// src/store.mjs — إعدادات دائمة (تبقى بعد restart) في ملف JSON واحد.
// على Railway لازم Volume + DATA_DIR=/data، وإلا الملف يضيع مع كل deploy.
import { readFileSync, renameSync } from 'node:fs';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';

export function createStore(file) {
  let data = { version: 1, guilds: {} };
  let timer = null;
  let pending = Promise.resolve();

  function load() {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'));
      data = { version: 1, guilds: {}, ...parsed };
    } catch (e) {
      if (e.code === 'ENOENT') return;
      console.error('[store] ملف الإعدادات تالف، انحفظت نسخة منه:', e.message);
      try { renameSync(file, `${file}.corrupt-${Date.now()}`); } catch {}
    }
  }

  async function write() {
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(data, null, 2));
    await rename(tmp, file); // استبدال ذري: ما يتلف الملف لو انقطع التشغيل
  }

  const queueWrite = () => {
    pending = pending.then(write).catch((e) => console.error('[store] فشل الحفظ:', e.message));
  };

  // استدعها بعد أي تعديل
  function save() {
    if (timer) return;
    timer = setTimeout(() => { timer = null; queueWrite(); }, 200);
    timer.unref?.();
  }

  // انتظر الحفظ (للإغلاق النظيف والاختبارات)
  function flush() {
    if (timer) { clearTimeout(timer); timer = null; queueWrite(); }
    return pending;
  }

  const guild = (gid) => (data.guilds[gid] ??= { owners: [], bots: {} });
  const bot = (gid, bid) => (guild(gid).bots[bid] ??= { stay: null, owners: [] });
  const stayOf = (gid, bid) => data.guilds[gid]?.bots?.[bid]?.stay ?? null;
  const guildIds = () => Object.keys(data.guilds);

  load();
  return { save, flush, guild, bot, stayOf, guildIds, get data() { return data; } };
}

export const store = createStore(path.join(process.env.DATA_DIR || path.resolve('data'), 'settings.json'));
