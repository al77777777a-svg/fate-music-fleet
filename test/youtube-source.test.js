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
