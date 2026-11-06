
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const MMX_CLI = "C:/Program Files/nodejs/mmx";
function _resolveMmxMjs(cliPath) {
  const dir = cliPath.replace(/\\?(?:mmx|mmx\.exe|mmx\.cmd)?$/i, "");
  return path.join(dir, "node_modules", "mmx-cli", "dist", "mmx.mjs");
}
const MMX_MJS = _resolveMmxMjs(MMX_CLI);

const prompt = "test sky, simple";
const out = "C:/Users/petra/museo-weird-scraper/sandbox/test-from-node.png";
const seed = 12345;

const spawnArgs = [
  "image", "generate",
  "--prompt", prompt,
  "--width", "1024", "--height", "512",
  "--seed", String(seed),
  "--out", out,
  "--model", "image-01-live",
  "--quiet",
];

const r = spawnSync("node", [MMX_MJS].concat(spawnArgs), {
  encoding: "utf-8",
  timeout: 60000,
  shell: false,
});
console.log("exit:", r.status);
console.log("stdout:", r.stdout);
console.log("stderr:", r.stderr);
console.log("file exists:", fs.existsSync(out));
