const { test } = require("node:test");
const assert = require("node:assert/strict");
const { matchingTrack, queryVariants, isYouTubeBlocked, rankSoundCloud } = require("../src/music-source");

test("YouTube login challenge is identified without treating all errors as a block", () => {
  assert.equal(isYouTubeBlocked(new Error("While getting info from url\nSign in to confirm you’re not a bot")), true);
  assert.equal(isYouTubeBlocked(new Error("Invalid URL")), false);
});

test("SoundCloud name search prefers the named original over an unrequested remix", () => {
  const tracks = [{ name: "Faded (SLUSHII Remix)" }, { name: "Alan Walker Faded" }];
  assert.equal(rankSoundCloud("Alan Walker Faded", tracks)[0].name, "Alan Walker Faded");
  assert.equal(rankSoundCloud("Faded SLUSHII Remix", tracks)[0].name, "Faded (SLUSHII Remix)");
  assert.equal(tracks[0].name, "Faded (SLUSHII Remix)");
});

test("a translated duplicate title can match one complete language and its duration", () => {
  const track = { title: "Fooz Ay Shee - فوز أي شي (Official Video)", duration: "3:23" };
  assert.deepEqual(queryVariants(track.title), ["فوز اي شي", "fooz ay shee"]);
  assert.equal(matchingTrack(track, { name: "فوز اي شي", durationInSec: 204 }), true);
  assert.equal(matchingTrack(track, { name: "Fooz Ay Shee", durationInSec: 203 }), true);
  assert.equal(matchingTrack(track, { name: "SI KRISTO AY GUNITAIN", durationInSec: 47 }), false);
  assert.equal(matchingTrack(track, { name: "اوبها اي شي", durationInSec: 205 }), false);
  assert.equal(matchingTrack(track, { name: "فوز اي شي Remix", durationInSec: 203 }), false);
  assert.equal(matchingTrack(track, { name: "فوز اي شي", durationInSec: 600 }), false);
});
