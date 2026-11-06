#!/usr/bin/env node
/**
 * One-shot regenerator for voxel-19, voxel-21, voxel-22 with the new
 * architecture (fixed camera, sceneGroup rotation, drag/wheel manual control).
 * Does NOT mint, does NOT upload gallery. Writes:
 *   - data/runs/<ts>_Petra_2026/t_<hash>.html
 *   - copies the HTML to deploy/huaca/voxel-N.html so we can FTP it
 *
 * Uses the COMPILED generate-three.js from build/scripts/ so all the latest
 * changes (sceneGroup, drag handlers, AUTO_YAW_SPEED=0.0025) are picked up.
 */

const fs = require("fs");
const path = require("path");

const ROOT = "C:/Users/petra/museo-weird-scraper";
const { generateThreeArtwork } = require(path.join(ROOT, "build", "scripts", "generate-three.js"));

// Each voxel's input mirrors what agent.js uses in its runCycle loop.
// Voxel 21 references sky-3143 (regenerated today with the curated prompt).
// Voxel 22 references sky-9775 (regenerated today with the curated prompt).
// Voxel 19 references sky-9860 (the rotated/sky-quality candidate).
const inputs = [
  {
    out: "voxel-19.html",
    input: {
      content: "Al menos ocho personas han muerto por un deslizamiento de tierra en el municipio colombiano de Bello, colindante con Medellín",
      category: "disaster_response",
      attribution: "Anonymous",
      source: "BSKY:\"DESLIZAMIENTO MEDELLIN\"",
      sourceUrl: "",
      scrapedAt: "2026-08-23T15:07:00Z",
      skyUrl: "textures/sky-9860.png",
    },
  },
  {
    out: "voxel-21.html",
    input: {
      content: "Al menos ocho personas murieron y cinco resultaron heridas por un deslizamiento de tierra en el municipio colombiano de Bello, colindante con Medellín",
      category: "disaster_response",
      attribution: "Anonymous",
      source: "bsky:\"deslizamiento medellin\"",
      sourceUrl: "",
      scrapedAt: "2026-08-24T15:07:00Z",
      skyUrl: "textures/sky-3143.png",
    },
  },
  {
    out: "voxel-22.html",
    input: {
      content: "Deslizamiento de grandes proporciones en Villatina",
      category: "disaster_response",
      attribution: "Anonymous",
      source: "bsky:\"deslizamiento medellin\"",
      sourceUrl: "",
      scrapedAt: "2026-08-24T16:30:00Z",
      skyUrl: "textures/sky-9775.png",
    },
  },
];

(async () => {
  for (const { out, input } of inputs) {
    console.log(`\n=== Regenerating ${out} ===`);
    const result = await generateThreeArtwork(input);
    console.log(`  written: ${result.htmlPath}`);
    console.log(`  voxels: ${result.voxelCount}`);

    const deployCopy = path.join(ROOT, "deploy", "huaca", out);
    fs.copyFileSync(result.htmlPath, deployCopy);
    const size = fs.statSync(deployCopy).size;
    console.log(`  copied to: ${deployCopy} (${size} bytes)`);

    // Sanity check the new HTML contains the new architecture markers
    const html = fs.readFileSync(deployCopy, "utf-8");
    const checks = [
      ["sceneGroup = new THREE.Group", "sceneGroup created"],
      ["sceneGroup.add(voxelMesh)", "voxelMesh in sceneGroup"],
      ["camera.position.set(0, 0, radius)", "camera fixed at +Z"],
      ["AUTO_YAW_SPEED = 0.0025", "auto-rotation speed = 0.0025"],
      ["MANUAL_YAW_SENSITIVITY", "manual drag handler present"],
      ["pointerdown", "pointer event listener present"],
      ["wheel", "wheel zoom handler present"],
      ["sceneGroup.rotation.y += dx * MANUAL_YAW_SENSITIVITY", "manual drag delta applied to sceneGroup"],
    ];
    let allOk = true;
    for (const [needle, desc] of checks) {
      const present = html.includes(needle);
      if (!present) allOk = false;
      console.log(`    ${present ? "✓" : "✗"} ${desc}`);
    }
    if (!allOk) {
      console.error(`  ✗ FAILED sanity checks for ${out}`);
      process.exit(1);
    }
    // Confirm legacy OSC and theta-orbital code is GONE
    if (html.includes("theta += OSC_SPEED")) {
      console.error(`  ✗ still contains legacy theta += OSC_SPEED`);
      process.exit(1);
    }
    if (html.includes("theta += 0.03")) {
      console.error(`  ✗ still contains legacy theta += 0.03`);
      process.exit(1);
    }
    console.log(`  ✓ no legacy orbital code`);
  }

  console.log(`\n=== All voxels regenerated ===`);
})().catch(e => { console.error(e); process.exit(1); });