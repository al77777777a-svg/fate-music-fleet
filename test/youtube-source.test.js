const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const { youtubeUrl, childEnvironment, sourceError, resolveYouTube, streamYouTube } = require("../src/youtube-source");

const sample = "https://www.youtube.com/watch?v=aqz-KE-bpKQ";
test("YouTube URL normalization accepts video variants and rejects arbitrary URLs", () => {
  for (const url of [sample, "https://youtu.be/aqz-KE-bpKQ?si=tracking", "https://music.youtube.com/watch?v=aqz-KE-bpKQ", "https://youtube.com/shorts/aqz-KE-bpKQ"]) assert.equal(youtubeUrl(url), sample);
  for (const url of ["file:///etc/passwd", "https://youtube.com.evil.test/watch?v=aqz-KE-bpKQ", "https://youtube.com:8080/watch?v=aqz-KE-bpKQ", "https://user:password@youtube.com/watch?v=aqz-KE-bpKQ", "https://youtube.com/watch?v=bad", "http://youtube.com/watch?v=aqz-KE-bpKQ"]) assert.throws(() => youtubeUrl(url));
});

test("extractor uses fixed arguments, no shell, no cookies, and no Discord environment", async () => {
  const metadata = await resolveYouTube(sample, async (_file, args, options) => {
    assert.deepEqual(args.slice(-2), ["--", sample]);
    assert.ok(args.includes("--ignore-config") && args.includes("--no-remote-components"));
    assert.ok(!args.some((arg) => /cookies|proxy|player_client|po_token/.test(arg)));
    assert.equal(options.shell, undefined);
    assert.equal(options.env.BOT_TOKENS, undefined);
    assert.equal(options.timeout, 35000);
    return { stdout: JSON.stringify({ url: "https://rr1.googlevideo.com/videoplayback", title: "Sample" }) };
  });
  assert.equal(metadata.title, "Sample");
  assert.ok(Object.keys(childEnvironment()).every((key) => /^(path|systemroot|windir|temp|tmp|lang|lc_all)$/i.test(key)));
});

test("rejects an extractor response containing a local or foreign media URL", async () => {
  for (const url of ["file:///etc/passwd", "https://googlevideo.com.evil.test/audio", "http://localhost/audio", "https://x:y@rr1.googlevideo.com/audio"]) {
    await assert.rejects(resolveYouTube(sample, async () => ({ stdout: JSON.stringify({ url }) })));
  }
});

test("access errors are classified without exposing signed URLs or diagnostic bodies", async () => {
  const error = sourceError({ stderr: "Sign in to confirm you're not a bot https://secret.test/token" });
  assert.equal(error.code, "YOUTUBE_ACCESS_REQUIRED");
  assert.ok(!error.message.includes("secret"));
  assert.ok(!sourceError({ stderr: "https://secret.test/token" }).message.includes("secret"));
  await assert.rejects(resolveYouTube(sample, async () => { throw { stderr: "LOGIN_REQUIRED" }; }), { code: "YOUTUBE_ACCESS_REQUIRED" });
});

function audioHarness() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => { child.killed = true; };
  let args;
  return {
    child,
    args: () => args,
    dependencies: {
      ffmpeg: "ffmpeg-test",
      resolve: async () => ({ url: "https://rr1.googlevideo.com/audio", title: "Real title", duration: 203 }),
      spawn: (_file, parameters) => { args = parameters; return child; }
    }
  };
}

test("does not report readiness before decoded audio exists; closing it kills the decoder", async () => {
  const h = audioHarness();
  const track = { url: sample };
  let ready = false;
  const pending = streamYouTube(track, 71, h.dependencies).then((result) => { ready = true; return result; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ready, false);
  h.child.stdout.write(Buffer.alloc(3840));
  const source = await pending;
  assert.equal(source.type, "raw");
  assert.equal(track.title, "Real title");
  assert.equal(track.duration, "3:23");
  assert.equal(h.args()[h.args().indexOf("-ss") + 1], "71");
  source.stream.destroy();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.child.killed, true);
});

test("failed and timed-out decoders reject readiness and are cleaned up", async () => {
  const h = audioHarness();
  const pending = streamYouTube({ url: sample }, 0, { ...h.dependencies, timeoutMs: 30 });
  await assert.rejects(pending, /مهلة/);
  assert.equal(h.child.killed, true);
  const failed = audioHarness();
  const result = streamYouTube({ url: sample }, 0, failed.dependencies);
  await new Promise((resolve) => setImmediate(resolve));
  failed.child.emit("error", new Error("sensitive command line"));
  await assert.rejects(result, /فك صوت/);
});

const { ffmpegHeaders, mediaError } = require("../src/youtube-source");
const { isYouTubeBlocked } = require("../src/music-source");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.kill = () => { child.killed = true; };
  return child;
}
function recordingSpawn() {
  const calls = [];
  return { calls, spawn: (file, args) => { const child = fakeChild(); calls.push({ file, args, child }); return child; } };
}
const metadata = { url: "https://rr1.googlevideo.com/audio", title: "T", http_headers: { "User-Agent": "UA/1", Accept: "*/*", Cookie: "secret", Host: "x", "Bad\r\nHeader": "x", "X-Evil": "a\r\nb" } };

test("ffmpeg gets the User-Agent and safe headers yt-dlp requested, never cookies or injected lines", () => {
  const args = ffmpegHeaders(metadata.http_headers);
  assert.deepEqual(args, ["-user_agent", "UA/1", "-headers", "Accept: */*\r\n"]);
  assert.deepEqual(ffmpegHeaders(undefined), []);
});

test("a 403 from the media server retries through yt-dlp and plays if that works", async () => {
  const { calls, spawn: spawnFn } = recordingSpawn();
  const pending = streamYouTube({ url: sample }, 0, { ffmpeg: "ffmpeg-test", resolve: async () => metadata, spawn: spawnFn, timeoutMs: 1000 });
  await wait(10);
  assert.ok(calls[0].args.includes("-user_agent"));
  calls[0].child.stderr.write("[https @ 0x1] Server returned 403 Forbidden (access denied)\n");
  calls[0].child.stdout.destroy();
  await wait(300);
  assert.equal(calls.length, 3, "yt-dlp upstream + a second ffmpeg");
  assert.ok(calls[1].args.includes("-o") && calls[1].args.at(-1) === sample && !calls[1].args.some((a) => /cookies|proxy/.test(a)));
  assert.ok(calls[2].args.includes("pipe:0"));
  calls[2].child.stdout.write(Buffer.alloc(3840));
  const source = await pending;
  assert.equal(source.type, "raw");
  source.stream.destroy();
  await wait(10);
  assert.equal(calls[1].child.killed, true, "closing the stream stops yt-dlp too");
});

test("when both paths are refused, the error is classified as access and exposes no URL", async () => {
  const { calls, spawn: spawnFn } = recordingSpawn();
  const pending = streamYouTube({ url: sample }, 0, { ffmpeg: "ffmpeg-test", resolve: async () => metadata, spawn: spawnFn, timeoutMs: 1000 });
  await wait(10);
  calls[0].child.stderr.write("Server returned 403 Forbidden https://rr1.googlevideo.com/videoplayback?sig=SECRET\n");
  calls[0].child.stdout.destroy();
  await wait(300);
  calls[1].child.stderr.write("ERROR: unable to download: HTTP Error 403: Forbidden\n");
  calls[2].child.stderr.write("pipe:0: Invalid data found\n");
  calls[2].child.stdout.destroy();
  await assert.rejects(pending, (error) => {
    assert.equal(error.code, "YOUTUBE_ACCESS_REQUIRED");
    assert.equal(error.httpStatus, "403");
    assert.ok(!/SECRET|googlevideo/.test(error.message + error.reason), error.reason);
    assert.equal(isYouTubeBlocked(error), true);
    return true;
  });
});

test("a failure without an HTTP status is not retried and is marked as a source failure", async () => {
  const { calls, spawn: spawnFn } = recordingSpawn();
  const pending = streamYouTube({ url: sample }, 0, { ffmpeg: "ffmpeg-test", resolve: async () => metadata, spawn: spawnFn, timeoutMs: 1000 });
  await wait(10);
  calls[0].child.stdout.destroy();
  await assert.rejects(pending, { code: "YOUTUBE_SOURCE_FAILED", message: /لم يصل صوت/ });
  assert.equal(calls.length, 1);
});

test("access and source failures are classified for the SoundCloud fallback", () => {
  assert.equal(isYouTubeBlocked(mediaError("Server returned 403 Forbidden")), true);
  assert.equal(isYouTubeBlocked(mediaError("Server returned 404 Not Found")), false);
  assert.equal(mediaError("Server returned 404 Not Found").code, "YOUTUBE_SOURCE_FAILED");
  assert.equal(sourceError({ stderr: "some unknown yt-dlp failure" }).code, "YOUTUBE_SOURCE_FAILED");
});
