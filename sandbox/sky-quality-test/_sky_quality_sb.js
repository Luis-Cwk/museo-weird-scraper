const SKY_CATEGORY_HINT = {
  air_pollution:      "smog haze, atmospheric particulate, midday haze over a valley",
  infrastructure:     "unstable hillside construction, mud-streaked slope, scaffolding",
  biodiversity_loss:  "dry wetland, receding water, displaced wildlife silhouettes",
  landslide:          "fresh landslide scar, raw red earthfall, displaced earth",
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

const ASCII = (s) => (s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '');

function extractProperNouns(content, maxN) {
  if (typeof maxN !== "number") maxN = 3;
  const STOP = new Set(["el","la","los","las","y","de","del","en","se","un","una","que","con","para","por","sobre","sin","tras","este","esta","es","son","fue","fueron","al"]);
  const out = [];
  const seen = new Set();
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

function buildSkyPrompt(candidate) {
  const cat = candidate.aiCategory || "other";
  const impact = candidate.aiImpactScore || 5;
  const content = (candidate.content || "").slice(0, 140);
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
    ASCII(anchor) + ", " +
    "scene features: " + ASCII(sceneFeatures) + ", " +
    "environment reference: " + ASCII(sceneFeatures) + ", " +
    ASCII(intensity) + ", " +
    "panoramic 2:1 equirectangular photograph, 360 degrees, full sphere, " +
    "no human figures, no text or labels, no logos, " +
    "clean zenith gradient to pale haze, clean nadir gradient to soft blur, " +
    "asymmetric composition: subject of interest offset from center NOT centered, " +
    "single frame photograph, cinematic detail, " +
    "atmospheric context: '" + ASCII(content.trim()) + "', " +
    "avoid: no visible stitch seam, " +
    "no distorted or stretched subject near the edges, " +
    "no mismatch between left edge and right edge, " +
    "no double exposure, no ghosting, no blurred horizon, " +
    "no low resolution stretching artifacts at the wrap point, " +
    "no hard transition at the seam between left-most and right-most columns"
  );
}

async function fixSkySeam(inputPath, outputPath, feather) {
  feather = feather || 96;
  let sharp;
  try { sharp = require("sharp"); } catch (e) { sharp = null; }
  if (!sharp) {
    fs.copyFileSync(inputPath, outputPath);
    log("  (sharp not installed; seam-fix skipped — install sharp for full seam continuity)");
    return outputPath;
  }
  const { data, info } = await sharp(inputPath).raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;
  const px = Buffer.from(data);
  const blended = Buffer.from(px);
  const target = Buffer.alloc(C);
  for (let y = 0; y < H; y++) {
    for (let k = 0; k < C; k++) {
      const left = px[y * W * C + 0 * C + k];
      const right = px[y * W * C + (W - 1) * C + k];
      target[k] = (left + right) >> 1;
    }
    for (let x = 0; x < feather; x++) {
      const t = (x === 0) ? 1 : x / feather;
      for (let k = 0; k < C; k++) {
        const origL = px[y * W * C + x * C + k];
        const origR = px[y * W * C + (W - 1 - x) * C + k];
        blended[y * W * C + x * C + k] = ((1 - t) * origL + t * target[k]) | 0;
        blended[y * W * C + (W - 1 - x) * C + k] = ((1 - t) * origR + t * target[k]) | 0;
      }
    }
  }
  await sharp(blended, { raw: { width: W, height: H, channels: C } })
    .png({ compressionLevel: 6 })
    .toFile(outputPath);
  return outputPath;
}

const log = (s) => process.stdout.write('LOG: ' + s + '\n');

module.exports = { buildSkyPrompt, fixSkySeam };