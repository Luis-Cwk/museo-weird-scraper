// E2E test of the full sky-quality pipeline (A+B+C+D)
// - mmx image generate at 2048x1024 with new prompt
// - fixSkySeam on output
// - voxel HTML with the fixed sky
const fs = require("fs");
const path = require("path");
const { spawnSync, execSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
const { generateThreeArtwork } = require(path.join(ROOT, "build", "scripts", "generate-three.js"));

// Read agent.js and re-evaluate the sky-related pure functions in a sandbox
const agentSrc = fs.readFileSync(path.join(ROOT, "scripts", "agent.js"), "utf-8");

/** Match `{ ... }` accounting for nested braces, strings, and comments. */
function extractBlock(src, name) {
  // Try async first (fixSkySeam is async); fall back to non-async.
  let start = src.indexOf(`async function ${name}(`);
  if (start < 0) start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`not found: ${name}`);
  // Skip to the function body's opening brace (the first '{' AFTER the signature).
  const braceOpen = src.indexOf("{", start);
  let depth = 0, inStr = null, inLC = false, inBC = false;
  let i = braceOpen;
  while (i < src.length) {
    const ch = src[i];
    if (inLC) { if (ch === "\n") inLC = false; i++; continue; }
    if (inBC) { if (ch === "*" && src[i + 1] === "/") { inBC = false; i += 2; continue; } i++; continue; }
    if (inStr) { if (ch === "\\") { i += 2; continue; } if (ch === inStr) inStr = null; i++; continue; }
    if (ch === "/" && src[i + 1] === "/") { inLC = true; i += 2; continue; }
    if (ch === "/" && src[i + 1] === "*") { inBC = true; i += 2; continue; }
    if (ch === '"' || ch === "'" || ch === "`") { inStr = ch; i++; continue; }
    if (ch === "{") depth++;
    if (ch === "}") { depth--; if (depth === 0) return src.slice(start, i + 1); }
    i++;
  }
  throw new Error("unbalanced: " + name);
}

const m1 = agentSrc.match(/const SKY_CATEGORY_HINT\s*=\s*\{[\s\S]*?\n\};/);
const m2 = agentSrc.match(/const SKY_INTENSITY_WORDS\s*=\s*\{[\s\S]*?\n\};/);

const sb = [
  m1 ? m1[0] : "const SKY_CATEGORY_HINT = { other: 'environmental disopia' };",
  m2 ? m2[0] : "const SKY_INTENSITY_WORDS = { high: 'high intensity', medium: 'medium intensity', low: 'low intensity' };",
  // ASCII strip helper (mirrors what's in agent.js above buildSkyPrompt)
  "const ASCII = (s) => (s || '').normalize('NFKD').replace(/[\\u0300-\\u036f]/g, '');",
  extractBlock(agentSrc, "extractProperNouns"),
  extractBlock(agentSrc, "buildSkyPrompt"),
  extractBlock(agentSrc, "fixSkySeam"),
  "const log = (s) => process.stdout.write('LOG: ' + s + '\\n');",
  "module.exports = { buildSkyPrompt, fixSkySeam };",
].join("\n\n");

const tmpMod = path.join(__dirname, "_sky_quality_sb.js");
fs.writeFileSync(tmpMod, sb);
const { buildSkyPrompt, fixSkySeam } = require(tmpMod);

const cand = {
  aiCategory: "deslizamiento",
  aiImpactScore: 9,
  content: "Un deslizamiento en el barrio Granizal de Medellín dejó 8 muertos y daños estructurales en al menos 25 viviendas, ciudad rodeada de montañas andinas, vía cerrada totalmente",
};

console.log("=== NEW prompt (sample) ===");
const prompt = buildSkyPrompt(cand);
console.log("Length:", prompt.length, "chars");
console.log("Has seamless 360:    ", /\bseamless 360\b/.test(prompt));
console.log("Has wrap continuity: ", /\bwrap continuity\b/.test(prompt));
console.log("Has avoid negative:  ", /\bavoid:/i.test(prompt));
console.log("Strips accents:      ", !/[áéíóúñ]/i.test(prompt));
console.log();

const queueId = 99998;
const filename = `sky-${queueId}.png`;
const SKY_DIR_LOCAL = path.join(ROOT, "deploy", "huaca", "textures");
fs.mkdirSync(SKY_DIR_LOCAL, { recursive: true });
const localPath = path.join(SKY_DIR_LOCAL, filename);
const mmx = "C:/Program Files/nodejs/mmx";
const seed = (1000 + (cand.aiImpactScore || 5) * 7 + (queueId * 31)) >>> 0;

console.log("=== Step 1: mmx at 2048x1024 ===");
const r = spawnSync(
  `"${mmx}" image generate --prompt "${prompt.replace(/"/g, '\\"')}" --width 2048 --height 1024 --seed ${seed} --out "${localPath}" --quiet`,
  { shell: true, encoding: "utf-8", timeout: 120000 }
);
if (r.status !== 0) { console.error("mmx failed:", r.stderr || r.stdout); process.exit(1); }
console.log(`OK: ${(fs.statSync(localPath).size / 1024).toFixed(1)} KB`);

function pyMeasure(p) {
  const out = execSync(`python -c "import sys, json; sys.path.insert(0, r'${__dirname.replace(/\\/g, "/")}'); import sky_quality as sq; print(json.dumps(sq.measure_seam_diff(r'${p.replace(/\\/g, "/")}')))"`).toString();
  return JSON.parse(out);
}

const before = pyMeasure(localPath);
console.log("Before fix: ", before);

console.log();
console.log("=== Step 2: fixSkySeam (feather=96) ===");
const fixedPath = path.join(SKY_DIR_LOCAL, filename.replace(".png", ".fixed.png"));
(async () => {
  await fixSkySeam(localPath, fixedPath, 96);
  fs.copyFileSync(fixedPath, localPath);
  const after = pyMeasure(localPath);
  console.log("After fix: ", after);
  const pct = 100 * (1 - after.tapered_diff / before.tapered_diff);
  console.log("Improvement:", pct.toFixed(1) + "%");

  console.log();
  console.log("=== Step 3: voxel HTML with skyUrl ===");
  const out = await generateThreeArtwork({
    content: cand.content,
    category: cand.aiCategory,
    attribution: "Redactor",
    source: "bsky:redactor",
    sourceUrl: "https://bsky.app/profile/sim/post/granizal-e2e",
    skyUrl: `textures/${filename}`,
  });
  console.log(`OK: ${path.basename(out.htmlPath)} (${out.voxelCount} voxels)`);

  const html = fs.readFileSync(out.htmlPath, "utf-8");
  const expected = ["window.__voxelSkyTex", "envMap: window.__voxelSkyTex", "metalness: 1.0", "roughness: 0.15", `textures/${filename}`];
  for (const e of expected) console.log(`  ${html.includes(e) ? "✓" : "✗"} ${e}`);

  const serveDir = path.join(__dirname, "view");
  fs.mkdirSync(serveDir, { recursive: true });
  fs.mkdirSync(path.join(serveDir, "textures"), { recursive: true });
  fs.copyFileSync(out.htmlPath, path.join(serveDir, "test.html"));
  fs.copyFileSync(localPath, path.join(serveDir, "textures", filename));
  console.log(`\nSaved for visual: ${serveDir}/test.html`);
})();
