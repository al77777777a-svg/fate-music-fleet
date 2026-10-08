// Read-only source/encoder probe: never logs in to Discord or sends audio to a guild.
const { AudioPlayerStatus, NoSubscriberBehavior, createAudioPlayer, createAudioResource, entersState } = require("@discordjs/voice");
const { ensureSoundCloud, streamTrack } = require("../src/music-source");

async function main() {
  await ensureSoundCloud();
  console.log("SoundCloud initialized");
  if (!process.argv[2]) return;
  const source = await streamTrack({ url: process.argv[2], title: "Audio probe" });
  const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
  const resource = createAudioResource(source.stream, { inputType: source.type, inlineVolume: true });
  resource.volume.setVolume(0.5);
  player.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
  player.play(resource);
  try {
    await entersState(player, AudioPlayerStatus.Playing, 15000);
    console.log("Audio decoded and encoded successfully; player status:", player.state.status);
  } finally {
    player.stop();
    source.stream.destroy();
  }
}
main().then(() => process.exit(process.exitCode || 0)).catch((error) => { console.error(error.message); process.exit(1); });
