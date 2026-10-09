function selectRoomBot({ bots, channelId, memberChannelId, isVoiceChat, isCommandsChat = false, command, targetIndex, targetId }) {
  // Voice membership alone never authorizes commands from an arbitrary text chat: only the
  // member's own voice-room chat, or the commands chat an admin set with `chat`.
  if (!memberChannelId) return null;
  const inOwnVoiceChat = Boolean(isVoiceChat && channelId === memberChannelId);
  if (!inOwnVoiceChat && !isCommandsChat) return null;

  const explicit = targetIndex != null || targetId != null;
  const target = explicit ? bots.find((bot) =>
    (targetIndex == null || bot.index + 1 === targetIndex) &&
    (targetId == null || bot.id === targetId)
  ) : null;
  if (explicit && !target) return null;

  const inRoom = bots.filter((bot) => bot.channelId === memberChannelId);
  if (target?.channelId === memberChannelId) return target.id;
  if (!explicit && inRoom.length) return inRoom[0].id;

  // join/setup are the only bootstrap commands (they bring an idle bot into the room).
  if (command !== "join" && command !== "setup") return null;
  if (explicit) return target.channelId ? null : target.id;
  return bots.find((bot) => !bot.channelId)?.id || null;
}

function isSameRoomChat({ channelId, memberChannelId, botChannelId, isVoiceChat }) {
  return Boolean(isVoiceChat && botChannelId && channelId === botChannelId && memberChannelId === botChannelId);
}

module.exports = { selectRoomBot, isSameRoomChat };
