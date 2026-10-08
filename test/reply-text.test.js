const { test } = require("node:test");
const assert = require("node:assert/strict");
const { trackReply, volumeReply } = require("../src/reply-text");

test("playback and skip replies use compact title and requester text", () => {
  assert.equal(trackReply("Playing song", { title: "Song" }, "MsTe"), "*Playing song :* **Song** *by :* **MsTe.**");
  assert.equal(trackReply("Skipped", { title: "Song" }, "MsTe"), "*Skipped :* **Song** *by :* **MsTe.**");
});

test("track replies escape user-controlled formatting and bound message length", () => {
  assert.ok(trackReply("Playing song", { title: "**Song**" }, "_Name_").includes("\\*\\*Song\\*\\*"));
  assert.ok(trackReply("Playing song", { title: "x".repeat(3000) }, "n".repeat(3000)).length < 2000);
});

test("volume feedback shows both the old and new percentages", () => {
  assert.equal(volumeReply(60, 150), "*Volume changed from* `60%` *to* `150%`.");
  assert.equal(volumeReply(50, 0), "*Volume changed from* `50%` *to* `0%`.");
});
