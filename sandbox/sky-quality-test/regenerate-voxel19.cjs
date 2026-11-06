#!/usr/bin/env node
/**
 * One-shot regenerator for voxel-19 (queue #19) with the new oscillating camera.
 * Does NOT mint, does NOT upload gallery. Writes:
 *   - data/runs/<ts>_Petra_2026/t_<hash>.html
 *   - copies the HTML to deploy/huaca/voxel-19.html so we can FTP it
 *
 * After it finishes, the upload step is done separately by upload-voxel19.cjs.
 */
const fs = require("fs");
const path = require("path");

const ROOT = "C:/Users/petra/museo-weird-scraper";

// Load the COMPILED generate-three.js from build/
const { generateThreeArtwork } = require(path.join(ROOT, "build", "scripts", "generate-three.js"));

// Queue #19 metadata — verified from data/art-queue.json
const input = {
  content: "Al menos ocho personas han muerto por un deslizamiento de tierra en el municipio colombiano de Bello, colindante con Medellín",
  category: "disaster_response",        // from the LLM guard
  attribution: "Anonymous",
  source: "BSKY:\"DESLIZAMIENTO MEDELLIN\"",
  sourceUrl: "",
  scrapedAt: "2026-08-23T15:07:00Z",
  skyUrl: "textures/sky-9860.png",      // updated sky, already on FTP
};

(async () => {
  console.log("Generating voxel #19 with new OSC camera...");
  const out = await generateThreeArtwork(input);
  console.log(`  written: ${out.htmlPath}`);
  console.log(`  voxels: ${out.voxelCount}`);
  console.log(`  metadata: ${out.metadataPath}`);

  // Also copy to deploy/huaca/voxel-19.html (the local copy we'll FTP)
  const deployCopy = path.join(ROOT, "deploy", "huaca", "voxel-19.html");
  fs.copyFileSync(out.htmlPath, deployCopy);
  console.log(`  copied to: ${deployCopy} (${fs.statSync(deployCopy).size} bytes)`);

  // Sanity-check the published HTML contains the new flat-sky zoom clamp (2026-08-24)
  const html = fs.readFileSync(deployCopy, "utf-8");
  if (html.includes("radius * 2.0")) {
    console.log(`  ✓ contains radius * 2.0 (new zoom clamp)`);
  } else {
    console.error(`  ✗ MISSING radius * 2.0 — old code?`);
    process.exit(1);
  }
  if (html.includes("sizeSkyToFrustum(newDist)")) {
    console.log(`  ✓ contains sizeSkyToFrustum(newDist) (sky rescales on wheel)`);
  } else {
    console.error(`  ✗ MISSING sizeSkyToFrustum(newDist) — sky won't follow zoom`);
    process.exit(1);
  }
})().catch(e => { console.error(e); process.exit(1); });