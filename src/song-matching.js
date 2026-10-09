function normalizeTitle(value) {
  return String(value || "").normalize("NFKC").toLowerCase()
    .replace(/[\u064b-\u065f\u0670\u0640]/g, "")
    .replace(/[أإآ]/g, "ا").replace(/ى/g, "ي")
    .replace(/\b(official|video|audio|lyrics|lyric|hd|hq|4k)\b/g, " ")
    .replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();
}

function directSongQuery(text) {
  if (typeof text !== "string" || text.length > 160 || /[\r\n]|https?:|<[@#]|^[/!#]/i.test(text)) return null;
  const query = normalizeTitle(text);
  if (query.length < 2 || !/\p{L}/u.test(query) || /^(.)\1+$/u.test(query)) return null;
  if (["السلام عليكم", "وعليكم السلام", "هلا", "مرحبا", "شكرا", "تمام", "اوكي", "hi", "hello", "hey", "ok", "thanks"].includes(query)) return null;
  return text.trim();
}

function matchingSong(query, tracks, titleOf = (track) => track.title) {
  const expected = normalizeTitle(query);
  const words = expected.split(" ").filter(Boolean);
  if (!words.length) return null;
  const scored = tracks.map((track, index) => {
    const actual = normalizeTitle(titleOf(track));
    const titleWords = new Set(actual.split(" "));
    if (!words.every((word) => titleWords.has(word))) return null;
    let score = actual === expected ? 100 : actual.includes(expected) ? 50 : 30;
    for (const modifier of ["remix", "cover", "nightcore", "slowed", "sped", "karaoke", "ريمكس", "بطيء", "مسرع"]) {
      if (actual.includes(modifier) && !expected.includes(modifier)) score -= 25;
    }
    return { track, score, index };
  }).filter(Boolean).sort((a, b) => b.score - a.score || a.index - b.index);
  return scored[0]?.track || null;
}

module.exports = { normalizeTitle, directSongQuery, matchingSong };
