
const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const MMX_CLI = "C:/Program Files/nodejs/mmx";
function _resolveMmxMjs(cliPath) {
  const dir = cliPath.replace(/\\?(?:mmx|mmx\.exe|mmx\.cmd)?$/i, "");
  return path.join(dir, "node_modules", "mmx-cli", "dist", "mmx.mjs");
}
const MMX_MJS = _resolveMmxMjs(MMX_CLI);

const prompt = 'cinematic landscape photograph with two-band composition: the TOP 70 percent of the frame is sky and atmosphere, the BOTTOM 30 percent is the ground scene with strong narrative foreground, horizon line perfectly level at 70 percent from the top, environmental disopia, atmospheric distress, violent, overwhelming, apocalyptic, raw power, scene features: Colombia, other, strong compositional anchor in the foreground, atmospheric depth with foreground middle-ground background layers, mood conveys the weight of other, panoramic 2:1 equirectangular photograph wrapping 360 degrees, left edge and right edge pixels identical at every row, no vertical seam line, single continuous 360 photograph taken with a 360 camera in one take, no human figures, no text or labels, no logos, nadir and zenith are blurred gradient without recognizable detail, single frame photograph, cinematic detail, atmospheric context: \'Este "periodista" la acaba de cagar completa. Que trauma tendría de niño con un\'avoid: no visible stitch seam, no distorted or stretched subject near the edges, no mismatch between left edge and right edge, no double exposure, no ghosting, no blurred horizon, no low resolution stretching artifacts at the wrap point, no hard transition at the seam between left-most and right-most columns';
const out = "C:/Users/petra/museo-weird-scraper/sandbox/test-exact-prompt.png";
if (fs.existsSync(out)) fs.unlinkSync(out);
const seed = 4046719885;

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
  timeout: 300000,
  shell: false,
});
console.log("exit:", r.status);
console.log("stderr first 400:", (r.stderr || "").slice(0, 400));
console.log("stdout first 400:", (r.stdout || "").slice(0, 400));
console.log("file exists:", fs.existsSync(out));
if (fs.existsSync(out)) console.log("size:", fs.statSync(out).size);
