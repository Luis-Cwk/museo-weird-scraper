#!/usr/bin/env node
/**
 * Sky-quality model comparison (sandbox only, does NOT touch agent.js or cron).
 *
 * Compares 3 generators on the same candidate (queue #19 — deslizamiento Bello/Medellín):
 *   A. image-01        + current buildSkyPrompt (faithful to today's sky-9860.png)
 *   B. image-01-live   + current buildSkyPrompt
 *   C. image-01        + MINIMAL prompt (only atmosphere — no scene features, no nouns)
 *
 * For each: download the PNG, measure seam with sky_quality.py, save preview.
 * Then visually inspect side-by-side.
 *
 * Cost: 3 mmx image calls (≈ $0.003 each). Uses the same MMX_CLI/MMX_MJS that agent.js uses.
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

// --- Paths ---
const SB = __dirname;
const OUT = path.join(SB, "out");
fs.mkdirSync(OUT, { recursive: true });

// --- Candidate (queue #19 — verbatim from data/art-queue.json) ---
const candidate = {
  id: 19,
  content: "Al menos ocho personas han muerto por un deslizamiento de tierra en el municipio colombiano de Bello, colindante con Medellín",
  sourceUrl: "",
  attribution: "Anonymous",
  aiCategory: null,   // was missing — that's why the agent fell back to "other"
  aiImpactScore: null, // was missing — fell back to 5
};

const SKY_CATEGORY_HINT = {
  disaster_response:  "evacuation warning, leaden sky, emergency zone",
  drought:            "cracked plateau, bleached soil, hazy heat shimmer",
  climate_violence:   "apocalyptic smoke-funneled storm, red sky, choking atmosphere",
  water_pollution:    "polluted river, sickly tinted water, industrial pipes",
  displacement:       "abandoned road, gray emptiness, melancholic fog",
  human_rights:       "institutional concrete, gray oppressive plaza",
  extraction:         "open-pit mine scar, terraced earthworks, dusty haze",
  necrocapitalism:    "industrial necropolis, glowing toxic towers",
  denialism:          "smog over downtown, polluted complacent sky",
  surreal:            "deep dreamlike museum landscape, impossible architecture, golden desaturated light",
};

const SKY_INTENSITY_WORDS = {
  low:    "quiet, subtle, ominous undercurrent, low contrast",
  medium: "weighted, visceral, tension under wide horizon",
  high:   "violent, overwhelming, apocalyptic, raw power",
};

function ascii(s) {
  return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function extractProperNouns(content, maxN) {
  if (typeof maxN !== "number") maxN = 3;
  const STOP = new Set(["el","la","los","las","y","de","del","en","se","un","una","que","con","para","por","sobre","sin","tras","este","esta","es","son","fue","fueron","al"]);
  const out = [], seen = new Set();
  const re = /\b[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,}\b/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const w = m[0];
    if (STOP.has(w.toLowerCase())) continue;
    if (seen.has(w.toLowerCase())) continue;
    seen.add(w.toLowerCase());
    out.push(w);
    if (out.length >= maxN) break;
  }
  return out;
}

// Faithful copy of agent.js buildSkyPrompt(c)
function buildSkyPrompt(c, overrideCategory) {
  const cat = overrideCategory || c.aiCategory || "other";
  const impact = c.aiImpactScore || 5;
  const content = (c.content || "").slice(0, 140);
  const anchor = SKY_CATEGORY_HINT[cat] || "environmental disopia, atmospheric distress";
  const band = impact >= 8 ? "high" : impact >= 6 ? "medium" : "low";
  const intensity = SKY_INTENSITY_WORDS[band];
  const nouns = extractProperNouns(content);
  const sceneFeatures = nouns.length > 0 ? nouns.join(", ") : ("Colombia, " + cat.replace(/_/g, " "));
  return (
    "seamless 360 degree equirectangular panorama, " +
    "perfect horizontal wrap continuity, " +
    "left edge and right edge of the frame must match seamlessly when wrapped to a sphere, " +
    "no visible seam line at the wrap point, " +
    "single continuous 360 photograph taken with a 360 camera in one take, " +
    "no horizon line crossing the upper third or lower third, " +
    "the nadir and zenith are blurred gradient without recognizable landscape detail, " +
    ascii(anchor) + ", " +
    "scene features: " + ascii(sceneFeatures) + ", " +
    "environment reference: " + ascii(sceneFeatures) + ", " +
    ascii(intensity) + ", " +
    "panoramic 2:1 equirectangular photograph, 360 degrees, full sphere, " +
    "no human figures, no text or labels, no logos, " +
    "clean zenith gradient to pale haze, clean nadir gradient to soft blur, " +
    "asymmetric composition: subject of interest offset from center NOT centered, " +
    "single frame photograph, cinematic detail, " +
    "atmospheric context: '" + ascii(content.trim()) + "', " +
    "avoid: no visible stitch seam, " +
    "no distorted or stretched subject near the edges, " +
    "no mismatch between left edge and right edge, " +
    "no double exposure, no ghosting, no blurred horizon, " +
    "no low resolution stretching artifacts at the wrap point, " +
    "no hard transition at the seam between left-most and right-most columns"
  );
}

// Minimal prompt — just atmospheric pressure, no scene features, no nouns
function buildMinimalPrompt() {
  return (
    "seamless 360 degree equirectangular panorama, " +
    "perfect horizontal wrap continuity, " +
    "single continuous photograph taken with a 360 camera in one take, " +
    "overcast sky, gray atmospheric haze, low visibility, " +
    "no human figures, no text or labels, no logos, " +
    "no horizon line crossing the upper third or lower third, " +
    "zenith and nadir blurred gradient without detail"
  );
}

// --- Locate mmx.mjs (same path resolution as agent.js) ---
const MMX_CLI = "C:\\Program Files\\nodejs\\mmx.cmd";
function _resolveMmxMjs(cliPath) {
  const dir = cliPath.replace(/\\?(?:mmx|mmx\.exe|mmx\.cmd)?$/i, "");
  return path.join(dir, "node_modules", "mmx-cli", "dist", "mmx.mjs");
}
const MMX_MJS = _resolveMmxMjs(MMX_CLI);

function genOne(label, prompt, outFile) {
  console.log(`\n>>> [${label}] generating...`);
  const spawnArgs = [
    "image", "generate",
    "--prompt", prompt,
    "--width", "2048", "--height", "1024",
    "--seed", "9860",
    "--out", outFile,
    "--quiet",
  ];
  const r = spawnSync("node", [MMX_MJS].concat(spawnArgs), {
    encoding: "utf-8",
    timeout: 240000,
    shell: false,
  });
  if (r.status !== 0 || !fs.existsSync(outFile)) {
    console.error(`  FAILED status=${r.status}`);
    console.error(`  stdout: ${(r.stdout||"").slice(0,300)}`);
    console.error(`  stderr: ${(r.stderr||"").slice(0,300)}`);
    return false;
  }
  console.log(`  OK ${(fs.statSync(outFile).size/1024).toFixed(1)}KB -> ${outFile}`);
  return true;
}

async function measureSky(file) {
  // shell out to sky_quality.py
  const py = path.join(SB, "..", "sky_quality.py");
  return new Promise((resolve) => {
    const r = spawnSync("python", [py, "measure", file], { encoding: "utf-8", timeout: 30 });
    try {
      const parsed = JSON.parse((r.stdout || "").trim().split("\n").slice(-1)[0]);
      resolve(parsed);
    } catch (e) {
      resolve({ error: r.stdout + "|" + r.stderr });
    }
  });
}

async function main() {
  const promptA = buildSkyPrompt(candidate);              // image-01  + current
  const promptB = buildSkyPrompt(candidate);              // image-01-live + current (same prompt, diff model)
  const promptC = buildMinimalPrompt();                   // image-01  + minimal

  fs.writeFileSync(path.join(OUT, "prompt-A-image01.txt"),      promptA);
  fs.writeFileSync(path.join(OUT, "prompt-B-image01-live.txt"), promptB);
  fs.writeFileSync(path.join(OUT, "prompt-C-minimal.txt"),      promptC);

  const targets = [
    { label: "A image-01+current", prompt: promptA, file: path.join(OUT, "A_image01_current.png"), model: "image-01" },
    { label: "B image-01-live+current", prompt: promptB, file: path.join(OUT, "B_image01live_current.png"), model: "image-01-live" },
    { label: "C image-01+minimal", prompt: promptC, file: path.join(OUT, "C_image01_minimal.png"), model: "image-01" },
  ];

  for (const t of targets) {
    const ok = genOne(t.label, t.prompt, t.file);
    if (!ok) continue;
    const m = await measureSky(t.file);
    console.log(`  seam: ${JSON.stringify(m)}`);
  }

  console.log("\nDone. Outputs at:", OUT);
}

main().catch(e => { console.error(e); process.exit(1); });