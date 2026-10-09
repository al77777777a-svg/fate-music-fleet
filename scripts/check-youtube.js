// A brief source/codec check only: no Discord client, messages, voice, cookies or media files.
const { AudioPlayerStatus, NoSubscriberBehavior, createAudioPlayer, createAudioResource, entersState } = require("@discordjs/voice");
const { streamYouTube } = require("../src/youtube-source");

async function main() {
  const track = { url: process.argv[2] || "https://www.youtube.com/watch?v=aqz-KE-bpKQ" };
  console.log("YouTube direct audio check: starting (no SoundCloud fallback).");
  const source = await streamYouTube(track);
  const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
  const resource = createAudioResource(source.stream, { inputType: source.type, inlineVolume: true });
  player.on("error", () => { process.exitCode = 1; });
  try {
    player.play(resource);
    await entersState(player, AudioPlayerStatus.Playing, 15000);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    if (player.state.status !== AudioPlayerStatus.Playing || process.exitCode) throw new Error("YouTube audio did not remain playable.");
    console.log("YOUTUBE_AUDIO_OK: decoded PCM and encoded Discord audio for 2 seconds.");
  } finally {
    player.stop(true);
    source.stream.destroy();
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
main().then(() => process.exit(process.exitCode || 0)).catch((error) => { console.error("YOUTUBE_AUDIO_FAILED:", error.message); process.exit(1); });
