const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const dist = path.join(root, "dist");
const files = ["index.html", "style.css", "leaderboard.js", "game.js"];

for (const file of files) {
  if (!fs.existsSync(path.join(root, file))) {
    console.error("missing " + file);
    process.exit(1);
  }
}

const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
if (!html.includes("Content-Security-Policy") || !html.includes("script-src 'self'")) {
  console.error("CSP missing from index.html");
  process.exit(1);
}
if (/<script(?![^>]*\bsrc=)/i.test(html) || /<style[\s>]/i.test(html)) {
  console.error("inline script or style in index.html");
  process.exit(1);
}

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
for (const file of files) {
  fs.copyFileSync(path.join(root, file), path.join(dist, file));
}

console.log("build ok");
