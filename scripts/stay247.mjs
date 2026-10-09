// src/stay247.mjs — تثبيت البوتات في الرومات 24 ساعة
// الأوامر: come/afk, leave/le/left, setup/se, comeall/joinall/afkall, setupall, checkchannelall
// ملاحظة: ما سجّلت `join` كاختصار لـ come لأنه عندك مستخدم لاستدعاء بوت متاح.
import { Tier, tierOf, parseOwnerIds } from './perms.mjs';

const NEEDED = ['ViewChannel', 'Connect', 'Speak'];
// View, Send, Embed, Attach, History, Connect, Speak
const INVITE_PERMS = 3263488;
export const inviteUrl = (clientId) =>
  `https://discord.com/oauth2/authorize?client_id=${clientId}&scope=bot&permissions=${INVITE_PERMS}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isVoice = (c) => c?.isVoiceBased?.() === true;

// الاتصال الافتراضي. group = ايدي البوت، وبدونه البوتات العشرة تتصادم في نفس العملية.
// إذا عندك مدير اتصالات خاص فيك، مرّر join/leave بتاعتك بدل هذي (انظر INTEGRATION.md).
export async function defaultJoin(client, channel) {
  const { joinVoiceChannel } = await import('@discordjs/voice');
  return joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
    group: client.user.id,
    selfDeaf: true,
  });
}
export async function defaultLeave(client, guildId) {
  const { getVoiceConnection } = await import('@discordjs/voice');
  getVoiceConnection(guildId, client.user.id)?.destroy();
}

// منشن الروم، أو الايدي، أو الاسم، وبدون وسيط ياخذ روم العضو
export function resolveVoiceChannel(guild, arg, member) {
  if (!arg) return member?.voice?.channel ?? null;
  const id = arg.match(/^<#(\d+)>$/)?.[1] ?? (/^\d{17,20}$/.test(arg) ? arg : null);
  if (id) { const c = guild.channels.cache.get(id); return isVoice(c) ? c : null; }
  const name = arg.toLowerCase();
  return guild.channels.cache.find((c) => isVoice(c) && c.name.toLowerCase() === name) ?? null;
}

const ALIAS = {
  come: 'come', afk: 'come',
  leave: 'leave', le: 'leave', left: 'leave',
  setup: 'setup', se: 'setup',
  comeall: 'comeall', joinall: 'comeall', afkall: 'comeall',
  setupall: 'setupall',
  checkchannelall: 'checkchannelall',
};
const NEED = {
  come: Tier.ADMIN, leave: Tier.ADMIN,
  setup: Tier.OWNER, comeall: Tier.OWNER,
  setupall: Tier.ALL_OWNER, checkchannelall: Tier.ALL_OWNER,
};

export function createStay247({
  store,
  clients,                                   // كل كلاينتات الأسطول
  envOwners = parseOwnerIds(process.env.OWNER_IDS),
  join = defaultJoin,
  leave = defaultLeave,
  log = console,
  delayMs = 400,                             // فاصل بين دخول البوتات
  readyEvent = 'clientReady',                // discord.js >= 14.17 (وقبلها 'ready')
}) {
  const rejoinLog = new Map();

  async function stay(client, channel) {
    const me = channel.guild.members.me;
    if (!channel.permissionsFor(me)?.has(NEEDED)) return { ok: false, reason: 'perms' };
    try {
      await join(client, channel);
    } catch (e) {
      log.error(`[247] فشل الدخول ${client.user.username}:`, e?.message ?? e);
      return { ok: false, reason: 'join' };
    }
    store.bot(channel.guild.id, client.user.id).stay = channel.id;
    store.save();
    return { ok: true };
  }

  async function unstay(client, guildId) {
    store.bot(guildId, client.user.id).stay = null; // أول شي، عشان ما يرجع لوحده
    store.save();
    await leave(client, guildId);
  }

  const rename = (channel) =>
    channel.guild.members.me.setNickname(channel.name.slice(0, 32)).then(() => true, () => false);

  // بعد restart: ارجع لكل روم محفوظ
  async function restore(client) {
    for (const gid of store.guildIds()) {
      const channelId = store.stayOf(gid, client.user.id);
      const guild = client.guilds.cache.get(gid);
      if (!channelId || !guild) continue;               // مو داخل السيرفر: خل الإعداد محفوظ
      const channel = guild.channels.cache.get(channelId);
      if (!channel) {                                   // الروم انحذف
        store.bot(gid, client.user.id).stay = null;
        store.save();
        continue;
      }
      const r = await stay(client, channel);
      if (!r.ok) log.warn(`[247] ما قدر يرجع ${client.user.username} → ${channel.name} (${r.reason})`);
      await sleep(delayMs);
    }
  }

  // إذا انفصل البوت من الروم (مو بأمر leave) يرجع. أقصى 5 محاولات في الدقيقة.
  function onVoiceState(client, _old, next) {
    if (next.id !== client.user.id || next.channelId) return;
    const gid = next.guild.id;
    const channelId = store.stayOf(gid, client.user.id);
    if (!channelId) return;

    const key = `${client.user.id}:${gid}`;
    const now = Date.now();
    const prev = rejoinLog.get(key);
    const rec = !prev || now - prev.since > 60_000 ? { since: now, n: 0 } : prev;
    rejoinLog.set(key, rec);
    if (++rec.n > 5) { log.warn(`[247] وقفت إعادة الدخول: ${key}`); return; }

    setTimeout(async () => {
      if (store.stayOf(gid, client.user.id) !== channelId) return; // صار leave بالأثناء
      const ch = next.guild.channels.cache.get(channelId);
      if (ch) await stay(client, ch);
    }, 3000).unref?.();
  }

  // استدعها مرة لكل كلاينت بعد إنشائه
  function attach(client) {
    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      restore(client).catch((e) => log.error('[247] restore:', e));
    };
    if (client.isReady?.()) start();
    client.once(readyEvent, start);
    client.on('voiceStateUpdate', (o, n) => onVoiceState(client, o, n));
  }

  const react = (m, e) => m.react(e).catch(() => {});
  const say = (m, c) => m.reply({ content: c.slice(0, 1900), allowedMentions: { parse: [], repliedUser: false } }).catch(() => {});

  // يرجّع true إذا الأمر انعالج. مرّر command بدون البادئة/المنشن.
  async function handle({ client, message, command, args = [] }) {
    const kind = ALIAS[command?.toLowerCase()];
    if (!kind || !message.guild) return false;

    const gid = message.guild.id;
    const member = message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
    if (tierOf({ store, member, guildId: gid, botId: client.user.id, envOwners }) < NEED[kind]) {
      await react(message, '🚫');
      return true;
    }

    if (kind === 'leave') {
      await unstay(client, gid);
      await react(message, '☑️');
      return true;
    }

    if (kind === 'checkchannelall') {
      const lines = clients.map((c) => {
        const g = c.guilds.cache.get(gid);
        if (!g) return `🔴 ${c.user.username} — <${inviteUrl(c.user.id)}>`;
        const vc = g.members.me?.voice?.channel;
        return vc ? `🎶 ${c.user.username} — ${vc.name}` : `⏳ ${c.user.username}`;
      });
      await say(message, lines.join('\n'));
      return true;
    }

    if (kind === 'setupall') {
      const taken = new Set(clients.map((c) => store.stayOf(gid, c.user.id)).filter(Boolean));
      const free = [...message.guild.channels.cache.filter(isVoice).values()]
        .sort((a, b) => a.rawPosition - b.rawPosition)
        .filter((ch) => !taken.has(ch.id));
      const idle = clients.filter((c) => c.guilds.cache.has(gid) && !store.stayOf(gid, c.user.id));
      let done = 0, failed = 0;
      for (const [i, c] of idle.entries()) {
        const target = free[i];
        if (!target) break;
        const ch = c.guilds.cache.get(gid).channels.cache.get(target.id);
        const r = ch ? await stay(c, ch) : { ok: false };
        if (r.ok) { await rename(ch); done++; } else failed++;
        await sleep(delayMs);
      }
      const out = clients.filter((c) => !c.guilds.cache.has(gid)).length;
      await say(message, `✅ ${done}  🔴 ${failed}  (برا السيرفر: ${out}، رومات فاضية بقت: ${Math.max(0, free.length - idle.length)})`);
      return true;
    }

    // come / setup / comeall
    const target = resolveVoiceChannel(message.guild, args.join(' ').trim(), member);
    if (!target) {
      await say(message, 'ادخل روم صوتي أو حدد الروم، مثال: `come #voice`');
      return true;
    }

    if (kind === 'comeall') {
      let ok = 0;
      const bad = [];
      for (const c of clients) {
        const ch = c.guilds.cache.get(gid)?.channels.cache.get(target.id);
        const r = ch ? await stay(c, ch) : { ok: false, reason: 'not-in-server' };
        if (r.ok) ok++; else bad.push(`${c.user.username} (${r.reason})`);
        await sleep(delayMs);
      }
      await say(message, `🎶 ${ok}/${clients.length}` + (bad.length ? `\n🔴 ${bad.join('، ')}` : ''));
      return true;
    }

    const r = await stay(client, target);
    if (!r.ok) {
      await react(message, '🔴');
      await say(message, r.reason === 'perms' ? 'البوت يحتاج View Channel و Connect و Speak في الروم.' : 'ما قدرت أدخل الروم.');
      return true;
    }
    if (kind === 'setup') await rename(target); // لو فشل التسمية يظل مثبّت
    await react(message, '✅');
    return true;
  }

  return { handle, attach, restore, stay, unstay };
}
