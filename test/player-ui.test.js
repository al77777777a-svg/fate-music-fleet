const { test } = require("node:test");
const assert = require("node:assert/strict");
const { existsSync } = require("node:fs");
const { playerPayload, playerComponents } = require("../src/player-ui");
const data = { filters: new Set(), player: { state: { status: "playing" } } };
const track = { title: "Fooz Ay Shee - فوز أي شي", url: "https://www.youtube.com/watch?v=12345678901", duration: "3:23" };

test("compact playing card serializes into a valid Discord message", () => {
  const payload = playerPayload("guild", data, track, { displayName: "MsTe", avatarURL: "https://cdn.discordapp.com/embed/avatars/0.png" });
  const embed = payload.embeds[0].toJSON();
  assert.deepEqual(embed.fields.map((field) => field.name), ["Playing Song", "Song Duration"]);
  assert.equal(embed.fields[1].value, "03:23");
  assert.equal(embed.color, 0x416f64);
  assert.equal(embed.footer.text, "MsTe");
  assert.equal(embed.thumbnail.url, "attachment://music-icon.png");
  assert.equal(existsSync(payload.files[0].attachment), true);
  assert.deepEqual(payload.allowedMentions.parse, []);
  assert.equal(payload.content, "🎶 /Mlj");
});

test("controls match the requested two button rows followed by filters", () => {
  const rows = playerComponents("guild", data).map((row) => row.toJSON());
  assert.deepEqual(rows.map((row) => row.components.length), [4, 1, 1]);
  assert.deepEqual(rows.slice(0, 2).flatMap((row) => row.components.map((button) => button.custom_id)), [
    "music:loop:guild", "music:voldown:guild", "music:pause:guild", "music:volup:guild", "music:skip:guild"
  ]);
  assert.ok(rows.slice(0, 2).every((row) => row.components.every((button) => button.style === 2)));
  assert.equal(rows[2].components[0].placeholder, "Filters ..");
  assert.equal(playerComponents("guild", { ...data, player: { state: { status: "paused" } } })[0].toJSON().components[2].emoji.name, "▶️");
});

test("missing attachment permission still produces a usable card and fallback is identified", () => {
  const payload = playerPayload("guild", data, { ...track, fallbackFrom: track.url }, { displayName: "MsTe" }, false);
  assert.equal(payload.files.length, 0);
  assert.equal(payload.embeds[0].toJSON().thumbnail, undefined);
  assert.equal(payload.embeds[0].toJSON().footer.text, "MsTe • SoundCloud");
});
