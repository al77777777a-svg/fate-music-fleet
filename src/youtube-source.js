const { execFile, spawn } = require("node:child_process");
const { promisify } = require("node:util");
const path = require("node:path");
const { StreamType } = require("@discordjs/voice");

const executable = path.join(__dirname, "../bin", process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
const runFile = promisify(execFile);

function childEnvironment() {
  // Media subprocesses do not need Discord tokens or other deployment secrets.
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(path|systemroot|windir|temp|tmp|lang|lc_all)$/i.test(key)));
}

function youtubeUrl(input) {
  const url = new URL(input);
  if (url.protocol !== "https:" || url.username || url.password || url.port) throw new Error("رابط YouTube غير صالح.");
  let id;
  if (["youtu.be", "www.youtu.be"].includes(url.hostname)) id = url.pathname.slice(1);
  else if (["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"].includes(url.hostname)) {
    id = url.pathname === "/watch" ? url.searchParams.get("v") : url.pathname.match(/^\/(?:shorts|live|embed)\/([^/]+)$/)?.[1];
  }
  if (!/^[\w-]{11}$/.test(id || "")) throw new Error("رابط YouTube غير صالح.");
  return `https://www.youtube.com/watch?v=${id}`;
}

function sourceError(error) {
  const diagnostic = String(error.stderr || error.message || error);
  if (/sign in to confirm|not a bot|LOGIN_REQUIRED/i.test(diagnostic)) {
    return Object.assign(new Error("YouTube يطلب تسجيل الدخول من هذا الخادم (LOGIN_REQUIRED)."), { code: "YOUTUBE_ACCESS_REQUIRED" });
  }
  if (/private video|video is unavailable|video unavailable|removed|not available in your country/i.test(diagnostic)) return new Error("مقطع YouTube غير متاح أو خاص.");
  if (error.code === "ENOENT") return new Error("محرّك YouTube غير مثبّت؛ أعد تثبيت تبعيات المشروع.");
  if (error.killed || error.code === "ETIMEDOUT") return Object.assign(new Error("انتهت مهلة الاتصال بـYouTube. جرّب لاحقًا."), { code: "YOUTUBE_SOURCE_FAILED" });
  // Never expose signed media URLs, response bodies or subprocess command lines in Discord/logs.
  return Object.assign(new Error("تعذر الحصول على صوت YouTube من هذا الخادم."), { code: "YOUTUBE_SOURCE_FAILED" });
}

// The decoder (ffmpeg / yt-dlp pipe) failed: turn its stderr into a safe, classified error.
function mediaError(diagnostic = "") {
  const text = String(diagnostic);
  const status = text.match(/(?:HTTP error|HTTP Error|Server returned) (\d{3})/i)?.[1];
  const reason = text.replace(/https?:\/\/\S+/g, "<url>").replace(/\s+/g, " ").trim().slice(-160);
  const denied = status === "403" || /sign in to confirm|not a bot|LOGIN_REQUIRED/i.test(text);
  const error = denied
    ? Object.assign(new Error(`YouTube رفض بث الصوت لهذا الخادم (${status || "تسجيل دخول"}).`), { code: "YOUTUBE_ACCESS_REQUIRED" })
    : Object.assign(new Error(status ? `YouTube رد بخطأ ${status} أثناء بث الصوت.` : "لم يصل صوت قابل للتشغيل من YouTube."), { code: "YOUTUBE_SOURCE_FAILED" });
  return Object.assign(error, { httpStatus: status, reason });
}

// Send the headers yt-dlp says the media URL needs (User-Agent etc.). Never cookies or auth.
function ffmpegHeaders(raw) {
  if (!raw || typeof raw !== "object") return [];
  const entries = Object.entries(raw).filter(([key, value]) =>
    /^[A-Za-z][A-Za-z0-9-]*$/.test(key) && typeof value === "string" && value && !/[\r\n]/.test(value) &&
    !/^(host|cookie|authorization|range|connection|content-length)$/i.test(key));
  const agent = entries.find(([key]) => key.toLowerCase() === "user-agent");
  const rest = entries.filter(([key]) => key.toLowerCase() !== "user-agent");
  return [...(agent ? ["-user_agent", agent[1]] : []), ...(rest.length ? ["-headers", rest.map(([key, value]) => `${key}: ${value}\r\n`).join("")] : [])];
}

async function resolveYouTube(input, run = runFile) {
  const url = youtubeUrl(input);
  let stdout;
  try {
    ({ stdout } = await run(executable, [
      "--ignore-config", "--no-plugin-dirs", "--no-cache-dir", "--no-playlist", "--no-progress", "--no-warnings",
      "--js-runtimes", `node:${process.execPath}`, "--no-remote-components",
      "--socket-timeout", "10", "--retries", "0", "--extractor-retries", "0",
      "--dump-single-json", "-f", "bestaudio[ext=webm]/bestaudio", "--", url
    ], { timeout: 35000, maxBuffer: 4 * 1024 * 1024, windowsHide: true, env: childEnvironment() }));
  } catch (error) { throw sourceError(error); }
  let metadata;
  try { metadata = JSON.parse(stdout); } catch { throw new Error("استجابة YouTube غير صالحة."); }
  const media = new URL(metadata.url);
  if (media.protocol !== "https:" || !/(?:^|\.)googlevideo\.com$/.test(media.hostname) || media.username || media.password || media.port) {
    throw new Error("YouTube أعاد مصدر صوت غير مسموح.");
  }
  return metadata;
}

// Starts a decoder process and resolves once real PCM audio is flowing.
// `upstream` (optional) is a yt-dlp process whose stdout is piped into the decoder.
function startDecoder({ spawnFn, command, args, timeoutMs, upstream }) {
  const decoder = spawnFn(command, args, { stdio: [upstream ? "pipe" : "ignore", "pipe", "pipe"], windowsHide: true, env: childEnvironment() });
  let diagnostic = "";
  const note = (chunk) => { diagnostic = (diagnostic + chunk).slice(-2000); };
  decoder.stderr.on("data", note);
  if (upstream) {
    upstream.stderr.on("data", note);
    upstream.stdout.on("error", () => {});
    decoder.stdin.on("error", () => {});
    upstream.stdout.pipe(decoder.stdin);
  }
  const stream = decoder.stdout;
  const stop = () => {
    if (!decoder.killed) decoder.kill();
    if (upstream && !upstream.killed) upstream.kill();
  };
  stream.once("close", stop);
  decoder.on("error", () => stream.destroy(new Error("تعذر بدء فك صوت YouTube.")));
  decoder.once("close", (code) => {
    if (code && !stream.destroyed) stream.destroy(new Error("توقف بث صوت YouTube قبل اكتماله."));
  });
  // Keep an error listener after the readiness check; the Discord resource adds its own later.
  stream.on("error", stop);
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => fail(new Error("انتهت مهلة بدء صوت YouTube.")), timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      stream.off("readable", ready);
      stream.off("error", fail);
      stream.off("end", ended);
      stream.off("close", ended);
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      stream.destroy();
      stop();
      reject(error);
    };
    // Give stderr a moment to arrive so the failure reason (403, 404…) is known.
    const ended = () => setTimeout(() => fail(mediaError(diagnostic)), 120);
    const ready = () => { if (!settled && stream.readableLength > 0) { settled = true; cleanup(); resolve(stream); } };
    stream.on("readable", ready);
    stream.once("error", fail);
    stream.once("end", ended);
    stream.once("close", ended);
    ready();
  });
}

const PIPE_ARGS = [
  "--ignore-config", "--no-plugin-dirs", "--no-cache-dir", "--no-playlist", "--no-progress", "--quiet", "--no-warnings",
  "--js-runtimes", `node:${process.execPath}`, "--no-remote-components",
  "--socket-timeout", "10", "--retries", "2", "-f", "bestaudio[ext=webm]/bestaudio", "-o", "-"
];

async function streamYouTube(track, startAt = 0, dependencies = {}) {
  if (!Number.isFinite(startAt) || startAt < 0) throw new Error("وقت التشغيل غير صالح.");
  const metadata = await (dependencies.resolve || resolveYouTube)(track.url);
  const ffmpeg = dependencies.ffmpeg || require("ffmpeg-static");
  if (!ffmpeg) throw new Error("FFmpeg غير متاح.");
  const spawnFn = dependencies.spawn || spawn;
  const timeoutMs = dependencies.timeoutMs || 20000;
  const seek = startAt ? ["-ss", String(startAt)] : [];
  const output = ["-vn", "-f", "s16le", "-ar", "48000", "-ac", "2", "pipe:1"];

  let stream;
  try {
    // 1) ffmpeg reads the media URL directly, with the headers yt-dlp asked for.
    stream = await startDecoder({
      spawnFn, command: ffmpeg, timeoutMs,
      args: ["-hide_banner", "-loglevel", "error", "-nostdin", "-rw_timeout", "15000000", ...seek, ...ffmpegHeaders(metadata.http_headers), "-i", metadata.url, ...output]
    });
  } catch (error) {
    if (!error.httpStatus || dependencies.pipe === false) throw error;
    try {
      // 2) The media server refused ffmpeg: let yt-dlp download it (same headers, chunking, retries) and pipe it in.
      const upstream = spawnFn(executable, [...PIPE_ARGS, "--", youtubeUrl(track.url)], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, env: childEnvironment() });
      upstream.on("error", () => {});
      stream = await startDecoder({
        spawnFn, command: ffmpeg, timeoutMs, upstream,
        args: ["-hide_banner", "-loglevel", "error", ...seek, "-i", "pipe:0", ...output]
      });
    } catch (second) {
      error.reason = `${error.reason} | pipe: ${second.reason || second.message}`.slice(0, 300);
      throw error;
    }
  }
  if (metadata.title) track.title = metadata.title;
  if (metadata.thumbnail) track.thumbnail = metadata.thumbnail;
  if (metadata.duration) track.duration = `${Math.floor(metadata.duration / 60)}:${String(Math.floor(metadata.duration % 60)).padStart(2, "0")}`;
  return { stream, type: StreamType.Raw };
}

module.exports = { childEnvironment, youtubeUrl, sourceError, mediaError, ffmpegHeaders, resolveYouTube, streamYouTube };
