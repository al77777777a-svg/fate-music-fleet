const { trackReply } = require("./reply-text");

async function skipTrack(data, advance, stopFilters) {
  if (data.starting || data.skipping) return { status: "busy" };
  if (!data.current) return { status: "empty" };
  const skipped = data.current;

  // Explicitly advance once; stopping the player also emits Idle synchronously.
  data.skipping = true;
  data.skipCurrent = true;
  data.seekSeconds = null;
  try {
    stopFilters();
    data.player.stop(true);
    const started = await advance();
    if (started && data.current) return { status: "playing", track: data.current, skipped };
    return { status: started === false ? "failed" : "empty", skipped };
  } finally {
    data.skipping = false;
  }
}

function skipMessage(result, requester) {
  if (result.status === "busy") return "⏳ جاري تجهيز الأغنية، انتظر لحظة.";
  const skipped = result.skipped ? trackReply("Skipped", result.skipped, requester) : "";
  if (result.status === "playing") return skipped;
  if (result.status === "failed") return `${skipped}\n❌ تعذر تشغيل الأغنية التالية. جرّب \`ش اسم الأغنية\`.`.trim();
  return `${skipped}\n🎵 ما فيه أغنية تالية. وش تبي أشغّل؟ اكتب \`ش\` ثم اسم الأغنية.`.trim();
}

module.exports = { skipTrack, skipMessage };
