const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

function harness(started, busy = false) {
  const source = fs.readFileSync(path.join(__dirname, "../src/index.js"), "utf8");
  const body = source.slice(source.indexOf("async function enqueueTracks("), source.indexOf("async function enqueue(client"));
  const calls = [];
  const enqueue = vm.runInNewContext(`${body}; enqueueTracks`, {
    MAX_QUEUE_SIZE: 100,
    connectToMemberChannel: async () => {},
    isPlaying: () => busy,
    playNext: async () => { calls.push("start"); return started; }
  });
  const context = {
    channel: {}, guild: { id: "guild" }, messageId: "message",
    acknowledge: async (success) => calls.push(success ? "success" : "failure"),
    reply: async (payload) => calls.push(payload.content)
  };
  return { enqueue, calls, context, data: { queue: [], starting: false } };
}

test("failed playback never acknowledges addition or start as success", async () => {
  const h = harness(false);
  await h.enqueue({}, h.context, h.data, [{}]);
  assert.deepEqual(h.calls, ["start", "failure"]);
});

test("successful initial playback confirms only once and after the player starts", async () => {
  const h = harness(true);
  const track = {};
  await h.enqueue({}, h.context, h.data, [track]);
  assert.deepEqual(h.calls, ["start", "success"]);
  assert.equal(track.requestMessageId, "message");
});

test("search interaction receives an explicit failure instead of an unfinished reply", async () => {
  const h = harness(false);
  delete h.context.acknowledge;
  await h.enqueue({}, h.context, h.data, [{}]);
  assert.equal(h.calls.length, 2);
  assert.match(h.calls[1], /^❌/);
});

test("adding to an active queue confirms the queue without creating a second playing card", async () => {
  const h = harness(true, true);
  await h.enqueue({}, h.context, h.data, [{}]);
  assert.deepEqual(h.calls, ["success"]);
  assert.equal(h.data.queue.length, 1);
});
