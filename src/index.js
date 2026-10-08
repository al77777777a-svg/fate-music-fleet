require("dotenv").config();

const { spawn } = require("node:child_process");
const express = require("express");
const play = require("play-dl");
const { selectRoomBot, isSameRoomChat } = require("./room-routing");
const { skipTrack, skipMessage } = require("./skip-track");
const { trackReply, volumeReply } = require("./reply-text");
const { FILTER_LABELS, filterRow, playerComponents, playerPayload } = require("./player-ui");
const { ensureSoundCloud, isYouTubeBlocked, searchSoundCloud, soundCloudTrack, streamTrack } = require("./music-source");
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  PermissionFlagsBits,
  REST,
  Routes
} = require("discord.js");
const {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  getVoiceConnection,
  joinVoiceChannel
} = require("@discordjs/voice");

const tokens = (process.env.BOT_TOKENS || "")
  .split(",")
  .map((token) => token.trim())
  .filter(Boolean)
  .slice(0, 10);
const owners = new Set(
  (process.env.OWNER_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
);
const clients = [];
const botStates = new Map();
const pendingSearches = new Map();
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const MAX_QUEUE_SIZE = 100;
let ffmpegPath = null;
try {
  ffmpegPath = require("ffmpeg-static");
} catch (_) {
  // Filters will explain that FFmpeg is unavailable; normal playback still works.
}

if (!tokens.length) {
  console.error("BOT_TOKENS is missing. Add one to ten Discord bot tokens in Railway Variables.");
  process.exit(1);
}

const app = express();
app.get("/", (_req, res) => res.json({ ok: true, service: "music-fleet", bots: botStates.size }));
app.get("/health", (_req, res) => res.json({ ok: true, bots: [...botStates.values()].map((state) => state.tag) }));
app.listen(Number(process.env.PORT || 3000), "0.0.0.0", () => console.log("Health server is ready."));

const aliasGroups = {
  help: ["help", "اوامر"],
  ping: ["ping"],
  join: ["join", "come", "afk", "تعال"],
  leave: ["leave", "le", "left", "اطلع"],
  play: ["play", "p", "شغل", "ش"],
  search: ["search", "بحث"],
  queue: ["queue", "q", "que", "قائمه", "القائمه"],
  nowplaying: ["nowplaying", "np", "now", "الان"],
  pause: ["pause", "pa"],
  resume: ["resume", "res", "كمل"],
  skip: ["skip", "s", "تخطي", "ت", "س"],
  stop: ["stop", "st", "وقف", "توقف"],
  clear: ["clear", "cl", "clean", "حذف", "كلين"],
  shuffle: ["shuffle", "sh", "خلط"],
  loop: ["loop", "repeat", "re", "r", "l", "تكرار", "كرر"],
  autoplay: ["autoplay", "ap", "تلقائي"],
  filters: ["filters", "filter", "فلاتر", "فلتر"],
  seek: ["seek", "sk", "قدم", "تقديم"],
  volume: ["volume", "vol", "v", "صوت", "ص"],
  playinvcall: ["playinvcall", "callplay", "تشغيلبالروم"],
  settings: ["settings", "setting", "اعدادات", "إعدادات"],
  fleet: ["fleet", "bots", "البوتات"]
};
const commandNames = new Map(
  Object.entries(aliasGroups).flatMap(([command, aliases]) => aliases.map((alias) => [alias, command]))
);

function stateFor(client) {
  if (!botStates.has(client.user.id)) {
    botStates.set(client.user.id, {
      botIndex: client.botIndex,
      client,
      guilds: new Map(),
      tag: client.user.tag
    });
  }
  return botStates.get(client.user.id);
}

function guildState(client, guildId) {
  const state = stateFor(client);
  if (!state.guilds.has(guildId)) {
    const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
    const data = {
      autoplay: false,
      connection: null,
      current: null,
      filterProcess: null,
      filters: new Set(),
      loop: false,
      player,
      queue: [],
      resource: null,
      resourceStartSeconds: 0,
      seekSeconds: null,
      skipCurrent: false,
      skipping: false,
      starting: false,
      textChannel: null,
      volume: 0.5
    };
    player.on(AudioPlayerStatus.Idle, () => {
      if (!data.skipping) void playNext(client, guildId);
    });
    player.on("error", (error) => {
      console.error(`[${client.user.tag}] audio error:`, error.message);
      if (!data.skipping) void playNext(client, guildId);
    });
    state.guilds.set(guildId, data);
  }
  return state.guilds.get(guildId);
}

function botVoiceChannelId(client, guildId) {
  const channelId = client.guilds.cache.get(guildId)?.members.me?.voice?.channelId;
  if (channelId) return channelId;
  const connection = botStates.get(client.user.id)?.guilds.get(guildId)?.connection;
  return connection && connection.state.status !== VoiceConnectionStatus.Destroyed
    ? connection.joinConfig?.channelId || null
    : null;
}

function stripMention(client, text) {
  return text.replace(new RegExp(`^<@!?${client.user.id}>\\s*`), "").trim();
}

function parseInput(client, message) {
  const targetId = message.content.trim().match(/^<@!?(\d+)>/)?.[1] || null;
  const mentioned = targetId === client.user.id;
  const text = stripMention(client, message.content.trim());
  if (!text) return { mentioned, parts: [], targetIndex: null, text };

  const parts = text.split(/\s+/);
  let first = parts.shift();
  let targetIndex = null;
  const numbered = first.match(/^([0-9٠-٩]+)([a-z\u0600-\u06ff]+)$/i);
  if (numbered) {
    targetIndex = Number(arabicNumber(numbered[1]));
    first = numbered[2];
  }
  return {
    command: commandNames.get(first.toLowerCase()),
    mentioned,
    parts,
    raw: first.toLowerCase(),
    targetIndex,
    targetId,
    text
  };
}

function selected(client, message, parsed) {
  const bots = clients
    .filter((bot) => bot.user && bot.guilds.cache.has(message.guild.id))
    .map((bot) => ({ id: bot.user.id, index: bot.botIndex, channelId: botVoiceChannelId(bot, message.guild.id) }));
  return selectRoomBot({
    bots,
    channelId: message.channelId,
    memberChannelId: message.member?.voice?.channelId,
    isVoiceChat: message.channel.isVoiceBased(),
    command: parsed.command,
    targetIndex: parsed.targetIndex,
    targetId: parsed.targetId
  }) === client.user.id;
}

function isAdministrator(message) {
  return Boolean(
    owners.has(message.author.id) ||
      message.member?.permissions?.has(PermissionFlagsBits.Administrator)
  );
}

function arabicNumber(value) {
  return String(value).replace(/[٠-٩]/g, (digit) => ARABIC_DIGITS.indexOf(digit));
}

function truncate(value, max = 90) {
  const text = String(value || "");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isRateLimited(error) {
  return Boolean(error?.status === 429 || error?.code === 429 || /\b429\b/.test(String(error?.message || "")));
}

function publicError(error) {
  if (isYouTubeBlocked(error)) return "YouTube يرفض التشغيل من خادم Railway حاليًا. جرّب رابط SoundCloud أو play sc اسم الأغنية.";
  if (isRateLimited(error)) return "المصدر رفض طلب البحث مؤقتًا. انتظر 10 ثواني ثم جرّب مرة ثانية.";
  if (error?.name === "AbortError") return "انتهت مهلة الاتصال. تأكد من صلاحيات البوت ثم جرّب مرة ثانية.";
  return error?.message || "حدث خطأ غير متوقع.";
}

async function youtubeSearch(query, options) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await play.search(query, options);
    } catch (error) {
      lastError = error;
      if (!isRateLimited(error) || attempt === 1) throw error;
      await sleep(1200);
    }
  }
  throw lastError;
}

function providerFor(url) {
  if (/spotify\.com/i.test(url)) return "Spotify → YouTube";
  if (/soundcloud\.com/i.test(url)) return "SoundCloud";
  if (/youtu(?:\.be|be\.com)/i.test(url)) return "YouTube";
  return "رابط";
}

async function titleForUrl(url) {
  try {
    if (play.yt_validate(url) === "video") {
      const info = await play.video_basic_info(url);
      return {
        duration: info.video_details.durationRaw,
        thumbnail: info.video_details.thumbnails?.at(-1)?.url,
        title: info.video_details.title
      };
    }
  } catch (_) {
    // The URL can still be streamed even when metadata is unavailable.
  }

  try {
    if (/soundcloud\.com/i.test(url)) {
      await ensureSoundCloud();
      const sound = await play.soundcloud(url);
      return soundCloudTrack(sound);
    }
  } catch (_) {
    // Keep a useful fallback title.
  }
  return { title: url };
}

async function spotifyTracks(url, requester) {
  const resource = await play.spotify(url);
  const tracks = resource.type === "track" ? [resource] : await resource.all_tracks();
  const resolved = [];

  for (const track of tracks.slice(0, 25)) {
    const artists = (track.artists || []).map((artist) => artist.name).join(" ");
    const search = await youtubeSearch(`${track.name} ${artists}`, {
      limit: 1,
      source: { youtube: "video" }
    });
    if (!search.length) continue;
    resolved.push({
      duration: search[0].durationRaw,
      provider: "Spotify → YouTube",
      requester,
      thumbnail: search[0].thumbnails?.at(-1)?.url,
      title: `${track.name}${artists ? ` — ${artists}` : ""}`,
      url: search[0].url
    });
  }

  if (!resolved.length) throw new Error("تعذر العثور على نسخة قابلة للتشغيل من Spotify.");
  return resolved;
}

async function resolveTracks(query, requester) {
  const value = query.trim();
  if (!value) throw new Error("اكتب اسم الأغنية أو الرابط.");
  const soundCloudQuery = value.match(/^(?:sc|soundcloud|ساوندكلاود)\s+(.+)$/i)?.[1];
  if (soundCloudQuery) {
    const tracks = await searchSoundCloud(soundCloudQuery, requester, 1);
    if (!tracks.length) throw new Error("لم أجد الأغنية على SoundCloud.");
    return tracks;
  }

  if (/^https?:\/\//i.test(value)) {
    if (/spotify\.com/i.test(value)) return spotifyTracks(value, requester);

    let youtubeType = null;
    try {
      youtubeType = play.yt_validate(value);
    } catch (_) {
      youtubeType = null;
    }
    if (youtubeType === "playlist") {
      const playlist = await play.playlist_info(value);
      const videos = (await playlist.all_videos()).slice(0, 25);
      return videos.map((video) => ({
        duration: video.durationRaw,
        provider: "YouTube playlist",
        requester,
        thumbnail: video.thumbnails?.at(-1)?.url,
        title: video.title,
        url: video.url
      }));
    }

    if (youtubeType !== "video" && !/soundcloud\.com/i.test(value)) {
      throw new Error("الرابط المدعوم يكون من YouTube أو SoundCloud أو Spotify.");
    }

    const metadata = await titleForUrl(value);
    return [{ ...metadata, provider: providerFor(value), requester, url: value }];
  }

  const results = await youtubeSearch(value, { limit: 1, source: { youtube: "video" } });
  if (!results.length) throw new Error("لم أجد الأغنية. جرّب كلمات أوضح.");
  return [{
    duration: results[0].durationRaw,
    provider: "YouTube",
    requester,
    thumbnail: results[0].thumbnails?.at(-1)?.url,
    title: results[0].title,
    url: results[0].url
  }];
}

function filtersEmbed(data) {
  const active = [...data.filters].map((filter) => FILTER_LABELS.get(filter)).filter(Boolean);
  return new EmbedBuilder()
    .setColor(0x7c3aed)
    .setTitle("🎛️ فلاتر الصوت")
    .setDescription(active.length ? `المفعّل الآن: **${active.join("، ")}**` : "ما فيه فلاتر مفعّلة.")
    .setFooter({ text: "اختر أكثر من فلتر من القائمة • تطبّق على الأغنية التالية" });
}

function requesterInfo(client, guildId, track) {
  const member = client.guilds.cache.get(guildId)?.members.cache.get(track.requester);
  const user = member?.user || client.users.cache.get(track.requester);
  return {
    displayName: member?.displayName || user?.globalName || user?.username,
    avatarURL: member?.displayAvatarURL() || user?.displayAvatarURL()
  };
}

function nowPlayingPayload(client, guildId, data, track) {
  const requester = requesterInfo(client, guildId, track);
  const permissions = data.textChannel?.permissionsFor?.(client.user);
  return playerPayload(guildId, data, track, requester, !permissions || permissions.has(PermissionFlagsBits.AttachFiles));
}

async function sendNowPlaying(client, guildId, data, track) {
  if (!data.textChannel) return;
  const requester = requesterInfo(client, guildId, track);
  const payload = {
    content: trackReply("Playing song", track, requester.displayName) + (track.fallbackFrom ? "\n*Source: SoundCloud*" : ""),
    allowedMentions: { parse: [] }
  };
  if (track.requestMessageId) payload.reply = { messageReference: track.requestMessageId, failIfNotExists: false };
  await data.textChannel.send(payload).catch((error) => console.error("Player card:", error.message));
}

function durationInSeconds(value) {
  if (typeof value === "number") return value;
  const text = String(value || "").trim();
  if (!/^\d+(?::\d{1,2}){0,2}$/.test(text)) return 0;
  return text.split(":").reduce((total, part) => total * 60 + Number(part), 0);
}

function formatSeconds(value) {
  const seconds = Math.max(0, Math.floor(Number(value) || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

function killFilterProcess(data) {
  if (data.filterProcess && !data.filterProcess.killed) data.filterProcess.kill();
  data.filterProcess = null;
}

function filterExpression(filters) {
  const expressions = [];
  if (filters.has("8d")) expressions.push("apulsator=hz=0.08");
  if (filters.has("nightcore")) expressions.push("asetrate=60000,aresample=48000,atempo=0.8");
  if (filters.has("bassboost")) expressions.push("bass=g=8");
  if (filters.has("vaporwave")) expressions.push("asetrate=38400,aresample=48000,atempo=1.25");
  if (filters.has("slowmode")) expressions.push("atempo=0.8");
  return expressions.join(",");
}

function filteredStream(source, data) {
  if (!data.filters.size) return { stream: source.stream, type: source.type || StreamType.WebmOpus };
  if (!ffmpegPath) throw new Error("الفلاتر تحتاج FFmpeg، وهو غير متاح في الخدمة حالياً.");

  const process = spawn(ffmpegPath, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    "pipe:0",
    "-vn",
    "-af",
    filterExpression(data.filters),
    "-f",
    "s16le",
    "-ar",
    "48000",
    "-ac",
    "2",
    "pipe:1"
  ], { stdio: ["pipe", "pipe", "pipe"] });
  data.filterProcess = process;
  process.stderr.on("data", (chunk) => console.error("FFmpeg:", chunk.toString().trim()));
  process.on("close", () => {
    if (data.filterProcess === process) data.filterProcess = null;
  });
  process.on("error", (error) => console.error("FFmpeg process error:", error.message));
  source.stream.on("error", (error) => process.stdin.destroy(error));
  process.stdin.on("error", () => {});
  source.stream.pipe(process.stdin);
  return { stream: process.stdout, type: StreamType.Raw };
}

function searchRows(searchId, count) {
  const buttons = Array.from({ length: count }, (_, index) =>
    new ButtonBuilder()
      .setCustomId(`musicsearch:${searchId}:${index}`)
      .setLabel(String(index + 1))
      .setStyle(ButtonStyle.Secondary)
  );
  const rows = [];
  for (let index = 0; index < buttons.length; index += 5) {
    rows.push(new ActionRowBuilder().addComponents(buttons.slice(index, index + 5)));
  }
  return rows;
}

function queueEmbed(data, page) {
  const start = (page - 1) * 10;
  const tracks = data.queue.slice(start, start + 10);
  const description = tracks.length
    ? tracks.map((track, index) => `**${start + index + 1}.** ${truncate(track.title)} • <@${track.requester}>`).join("\n")
    : "القائمة فارغة.";
  return new EmbedBuilder()
    .setColor(0x7c3aed)
    .setTitle(`📃 قائمة التشغيل • صفحة ${page}`)
    .setDescription(`${data.current ? `🎶 الآن: **${truncate(data.current.title)}**\n\n` : ""}${description}`);
}

function queueRow(guildId, page, totalPages) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`music:queueprev:${guildId}:${page}`)
      .setEmoji("⬅️")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 1),
    new ButtonBuilder()
      .setCustomId(`music:queuenext:${guildId}:${page}`)
      .setEmoji("➡️")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages)
  );
}

async function playNext(client, guildId) {
  const data = guildState(client, guildId);
  if (data.starting) return;
  data.starting = true;

  try {
    const previous = data.current;
    const seekSeconds = data.seekSeconds;
    const skipped = data.skipCurrent;
    data.seekSeconds = null;
    data.skipCurrent = false;
    let track = seekSeconds !== null && previous
      ? previous
      : (!skipped && data.loop && previous ? previous : data.queue.shift());
    if (!track && data.autoplay && previous) {
      const results = await youtubeSearch(`${previous.title} mix`, {
        limit: 1,
        source: { youtube: "video" }
      }).catch(() => []);
      if (results[0]) {
        track = {
          duration: results[0].durationRaw,
          provider: "YouTube autoplay",
          requester: previous.requester,
          thumbnail: results[0].thumbnails?.at(-1)?.url,
          title: results[0].title,
          url: results[0].url
        };
      }
    }

    if (!track) {
      data.current = null;
      data.resource = null;
      return;
    }

    killFilterProcess(data);
    const startAt = Math.max(0, Number(seekSeconds) || 0);
    const source = await streamTrack(track, startAt);
    data.current = track;
    data.resourceStartSeconds = startAt;
    const output = filteredStream(source, data);
    data.resource = createAudioResource(output.stream, {
      inlineVolume: true,
      inputType: output.type || StreamType.WebmOpus
    });
    data.resource.volume.setVolume(data.volume);
    data.player.play(data.resource);
    await entersState(data.player, AudioPlayerStatus.Playing, 15_000);
    await sendNowPlaying(client, guildId, data, track);
    return true;
  } catch (error) {
    console.error(`[${client.user.tag}] stream error:`, error.message);
    if (data.textChannel) {
      await data.textChannel.send(`❌ ${publicError(error)}`).catch(() => {});
    }
    data.current = null;
    data.resource = null;
    killFilterProcess(data);
    data.player.stop();
    if (data.queue.length) setImmediate(() => void playNext(client, guildId));
    return false;
  } finally {
    data.starting = false;
  }
}

async function connectToMemberChannel(client, context, data) {
  const channel = context.member?.voice?.channel;
  if (!channel) throw new Error("ادخل روم صوتي أولاً.");
  if (!context.channel?.isVoiceBased() || context.channel.id !== channel.id) {
    throw new Error("اكتب الأمر في شات الروم الصوتي اللي أنت داخله.");
  }

  const me = context.guild.members.me;
  const permissions = me ? channel.permissionsFor(me) : null;
  if (permissions && !permissions.has(PermissionFlagsBits.ViewChannel)) {
    throw new Error("ما عندي صلاحية View Channel على الروم الصوتي.");
  }
  if (permissions && !permissions.has(PermissionFlagsBits.Connect)) {
    throw new Error("ما عندي صلاحية Connect في هذا الروم الصوتي.");
  }
  if (permissions && !permissions.has(PermissionFlagsBits.Speak)) {
    throw new Error("ما عندي صلاحية Speak في هذا الروم الصوتي.");
  }

  if (data.connection?.state.status === VoiceConnectionStatus.Destroyed) data.connection = null;
  const currentChannelId = data.connection?.joinConfig?.channelId;
  if (currentChannelId && currentChannelId !== channel.id) {
    throw new Error("البوت موجود في روم صوتي آخر.");
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (!data.connection) {
      data.connection = joinVoiceChannel({
        adapterCreator: channel.guild.voiceAdapterCreator,
        channelId: channel.id,
        guildId: channel.guild.id,
        group: client.user.id,
        selfDeaf: true,
        selfMute: false
      });
      data.connection.on("stateChange", (oldState, newState) => {
        const networkCode = newState.networking?.state?.code || "n/a";
        console.log(`[${client.user.tag}] voice ${oldState.status} -> ${newState.status} (network ${networkCode})`);
        if (newState.status === VoiceConnectionStatus.Destroyed) data.connection = null;
      });
      data.connection.on("error", (error) => {
        console.error(`[${client.user.tag}] voice error:`, error.stack || error.message);
      });
    }

    data.connection.subscribe(data.player);
    try {
      await entersState(data.connection, VoiceConnectionStatus.Ready, 30_000);
      return channel;
    } catch (error) {
      const status = data.connection?.state?.status || "unknown";
      console.error(`[${client.user.tag}] voice join failed (${status}), attempt ${attempt + 1}:`, error.stack || error.message);
      data.connection?.destroy();
      data.connection = null;
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 750));
    }
  }
  throw new Error("تعذر دخول الروم خلال 30 ثانية. أعطِ البوت View Channel وConnect وSpeak ثم جرّب come مرة ثانية.");
}

function isPlaying(data) {
  return [AudioPlayerStatus.Playing, AudioPlayerStatus.Buffering, AudioPlayerStatus.Paused].includes(data.player.state.status);
}

async function enqueueTracks(client, context, data, tracks) {
  if (data.queue.length + tracks.length > MAX_QUEUE_SIZE) {
    throw new Error(`الحد الأقصى للقائمة ${MAX_QUEUE_SIZE} أغنية.`);
  }
  await connectToMemberChannel(client, context, data);
  data.textChannel = context.channel;
  for (const track of tracks) track.requestMessageId = context.messageId;
  data.queue.push(...tracks);

  if (!isPlaying(data) && !data.starting && !data.skipping) {
    const started = await playNext(client, context.guild.id);
    if (!started) return context.acknowledge
      ? context.acknowledge(false)
      : context.reply({ content: "❌ لم يبدأ التشغيل. سبب الخطأ موجود في شات الروم." });
    return context.acknowledge ? context.acknowledge(true) : context.reply({ content: "✅ بدأ التشغيل." });
  }
  return context.acknowledge ? context.acknowledge(true) : context.reply({ content: "✅ تمت الإضافة إلى الانتظار." });
}

async function enqueue(client, message, data, query) {
  const tracks = await resolveTracks(query, message.author.id);
  return enqueueTracks(client, {
    authorId: message.author.id,
    channel: message.channel,
    guild: message.guild,
    member: message.member,
    messageId: message.id,
    acknowledge: (success) => message.react(success ? "✅" : "❌").catch(() => {}),
    reply: (payload) => message.reply(payload)
  }, data, tracks);
}

function helpEmbed() {
  return new EmbedBuilder()
    .setColor(0x7c3aed)
    .setTitle("🎵 Music Fleet — الأوامر")
    .setDescription("الأوامر تعمل فقط في شات الروم الصوتي اللي أنت والبوت فيه. للتشغيل اكتب ش ثم اسم الأغنية أو رابطها. الكلام العادي لا يشغّل أغاني. إذا الروم بدون بوت، اكتب join في شاته أولاً.")
    .addFields(
      { name: "التشغيل", value: "`ش <اسم أو رابط>` أو `play <اسم أو رابط>` أو `شغل <اسم>`\nمثال: `ش اسم الأغنية`" },
      { name: "التحكم", value: "`queue` القائمة • `nowplaying` الحالي • `pause` إيقاف مؤقت • `resume` متابعة\n`skip` تخطي • `stop` إيقاف • `clear` مسح الانتظار • `leave` خروج" },
      { name: "الخيارات", value: "`loop` تكرار • `autoplay` تشغيل تلقائي • `shuffle` خلط • `volume 0-150` الصوت\n`filters` فلاتر • `seek 1:30` تقديم • `search <اسم>` بحث\n`ping` سرعة البوت • `settings` الإعدادات" },
      { name: "اختصارات عربية", value: "`شغل` `ش` `قائمه` `الان` `تخطي` `ت` `وقف` `حذف` `خلط` `تكرار` `تلقائي` `فلاتر` `قدم` `صوت`" },
      { name: "توجيه بوت معيّن", value: "`1play اسم الأغنية` أو منشن البوت ثم الأمر داخل شات رومه فقط. بدون رقم يرد بوت واحد من الموجودين معك. لاستدعاء بوت غير متصل، اكتب `1join` في شات رومك الصوتي." }
    )
    .setFooter({ text: "Music Fleet" });
}

function settingsEmbed(client, data) {
  const channelId = data.connection?.joinConfig?.channelId;
  return new EmbedBuilder()
    .setColor(0x7c3aed)
    .setTitle(`⚙️ إعدادات ${client.user.username}`)
    .addFields(
      { name: "طريقة التشغيل", value: "`ش اسم الأغنية` أو `play اسم الأغنية` فقط؛ الكلام العادي يُتجاهل.", inline: false },
      { name: "الروم الصوتي", value: channelId ? `<#${channelId}>` : "غير متصل", inline: true },
      { name: "الصوت", value: `${Math.round(data.volume * 100)}`, inline: true },
      { name: "التكرار", value: data.loop ? "✅" : "☑️", inline: true },
      { name: "التشغيل التلقائي", value: data.autoplay ? "✅" : "☑️", inline: true },
      { name: "الفلاتر", value: data.filters.size ? [...data.filters].map((filter) => FILTER_LABELS.get(filter)).join("، ") : "لا يوجد", inline: true },
      { name: "الأغاني المنتظرة", value: String(data.queue.length), inline: true }
    );
}

function parseSeekInput(value) {
  const normalized = arabicNumber(String(value || "").trim());
  if (!normalized || !/^\d+(?::\d{1,2}){0,2}$/.test(normalized)) return null;
  const parts = normalized.split(":").map(Number);
  if (parts.some((part) => !Number.isInteger(part) || part < 0)) return null;
  if (parts.length > 1 && parts.slice(1).some((part) => part > 59)) return null;
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return (parts[0] * 60) + parts[1];
  return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
}

async function clearOldSlashCommands(client) {
  const rest = new REST({ version: "10" }).setToken(client.token);
  const route = process.env.TEST_GUILD_ID
    ? Routes.applicationGuildCommands(client.user.id, process.env.TEST_GUILD_ID)
    : Routes.applicationCommands(client.user.id);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await rest.put(route, { body: [] });
      return;
    } catch (error) {
      if (!isRateLimited(error) || attempt === 2) throw error;
      await sleep(1500 * (attempt + 1));
    }
  }
}

async function handleMessage(client, message) {
  if (message.author.bot || !message.guild) return;
  const parsed = parseInput(client, message);
  if (!parsed.text || !parsed.command || !selected(client, message, parsed)) return;

  const data = guildState(client, message.guild.id);
  data.textChannel = message.channel;
  const command = parsed.command;

  try {
    if (command === "help") {
      try {
        await message.author.send({ embeds: [helpEmbed()] });
        await message.react("✅");
      } catch (_) {
        await message.react("🔐");
      }
      return;
    }
    if (command === "ping") return void message.reply(`🏓 ${client.ws.ping}ms`);
    if (command === "fleet") {
      const lines = clients.map((bot, index) => `${index + 1}. ${bot.user ? `${bot.user.tag} ✅` : "غير متصل ⏳"}`);
      return void message.reply(lines.join("\n"));
    }
    if (command === "settings") return void message.reply({ embeds: [settingsEmbed(client, data)] });
    if (command === "join") {
      await connectToMemberChannel(client, message, data);
      return void message.reply("✅ دخلت الروم الصوتي.");
    }
    if (command === "leave") {
      data.queue.length = 0;
      data.current = null;
      data.loop = false;
      data.autoplay = false;
      data.filters.clear();
      data.seekSeconds = null;
      data.skipCurrent = false;
      killFilterProcess(data);
      data.player.stop();
      getVoiceConnection(message.guild.id, client.user.id)?.destroy();
      data.connection = null;
      return void message.reply("☑️ طلعت من الروم.");
    }
    if (command === "play") {
      const query = parsed.parts.join(" ");
      if (!query) return void message.reply("اكتب `ش` ثم اسم الأغنية أو رابطها، مثل: `ش اسم الأغنية`.");
      return void (await enqueue(client, message, data, query));
    }
    if (command === "search") {
      const query = parsed.parts.join(" ");
      if (!query) return void message.reply("طريقة الاستخدام: `search <song name>`");
      const results = await youtubeSearch(query, { limit: 10, source: { youtube: "video" } });
      if (!results.length) return void message.reply("لم أجد نتائج.");
      const searchId = message.id;
      const tracks = results.map((result) => ({
        duration: result.durationRaw,
        provider: "YouTube",
        requester: message.author.id,
        thumbnail: result.thumbnails?.at(-1)?.url,
        title: result.title,
        url: result.url
      }));
      pendingSearches.set(searchId, {
        clientId: client.user.id,
        guildId: message.guild.id,
        requester: message.author.id,
        tracks
      });
      setTimeout(() => pendingSearches.delete(searchId), 30_000).unref?.();
      const description = results.length
        ? results.map((result, index) => `**${index + 1}.** [${truncate(result.title, 80)}](${result.url}) • ${result.durationRaw || "?"}`).join("\n")
        : "لم أجد نتائج.";
      return void message.reply({
        components: searchRows(searchId, tracks.length),
        embeds: [new EmbedBuilder().setColor(0x7c3aed).setTitle(`🔎 نتائج البحث عن ${truncate(query, 50)}`).setDescription(`${description}\n\nاختر رقم الأغنية من الأزرار — القائمة صالحة 30 ثانية.`)]
      });
    }
    if (command === "queue") {
      const page = Math.max(1, Number(arabicNumber(parsed.parts[0] || "1")) || 1);
      const totalPages = Math.max(1, Math.ceil(data.queue.length / 10));
      const safePage = Math.min(page, totalPages);
      return void message.reply({
        components: totalPages > 1 ? [queueRow(message.guild.id, safePage, totalPages)] : [],
        embeds: [queueEmbed(data, safePage)]
      });
    }
    if (command === "nowplaying") {
      if (!data.current) return void message.reply("لا توجد أغنية تعمل الآن.");
      return void message.reply(nowPlayingPayload(client, message.guild.id, data, data.current));
    }
    if (command === "skip") {
      const result = await skipTrack(data, () => playNext(client, message.guild.id), () => killFilterProcess(data));
      return void message.reply({ content: skipMessage(result, message.member?.displayName || message.author.globalName || message.author.username), allowedMentions: { parse: [] } });
    }
    if (command === "stop") {
      data.queue.length = 0;
      data.current = null;
      data.loop = false;
      data.autoplay = false;
      data.filters.clear();
      data.seekSeconds = null;
      data.skipCurrent = false;
      killFilterProcess(data);
      data.player.stop();
      return void message.reply("⛔ تم الإيقاف ومسح القائمة.");
    }
    if (command === "clear") {
      data.queue.length = 0;
      return void message.reply("✅ تم مسح الأغاني المنتظرة.");
    }
    if (command === "pause") {
      data.player.pause();
      return void message.reply("⏸️ تم الإيقاف المؤقت.");
    }
    if (command === "resume") {
      data.player.unpause();
      return void message.reply("▶️ تم الاستكمال.");
    }
    if (command === "shuffle") {
      for (let index = data.queue.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(Math.random() * (index + 1));
        [data.queue[index], data.queue[swap]] = [data.queue[swap], data.queue[index]];
      }
      return void message.reply(data.queue.length > 1 ? "🔀 تم خلط القائمة." : "تحتاج أكثر من أغنيتين.");
    }
    if (command === "loop") {
      data.loop = !data.loop;
      return void message.reply(data.loop ? "🔁 تم تشغيل التكرار." : "✅ تم إيقاف التكرار.");
    }
    if (command === "autoplay") {
      data.autoplay = !data.autoplay;
      return void message.reply(data.autoplay ? "🔄 تم تشغيل التشغيل التلقائي." : "✅ تم إيقاف التشغيل التلقائي.");
    }
    if (command === "filters") {
      return void message.reply({
        components: [filterRow(message.guild.id, [...data.filters])],
        embeds: [filtersEmbed(data)]
      });
    }
    if (command === "seek") {
      if (!data.current) return void message.reply("لا توجد أغنية تعمل الآن.");
      let youtubeType = null;
      try {
        youtubeType = play.yt_validate(data.current.url);
      } catch (_) {
        youtubeType = null;
      }
      if (youtubeType !== "video") return void message.reply("التقديم متاح حاليًا لأغاني YouTube فقط.");
      const seconds = parseSeekInput(parsed.parts[0]);
      if (seconds === null) return void message.reply("طريقة الاستخدام: `seek 90` أو `seek 1:30`.");
      const duration = durationInSeconds(data.current.duration);
      if (duration && seconds >= duration) return void message.reply(`استخدم وقتًا أقل من ${formatSeconds(duration)}.`);
      data.seekSeconds = seconds;
      data.skipCurrent = false;
      killFilterProcess(data);
      data.player.stop();
      return void message.reply(`⏩ تم التقديم إلى ${formatSeconds(seconds)}.`);
    }
    if (command === "volume") {
      const before = Math.round(data.volume * 100);
      if (!parsed.parts[0]) return void message.reply(`*Volume:* \`${before}%\`.`);
      const raw = parsed.parts[0] ? arabicNumber(parsed.parts[0]) : String(Math.round(data.volume * 100));
      const volume = Number(raw);
      if (!Number.isFinite(volume) || volume < 0 || volume > 150) return void message.reply("استخدم رقمًا من 0 إلى 150.");
      data.volume = volume / 100;
      data.resource?.volume?.setVolume(data.volume);
      return void message.reply(volumeReply(before, volume));
    }
    if (command === "playinvcall") {
      if (!isAdministrator(message)) return void message.reply("هذا الأمر للأدمن أو المالك فقط.");
      return void message.reply("التشغيل بالرسائل العادية مُلغى. استخدم `ش اسم الأغنية` أو `play اسم الأغنية` داخل شات الروم الصوتي.");
    }
  } catch (error) {
    console.error(`[${client.user.tag}] command error:`, error.message);
    await message.reply(`❌ ${publicError(error)}`).catch(() => {});
  }
}

async function memberForInteraction(interaction) {
  if (interaction.member?.voice) return interaction.member;
  return interaction.guild.members.fetch(interaction.user.id).catch(() => null);
}

async function requireSameVoice(interaction, data) {
  const member = await memberForInteraction(interaction);
  const botChannelId = botVoiceChannelId(interaction.client, interaction.guildId);
  if (!isSameRoomChat({
    channelId: interaction.channelId,
    memberChannelId: member?.voice?.channelId,
    botChannelId,
    isVoiceChat: interaction.channel?.isVoiceBased()
  })) {
    await interaction.reply({ content: "استخدم الأزرار في شات الروم الصوتي اللي أنت والبوت فيه.", ephemeral: true });
    return null;
  }
  return member;
}

async function handleSearchSelection(client, interaction) {
  const [, searchId, rawIndex] = interaction.customId.split(":");
  const record = pendingSearches.get(searchId);
  const index = Number(rawIndex);
  if (!record || record.clientId !== client.user.id || !record.tracks[index]) {
    return void interaction.reply({ content: "انتهت قائمة البحث. اكتب search مرة ثانية.", ephemeral: true });
  }
  if (record.guildId !== interaction.guildId) return;
  if (record.requester !== interaction.user.id) {
    return void interaction.reply({ content: "صاحب البحث فقط يقدر يختار أغنية.", ephemeral: true });
  }

  const data = guildState(client, interaction.guildId);
  const member = await requireSameVoice(interaction, data);
  if (!member) return;
  const track = record.tracks[index];
  await interaction.deferReply({ ephemeral: true });
  try {
    await enqueueTracks(client, {
      authorId: interaction.user.id,
      channel: interaction.channel,
      guild: interaction.guild,
      member,
      reply: (payload) => interaction.editReply(payload)
    }, data, [track]);
    pendingSearches.delete(searchId);
    await interaction.message.edit({ components: [] }).catch(() => {});
  } catch (error) {
    await interaction.editReply(`❌ ${publicError(error)}`).catch(() => {});
  }
}

async function handleButton(client, interaction) {
  if (!interaction.guildId) return;

  if (interaction.isButton() && interaction.customId.startsWith("musicsearch:")) {
    return handleSearchSelection(client, interaction);
  }

  if (interaction.isStringSelectMenu() && interaction.customId.startsWith("music:filters:")) {
    const guildId = interaction.customId.split(":")[2];
    if (guildId !== interaction.guildId) return;
    const data = guildState(client, guildId);
    if (!await requireSameVoice(interaction, data)) return;
    const values = interaction.values || [];
    if (values.includes("clear")) data.filters.clear();
    else {
      data.filters.clear();
      values.filter((value) => FILTER_LABELS.has(value)).forEach((value) => data.filters.add(value));
    }
    const active = [...data.filters].map((filter) => FILTER_LABELS.get(filter)).join("، ");
    return void interaction.reply({
      content: active ? `🎛️ الفلاتر المفعّلة: ${active}` : "✅ تم مسح كل الفلاتر.",
      ephemeral: true
    });
  }

  if (!interaction.isButton() || !interaction.customId.startsWith("music:")) return;
  const parts = interaction.customId.split(":");
  const action = parts[1];
  const guildId = parts[2];
  if (guildId !== interaction.guildId) return;

  const data = guildState(client, guildId);
  if (action === "queueprev" || action === "queuenext") {
    if (!await requireSameVoice(interaction, data)) return;
    const totalPages = Math.max(1, Math.ceil(data.queue.length / 10));
    const oldPage = Math.max(1, Number(parts[3]) || 1);
    const page = Math.min(totalPages, Math.max(1, oldPage + (action === "queuenext" ? 1 : -1)));
    return void interaction.update({
      components: totalPages > 1 ? [queueRow(guildId, page, totalPages)] : [],
      embeds: [queueEmbed(data, page)]
    });
  }

  if (!await requireSameVoice(interaction, data)) return;
  if (action === "pause") {
    if (data.player.state.status === AudioPlayerStatus.Paused) data.player.unpause();
    else data.player.pause();
    return void interaction.update({ components: playerComponents(guildId, data) });
  }
  if (action === "skip") {
    await interaction.deferReply({ ephemeral: true });
    const result = await skipTrack(data, () => playNext(client, guildId), () => killFilterProcess(data));
    return void interaction.editReply({ content: skipMessage(result, interaction.member?.displayName || interaction.user.globalName || interaction.user.username), allowedMentions: { parse: [] } });
  }
  if (action === "stop") {
    data.queue.length = 0;
    data.current = null;
    data.loop = false;
    data.autoplay = false;
    data.filters.clear();
    data.seekSeconds = null;
    data.skipCurrent = false;
    killFilterProcess(data);
    data.player.stop();
    return void interaction.reply({ content: "⛔ تم الإيقاف.", ephemeral: true });
  }
  if (action === "loop") {
    data.loop = !data.loop;
    return void interaction.reply({ content: data.loop ? "🔁 التكرار مفعّل." : "✅ التكرار متوقف.", ephemeral: true });
  }
  if (["volume", "volup", "voldown"].includes(action)) {
    const before = Math.round(data.volume * 100);
    const delta = action === "voldown" ? -0.1 : 0.1;
    data.volume = Math.max(0, Math.min(1.5, Math.round((data.volume + delta) * 100) / 100));
    data.resource?.volume?.setVolume(data.volume);
    return void interaction.reply({ content: volumeReply(before, data.volume * 100), ephemeral: true });
  }
}

for (const [index, token] of tokens.entries()) {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.MessageContent
    ]
  });
  client.botIndex = index;
  clients.push(client);
  client.once("clientReady", async () => {
    console.log(`Bot ${index}/${tokens.length} online as ${client.user.tag}`);
    stateFor(client).tag = client.user.tag;
    try {
      await sleep(index * 1200);
      await clearOldSlashCommands(client);
      console.log(`Old slash commands cleared for ${client.user.tag}`);
    } catch (error) {
      console.error(`Could not clear old slash commands for ${client.user.tag}:`, error.message);
    }
  });
  client.on("voiceStateUpdate", (oldState, newState) => {
    if (newState.id !== client.user?.id || !oldState.channelId || newState.channelId) return;
    const data = botStates.get(client.user.id)?.guilds.get(newState.guild.id);
    if (data) data.connection = null;
  });
  client.on("messageCreate", (message) => void handleMessage(client, message));
  client.on("interactionCreate", (interaction) => void handleButton(client, interaction));
  client.login(token).catch((error) => console.error(`Bot ${index} login failed:`, error.message));
}

process.on("unhandledRejection", (error) => {
  if (isRateLimited(error)) {
    console.warn("An upstream request was rate-limited; the bot remains online.");
    return;
  }
  console.error("Unhandled rejection:", error);
});
