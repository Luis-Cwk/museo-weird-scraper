
const SKY_CATEGORY_HINT = {
  violence: "blood, surveillance, electric perimeter, civic estrangement",
  urban_folklore: "urban legend, ritual repetition, accumulated memory",
  natural_anomaly: "flood scar, soil displacement, displaced earth",
  infrastructure: "concrete failure, exposed wiring, failed civic promise",
  other: "environmental disopia, atmospheric distress",
};
const SKY_INTENSITY_WORDS = {
  high: "saturated, hyperreal, ominous, electric, dense",
  medium: "muted, weighted, contemplative, still, heavy",
  low: "subtle, washed, distant, faint, decaying",
};

function extractProperNouns(content) {
  return content.split(/\s+/).filter(w => /^[A-Z]/.test(w)).slice(0, 4);
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

const candidate = {
  aiCategory: "natural_anomaly",
  aiImpactScore: 9,
  content: "Deslizamiento Granizal Medellin barrio damnificado",
};
const prompt = buildSkyPrompt(candidate);
console.log("Prompt length:", prompt.length, "chars (under 1500:", prompt.length < 1500, ")");
console.log("---");
console.log(prompt);
console.log("---");
