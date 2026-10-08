const { createHash } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

// Official release assets, pinned and verified. No runtime downloads or auto-updates.
const VERSION = "2026.08.19";
const RELEASES = {
  "win32-x64": ["yt-dlp.exe", "66674953fe251b89f4d08c5f0e35e0728679bd67ab3d7d05c0562af101dd3e7a"],
  "linux-x64": ["yt-dlp_linux", "58162f9bfdc27458ea47bfcb311cf47028f17d8154a8bf7d689861d46399230a"]
};

async function install() {
  const release = RELEASES[`${process.platform}-${process.arch}`];
  if (!release) throw new Error("The bundled YouTube backend requires Windows x64 or Linux x64.");
  const [asset, expected] = release;
  const directory = path.join(__dirname, "../bin");
  const target = path.join(directory, process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
  const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const existing = await fs.readFile(target).catch(() => null);
  if (existing && hash(existing) === expected) return console.log(`YouTube backend ${VERSION} verified.`);
  const response = await fetch(`https://github.com/yt-dlp/yt-dlp/releases/download/${VERSION}/${asset}`, { signal: AbortSignal.timeout(90000) });
  if (!response.ok) throw new Error(`YouTube backend download failed (${response.status}).`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (hash(bytes) !== expected) throw new Error("YouTube backend checksum mismatch.");
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(target, bytes, { mode: 0o755 });
  console.log(`YouTube backend ${VERSION} installed and verified.`);
}

install().catch((error) => { console.error(error.message); process.exitCode = 1; });
