const { escapeMarkdown } = require("discord.js");

function trackReply(label, track, requester) {
  const title = escapeMarkdown(String(track.title || "Music").slice(0, 180));
  const name = escapeMarkdown(String(requester || "مستمع").slice(0, 80));
  return `*${label} :* **${title}** *by :* **${name}.**`;
}

function volumeReply(before, after) {
  return `*Volume changed from* \`${Math.round(before)}%\` *to* \`${Math.round(after)}%\`.`;
}

module.exports = { trackReply, volumeReply };
