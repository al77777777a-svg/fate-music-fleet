const { test } = require("node:test");
const assert = require("node:assert/strict");
const { directSongQuery, matchingSong } = require("../src/song-matching");

test("Arabic title words match across accents and letter variants, not unrelated search results", () => {
  const correct = { title: "Fooz Ay Shee فوز - اى شى" };
  const unrelated = { title: "I Tested the Weirdest AI Life Hacks Online" };
  assert.equal(matchingSong("أي شي", [unrelated, correct]), correct);
  assert.equal(matchingSong("فوز", [unrelated, correct]), correct);
  assert.equal(matchingSong("أغنية مختلفة", [unrelated, correct]), null);
});

test("one-word matching uses full words and prefers the original over remixes", () => {
  const original = { title: "Alan Walker - Faded (Official Video)" };
  const remix = { title: "Alan Walker - Faded remix" };
  assert.equal(matchingSong("Faded", [remix, original]), original);
  assert.equal(matchingSong("Fade", [original]), null);
  assert.equal(matchingSong("Faded remix", [original, remix]), remix);
});

test("title detection excludes simple chat and noise while preserving Arabic and English names", () => {
  for (const text of ["aa", "dd", "hi", "السلام عليكم", "<@123>", "!unknown", "1234", "a", "word\nword"]) assert.equal(directSongQuery(text), null);
  for (const text of ["اي شي", "Faded", "حب", "Blinding Lights"]) assert.equal(directSongQuery(text), text);
});
