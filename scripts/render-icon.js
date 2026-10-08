const path = require("node:path");
const sharp = require(process.argv[2] || "sharp");
sharp(path.join(__dirname, "../assets/music-icon.svg"))
  .png()
  .toFile(path.join(__dirname, "../assets/music-icon.png"))
  .catch((error) => { console.error(error.message); process.exitCode = 1; });
