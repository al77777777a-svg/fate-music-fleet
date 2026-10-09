const { test } = require("node:test");
const assert = require("node:assert/strict");
const { selectRoomBot, isSameRoomChat } = require("../src/room-routing");

const bots = [
  { id: "one", index: 0, channelId: "voice-a" },
  { id: "two", index: 1, channelId: "voice-b" },
  { id: "three", index: 2, channelId: null }
];
const base = { bots, channelId: "voice-a", memberChannelId: "voice-a", isVoiceChat: true, command: "play" };
const commands = ["help", "ping", "join", "play", "queue", "nowplaying", "pause", "resume", "skip", "stop", "clear", "shuffle", "loop", "autoplay", "volume", "leave", "search", "seek", "filters", "settings", "fleet", "playinvcall", undefined];

test("all commands and direct song names select only the bot in the message voice room", () => {
  for (const command of commands) assert.equal(selectRoomBot({ ...base, command }), "one");
  assert.equal(selectRoomBot({ ...base, channelId: "voice-b", memberChannelId: "voice-b" }), "two");
});

test("general chat is silent for every command even with a bot mention or number", () => {
  for (const command of commands) {
    for (const target of [{}, { targetId: "one" }, { targetIndex: 1 }]) {
      assert.equal(selectRoomBot({ ...base, command, ...target, channelId: "general", isVoiceChat: false }), null);
    }
  }
});

test("members outside voice or in a different room cannot control a bot", () => {
  for (const memberChannelId of [null, "voice-b"]) {
    for (const command of commands) assert.equal(selectRoomBot({ ...base, command, memberChannelId }), null);
  }
});

test("mentions and numbers cannot target a bot in another room", () => {
  for (const command of commands) {
    assert.equal(selectRoomBot({ ...base, command, targetIndex: 2 }), null);
    assert.equal(selectRoomBot({ ...base, command, targetId: "two" }), null);
  }
  assert.equal(selectRoomBot({ ...base, targetIndex: 1 }), "one");
  assert.equal(selectRoomBot({ ...base, targetId: "one" }), "one");
});

test("unknown or conflicting explicit targets never fall back to another bot", () => {
  assert.equal(selectRoomBot({ ...base, targetIndex: 0 }), null);
  assert.equal(selectRoomBot({ ...base, targetIndex: 11 }), null);
  assert.equal(selectRoomBot({ ...base, targetId: "unknown" }), null);
  assert.equal(selectRoomBot({ ...base, targetIndex: 1, targetId: "two" }), null);
});

test("only join can bring an available bot into an empty voice room", () => {
  const emptyRoom = { ...base, channelId: "voice-c", memberChannelId: "voice-c" };
  assert.equal(selectRoomBot({ ...emptyRoom, command: "join" }), "three");
  for (const command of commands.filter((item) => item !== "join")) {
    assert.equal(selectRoomBot({ ...emptyRoom, command }), null);
    assert.equal(selectRoomBot({ ...emptyRoom, command, targetIndex: 3 }), null);
  }
});

test("explicit join may summon an idle bot but never move an occupied bot", () => {
  assert.equal(selectRoomBot({ ...base, command: "join", targetIndex: 3 }), "three");
  assert.equal(selectRoomBot({ ...base, command: "join", targetId: "three" }), "three");
  assert.equal(selectRoomBot({ ...base, command: "join", targetIndex: 2 }), null);
});

test("two bots in the same room still produce just one default responder", () => {
  const together = [bots[0], { ...bots[1], channelId: "voice-a" }, bots[2]];
  assert.equal(selectRoomBot({ ...base, bots: together }), "one");
  assert.equal(selectRoomBot({ ...base, bots: together, targetIndex: 2 }), "two");
});

test("no available bot or empty fleet never selects a responder", () => {
  assert.equal(selectRoomBot({ ...base, bots: [] }), null);
  assert.equal(selectRoomBot({ ...base, bots: bots.slice(0, 2), channelId: "voice-c", memberChannelId: "voice-c", command: "join" }), null);
});

test("buttons and search selections require both member and chat in the bot room", () => {
  const context = { channelId: "voice-a", memberChannelId: "voice-a", botChannelId: "voice-a", isVoiceChat: true };
  assert.equal(isSameRoomChat(context), true);
  for (const change of [
    { channelId: "general", isVoiceChat: false },
    { channelId: "voice-b" },
    { memberChannelId: "voice-b" },
    { memberChannelId: null },
    { botChannelId: null },
    { botChannelId: "voice-b" }
  ]) assert.equal(isSameRoomChat({ ...context, ...change }), false);
});

test("a configured commands chat works for members in a bot room, but only there", () => {
  const chat = { ...base, channelId: "commands", isVoiceChat: false, isCommandsChat: true };
  for (const command of commands) assert.equal(selectRoomBot({ ...chat, command }), "one");
  assert.equal(selectRoomBot({ ...chat, memberChannelId: null }), null);                  // لازم يكون في روم
  assert.equal(selectRoomBot({ ...chat, memberChannelId: "voice-b" }), "two");           // البوت اللي في رومه
  assert.equal(selectRoomBot({ ...chat, command: "play", targetIndex: 2 }), null);       // ما يوصل لبوت في روم ثاني
});

test("setup, like join, can bring an idle bot into an empty room", () => {
  const emptyRoom = { ...base, channelId: "voice-c", memberChannelId: "voice-c" };
  assert.equal(selectRoomBot({ ...emptyRoom, command: "setup" }), "three");
  assert.equal(selectRoomBot({ ...emptyRoom, command: "play" }), null);
});
