
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const MMX_CLI = "C:/Program Files/nodejs/mmx";
function _resolveMmxMjs(cliPath) {
  const dir = cliPath.replace(/\\?(?:mmx|mmx\.exe|mmx\.cmd)?$/i, "");
  return path.join(dir, "node_modules", "mmx-cli", "dist", "mmx.mjs");
}
const MMX_MJS = _resolveMmxMjs(MMX_CLI);

const prompt = "test sky with 2048x1024 like agent.js does";
const out = "C:/Users/petra/museo-weird-scraper/sandbox/test-2048.png";
if (fs.existsSync(out)) fs.unlinkSync(out);
const seed = 12345;

const spawnArgs = [
  "image", "generate",
  "--prompt", prompt,
  "--width", "2048", "--height", "1024",
  "--seed", String(seed),
  "--out", out,
  "--model", "image-01-live",
  "--quiet",
];

const r = spawnSync("node", [MMX_MJS].concat(spawnArgs), {
  encoding: "utf-8",
  timeout: 120000,
  shell: false,
});
console.log("exit:", r.status);
console.log("stderr:", r.stderr.slice(0, 500));
console.log("file exists:", fs.existsSync(out));
if (fs.existsSync(out)) {
  console.log("file size:", fs.statSync(out).size);
}
