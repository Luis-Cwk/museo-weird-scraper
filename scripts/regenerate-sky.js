// Regenera el cielo de una pieza específica (para corregir letterbox/cinematic).
// Uso: node scripts/regenerate-sky.js
// Requiere que scripts/agent.js exporte generateSkyForCandidate.
const { generateSkyForCandidate } = require("./agent.js");

// Pieza #3 (token 2) — sky-8737.png con barras negras (cinematic).
const candidate = {
  content: "A Galán hay muchas cosas que se le salieron de las manos, le bloquean vías, le generan violencia, hay corrupción al interior y nada pasa. Que mire a Medellín y aprenda cómo se administra!",
  aiCategory: "climate_violence",
  aiImpactScore: 7,
  attribution: "Anonymous",
  source: 'x:"(violencia OR deslizamiento) (medellin OR antioquia) lang:es -is:retweet"',
  sourceUrl: "https://bsky.app/profile/x.com",
};

async function main() {
  const skyNum = 8737; // token 2 → textures/sky-8737.png (determinista por content hash)
  console.log("Regenerando sky-" + skyNum + ".png con prompt corregido (sin 'cinematic')...");
  const result = await generateSkyForCandidate(candidate, skyNum);
  if (result) {
    console.log("REGEN OK:", result.remoteName, "->", result.localPath);
  } else {
    console.log("REGEN FAILED");
    process.exitCode = 1;
  }
}

main();
