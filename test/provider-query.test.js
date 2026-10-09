const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { matchingSong } = require("../src/song-matching");
const file = fs.readFileSync(path.join(__dirname, "../src/index.js"), "utf8");
const source = file.slice(file.indexOf("async function resolveTracks("), file.indexOf("function filtersEmbed("));

test("song names select YouTube by default and explicit YouTube/SoundCloud aliases strip only the provider", async () => {
  const calls = [];
  const resolve = vm.runInNewContext(`${source}\nresolveTracks`, {
    matchingSong,
    youtubeSearch: async (query) => { calls.push(["YouTube", query]); return [{ title: "Unrelated first result", url: "wrong" }, { title: query, url: "url" }]; },
    searchSoundCloud: async (query) => { calls.push(["SoundCloud", query]); return [{ title: query, url: "url" }]; }
  });
  for (const name of ["فوز اي شي", "yt فوز اي شي", "youtube فوز اي شي", "يوتيوب فوز اي شي"]) await resolve(name, "listener");
  for (const name of ["sc فوز اي شي", "soundcloud فوز اي شي", "ساوندكلاود فوز اي شي"]) await resolve(name, "listener");
  assert.deepEqual(calls, [...Array.from({ length: 4 }, () => ["YouTube", "فوز اي شي"]), ...Array.from({ length: 3 }, () => ["SoundCloud", "فوز اي شي"])]);
});

test("unrelated YouTube results fall back only to a matching SoundCloud title", async () => {
  const resolve = vm.runInNewContext(`${source}\nresolveTracks`, {
    matchingSong,
    youtubeSearch: async () => [{ title: "Weird AI Life Hacks", url: "wrong" }],
    searchSoundCloud: async (query) => query === "اي شي" ? [{ title: "فوز اي شي", url: "correct" }] : []
  });
  assert.equal((await resolve("اي شي", "listener"))[0].url, "correct");
  await assert.rejects(resolve("nothing matching", "listener"), /مطابق/);
});
