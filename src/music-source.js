const play = require("play-dl");

let soundCloudReady;
let youtubeBlockedUntil = 0;

function isYouTubeBlocked(error) {
  return /sign in to confirm|not a bot|LOGIN_REQUIRED/i.test(String(error?.message || error));
}

async function ensureSoundCloud() {
  if (!soundCloudReady) {
    soundCloudReady = (async () => {
      const clientId = process.env.SOUNDCLOUD_CLIENT_ID || await play.getFreeClientID();
      await play.setToken({ soundcloud: { client_id: clientId } });
    })().catch((error) => { soundCloudReady = null; throw error; });
  }
  return soundCloudReady;
}

function seconds(value) {
  if (typeof value === "number") return value;
  if (!/^\d+(?::\d+){0,2}$/.test(String(value || ""))) return 0;
  return String(value).split(":").reduce((total, part) => total * 60 + Number(part), 0);
}

function normalize(value) {
  return String(value).toLowerCase().normalize("NFKC")
    .replace(/[\u064b-\u065f\u0670\u0640]/g, "")
    .replace(/[أإآ]/g, "ا").replace(/ى/g, "ي")
    .replace(/\b(official|video|audio|lyrics|lyric|hd|hq|4k|music)\b/g, " ")
    .replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();
}

function queryVariants(title) {
  const clean = normalize(title);
  const arabic = (clean.match(/[\u0600-\u06ff]+/g) || []).join(" ");
  const latin = (clean.match(/[a-z0-9]+/g) || []).join(" ");
  return [...new Set([arabic, latin].filter((value) => value.split(" ").length >= 2))].slice(0, 2).concat(!arabic && !latin ? [clean] : []);
}

function matchingTrack(track, candidate) {
  const expectedDuration = seconds(track.duration);
  if (expectedDuration && Math.abs(candidate.durationInSec - expectedDuration) > Math.max(15, expectedDuration * 0.12)) return false;
  const expected = normalize(track.title);
  const actual = normalize(candidate.name);
  for (const modifier of ["remix", "cover", "nightcore", "slowed", "sped", "karaoke", "ريمكس", "بطيء", "مسرع"]) {
    if (actual.includes(modifier) && !expected.includes(modifier)) return false;
  }
  const candidateWords = new Set(actual.split(" "));
  return queryVariants(track.title).some((query) => {
    const words = [...new Set(query.split(" "))];
    return words.length >= 2 && words.filter((word) => candidateWords.has(word)).length / words.length >= 0.85;
  });
}

function soundCloudTrack(track, requester) {
  return {
    title: track.name,
    url: track.permalink,
    duration: `${Math.floor(track.durationInSec / 60)}:${String(track.durationInSec % 60).padStart(2, "0")}`,
    provider: "SoundCloud", requester, thumbnail: track.thumbnail
  };
}

async function searchSoundCloud(query, requester, limit = 5) {
  await ensureSoundCloud();
  const tracks = await play.search(query, { limit, source: { soundcloud: "tracks" } });
  return tracks.map((track) => soundCloudTrack(track, requester));
}

async function streamTrack(track, startAt = 0) {
  const isSoundCloud = /(?:^|\.)soundcloud\.com$/.test(new URL(track.url).hostname);
  if (isSoundCloud) await ensureSoundCloud();
  try {
    if (!isSoundCloud && youtubeBlockedUntil > Date.now()) throw new Error("Sign in to confirm you’re not a bot");
    return await play.stream(track.url, { quality: 2, discordPlayerCompatibility: startAt === 0, ...(startAt ? { seek: startAt } : {}) });
  } catch (error) {
    if (isSoundCloud || !isYouTubeBlocked(error) || startAt) throw error;
    youtubeBlockedUntil = Date.now() + 300_000;
    await ensureSoundCloud();
    for (const query of queryVariants(track.title)) {
      const candidates = await play.search(query, { limit: 5, source: { soundcloud: "tracks" } });
      const match = candidates.find((candidate) => matchingTrack(track, candidate));
      if (!match) continue;
      const source = await play.stream(match.permalink);
      const originalUrl = track.url;
      Object.assign(track, soundCloudTrack(match, track.requester), { fallbackFrom: originalUrl });
      return source;
    }
    throw new Error("YouTube يرفض التشغيل من خادم Railway حاليًا، ولم أجد نسخة مطابقة على SoundCloud. جرّب رابط SoundCloud أو اكتب: play sc اسم الأغنية.");
  }
}

module.exports = { ensureSoundCloud, isYouTubeBlocked, matchingTrack, queryVariants, searchSoundCloud, soundCloudTrack, streamTrack };
