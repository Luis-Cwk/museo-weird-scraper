---
name: huaca-voxel-viewer-iteration
description: Iterate on huaca voxel viewer. Auto-fit, flat-sky.
---

# Huaca voxel viewer — iteration guide

## When to load

- User says "the voxel looks X" or "the sky looks Y" or "change the camera/material/sky"
- Working on `scripts/generate-three.ts` in `C:\Users\petra\museo-weird-scraper`
- Want to update `deploy/huaca/voxel-{N}.html` files and re-upload to `petrasynthetic.com`
- The cron is regenerating pieces and they want to override the visual style

## Architecture (as of 2026-08-24, "flat-sky" build)

- **Camera**: `THREE.PerspectiveCamera(70 FOV, aspect, 0.1, 500)` placed at `(0, 0, radius)` looking at origin
- **Voxel sculpture**: `InstancedMesh` of 1×1×1 cubes in a `sceneGroup`. Position computed from voxel bitmap at z=0.
- **Sky**: `THREE.PlaneGeometry` at z=−`radius * SKY_BEHIND_FACTOR` (2× further than sculpture). Texture: equirectangular PNG, but mapped as a 2D image via `MeshBasicMaterial` (NOT `EquirectangularReflectionMapping`).
- **Lights**: `AmbientLight(0.65) + DirectionalLight(1.4) + warm fill(0.5)`. No `scene.environment` (no IBL).
- **Voxel material**: `MeshStandardMaterial({ roughness: 0.5, metalness: 0.0, envMapIntensity: 0 })` — non-metal, no envMap. Explicit lights do the work.
- **Auto-fit**: `fitToViewport()` reads `VOXEL.width × cellSize` and `VOXEL.height × cellSize`, computes the camera distance to fit both axes with 40% margin, and re-runs on resize.
- **User controls**:
  - Drag with mouse → rotate `sceneGroup.rotation.y` (camera stays put)
  - Wheel → zoom by changing `camera.position.z` only (x/y stay 0)
  - No auto-rotation of sceneGroup (removed 2026-08-24, user said it felt rushed)
  - Per-decorCube rotation removed (0 cubes currently; `for (let k=0; k<0; k++)` loop)
- **Sky sizing**: PlaneGeometry width/height = `2 * (radius + skyDist) * tan(fov/2) * SKY_OVERSIZE (1.2)`. Re-created on each `fitToViewport()` call (old geometry is `.dispose()`d first).

## When to load (procedure)

1. Read `scripts/generate-three.ts` end-to-end (it's 700+ lines, one big `emitHTML` template)
2. Identify which part of the template to change (sky loader, voxel material, animate loop, fitToViewport)
3. Make the change in TS
4. `tsc` from `node_modules/.bin/tsc` (the `npm run build` step) — must exit 0
5. Regenerate the voxel HTML using the script in `sandbox/sky-quality-test/regenerate-voxel19.cjs` (or `regenerate-all-voxels.cjs` for all 3)
6. Upload to FTP: `curl -T <local> --user "huaca@petrasynthetic.com:<pwd>" "ftp://ftp.petrasynthetic.com/huaca/voxel-N.html"`
7. Verify SHA256 byte-for-byte match via `urllib.request` + `If-Modified-Since: Thu, 01 Jan 1970` headers (to bypass nginx cache)
8. Visual verify with `browser_navigate` + `browser_vision` (the only way to see actual rendering)
9. **DO NOT commit until user confirms visual is good** (creative UI rule)

## Approaches tried 2026-08-23/24 (and why each was rejected)

### Approach 1: Equirectangular sky + scene.environment
- `skyTex.mapping = THREE.EquirectangularReflectionMapping`
- `scene.environment = skyTex` (IBL)
- **Problem**: User saw seam (panoramic edge) rotating into view as camera moved
- **Mitigation attempt**: oscillating camera (NOT on sceneGroup) with `theta = sin(t) * 35°` + OFFSET 134° — partially worked but seam still visible at extremes
- **Verdict**: REJECTED. The panorama seam is structural, not just one bad column.

### Approach 2: Brushed metal voxel (roughness 0.4, envMapIntensity 0.6)
- Switched voxelMat from mirror (rough 0.15) to brushed (rough 0.4), dropped envMapIntensity from 1.4 to 0.6
- **Problem**: User said "sigue viendose opaco el HDRI, sin color real"
- **Verdict**: REJECTED. IBL was still coloring the voxel gray. User wanted "100% like the image".

### Approach 3: PMREMGenerator prefilter
- Tried to add `import { PMREMGenerator } from ".../examples/jsm/pmrem/PMREMGenerator.js"`
- **Problem 1**: That URL doesn't exist in three.js r160 (the examples/jsm/pmrem/ path is not in the published package)
- **Problem 2**: PMREMGenerator IS in the main bundle (verified with grep) but the voxel-19.html browser console showed `THREE not loaded` and 4 JS errors with empty messages
- **Verdict**: REJECTED. Diagnostic was inconclusive (browser had no useful error output). Even if PMREM worked, it would still wrap to a sphere and have a seam.

### Approach 4: Flat sky (PlaneGeometry + MeshBasicMaterial)
- `skyMesh = new THREE.Mesh(new THREE.PlaneGeometry(W, H), skyMat)` at z=−skyDist
- `skyMat = new THREE.MeshBasicMaterial({ map: skyTex, toneMapped: false, depthWrite: false })`
- `scene.environment` NOT set (no IBL)
- Voxel material: `metalness: 0.0, envMapIntensity: 0`
- **Result**: Sky shows at 100% colors (no IBL gray), no seam (image is 2D, not spherical)
- **Verdict**: SELECTED. The voxel sculpture floats in 3D space, the sky is a flat 2D background.

### Approach 5: Decor cubes (300) with individual rotation
- 300 cubes randomly placed in a 80×80×80 box around the voxel, each with `userData.rotationSpeed`
- **Problem 1**: User saw cubes only on one side (front), concentrated at top
- **Problem 2**: User said "van rápido" (felt fast)
- **Mitigation**: `for (let k=0; k<300; k++)` → distribution in 3D (front+back of voxel) with `fz * radius * 0.7` (z range: -0.35r to +0.35r)
- **Verdict**: REJECTED on second iteration. User said "quita los cubos negros, solo deja el voxel y el entorno". Final: `for (let k=0; k<0; k++)` (zero cubes, no-op loop)

## Sky URL convention

- `textures/sky-{skyNum}.png` where `skyNum` is computed by `agent.js` as `(Math.abs(contentHash) % 9999) + 1` (content-hash, NOT id-hash, to avoid collisions on numeric queue ids)
- Voxel-19 uses `sky-9860.png` (regenerated 2026-08-24 with the curated prompt)
- Voxel-21 uses `sky-3143.png` (regenerated)
- Voxel-22 uses `sky-9775.png` (regenerated)
- New cron pieces will use new sky numbers but the same logic

## Sky prompt (curated, 2026-08-24)

```
seamless 360 degree equirectangular panorama,
distant Andean valley landscape filling the bottom 30 percent of the frame,
atmosphere and sky filling the top 70 percent,
soft haze at horizon,
[category-hint: e.g. "environmental disopia, atmospheric distress"],
[intensity-words: e.g. "quiet, subtle, ominous undercurrent, low contrast"],
scene features: [nouns from content],
horizon line is perfectly straight and continuous horizontally,
left edge and right edge pixels identical at every row,
no vertical seam line visible at any column,
single continuous 360 photograph taken with a 360 camera in one take,
no horizon line crossing the upper third,
the nadir and zenith are blurred gradient without recognizable detail,
panoramic 2:1 equirectangular photograph, 360 degrees, full sphere,
no human figures, no text or labels, no logos,
single frame photograph, cinematic detail,
atmospheric context: '[content]',
avoid: no visible stitch seam, no distorted or stretched subject near the edges,
       no mismatch between left edge and right edge, no double exposure,
       no ghosting, no blurred horizon, no low resolution stretching artifacts
       at the wrap point, no hard transition at the seam
```

When used as a 2D flat sky (current), the panorama instructions don't matter — the image is stretched to a plane. The prompt still produces a coherent image with sky+ground split.

## Backups pattern (CRITICAL for rollback)

The `scripts/generate-three.ts.bak-*-<date>` files let you roll back any prior visual state. Current backups (most recent first):
- `.bak-flat-sky-20260824` — flat-sky + auto-fit, NO decorCubes
- `.bak-staticcam-20260824` — fixed camera + sceneGroup rotation
- `.bak-pmrem-20260824` — PMREM attempt (didn't work)
- `.bak-oscam-20260823` — original camera oscillation (sin sweep)

To roll back: `cp scripts/generate-three.ts.bak-X scripts/generate-three.ts && npm run build && node sandbox/sky-quality-test/regenerate-all-voxels.cjs && curl -T deploy/huaca/voxel-19.html --user "..." "ftp://..."`

## Common mistakes

- **Patch tool breaks indentation on TS template literals**: When patching the big `emitHTML` template, the patch tool sometimes adds extra spaces or breaks backticks. If you see "TS1005 ';' expected", read the file around that line — usually it's a `// comment` inside a template literal that contains a backtick. Fix with `python3 replace()` directly.
- **Forgetting to update regenerator script**: The sanity checks in `regenerate-all-voxels.cjs` were written for the older "OSC" animation. After architecture changes, update the `checks` array or the script will fail with `exit 1` even when the HTML is correct.
- **Browser cache**: nginx caches `voxel-N.html` for hours. Always append `?nocache=$(date +%s)` to the URL when verifying.
- **FTP user is chrooted**: Do NOT prepend `/public_html/` to remote paths. The user `huaca@petrasynthetic.com` starts at the FTP root of their account, which is what nginx serves.

## Future ideas (don't start without asking)

- **More dynamic lighting**: add a 4th colored point light that follows the camera, gives the voxel more dimension
- **Selective bloom on voxel mesh only**: use a post-process pass with selective bloom
- **Multiple sky layers**: parallax mountains behind the sky plane
- **Sky day/night cycle**: animate the sky's brightness over time
- **Tap-to-place decor cubes**: let the user add cubes where they tap
