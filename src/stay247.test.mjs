import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';
import { createStore } from '../src/store.mjs';
import { createStay247 } from '../src/stay247.mjs';
import { createOwnerCommands, tierOf, Tier } from '../src/perms.mjs';
import { createSettings, prefixOf, chatAllowed, settingsOf } from '../src/settings.mjs';

class Coll extends Map {
  find(fn) { for (const v of this.values()) if (fn(v)) return v; }
  filter(fn) { return new Coll([...this].filter(([, v]) => fn(v))); }
}

const ID = (n) => `10000000000000000${n}`.slice(-18);
const tmpStore = () => createStore(path.join(mkdtempSync(path.join(os.tmpdir(), 'fleet-')), 's.json'));

function world(botCount = 2, voiceCount = 3) {
  const gid = ID(1);
  const clients = [];
  const guildOf = {};
  for (let b = 0; b < botCount; b++) {
    const guild = { id: gid, channels: { cache: new Coll() }, members: { me: { names: [], voice: {}, setNickname: async (n) => guild.members.me.names.push(n) } } };
    for (let v = 0; v < voiceCount; v++) {
      const ch = { id: ID(50 + v), name: `room${v}`, rawPosition: v, guild, isVoiceBased: () => true, permissionsFor: () => ({ has: () => true }) };
      guild.channels.cache.set(ch.id, ch);
    }
    const client = { user: { id: ID(90 + b), username: `bot${b}` }, guilds: { cache: new Coll([[gid, guild]]) }, isReady: () => false, once() {}, on() {} };
    clients.push(client);
    guildOf[client.user.id] = guild;
  }
  return { gid, clients, guildOf };
}

const msg = (guild, { admin = true, id = ID(7), voice = null } = {}) => {
  const m = { reacts: [], replies: [], guild, author: { id }, member: { id, permissions: { has: () => admin }, voice: { channel: voice } } };
  m.react = async (e) => m.reacts.push(e);
  m.reply = async (o) => m.replies.push(o.content);
  return m;
};

test('الإعدادات تنحفظ وترجع بعد restart', async () => {
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), 'fleet-')), 's.json');
  const a = createStore(file);
  a.bot('g1', 'b1').stay = 'c1';
  a.save();
  await a.flush();
  assert.equal(createStore(file).stayOf('g1', 'b1'), 'c1');
});

test('مستويات الصلاحيات', () => {
  const store = tmpStore();
  store.bot('g', 'b').owners.push('o1');
  store.guild('g').owners.push('o2');
  const t = (id, admin = false) => tierOf({ store, member: { id, permissions: { has: () => admin } }, guildId: 'g', botId: 'b', envOwners: new Set(['o3']) });
  assert.equal(t('x'), Tier.EVERYONE);
  assert.equal(t('x', true), Tier.ADMIN);
  assert.equal(t('o1'), Tier.OWNER);
  assert.equal(t('o2'), Tier.ALL_OWNER);
  assert.equal(t('o3'), Tier.ALL_OWNER);
});

test('come يثبّت، leave يفك، وغير الأدمن يتجاهل', async () => {
  const { gid, clients, guildOf } = world();
  const store = tmpStore();
  const joins = [], leaves = [];
  const s = createStay247({ store, clients, join: async (c, ch) => joins.push([c.user.id, ch.id]), leave: async (c, g) => leaves.push([c.user.id, g]), delayMs: 0, envOwners: new Set() });
  const [c0] = clients;
  const guild = guildOf[c0.user.id];
  const room = guild.channels.cache.get(ID(51));

  const bad = msg(guild, { admin: false, voice: room });
  assert.equal(await s.handle({ client: c0, message: bad, command: 'come' }), true);
  assert.deepEqual(bad.reacts, ['🚫']);
  assert.equal(joins.length, 0);

  const ok = msg(guild, { voice: room });
  await s.handle({ client: c0, message: ok, command: 'afk' });
  assert.deepEqual(joins, [[c0.user.id, ID(51)]]);
  assert.equal(store.stayOf(gid, c0.user.id), ID(51));
  assert.deepEqual(ok.reacts, ['✅']);

  const bye = msg(guild);
  await s.handle({ client: c0, message: bye, command: 'leave' });
  assert.equal(store.stayOf(gid, c0.user.id), null);
  assert.deepEqual(leaves, [[c0.user.id, gid]]);
  assert.equal(await s.handle({ client: c0, message: msg(guild), command: 'play' }), false);
});

test('restore يرجّع البوت لرومه ويمسح الروم المحذوف', async () => {
  const { gid, clients } = world(2);
  const store = tmpStore();
  store.bot(gid, clients[0].user.id).stay = ID(52);
  store.bot(gid, clients[1].user.id).stay = ID(99); // مو موجود
  const joins = [];
  const s = createStay247({ store, clients, join: async (c, ch) => joins.push(ch.id), delayMs: 0 });
  await s.restore(clients[0]);
  await s.restore(clients[1]);
  assert.deepEqual(joins, [ID(52)]);
  assert.equal(store.stayOf(gid, clients[1].user.id), null);
});

test('setupall يوزّع بوت لكل روم ويسمّيه', async () => {
  const { gid, clients, guildOf } = world(2, 3);
  const store = tmpStore();
  store.bot(gid, clients[0].user.id).stay = ID(50); // الروم الأول ماخوذ
  clients.length = 2;
  const s = createStay247({ store, clients, join: async () => {}, delayMs: 0, envOwners: new Set([ID(7)]) });
  const m = msg(guildOf[clients[0].user.id]);
  await s.handle({ client: clients[0], message: m, command: 'setupall' });
  assert.equal(store.stayOf(gid, clients[1].user.id), ID(51));
  assert.deepEqual(guildOf[clients[1].user.id].members.me.names, ['room1']);
});

test('addowner / ownerlist', async () => {
  const { gid, clients, guildOf } = world(1);
  const store = tmpStore();
  const h = createOwnerCommands({ store, envOwners: new Set([ID(7)]) });
  const m = msg(guildOf[clients[0].user.id]);
  await h({ client: clients[0], message: m, command: 'ao', args: [`<@${ID(8)}>`] });
  assert.deepEqual(store.bot(gid, clients[0].user.id).owners, [ID(8)]);
  await h({ client: clients[0], message: m, command: 'ro', args: [ID(8)] });
  assert.deepEqual(store.bot(gid, clients[0].user.id).owners, []);
});

test('settings: prefix / chat / toggles / platform', async () => {
  const { gid, clients, guildOf } = world(2);
  const store = tmpStore();
  const h = createSettings({ store, clients, envOwners: new Set([ID(7)]) });
  const [c0, c1] = clients;
  const g = guildOf[c0.user.id];
  const run = (client, command, args = [], opts) => { const m = msg(g, opts); m.channelId = ID(50); m.channel = { isVoiceBased: () => false }; return h({ client, message: m, command, args }).then(() => m); };

  assert.equal(prefixOf(store, gid, c0.user.id, 3), '3');            // الافتراضي = رقم البوت
  await run(c0, 'prefix', ['!']);
  assert.equal(prefixOf(store, gid, c0.user.id, 3), '!');
  const long = await run(c0, 'prefix', ['abcd']);
  assert.equal(settingsOf(store, gid, c0.user.id).prefix, '!');       // أكثر من 3 حروف مرفوض
  assert.match(long.replies[0], /3/);

  await run(c0, 'chat', [`<#${ID(51)}>`]);
  assert.equal(settingsOf(store, gid, c0.user.id).chatId, ID(51));
  const inChat = { guild: g, channelId: ID(51), channel: { isVoiceBased: () => false } };
  const other = { guild: g, channelId: ID(52), channel: { isVoiceBased: () => false } };
  const vc = { guild: g, channelId: ID(52), channel: { isVoiceBased: () => true } };
  assert.equal(chatAllowed(store, inChat, c0.user.id), true);
  assert.equal(chatAllowed(store, other, c0.user.id), false);
  assert.equal(chatAllowed(store, vc, c0.user.id), true);            // شات الروم الصوتي دايم مسموح
  const off = await run(c0, 'chat', [`<#${ID(51)}>`]);                // نفس الشات يشيله
  assert.deepEqual(off.reacts, ['☑️']);
  assert.equal(settingsOf(store, gid, c0.user.id).chatId, null);

  await run(c0, 'embed');
  assert.equal(settingsOf(store, gid, c0.user.id).embed, true);
  assert.equal(settingsOf(store, gid, c1.user.id).embed, false);      // بوت واحد بس
  await run(c0, 'embedall', ['on']);
  assert.equal(settingsOf(store, gid, c1.user.id).embed, true);       // كل البوتات
  await run(c0, 'platformall', ['soundcloud']);
  assert.equal(settingsOf(store, gid, c1.user.id).platform, 'soundcloud');
  const bad = await run(c0, 'platformall', ['spotify']);
  assert.equal(settingsOf(store, gid, c1.user.id).platform, 'soundcloud');
  assert.match(bad.replies[0], /youtube/);

  const denied = await run(c0, 'embedall', ['off'], { admin: true, id: ID(8) }); // أدمن بس، مو أونر كل البوتات
  assert.deepEqual(denied.reacts, ['🚫']);
  assert.equal(settingsOf(store, gid, c1.user.id).embed, true);
});
