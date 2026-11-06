
const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const MMX_CLI = "C:\\Program Files\\nodejs\\mmx";
function _resolveMmxMjs(cliPath) {
  const dir = cliPath.replace(/\\?(?:mmx|mmx\.exe|mmx\.cmd)?$/i, "");
  return path.join(dir, "node_modules", "mmx-cli", "dist", "mmx.mjs");
}
const MMX_MJS = _resolveMmxMjs(MMX_CLI);

const prompt = "seamless 360 degree equirectangular panorama, very low distant horizon line at 25 percent from the bottom of the frame, sky and atmosphere filling the top 75 percent of the panorama, thin strip of distant terrain visible only at the very bottom 25 percent, soft haze at horizon, environmental disopia, atmospheric distress, weighted, visceral, tension under wide horizon, scene features: Inundacion, Olaya, Herrera, horizon line is perfectly straight and continuous horizontally, left edge and right edge pixels identical at every row, no vertical seam line visible at any column, single continuous 360 photograph taken with a 360 camera in one take, no horizon line crossing the upper third, the nadir and zenith are blurred gradient without recognizable detail, panoramic 2:1 equirectangular photograph, 360 degrees, full sphere, no human figures, no text or labels, no logos, single frame photograph, cinematic detail, atmospheric context: 'Inundación en el aeropuerto Olaya Herrera de Medellín produce cancelación y demoras en vuelos', avoid: no visible stitch seam, no distorted or stretched subject near the edges, no mismatch between left edge and right edge, no double exposure, no ghosting, no blurred horizon, no low resolution stretching artifacts at the wrap point, no hard transition at the seam between left-most and right-most columns";

const localPath = "C:\\Users\\petra\\museo-weird-scraper\\deploy\\huaca\\textures\\sky-test-failure-debug.png";

// Try THREE different strategies to spawn mmx:
async function tryStrategy(name, fn) {
  console.log("\n=== Strategy:", name, "===");
  if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
  const start = Date.now();
  try {
    await fn(localPath);
    const exists = fs.existsSync(localPath);
    const dur = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`  duration: ${dur}s`);
    console.log(`  result: ${exists ? "OK " + fs.statSync(localPath).size + " bytes" : "FILE NOT CREATED"}`);
    return exists;
  } catch (e) {
    console.log(`  EXCEPTION: ${e.message}`);
    return false;
  }
}

(async () => {
  // Strategy A: spawnSync with array args (this is what agent.js does)
  await tryStrategy("A: spawnSync array args", (out) => {
    const r = spawnSync("node", [MMX_MJS, "image", "generate",
      "--prompt", prompt,
      "--width", "2048", "--height", "1024",
      "--seed", "254467",
      "--out", out,
      "--model", "image-01-live",
      "--quiet"], {encoding: "utf-8", timeout: 60000, shell: false});
    console.log("    status:", r.status);
    console.log("    error:", r.error ? r.error.message : null);
    console.log("    stdout:", JSON.stringify(r.stdout).slice(0, 200));
    console.log("    stderr:", JSON.stringify(r.stderr).slice(0, 500));
    if (r.error) throw r.error;
    return r.status === 0;
  });
})().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
