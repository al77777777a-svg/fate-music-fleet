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
  if (error.killed || error.code === "ETIMEDOUT") return new Error("انتهت مهلة الاتصال بـYouTube. جرّب لاحقًا.");
  // Never expose signed media URLs, response bodies or subprocess command lines in Discord/logs.
  return new Error("تعذر الحصول على صوت YouTube من هذا الخادم.");
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

async function streamYouTube(track, startAt = 0, dependencies = {}) {
  if (!Number.isFinite(startAt) || startAt < 0) throw new Error("وقت التشغيل غير صالح.");
  const metadata = await (dependencies.resolve || resolveYouTube)(track.url);
  const ffmpeg = dependencies.ffmpeg || require("ffmpeg-static");
  if (!ffmpeg) throw new Error("FFmpeg غير متاح.");
  const processAudio = (dependencies.spawn || spawn)(ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-rw_timeout", "15000000",
    ...(startAt ? ["-ss", String(startAt)] : []), "-i", metadata.url,
    "-vn", "-f", "s16le", "-ar", "48000", "-ac", "2", "pipe:1"
  ], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, env: childEnvironment() });
  const stream = processAudio.stdout;
  processAudio.stderr.resume();
  const stop = () => { if (!processAudio.killed) processAudio.kill(); };
  stream.once("close", stop);
  processAudio.on("error", () => stream.destroy(new Error("تعذر بدء فك صوت YouTube.")));
  processAudio.once("close", (code) => {
    if (code && !stream.destroyed) stream.destroy(new Error("توقف بث صوت YouTube قبل اكتماله."));
  });
  // Keep an error listener after the readiness check; the Discord resource adds its own later.
  stream.on("error", stop);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => fail(new Error("انتهت مهلة بدء صوت YouTube.")), dependencies.timeoutMs || 20000);
    const cleanup = () => {
      clearTimeout(timer);
      stream.off("readable", ready);
      stream.off("error", fail);
      stream.off("end", ended);
      stream.off("close", ended);
    };
    const fail = (error) => { cleanup(); stream.destroy(); stop(); reject(error); };
    const ended = () => fail(new Error("لم يصل صوت قابل للتشغيل من YouTube."));
    const ready = () => { if (stream.readableLength > 0) { cleanup(); resolve(); } };
    stream.on("readable", ready);
    stream.once("error", fail);
    stream.once("end", ended);
    stream.once("close", ended);
    ready();
  });
  if (metadata.title) track.title = metadata.title;
  if (metadata.thumbnail) track.thumbnail = metadata.thumbnail;
  if (metadata.duration) track.duration = `${Math.floor(metadata.duration / 60)}:${String(Math.floor(metadata.duration % 60)).padStart(2, "0")}`;
  return { stream, type: StreamType.Raw };
}

module.exports = { childEnvironment, youtubeUrl, sourceError, resolveYouTube, streamYouTube };
