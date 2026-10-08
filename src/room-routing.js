function selectRoomBot({ bots, channelId, memberChannelId, isVoiceChat, command, targetIndex, targetId }) {
  // Voice membership alone never authorizes commands from a separate text chat.
  if (!isVoiceChat || !memberChannelId || channelId !== memberChannelId) return null;

  const explicit = targetIndex != null || targetId != null;
  const target = explicit ? bots.find((bot) =>
    (targetIndex == null || bot.index + 1 === targetIndex) &&
    (targetId == null || bot.id === targetId)
  ) : null;
  if (explicit && !target) return null;

  const inRoom = bots.filter((bot) => bot.channelId === channelId);
  if (target?.channelId === channelId) return target.id;
  if (!explicit && inRoom.length) return inRoom[0].id;

  // join is the only bootstrap command, and must also be sent in that voice chat.
  if (command !== "join") return null;
  if (explicit) return target.channelId ? null : target.id;
  return bots.find((bot) => !bot.channelId)?.id || null;
}

function isSameRoomChat({ channelId, memberChannelId, botChannelId, isVoiceChat }) {
  return Boolean(isVoiceChat && botChannelId && channelId === botChannelId && memberChannelId === botChannelId);
}

module.exports = { selectRoomBot, isSameRoomChat };
