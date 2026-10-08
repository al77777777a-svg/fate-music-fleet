const { test } = require("node:test");
const assert = require("node:assert/strict");
const { skipTrack, skipMessage } = require("../src/skip-track");

test("skipping an idle player asks for a song without claiming a skip or stopping it", async () => {
  const data = { current: null, player: { stop: () => assert.fail("must not stop an idle player") } };
  const result = await skipTrack(data, () => assert.fail("must not advance"), () => assert.fail("must not stop filters"));
  assert.equal(result.status, "empty");
  assert.match(skipMessage(result), /ش.*اسم الأغنية/);
});

test("skip advances only once and reports the track that actually started", async () => {
  let advances = 0;
  const data = { current: { title: "old" }, seekSeconds: 40, player: {} };
  const advance = async () => { advances++; data.current = { title: "new" }; return true; };
  data.player.stop = (force) => {
    assert.equal(force, true);
    // Same guard as the production Idle listener.
    if (!data.skipping) advance();
  };
  const result = await skipTrack(data, advance, () => {});
  assert.equal(advances, 1);
  assert.equal(result.status, "playing");
  assert.equal(result.track.title, "new");
  assert.equal(result.skipped.title, "old");
  assert.match(skipMessage(result, "MsTe"), /Skipped.*old.*MsTe/);
  assert.equal(data.seekSeconds, null);
  assert.equal(data.skipCurrent, true);
  assert.equal(data.skipping, false);
});

test("the final track produces an empty queue prompt and subsequent skips stay idle", async () => {
  let stops = 0;
  const data = { current: { title: "last" }, player: { stop: () => stops++ } };
  const advance = async () => { data.current = null; };
  assert.equal((await skipTrack(data, advance, () => {})).status, "empty");
  assert.equal((await skipTrack(data, advance, () => {})).status, "empty");
  assert.equal(stops, 1);
});

test("failed next track is not reported as playing", async () => {
  const data = { current: { title: "old" }, player: { stop: () => {} } };
  const result = await skipTrack(data, async () => { data.current = null; return false; }, () => {});
  assert.equal(result.status, "failed");
  assert.match(skipMessage(result), /تعذر/);
});

test("rapid duplicate skips cannot consume another queued track while starting", async () => {
  let release;
  const data = { current: { title: "old" }, player: { stop: () => {} } };
  const first = skipTrack(data, () => new Promise((resolve) => { release = resolve; }), () => {});
  const duplicate = await skipTrack(data, () => assert.fail("duplicate advance"), () => {});
  assert.equal(duplicate.status, "busy");
  data.current = { title: "next" };
  release(true);
  assert.equal((await first).status, "playing");
  assert.equal(data.skipping, false);
});

test("preparing a new track and unexpected failures both keep skip state consistent", async () => {
  assert.equal((await skipTrack({ starting: true }, () => assert.fail("advance"), () => {})).status, "busy");
  const data = { current: {}, player: { stop: () => {} } };
  await assert.rejects(skipTrack(data, async () => { throw new Error("failure"); }, () => {}));
  assert.equal(data.skipping, false);
});
