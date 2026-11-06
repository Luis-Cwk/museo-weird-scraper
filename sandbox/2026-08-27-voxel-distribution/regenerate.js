// Regenerate the voxel-3 ("Kilómetros de agua...") with the updated
// generate-three.ts (smartTruncate + balanced wrapping). Uses the existing
// .json metadata for content + category, then re-emits the HTML through
// the patcher into sandbox/2026-08-27-voxel-distribution/.

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const BUILD = path.join(ROOT, "build", "scripts", "generate-three.js");
const META = path.join(ROOT, "build", "data", "artworks", "t_05b4c0c22225a919.json");
const SANDBOX = __dirname;
const PATCH = path.join(ROOT, "scripts", "post-generate-patch.py");

if (!fs.existsSync(BUILD)) {
  console.error("ERROR: build not found at", BUILD, "- run `npm run build` first");
  process.exit(1);
}
if (!fs.existsSync(META)) {
  console.error("ERROR: metadata not found at", META);
  process.exit(1);
}

const meta = JSON.parse(fs.readFileSync(META, "utf-8"));
console.log("Loaded metadata:", meta.id, "/", meta.category);
console.log("Original content length:", meta.content.length, "chars");

const { generateThreeArtwork } = require(BUILD);

(async () => {
  const input = {
    content: meta.content,
    category: meta.category,
    attribution: meta.attribution || "Petra",
    source: meta.source || "regenerate-sandbox",
    sourceUrl: meta.sourceUrl || "about:sandbox",
    skyUrl: "textures/sky-8855.png",
  };
  const out = await generateThreeArtwork(input);
  console.log("Generated:", out.htmlPath, "(" + out.voxelCount + " voxels)");

  // Copy the run HTML and metadata to the sandbox
  const destHtml = path.join(SANDBOX, "voxel-3.html");
  fs.copyFileSync(out.htmlPath, destHtml);
  console.log("Copied to sandbox:", destHtml);

  // Run the patcher on the sandbox copy so we get the canonical CSS-BG sky +
  // canvas. PYTHONIOENCODING avoids the cp1252 crash on the final print.
  const env = { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" };
  const patchOut = execSync(`py "${PATCH}" "${destHtml}"`, { env }).toString();
  console.log("Patch:", patchOut.trim());

  // Make sure the sky texture is in sandbox/textures/. DO NOT overwrite if
  // the sandbox already has a curated sky (e.g. one regenerated to 16:9 by
  // mmx) — the deploy/ copy is the original 2:1 panorama and would re-introduce
  // the dark side bands the curated sky fixed.
  const sbTextures = path.join(SANDBOX, "textures");
  fs.mkdirSync(sbTextures, { recursive: true });
  const html = fs.readFileSync(destHtml, "utf-8");
  const m = html.match(/textures\/(sky-\d+\.png)/);
  if (m) {
    const skyName = m[1];
    const skyDst = path.join(sbTextures, skyName);
    if (fs.existsSync(skyDst)) {
      console.log("Sky texture already in sandbox, keeping:", skyName, "(" + fs.statSync(skyDst).size + " bytes)");
    } else {
      const skySrc = path.join(ROOT, "deploy", "huaca", "textures", skyName);
      if (fs.existsSync(skySrc)) {
        fs.copyFileSync(skySrc, skyDst);
        console.log("Copied sky texture from deploy:", skyName, "(" + fs.statSync(skyDst).size + " bytes)");
      } else {
        console.error("WARNING: sky texture not found:", skySrc);
      }
    }
  } else {
    console.error("WARNING: no sky reference found in patched HTML");
  }

  // Show line/voxel stats from the patched HTML
  const metaMatch = html.match(/const VOXEL = (\{[^\n]+\})/);
  const layoutMatch = html.match(/const LAYOUT = (\{[^\n]+\})/);
  if (metaMatch && layoutMatch) {
    try {
      const voxel = JSON.parse(metaMatch[1]);
      const layout = JSON.parse(layoutMatch[1]);
      console.log("Voxel stats:", voxel.width + "x" + voxel.height, "px,", voxel.pixels.length, "filled pixels");
      console.log("Layout: cellSize=" + layout.cellSize, "depth=" + layout.depth, "voxelCount=" + layout.voxelCount);
    } catch (e) {
      console.error("Could not parse voxel/layout:", e.message);
    }
  }
})();
