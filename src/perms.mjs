// src/perms.mjs — مستويات الصلاحيات + أوامر الأونرات (addowner / ownerlist ...)
export const Tier = Object.freeze({ EVERYONE: 0, ADMIN: 1, OWNER: 2, ALL_OWNER: 3 });

export const parseOwnerIds = (raw = '') =>
  new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));

export const extractUserId = (s = '') =>
  s.match(/^<@!?(\d{17,20})>$/)?.[1] ?? (/^\d{17,20}$/.test(s) ? s : null);

// OWNER_IDS = صاحب الاشتراك = أونر لكل البوتات
export function tierOf({ store, member, guildId, botId, envOwners = new Set() }) {
  if (!member) return Tier.EVERYONE;
  const g = store.data.guilds[guildId];
  if (envOwners.has(member.id) || g?.owners?.includes(member.id)) return Tier.ALL_OWNER;
  if (g?.bots?.[botId]?.owners?.includes(member.id)) return Tier.OWNER;
  return member.permissions?.has('Administrator') ? Tier.ADMIN : Tier.EVERYONE;
}

const ALIAS = {
  addowner: 'add', ao: 'add',
  removeowner: 'remove', ro: 'remove',
  ownerlist: 'list', owners: 'list',
  addownerall: 'addall', removeownerall: 'removeall',
};
const NEED = { add: Tier.OWNER, remove: Tier.OWNER, list: Tier.OWNER, addall: Tier.ALL_OWNER, removeall: Tier.ALL_OWNER };

export function createOwnerCommands({ store, envOwners = parseOwnerIds(process.env.OWNER_IDS) }) {
  const say = (m, content) =>
    m.reply({ content, allowedMentions: { parse: [], repliedUser: false } }).catch(() => {});

  // يرجّع true إذا الأمر انعالج
  return async function handle({ client, message, command, args = [] }) {
    const kind = ALIAS[command?.toLowerCase()];
    if (!kind || !message.guild) return false;

    const gid = message.guild.id;
    const botId = client.user.id;
    const member = message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
    if (tierOf({ store, member, guildId: gid, botId, envOwners }) < NEED[kind]) {
      await message.react('🚫').catch(() => {});
      return true;
    }

    if (kind === 'list') {
      const mine = store.bot(gid, botId).owners;
      const all = [...envOwners, ...store.guild(gid).owners];
      const fmt = (ids) => (ids.length ? ids.map((i) => `<@${i}>`).join(' ') : '—');
      await say(message, `أونرات هالبوت: ${fmt(mine)}\nأونرات كل البوتات: ${fmt([...new Set(all)])}`);
      return true;
    }

    const id = extractUserId(args[0]);
    if (!id) { await say(message, 'منشن العضو أو حط الايدي.'); return true; }

    const list = kind.endsWith('all') ? store.guild(gid).owners : store.bot(gid, botId).owners;
    const i = list.indexOf(id);
    if (kind.startsWith('add') && i === -1) list.push(id);
    if (kind.startsWith('remove') && i !== -1) list.splice(i, 1);
    store.save();
    await message.react('✅').catch(() => {});
    return true;
  };
}
