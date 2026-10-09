// src/settings.mjs — إعدادات كل بوت (وأخواتها *all لكل البوتات) حسب دليل فيت ستور
// per-bot: prefix, chat, settings, buttons, embed, playinvc, lang, platform, ecolor
// all-bots: buttonsall, embedall, playinvcall, langall, platformall, chatall, ecolorall
import { Tier, tierOf, parseOwnerIds } from './perms.mjs';

// playinvc مفعّل افتراضياً عشان يبقى سلوك "اكتب اسم الأغنية مباشرة" اللي عندك
export const DEFAULTS = Object.freeze({
  prefix: null, chatId: null, embed: false, buttons: false,
  playinvc: true, platform: 'youtube', lang: 'en', ecolor: null,
});

export const settingsOf = (store, gid, bid) => ({ ...DEFAULTS, ...(store.data.guilds[gid]?.bots?.[bid] ?? {}) });

// البادئة الافتراضية = رقم البوت (0، 1، 2…). none تخزّن نص فاضي.
export function prefixOf(store, gid, bid, index) {
  const p = settingsOf(store, gid, bid).prefix;
  return p === null ? String(index) : p;
}

// استخدمها في الموجّه: الأوامر تشتغل بس في شات الأوامر المحدد وفي شات الروم الصوتي نفسه
export function chatAllowed(store, message, botId) {
  const { chatId } = settingsOf(store, message.guild.id, botId);
  return !chatId || (message.channelId ?? message.channel?.id) === chatId || message.channel?.isVoiceBased?.() === true;
}

const ALIAS = {
  prefix: 'prefix', setprefix: 'prefix',
  chat: 'chat', setchat: 'chat',
  settings: 'settings', setting: 'settings', 'اعدادات': 'settings',
  buttons: 'buttons', setbuttons: 'buttons',
  embed: 'embed', setembed: 'embed',
  playinvc: 'playinvc',
  lang: 'lang', setlang: 'lang',
  platform: 'platform',
  ecolor: 'ecolor', setecolor: 'ecolor',
  buttonsall: 'buttons+', embedall: 'embed+', playinvcall: 'playinvc+',
  langall: 'lang+', platformall: 'platform+',
  chatall: 'chat+', setchatall: 'chat+',
  ecolorall: 'ecolor+', setecolorall: 'ecolor+',
};
const ADMIN_ONLY = new Set(['prefix', 'chat', 'settings']);
const ENUMS = { lang: ['ar', 'en'], platform: ['youtube', 'soundcloud'] };

export function createSettings({ store, clients, envOwners = parseOwnerIds(process.env.OWNER_IDS) }) {
  const react = (m, e) => m.react(e).catch(() => {});
  const say = (m, c) => m.reply({ content: c.slice(0, 1900), allowedMentions: { parse: [], repliedUser: false } }).catch(() => {});
  const onoff = (v) => (v ? 'on' : 'off');

  return async function handle({ client, message, command, args = [] }) {
    const raw = ALIAS[command?.toLowerCase()];
    if (!raw || !message.guild) return false;
    const all = raw.endsWith('+');
    const kind = raw.replace('+', '');
    const gid = message.guild.id;

    const member = message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
    const need = all ? Tier.ALL_OWNER : ADMIN_ONLY.has(kind) ? Tier.ADMIN : Tier.OWNER;
    if (tierOf({ store, member, guildId: gid, botId: client.user.id, envOwners }) < need) {
      await react(message, '🚫');
      return true;
    }

    const targets = all ? clients.filter((c) => c.guilds.cache.has(gid)) : [client];
    const apply = (key, value) => { for (const c of targets) store.bot(gid, c.user.id)[key] = value; store.save(); };
    const arg = args[0]?.toLowerCase();
    const cur = settingsOf(store, gid, client.user.id);

    switch (kind) {
      case 'prefix': {
        if (!args[0]) { await say(message, `البادئة: \`${cur.prefix ?? '(الافتراضية = رقم البوت)'}\``); return true; }
        const v = arg === 'none' ? '' : args[0];
        if (v.length > 3) { await say(message, 'البادئة لازم تكون 3 حروف أو أقل.'); return true; }
        apply('prefix', v);
        break;
      }
      case 'chat': {
        const id = args[0]?.match(/^<#(\d+)>$/)?.[1] ?? (/^\d{17,20}$/.test(args[0] ?? '') ? args[0] : null);
        if (all && arg === 'none') { apply('chatId', null); break; }
        if (!id || !message.guild.channels.cache.has(id)) { await say(message, 'حدد الشات: `chat #commands`' + (all ? ' أو `none`' : '')); return true; }
        if (!all && cur.chatId === id) { apply('chatId', null); await react(message, '☑️'); return true; } // نفس الشات مرة ثانية يشيله
        apply('chatId', id);
        break;
      }
      case 'settings': {
        const stay = store.stayOf(gid, client.user.id);
        await say(message, [
          `Prefix: ${cur.prefix === null ? '(رقم البوت)' : cur.prefix || 'none'}`,
          `24/7: ${stay ? `<#${stay}>` : '—'}`,
          `Chat: ${cur.chatId ? `<#${cur.chatId}>` : '—'}`,
          `Embed: ${onoff(cur.embed)} | Buttons: ${onoff(cur.buttons)} | Play-in-room: ${onoff(cur.playinvc)}`,
          `Platform: ${cur.platform} | Lang: ${cur.lang}`,
        ].join('\n'));
        return true;
      }
      case 'buttons': case 'embed': case 'playinvc': {
        let v;
        if (all) {
          if (!['on', 'off'].includes(arg)) { await say(message, `استخدم: \`${command} on\` أو \`${command} off\``); return true; }
          v = arg === 'on';
        } else v = !cur[kind];
        apply(kind, v);
        await react(message, v ? '✅' : '☑️');
        return true;
      }
      case 'lang': case 'platform': {
        if (!ENUMS[kind].includes(arg)) { await say(message, `القيم المتاحة: ${ENUMS[kind].join(' | ')}`); return true; }
        apply(kind, arg);
        break;
      }
      case 'ecolor': {
        if (arg === 'none') { apply('ecolor', null); break; }
        if (!/^#[0-9a-f]{6}$/i.test(args[0] ?? '')) { await say(message, 'اللون لازم يبدأ بـ # مثل `#ff5500`'); return true; }
        apply('ecolor', args[0].toLowerCase());
        break;
      }
    }
    await react(message, '✅');
    return true;
  };
}
