
const path = require("path");
const ROOT = "C:/Users/petra/museo-weird-scraper";
process.chdir(ROOT);
const { generateThreeArtwork } = require(path.join(ROOT, "build", "scripts", "generate-three.js"));

(async () => {
  // Use the same content/sourceUrl/attribution that the cron used
  // For queue #24 (sismo antioquia)
  const result = await generateThreeArtwork({
    content: "Un sismo sorprendió a los habitantes de Antioquia en horas de la noche de este domingo, 5 de enero, durante el puente de Reyes.",
    category: "other",
    attribution: "Anonymous",
    source: 'bsky:"temblor medellin hoy"',
    sourceUrl: "",
    scrapedAt: "2026-08-25T00:17:00Z",
    skyUrl: "textures/sky-6572.png",  // The actual skyNum the cron computed
  });
  console.log("written:", result.htmlPath);
  console.log("voxels:", result.voxelCount);
  // Copy to deploy/huaca/voxel-24.html
  const deployCopy = path.join(ROOT, "deploy", "huaca", "voxel-24.html");
  require("fs").copyFileSync(result.htmlPath, deployCopy);
  console.log("copied to:", deployCopy, require("fs").statSync(deployCopy).size, "bytes");
  // Sanity checks
  const html = require("fs").readFileSync(deployCopy, "utf-8");
  const checks = {
    "sceneGroup present": html.includes("sceneGroup"),
    "AUTO_YAW_SPEED present": html.includes("AUTO_YAW_SPEED"),
    "skyUrl referenced": html.includes("sky-6572.png") || html.includes("skyUrl"),
  };
  for (const [k, v] of Object.entries(checks)) {
    console.log(" ", v ? "✓" : "✗", k);
  }
})().catch(e => { console.error(e); process.exit(1); });
