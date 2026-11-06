
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const MMX_CLI = "C:/Program Files/nodejs/mmx";
function _resolveMmxMjs(cliPath) {
  const dir = cliPath.replace(/\\?(?:mmx|mmx\.exe|mmx\.cmd)?$/i, "");
  return path.join(dir, "node_modules", "mmx-cli", "dist", "mmx.mjs");
}
const MMX_MJS = _resolveMmxMjs(MMX_CLI);

const prompt = "test sky, simple with async around";
const out = "C:/Users/petra/museo-weird-scraper/sandbox/test-async.png";
if (fs.existsSync(out)) fs.unlinkSync(out);
const seed = 99999;

const spawnArgs = [
  "image", "generate",
  "--prompt", prompt,
  "--width", "2048", "--height", "1024",
  "--seed", String(seed),
  "--out", out,
  "--model", "image-01-live",
  "--quiet",
];

// Replicate EXACTLY: same code structure as agent.js
async function generateSkyForCandidateLikeAgent() {
  try {
    let r = null;
    let attempt = 0;
    const MAX_ATTEMPTS = 5;
    const BACKOFFS_MS = [5000, 10000, 20000, 40000];
    while (attempt < MAX_ATTEMPTS) {
      attempt++;
      r = spawnSync("node", [MMX_MJS].concat(spawnArgs), {
        encoding: "utf-8",
        timeout: 300000,
        shell: false,
      });
      console.log(`attempt ${attempt} status=${r.status} error=${r.error ? r.error.message : "null"}`);
      console.log(`  stderr (first 300): ${(r.stderr || "").slice(0, 300)}`);
      if (r.status === 0 && fs.existsSync(out)) break;
      if (attempt < MAX_ATTEMPTS) {
        const waitMs = BACKOFFS_MS[Math.min(attempt - 1, BACKOFFS_MS.length - 1)];
        console.log(`  retrying in ${waitMs/1000}s...`);
        spawnSync("node", ["-e", `setTimeout(()=>{},${waitMs})`], { shell: false });
      }
    }
    if (r.error || r.status !== 0 || !fs.existsSync(out)) {
      const errMsg = r.error ? r.error.message : (r.stderr || r.stdout || "").slice(0, 200);
      console.log(`FAILED: ${errMsg}`);
      return null;
    }
    console.log(`OK: ${(fs.statSync(out).size / 1024).toFixed(1)} KB`);
    return true;
  } catch (e) {
    console.log(`THREW: ${e.message}`);
    return null;
  }
}

(async () => {
  await new Promise(r => setTimeout(r, 200));
  const r = await generateSkyForCandidateLikeAgent();
  console.log("Final:", r);
  process.exit(0);
})();
