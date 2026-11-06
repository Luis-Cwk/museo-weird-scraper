
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const candidate = JSON.parse(fs.readFileSync(process.argv[2], "utf-8"));

const SKY_CATEGORY_HINT = {
  violence: "blood, surveillance, electric perimeter, civic estrangement",
  urban_folklore: "urban legend, ritual repetition, accumulated memory",
  natural_anomaly: "flood scar, soil displacement, displaced earth",
  infrastructure: "concrete failure, exposed wiring, failed civic promise",
  other: "environmental disopia, atmospheric distress",
  displacement: "exodus, transhumance, packed belongings, urban encampment, abandoned dwellings",
  climate_violence: "drought, scorched earth, parched riverbeds, dust storms",
  human_rights: "absent bodies, civic silence, witness, mournful light",
};
const SKY_INTENSITY_WORDS = {
  high: "saturated, hyperreal, ominous, electric, dense",
  medium: "muted, weighted, contemplative, still, heavy",
  low: "subtle, washed, distant, faint, decaying",
};

function extractProperNouns(content) {
  return content.split(/\s+/).filter(w => /^[A-Z]/.test(w) && w.length > 2).slice(0, 4);
}

function buildSkyPrompt(candidate) {
  const cat = candidate.aiCategory || "other";
  const impact = candidate.aiImpactScore || 5;
  const content = (candidate.content || "").slice(0, 80);
  const anchor = SKY_CATEGORY_HINT[cat] || "environmental disopia, atmospheric distress";
  const band = impact >= 8 ? "high" : impact >= 6 ? "medium" : "low";
  const intensity = SKY_INTENSITY_WORDS[band];
  const nouns = extractProperNouns(content);
  const sceneFeatures = nouns.length > 0 ? nouns.join(", ") : ("Colombia, " + cat.replace(/_/g, " "));
  const composition =
    "cinematic landscape photograph, 16:9 aspect ratio, " +
    "two-band composition: " +
    "the TOP 60 percent of the frame is sky and atmosphere, " +
    "the BOTTOM 40 percent is the ground scene with strong narrative foreground, " +
    "horizon line perfectly level at 60 percent from the top, " +
    "the LEFT THIRD and the RIGHT THIRD of the frame carry the same " +
    "narrative weight as the center: buildings, structures, lights, " +
    "vegetation, or weather must extend across the entire horizontal width, " +
    "not be concentrated only in the middle. ";
  const narrative = anchor + ", " + intensity + ", " +
    "scene features: " + sceneFeatures + ", " +
    "strong compositional anchor in the foreground, " +
    "atmospheric depth with foreground middle-ground background layers, " +
    "mood conveys the weight of " + cat.replace(/_/g, " ") + ", ";
  const wrap =
    "16:9 framed photograph, " +
    "single continuous photograph taken in one take, " +
    "no human figures, no text or labels, no logos, " +
    "no letterbox bars at top or bottom, " +
    "no pillarbox bars at left or right, " +
    "the entire frame is filled with content from edge to edge, " +
    "single frame photograph, cinematic detail, " +
    "atmospheric context: '" + content.trim() + "'";
  const avoidFull = (
    "avoid: no empty dark borders at left or right edges, " +
    "no pillarboxing, no letterboxing, " +
    "no compositional dead zones, " +
    "no vignette of darkness concentrated at the edges, " +
    "no double exposure, no ghosting, no horizon cut by frame, " +
    "no low resolution stretching artifacts"
  );
  const avoidShort = "avoid: no empty edges, no pillarboxing, no letterboxing, no compositional dead zones";
  let prompt = composition + narrative + wrap + avoidFull;
  if (prompt.length > 1450) prompt = composition + narrative + wrap + avoidShort;
  return prompt;
}

const prompt = buildSkyPrompt(candidate);
console.log("PROMPT (", prompt.length, "chars):");

// ASCII strip — correctly this time
const cleanPrompt = prompt
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^\x00-\x7f]/g, "");
console.log("After ASCII strip (", cleanPrompt.length, "chars)");

const MMX_MJS = "C:\\\\Program Files\\\\nodejs\\\\node_modules\\\\mmx-cli\\\\dist\\\\mmx.mjs";
if (!fs.existsSync(MMX_MJS)) {
  console.error("mmx.mjs not found");
  process.exit(1);
}

const seed = Math.floor(Math.random() * 1e9);
const outPath = path.resolve(process.argv[3]);
console.log("\\nGenerating 2048x1152 sky...");
console.log("Output:", outPath);

const spawnArgs = [
  "image", "generate",
  "--prompt", cleanPrompt,
  "--width", "2048", "--height", "1152",
  "--seed", String(seed),
  "--out", outPath,
  "--model", "image-01-live",
];

const t0 = Date.now();
const r = spawnSync("node", [MMX_MJS, ...spawnArgs], {
  shell: false,
  timeout: 300000,
  encoding: "utf-8",
});
const dur = ((Date.now() - t0) / 1000).toFixed(1);
console.log("Exit:", r.status, "Duration:", dur, "s");
if (r.stdout) console.log("stdout:", r.stdout.slice(-300));
if (r.stderr) console.log("stderr:", r.stderr.slice(-300));

if (r.status === 0 && fs.existsSync(outPath)) {
  console.log("\\n[OK]", outPath, "(", fs.statSync(outPath).size, "bytes)");
} else {
  console.log("\\n[FAIL]");
  process.exit(1);
}
