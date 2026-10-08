require("dotenv").config();

const express = require("express");
const play = require("play-dl");
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
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

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
      loop: false,
      player,
      playInVoice: true,
      queue: [],
      resource: null,
      starting: false,
      textChannel: null,
      volume: 0.5
    };
    player.on(AudioPlayerStatus.Idle, () => void playNext(client, guildId));
    player.on("error", (error) => {
      console.error(`[${client.user.tag}] audio error:`, error.message);
      void playNext(client, guildId);
    });
    state.guilds.set(guildId, data);
  }
  return state.guilds.get(guildId);
}

function activeVoice(guildId) {
  for (const client of clients) {
    if (!client.user) continue;
    const data = botStates.get(client.user.id)?.guilds.get(guildId);
    if (data?.connection?.joinConfig?.channelId) return { client, data };
  }
  return null;
}

function stripMention(client, text) {
  return text.replace(new RegExp(`^<@!?${client.user.id}>\\s*`), "").trim();
}

function parseInput(client, message) {
  const mentioned = message.mentions.users.has(client.user.id);
  const text = stripMention(client, message.content.trim());
  if (!text) return { mentioned, parts: [], targetIndex: null, text };

  const parts = text.split(/\s+/);
  let first = parts.shift();
  let targetIndex = null;
  const numbered = first.match(/^(\d+)([a-z]+)$/i);
  if (numbered) {
    targetIndex = Number(numbered[1]);
    first = numbered[2];
  }
  return {
    command: commandNames.get(first.toLowerCase()),
    mentioned,
    parts,
    raw: first.toLowerCase(),
    targetIndex,
    text
  };
}

function selected(client, message, parsed) {
  if (parsed.targetIndex !== null) return parsed.targetIndex - 1 === client.botIndex;
  if (parsed.mentioned) return true;

  const active = activeVoice(message.guild.id);
  if (!active) return client.botIndex === 0;
  return (
    active.client.user.id === client.user.id &&
    message.member?.voice?.channelId === active.data.connection.joinConfig.channelId
  );
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
      const sound = await play.soundcloud(url);
      return { title: sound.name || sound.title || "SoundCloud track" };
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
    const search = await play.search(`${track.name} ${artists}`, {
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

  if (/^https?:\/\//i.test(value)) {
    if (/spotify\.com/i.test(value)) return spotifyTracks(value, requester);

    if (play.yt_validate(value) === "playlist") {
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

    const metadata = await titleForUrl(value);
    return [{ ...metadata, provider: providerFor(value), requester, url: value }];
  }

  const results = await play.search(value, { limit: 1, source: { youtube: "video" } });
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

function controlRow(guildId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`music:pause:${guildId}`).setEmoji("⏯️").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`music:skip:${guildId}`).setEmoji("⏭️").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`music:stop:${guildId}`).setEmoji("⛔").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`music:loop:${guildId}`).setEmoji("🔁").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`music:volume:${guildId}`).setEmoji("🔊").setStyle(ButtonStyle.Secondary)
  );
}

function trackEmbed(client, _data, track, title) {
  const embed = new EmbedBuilder()
    .setColor(0x7c3aed)
    .setTitle(title)
    .setDescription(`[${truncate(track.title)}](${track.url})`)
    .addFields(
      { name: "طلبها", value: `<@${track.requester}>`, inline: true },
      { name: "المصدر", value: track.provider || "Music Fleet", inline: true },
      { name: "المدة", value: track.duration || "غير معروفة", inline: true }
    )
    .setFooter({ text: `${client.user.username} • Music Fleet` });
  if (track.thumbnail) embed.setThumbnail(track.thumbnail);
  return embed;
}

async function sendNowPlaying(client, guildId, data, track) {
  if (!data.textChannel) return;
  await data.textChannel.send({
    allowedMentions: { users: [track.requester] },
    components: [controlRow(guildId)],
    embeds: [trackEmbed(client, data, track, "🎶 Playing Song")]
  }).catch(() => {});
}

async function playNext(client, guildId) {
  const data = guildState(client, guildId);
  if (data.starting) return;
  data.starting = true;

  try {
    let track = data.loop && data.current ? data.current : data.queue.shift();
    if (!track && data.autoplay && data.current) {
      const results = await play.search(`${data.current.title} mix`, {
        limit: 1,
        source: { youtube: "video" }
      }).catch(() => []);
      if (results[0]) {
        track = {
          duration: results[0].durationRaw,
          provider: "YouTube autoplay",
          requester: data.current.requester,
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

    const source = await play.stream(track.url, {
      discordPlayerCompatibility: true,
      quality: 2
    });
    data.current = track;
    data.resource = createAudioResource(source.stream, {
      inlineVolume: true,
      inputType: source.type || StreamType.WebmOpus
    });
    data.resource.volume.setVolume(data.volume);
    data.player.play(data.resource);
    await sendNowPlaying(client, guildId, data, track);
  } catch (error) {
    console.error(`[${client.user.tag}] stream error:`, error.message);
    if (data.textChannel) {
      await data.textChannel.send("تعذر تشغيل هذا المصدر، جرّب اسمًا أو رابطًا آخر.").catch(() => {});
    }
    data.current = null;
    setImmediate(() => void playNext(client, guildId));
  } finally {
    data.starting = false;
  }
}

async function connectToMemberChannel(client, message, data) {
  const channel = message.member?.voice?.channel;
  if (!channel) throw new Error("ادخل روم صوتي أولاً.");

  const me = message.guild.members.me;
  const permissions = me ? channel.permissionsFor(me) : null;
  if (permissions && !permissions.has(PermissionFlagsBits.Connect)) {
    throw new Error("ما عندي صلاحية Connect في هذا الروم الصوتي.");
  }
  if (permissions && !permissions.has(PermissionFlagsBits.Speak)) {
    throw new Error("ما عندي صلاحية Speak في هذا الروم الصوتي.");
  }

  const currentChannelId = data.connection?.joinConfig?.channelId;
  if (currentChannelId && currentChannelId !== channel.id) {
    throw new Error("البوت موجود في روم صوتي آخر.");
  }

  if (!data.connection || data.connection.state.status === VoiceConnectionStatus.Destroyed) {
    data.connection = joinVoiceChannel({
      adapterCreator: channel.guild.voiceAdapterCreator,
      channelId: channel.id,
      guildId: channel.guild.id,
      group: client.user.id,
      selfDeaf: true
    });
    data.connection.on("stateChange", (oldState, newState) => {
      console.log(`[${client.user.tag}] voice ${oldState.status} -> ${newState.status}`);
      if (newState.status === VoiceConnectionStatus.Destroyed) data.connection = null;
    });
    data.connection.on("error", (error) => {
      console.error(`[${client.user.tag}] voice error:`, error.stack || error.message);
    });
  }

  data.connection.subscribe(data.player);
  try {
    await entersState(data.connection, VoiceConnectionStatus.Ready, 30_000);
  } catch (error) {
    const status = data.connection?.state?.status || "unknown";
    console.error(`[${client.user.tag}] voice join failed (${status}):`, error.stack || error.message);
    data.connection?.destroy();
    data.connection = null;
    throw new Error("تعذر دخول الروم خلال 30 ثانية. تأكد من Connect وSpeak للبوت ثم جرّب come مرة ثانية.");
  }
  return channel;
}

function isPlaying(data) {
  return [AudioPlayerStatus.Playing, AudioPlayerStatus.Buffering, AudioPlayerStatus.Paused].includes(data.player.state.status);
}

async function enqueue(client, message, data, query) {
  const tracks = await resolveTracks(query, message.author.id);
  await connectToMemberChannel(client, message, data);
  data.textChannel = message.channel;
  data.queue.push(...tracks);

  if (!isPlaying(data) && !data.starting) await playNext(client, message.guild.id);

  const first = tracks[0];
  const extra = tracks.length > 1 ? `\n✅ أضيفت **${tracks.length}** أغاني للقائمة.` : "";
  return message.reply({
    embeds: [trackEmbed(client, data, first, "✅ تمت الإضافة")],
    content: extra || undefined
  });
}

function helpEmbed() {
  return new EmbedBuilder()
    .setColor(0x7c3aed)
    .setTitle("🎵 Music Fleet — الأوامر")
    .setDescription("اكتب الأوامر في شات الروم الصوتي. والتشغيل المباشر مفعّل: اكتب اسم الأغنية وحده وسيبحث عنها البوت الموجود معك.")
    .addFields(
      { name: "التشغيل", value: "`play <اسم أو رابط>` أو `شغل <اسم>`\nYouTube وSoundCloud وSpotify والروابط والقوائم مدعومة." },
      { name: "التحكم", value: "`queue` القائمة • `nowplaying` الحالي • `pause` إيقاف مؤقت • `resume` متابعة\n`skip` تخطي • `stop` إيقاف • `clear` مسح الانتظار • `leave` خروج" },
      { name: "الخيارات", value: "`loop` تكرار • `autoplay` تشغيل تلقائي • `shuffle` خلط • `volume 0-150` الصوت\n`search <اسم>` بحث • `ping` سرعة البوت • `settings` الإعدادات" },
      { name: "اختصارات عربية", value: "`شغل` `ش` `قائمه` `الان` `تخطي` `ت` `وقف` `حذف` `خلط` `تكرار` `تلقائي` `صوت`" },
      { name: "توجيه بوت معيّن", value: "`1play اسم الأغنية` أو منشن البوت ثم الأمر. بدون رقم يرد البوت الموجود معك فقط." }
    )
    .setFooter({ text: "Music Fleet" });
}

function settingsEmbed(client, data) {
  const channelId = data.connection?.joinConfig?.channelId;
  return new EmbedBuilder()
    .setColor(0x7c3aed)
    .setTitle(`⚙️ إعدادات ${client.user.username}`)
    .addFields(
      { name: "التشغيل بالروم", value: data.playInVoice ? "✅ مفعّل" : "☑️ متوقف", inline: true },
      { name: "الروم الصوتي", value: channelId ? `<#${channelId}>` : "غير متصل", inline: true },
      { name: "الصوت", value: `${Math.round(data.volume * 100)}`, inline: true },
      { name: "التكرار", value: data.loop ? "✅" : "☑️", inline: true },
      { name: "التشغيل التلقائي", value: data.autoplay ? "✅" : "☑️", inline: true },
      { name: "الأغاني المنتظرة", value: String(data.queue.length), inline: true }
    );
}

async function clearOldSlashCommands(client) {
  const rest = new REST({ version: "10" }).setToken(client.token);
  const route = process.env.TEST_GUILD_ID
    ? Routes.applicationGuildCommands(client.user.id, process.env.TEST_GUILD_ID)
    : Routes.applicationCommands(client.user.id);
  await rest.put(route, { body: [] });
}

async function handleMessage(client, message) {
  if (message.author.bot || !message.guild) return;
  const parsed = parseInput(client, message);
  if (!parsed.text || !selected(client, message, parsed)) return;

  const data = guildState(client, message.guild.id);
  data.textChannel = message.channel;
  const command = parsed.command;

  try {
    if (!command) {
      if (!data.playInVoice || !message.member?.voice?.channel) return;
      return await enqueue(client, message, data, parsed.text);
    }

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
      const lines = clients.map((bot, index) => `${index}. ${bot.user ? `${bot.user.tag} ✅` : "غير متصل ⏳"}`);
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
      data.player.stop();
      getVoiceConnection(message.guild.id, client.user.id)?.destroy();
      data.connection = null;
      return void message.reply("☑️ طلعت من الروم.");
    }
    if (command === "play") {
      const query = parsed.parts.join(" ");
      if (!query) return void message.reply("طريقة الاستخدام: `play <song name | link>`");
      return void (await enqueue(client, message, data, query));
    }
    if (command === "search") {
      const query = parsed.parts.join(" ");
      if (!query) return void message.reply("طريقة الاستخدام: `search <song name>`");
      const results = await play.search(query, { limit: 10, source: { youtube: "video" } });
      const description = results.length
        ? results.map((result, index) => `**${index + 1}.** [${truncate(result.title, 80)}](${result.url}) • ${result.durationRaw || "?"}`).join("\n")
        : "لم أجد نتائج.";
      return void message.reply({ embeds: [new EmbedBuilder().setColor(0x7c3aed).setTitle(`🔎 نتائج البحث عن ${truncate(query, 50)}`).setDescription(description)] });
    }
    if (command === "queue") {
      const page = Math.max(1, Number(arabicNumber(parsed.parts[0] || "1")) || 1);
      const start = (page - 1) * 10;
      const tracks = data.queue.slice(start, start + 10);
      const description = tracks.length
        ? tracks.map((track, index) => `**${start + index + 1}.** ${truncate(track.title)} • <@${track.requester}>`).join("\n")
        : "القائمة فارغة.";
      const embed = new EmbedBuilder().setColor(0x7c3aed).setTitle(`📃 قائمة التشغيل • صفحة ${page}`).setDescription(
        `${data.current ? `🎶 الآن: **${truncate(data.current.title)}**\n\n` : ""}${description}`
      );
      return void message.reply({ embeds: [embed] });
    }
    if (command === "nowplaying") {
      if (!data.current) return void message.reply("لا توجد أغنية تعمل الآن.");
      return void message.reply({ components: [controlRow(message.guild.id)], embeds: [trackEmbed(client, data, data.current, "🎶 الآن تعمل")] });
    }
    if (command === "skip") {
      data.player.stop();
      return void message.reply("⏭️ تم التخطي.");
    }
    if (command === "stop") {
      data.queue.length = 0;
      data.current = null;
      data.loop = false;
      data.autoplay = false;
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
    if (command === "volume") {
      const raw = parsed.parts[0] ? arabicNumber(parsed.parts[0]) : String(Math.round(data.volume * 100));
      const volume = Number(raw);
      if (!Number.isFinite(volume) || volume < 0 || volume > 150) return void message.reply("استخدم رقمًا من 0 إلى 150.");
      data.volume = volume / 100;
      data.resource?.volume?.setVolume(data.volume);
      return void message.reply(`🔊 مستوى الصوت: ${volume}`);
    }
    if (command === "playinvcall") {
      if (!isAdministrator(message)) return void message.reply("هذا الأمر للأدمن أو المالك فقط.");
      const value = parsed.parts[0]?.toLowerCase();
      if (!["on", "off", "تشغيل", "ايقاف", "إيقاف"].includes(value)) {
        return void message.reply(`التشغيل بالروم الآن: ${data.playInVoice ? "مفعّل" : "متوقف"}. استخدم \`playinvcall on\` أو \`off\`.`);
      }
      data.playInVoice = ["on", "تشغيل"].includes(value);
      return void message.reply(data.playInVoice ? "✅ صار يشتغل بمجرد كتابة اسم الأغنية في شات الروم." : "☑️ تم إيقاف التشغيل بالاسم المباشر.");
    }
  } catch (error) {
    console.error(`[${client.user.tag}] command error:`, error.message);
    await message.reply(`❌ ${error.message || "حدث خطأ غير متوقع."}`).catch(() => {});
  }
}

async function handleButton(client, interaction) {
  if (!interaction.isButton() || !interaction.customId.startsWith("music:")) return;
  const [, action, guildId] = interaction.customId.split(":");
  if (guildId !== interaction.guildId) return;

  const data = guildState(client, guildId);
  const botChannelId = data.connection?.joinConfig?.channelId;
  if (!botChannelId || interaction.member?.voice?.channelId !== botChannelId) {
    return void interaction.reply({ content: "لازم تكون في نفس الروم الصوتي مع البوت.", ephemeral: true });
  }

  if (action === "pause") {
    if (data.player.state.status === AudioPlayerStatus.Paused) data.player.unpause();
    else data.player.pause();
    return void interaction.reply({ content: "⏯️ تم تحديث حالة التشغيل.", ephemeral: true });
  }
  if (action === "skip") {
    data.player.stop();
    return void interaction.reply({ content: "⏭️ تم التخطي.", ephemeral: true });
  }
  if (action === "stop") {
    data.queue.length = 0;
    data.current = null;
    data.player.stop();
    return void interaction.reply({ content: "⛔ تم الإيقاف.", ephemeral: true });
  }
  if (action === "loop") {
    data.loop = !data.loop;
    return void interaction.reply({ content: data.loop ? "🔁 التكرار مفعّل." : "✅ التكرار متوقف.", ephemeral: true });
  }
  if (action === "volume") {
    data.volume = Math.min(1.5, data.volume + 0.1);
    data.resource?.volume?.setVolume(data.volume);
    return void interaction.reply({ content: `🔊 مستوى الصوت: ${Math.round(data.volume * 100)}`, ephemeral: true });
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
  client.once("ready", async () => {
    console.log(`Bot ${index}/${tokens.length} online as ${client.user.tag}`);
    stateFor(client).tag = client.user.tag;
    try {
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

process.on("unhandledRejection", (error) => console.error("Unhandled rejection:", error));
