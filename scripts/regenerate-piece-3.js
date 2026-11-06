// Regenera la pieza 3 (token #2, voxel-30.html) con:
// 1. Texto corregido (corta en la primera oración completa, en "Guajira.").
// 2. CSS sky-bg con background-size: cover (fix letterbox).
// No mintea nada — solo regenera los archivos estáticos locales.
const { generateThreeArtwork } = require("../build/scripts/generate-three.js");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = "C:/Users/petra/museo-weird-scraper";

// Texto corregido: primera oración completa (termina en "Guajira.").
const CORRECTED_CONTENT =
  "De la Espiella y la mafia de Miami están desesperados por hacernos creer que la violencia en Colombia es culpa de un pelao que vive una historia de amor y poder en los pueblos desérticos de la Guajira.";

async function main() {
  console.log("Regenerando voxel pieza 3 (token #2)...");

  // 1. Generar el voxel HTML base con el contenido corregido.
  const out = await generateThreeArtwork({
    content: CORRECTED_CONTENT,
    category: "other",
    skyUrl: "textures/sky-9171.png",
  });
  console.log("  generateThreeArtwork OK ->", out.htmlPath);
  console.log("  voxelCount:", out.voxelCount);

  // 2. Aplicar post-generate-patch (ahora con background-size: cover).
  const patchCmd = `python "${path.join(ROOT, "scripts", "post-generate-patch.py")}" "${out.htmlPath}"`;
  try {
    execSync(patchCmd, { stdio: "pipe" });
    console.log("  post-generate-patch OK (CSS cover)");
  } catch (e) {
    console.log("  WARNING post-generate-patch:", e.message.slice(0, 200));
  }

  // 3. Copiar a deploy/huaca/voxel-30.html
  const dest = path.join(ROOT, "deploy", "huaca", "voxel-30.html");
  fs.copyFileSync(out.htmlPath, dest);
  console.log("  Copiado a", dest);

  // 4. Verificar que el CSS tiene cover y el texto corregido
  const final = fs.readFileSync(dest, "utf-8");
  const hasCover = final.includes("background-size: cover");
  const hasOldAuto = final.includes("background-size: 100% auto");
  const hasCorrected = final.includes("Guajira.");
  const hasTruncated = final.includes("candidatura de");
  console.log("\n=== Verificación ===");
  console.log("  background-size: cover:", hasCover);
  console.log("  background-size: 100% auto (debe ser false):", hasOldAuto);
  console.log("  texto 'Guajira.' presente:", hasCorrected);
  console.log("  texto 'candidatura de' (debe ser false):", hasTruncated);
}

main().catch((e) => {
  console.error("ERROR:", e);
  process.exit(1);
});
