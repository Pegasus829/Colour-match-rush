const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { isValidEntry, topEntries, MAX_ENTRIES } = require("../leaderboard.js");

const root = path.join(__dirname, "..");

function read(name) {
  return fs.readFileSync(path.join(root, name), "utf8");
}

test("leaderboard drops forged and markup scores", () => {
  const now = Date.UTC(2026, 0, 2);
  const xss = "<img src=x onerror=alert(1)>";
  const result = topEntries([
    { score: xss, when: now },
    { score: "100", when: now },
    { score: -1, when: now },
    { score: 1.5, when: now },
    { score: Number.NaN, when: now },
    { score: Number.POSITIVE_INFINITY, when: now },
    { score: 40, when: "2026-01-02" },
    { score: 40, when: Date.UTC(2010, 0, 1) },
    { score: 10, when: now, name: xss },
    null,
    ["100", now],
    { score: 10, when: now },
    { score: 90, when: now + 10 },
  ]);

  assert.deepEqual(result, [
    { score: 90, when: now + 10 },
    { score: 10, when: now },
    { score: 10, when: now },
  ]);
  assert.equal(JSON.stringify(result).includes("<"), false);
  assert.equal(isValidEntry({ score: 0, when: now }), true);
  assert.equal(isValidEntry({ score: 0, when: now, extra: xss }), true);
});

test("leaderboard keeps only the top validated scores", () => {
  const now = Date.UTC(2026, 5, 1);
  const entries = [];
  for (let i = 0; i < 20; i += 1) {
    entries.push({ score: i, when: now + i, junk: "<script>" });
  }
  const result = topEntries(entries);
  assert.equal(result.length, MAX_ENTRIES);
  assert.equal(result[0].score, 19);
  assert.equal(result[MAX_ENTRIES - 1].score, 12);
  assert.deepEqual(Object.keys(result[0]).sort(), ["score", "when"]);
});

test("leaderboard rejects non-arrays", () => {
  assert.deepEqual(topEntries(null), []);
  assert.deepEqual(topEntries({ score: 1, when: Date.now() }), []);
  assert.deepEqual(topEntries("[]"), []);
});

test("page has a strict CSP and no inline code", () => {
  const html = read("index.html");
  assert.match(html, /http-equiv="Content-Security-Policy"/);
  assert.match(html, /script-src 'self'/);
  assert.match(html, /style-src 'self'/);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /base-uri 'none'/);
  assert.match(html, /object-src 'none'/);
  assert.match(html, /name="referrer" content="no-referrer"/);
  assert.doesNotMatch(html, /unsafe-inline|unsafe-eval|unsafe-hashes/);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)/i);
  assert.doesNotMatch(html, /<style[\s>]/i);
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i);
  assert.match(html, /href="style\.css"/);
  assert.match(html, /src="leaderboard\.js"/);
  assert.match(html, /src="game\.js"/);
  assert.doesNotMatch(html, /(?:src|href)\s*=\s*["']\//);
  assert.doesNotMatch(html, /https?:\/\//i);
});

test("game renders stored data as text and does not call the network", () => {
  const sources = ["game.js", "leaderboard.js"].map(read).join("\n");
  assert.match(sources, /textContent/);
  assert.match(sources, /topEntries/);
  assert.doesNotMatch(sources, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/);
  assert.doesNotMatch(sources, /\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|localStorage\.setItem\(\s*["'](?!cmr_leaderboard_v1)/);
  assert.doesNotMatch(sources, /sessionStorage|document\.cookie|indexedDB/);
});

test("no tracked source contains a token-like secret", () => {
  const skip = new Set(["package-lock.json"]);
  const files = fs.readdirSync(root).filter((name) => {
    if (skip.has(name) || name.startsWith(".")) return false;
    const stat = fs.statSync(path.join(root, name));
    return stat.isFile();
  });
  const pattern = /AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk_live_[A-Za-z0-9]+|xox[baprs]-[A-Za-z0-9-]+|BEGIN [A-Z ]*PRIVATE KEY|AIza[0-9A-Za-z_-]{20,}/;
  for (const name of files) {
    assert.equal(pattern.test(read(name)), false, name);
  }
});

test("ci workflow is one least-privilege job with pinned actions", () => {
  const workflowDir = path.join(root, ".github", "workflows");
  const workflows = fs.readdirSync(workflowDir).filter((name) => /\.ya?ml$/.test(name));
  assert.deepEqual(workflows, ["ci.yml"]);
  const yml = fs.readFileSync(path.join(workflowDir, "ci.yml"), "utf8");

  assert.match(yml, /^name:\s*ci\s*$/m);
  assert.match(yml, /^ {2}ci:\s*$/m);
  assert.match(yml, /name:\s*ci/);
  assert.match(yml, /contents:\s*read/);
  assert.doesNotMatch(yml, /:\s*write/);
  assert.doesNotMatch(yml, /pull_request_target/);
  assert.match(yml, /npm ci/);
  assert.match(yml, /npm run build/);
  assert.match(yml, /npm test/);
  assert.match(yml, /npm audit/);
  assert.match(yml, /gitleaks/);
  assert.doesNotMatch(yml, /npm install/);

  const uses = [...yml.matchAll(/uses:\s*(\S+)/g)].map((match) => match[1]);
  assert.ok(uses.length >= 1);
  for (const action of uses) {
    assert.match(action, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[0-9a-f]{40}$/);
  }

  const jobsBlock = yml.split(/^jobs:\s*$/m)[1] || "";
  const jobNames = [...jobsBlock.matchAll(/^ {2}([A-Za-z0-9_-]+):\s*$/gm)].map((match) => match[1]);
  assert.deepEqual(jobNames, ["ci"]);
  for (const name of jobNames) {
    if (!/deploy|pages/i.test(name)) continue;
    const job = jobsBlock.split(new RegExp("^ {2}" + name + ":\\s*$", "m"))[1] || "";
    assert.match(job, /needs:\s*(\[\s*ci\s*\]|ci\b)/);
  }
});

test("dependabot config exists", () => {
  const yml = fs.readFileSync(path.join(root, ".github", "dependabot.yml"), "utf8");
  assert.match(yml, /package-ecosystem:\s*["']?github-actions["']?/);
  assert.match(yml, /package-ecosystem:\s*["']?npm["']?/);
  assert.match(yml, /directory:\s*["']?\/["']?/);
});
