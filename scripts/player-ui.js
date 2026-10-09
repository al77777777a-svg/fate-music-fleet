const path = require("node:path");
const { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder, escapeMarkdown } = require("discord.js");

const FILTER_LABELS = new Map([
  ["8d", "8D"], ["nightcore", "Nightcore"], ["bassboost", "BassBoost"],
  ["vaporwave", "Vaporwave"], ["slowmode", "Slowmode"]
]);

function filterRow(guildId, selected = []) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`music:filters:${guildId}`)
      .setPlaceholder("Filters ..")
      .setMinValues(1)
      .setMaxValues(FILTER_LABELS.size)
      .addOptions([
        ...[...FILTER_LABELS].map(([value, label]) => ({ label, value, default: selected.includes(value) })),
        { label: "Clear", value: "clear", description: "مسح كل الفلاتر" }
      ])
  );
}

function playerComponents(guildId, data) {
  const button = (action, emoji) => new ButtonBuilder()
    .setCustomId(`music:${action}:${guildId}`).setEmoji(emoji).setStyle(ButtonStyle.Secondary);
  return [
    new ActionRowBuilder().addComponents(
      button("loop", "🔁"), button("voldown", "🔉"),
      button("pause", data.player.state.status === "paused" ? "▶️" : "⏸️"), button("volup", "🔊")
    ),
    new ActionRowBuilder().addComponents(button("skip", "⏭️")),
    filterRow(guildId, [...data.filters])
  ];
}

function playerPayload(guildId, data, track, requester = {}, attachIcon = true, color = 0x416f64) {
  const name = requester.displayName || requester.globalName || requester.username || "مستمع";
  const duration = String(track.duration || "Live").replace(/^(\d):/, "0$1:");
  const embed = new EmbedBuilder()
    .setColor(color)
    .addFields(
      { name: "Playing Song", value: `[${escapeMarkdown(String(track.title || "Music").slice(0, 180))}](${track.url})` },
      { name: "Song Duration", value: duration }
    )
    .setFooter({
      text: `${name}${track.fallbackFrom ? " • SoundCloud" : ""}`,
      ...(requester.avatarURL ? { iconURL: requester.avatarURL } : {})
    });
  const files = [];
  if (attachIcon) {
    embed.setThumbnail("attachment://music-icon.png");
    files.push(new AttachmentBuilder(path.join(__dirname, "../assets/music-icon.png"), { name: "music-icon.png" }));
  } else if (track.thumbnail) embed.setThumbnail(track.thumbnail);
  return {
    content: "🎶 /Mlj",
    allowedMentions: { parse: [] },
    embeds: [embed],
    components: playerComponents(guildId, data),
    files
  };
}

module.exports = { FILTER_LABELS, filterRow, playerComponents, playerPayload };
