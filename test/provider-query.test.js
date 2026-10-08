const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const file = fs.readFileSync(path.join(__dirname, "../src/index.js"), "utf8");
const source = file.slice(file.indexOf("async function resolveTracks("), file.indexOf("function filtersEmbed("));

test("song names select YouTube by default and explicit YouTube/SoundCloud aliases strip only the provider", async () => {
  const calls = [];
  const resolve = vm.runInNewContext(`${source}\nresolveTracks`, {
    youtubeSearch: async (query) => { calls.push(["YouTube", query]); return [{ title: "Track", url: "url" }]; },
    searchSoundCloud: async (query) => { calls.push(["SoundCloud", query]); return [{ title: "Track", url: "url" }]; }
  });
  for (const name of ["فوز اي شي", "yt فوز اي شي", "youtube فوز اي شي", "يوتيوب فوز اي شي"]) await resolve(name, "listener");
  for (const name of ["sc فوز اي شي", "soundcloud فوز اي شي", "ساوندكلاود فوز اي شي"]) await resolve(name, "listener");
  assert.deepEqual(calls, [...Array.from({ length: 4 }, () => ["YouTube", "فوز اي شي"]), ...Array.from({ length: 3 }, () => ["SoundCloud", "فوز اي شي"])]);
});
