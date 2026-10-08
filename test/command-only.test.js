const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Exercise the production parser and handler without a Discord login or media requests.
const source = fs.readFileSync(path.join(__dirname, "../src/index.js"), "utf8");
const aliases = source.slice(source.indexOf("const aliasGroups ="), source.indexOf("function stateFor("));
const parser = source.slice(source.indexOf("function stripMention("), source.indexOf("function selected("));
const handler = source.slice(source.indexOf("async function handleMessage("), source.indexOf("async function memberForInteraction("));

function harness() {
  const effects = [];
  const handleMessage = vm.runInNewContext(`${aliases}\n${parser}\n${handler}\nhandleMessage`, {
    selected: () => true,
    guildState: () => { effects.push("state"); return {}; },
    enqueue: async (_client, _message, _data, query) => effects.push(`play:${query}`),
    isAdministrator: () => true,
    arabicNumber: (text) => text.replace(/[٠-٩]/g, (digit) => "٠١٢٣٤٥٦٧٨٩".indexOf(digit)),
    console,
    publicError: (error) => error.message
  });
  return {
    effects,
    send: (content) => handleMessage({ user: { id: "123" }, ws: { ping: 25 } }, {
      content, author: { bot: false }, guild: { id: "guild" }, channel: {},
      member: { voice: { channel: {}, channelId: "voice" } },
      reply: async (text) => effects.push(`reply:${text}`)
    })
  };
}

test("ordinary chat, bare song names, and links never search, react, or reply", async () => {
  for (const message of ["aa", "dd", "السلام عليكم", "اي شي", "blinding lights", "https://soundcloud.com/artist/song", "<@123> aa"]) {
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

test("the old admin setting cannot re-enable ordinary chat playback", async () => {
  const h = harness();
  await h.send("playinvcall on");
  assert.match(h.effects[1], /مُلغى/);
  h.effects.length = 0;
  await h.send("aa");
  assert.deepEqual(h.effects, []);
});
