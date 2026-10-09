const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { directSongQuery } = require("../src/song-matching");

// Exercise the production parser and handler without a Discord login or media requests.
const source = fs.readFileSync(path.join(__dirname, "../src/index.js"), "utf8");
const aliases = source.slice(source.indexOf("const aliasGroups ="), source.indexOf("function stateFor("));
const parser = source.slice(source.indexOf("function stripMention("), source.indexOf("function selected("));
const handler = source.slice(source.indexOf("async function handleMessage("), source.indexOf("async function memberForInteraction("));

function harness({ match = true } = {}) {
  const effects = [];
  const data = { playInVoice: true, nameSearchBusy: false, lastNameSearchAt: 0 };
  const handleMessage = vm.runInNewContext(`${aliases}\n${parser}\n${handler}\nhandleMessage`, {
    selected: () => true,
    directSongQuery,
    guildState: () => { effects.push("state"); return data; },
    enqueue: async (_client, _message, _data, query) => effects.push(`play:${query}`),
    resolveTracks: async (query) => { effects.push(`search:${query}`); return match ? [{ title: query }] : []; },
    enqueueTracks: async (_client, _context, _data, tracks) => effects.push(`matched:${tracks[0].title}`),
    messageContext: () => ({}),
    isAdministrator: () => true,
    arabicNumber: (text) => text.replace(/[٠-٩]/g, (digit) => "٠١٢٣٤٥٦٧٨٩".indexOf(digit)),
    console,
    publicError: (error) => error.message
  });
  return {
    effects,
    data,
    send: (content) => handleMessage({ user: { id: "123" }, ws: { ping: 25 } }, {
      content, author: { bot: false }, guild: { id: "guild" }, channel: {},
      member: { voice: { channel: {}, channelId: "voice" } },
      reply: async (text) => effects.push(`reply:${text}`)
    })
  };
}

test("greetings, repeated letters, and bare unrelated links never start song matching", async () => {
  for (const message of ["aa", "dd", "السلام عليكم", "hello", "https://example.com/file", "<@123> aa"]) {
    const h = harness();
    await h.send(message);
    assert.deepEqual(h.effects, [], message);
  }
});

test("Arabic play command and supported aliases pass only the song name to playback", async () => {
  for (const command of ["ش", "شغل", "play", "p", "1play", "١ش", "<@123> ش"]) {
    const h = harness();
    await h.send(`${command}   اي شي`);
    assert.deepEqual(h.effects, ["state", "play:اي شي"], command);
  }
});

test("a missing song gives usage help without performing a search", async () => {
  const h = harness();
  await h.send("ش");
  assert.equal(h.effects.length, 2);
  assert.match(h.effects[1], /^reply:.*ش/);
});

test("other recognized commands still work", async () => {
  const h = harness();
  await h.send("ping");
  assert.deepEqual(h.effects, ["state", "reply:🏓 25ms"]);
});

test("administrators can switch direct title matching off while keeping commands", async () => {
  const h = harness();
  await h.send("playinvcall off");
  assert.equal(h.data.playInVoice, false);
  h.effects.length = 0;
  await h.send("اي شي");
  assert.deepEqual(h.effects, ["state"]);
  h.effects.length = 0;
  await h.send("ش اي شي");
  assert.deepEqual(h.effects, ["state", "play:اي شي"]);
});

test("a title or a single song word starts only the matched result", async () => {
  for (const title of ["اي شي", "Faded", "فوز"]) {
    const h = harness();
    await h.send(title);
    assert.deepEqual(h.effects, ["state", `search:${title}`, `matched:${title}`]);
    assert.equal(h.data.nameSearchBusy, false);
  }
});

test("unmatched names stay silent and rapid direct searches are limited", async () => {
  const h = harness({ match: false });
  await h.send("unmatched title");
  assert.deepEqual(h.effects, ["state", "search:unmatched title"]);
  h.effects.length = 0;
  await h.send("another title");
  assert.deepEqual(h.effects, ["state"]);
});
