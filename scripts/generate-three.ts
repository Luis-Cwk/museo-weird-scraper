import fs from "fs";
import path from "path";
import crypto from "crypto";

/**
 * HUACA, SISTEMAS MÁGICOS — Three.js Voxel Generator
 *
 * Builds a 3D voxel sculpture from each scraped text piece, with 300
 * decorative cubes orbiting around it. Self-contained for the viewer
 * (Three.js bundled), headless export to PNG/MP4 for IPFS/OpenSea.
 *
 * Why voxel:
 *   - No external font needed (TextGeometry requires helvetiker JSON)
 *   - Each piece is fully reproducible from its seed + content
 *   - Visually distinct from the previous SVG/Canvas2D outputs
 *
 * Visual reference: Three.js example `cubos3DEXAMPLE.html` — same camera
 * orbit, same pulse, same 300 background cubes. Text replaces the
 * "DO NOT BUY STUFF" TextGeometry with a 3D voxel sculpture.
 *
 * Output:
 *   - <id>.html : self-contained piece for viewer (Three.js bundled locally)
 *   - <id>.json : metadata (content, category, voxel count, layout)
 */

const ARTWORKS_DIR = path.join(__dirname, "..", "data", "artworks");
const RUNS_DIR = path.join(__dirname, "..", "data", "runs");

// --- Category palettes (4 active) ---

type Mood = "light" | "dark";

interface Palette {
  bg: string;       // scene.background
  fg: string;       // text voxel color
  accent: string;   // decorative cube color
  cubeLight: string;// half the decorative cubes
  cubeDark: string; // other half
  mood: Mood;
  label: string;
}

const PALETTES: Record<string, Palette> = {
  mexico_weird: {
    bg: "#f4efe6",
    fg: "#1a1a1a",
    accent: "#7a3b2e",
    cubeLight: "#f4efe6",
    cubeDark: "#3a2a1f",
    mood: "light",
    label: "MUSEO WEIRD · MÉXICO",
  },
  medellin_weird: {
    bg: "#f1ece4",
    fg: "#1a1a1a",
    accent: "#5b3a29",
    cubeLight: "#f1ece4",
    cubeDark: "#322015",
    mood: "light",
    label: "MUSEO WEIRD · MEDELLÍN",
  },
  air_pollution: {
    bg: "#0a0a0a",
    fg: "#ff7a1a",
    accent: "#cc4d00",
    cubeLight: "#1a1a1a",
    cubeDark: "#3a1a08",
    mood: "dark",
    label: "AIRE · MEDELLÍN",
  },
  water_pollution: {
    bg: "#070d18",
    fg: "#6fb8e0",
    accent: "#225a85",
    cubeLight: "#0e1825",
    cubeDark: "#1f3a55",
    mood: "dark",
    label: "AGUA · ABURRÁ",
  },
  other: {
    bg: "#0e0e0e",
    fg: "#e0e0e0",
    accent: "#888888",
    cubeLight: "#1a1a1a",
    cubeDark: "#333333",
    mood: "dark",
    label: "HUACA",
  },
};

// --- Seeded RNG (Mulberry32) ---

function hashSeed(text: string): number {
  const h = crypto.createHash("sha256")
    .update(text.toLowerCase().replace(/[^a-z0-9áéíóúñü]/g, ""))
    .digest("hex");
  return parseInt(h.slice(0, 8), 16);
}

// --- Voxel sampling: render text into a 2D canvas, return pixel coords ---

interface VoxelGrid {
  width: number;
  height: number;
  pixels: { x: number; y: number }[]; // filled pixel coords
}

function wordWrap(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    const candidate = (current ? current + " " : "") + w;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = w;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// Wrap text into lines that fit visually in the viewport for a given cell size.
// Each char is (charW * cellSize) wide + 1 cell gap. We budget ~70% of frame
// width for the sculpture so the camera at radius 6 shows it comfortably.
function wrappedLines(text: string, cellSize: number): string[] {
  const charW = 5;
  const gap = 1;
  const charUnits = charW + gap;
  // Frame width at radius 6 with FOV 70° ~= 8 world units visible.
  const frameWorldWidth = 8;
  const targetWidthWorld = frameWorldWidth * 0.7;
  const charsPerLine = Math.max(8, Math.floor(targetWidthWorld / (charUnits * cellSize)));
  return wordWrap(text, charsPerLine);
}

function sampleTextLine(line: string): VoxelGrid {
  const upper = line;
  const charCount = upper.length;
  const charW = 5;
  const charH = 7;

  const glyphs: Record<string, number[][]> = buildGlyphSet(charW, charH);

  const cols = charCount * (charW + 1);
  const rows = charH;

  const cells: { x: number; y: number }[] = [];
  for (let i = 0; i < upper.length; i++) {
    const ch = upper[i];
    const pattern = glyphs[ch] || glyphs["?"];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < charW; col++) {
        if (pattern[row] && pattern[row][col]) {
          cells.push({
            x: i * (charW + 1) + col,
            y: row,
          });
        }
      }
    }
  }

  return {
    width: cols,
    height: rows,
    pixels: cells,
  };
}

// Sample a multi-line voxel sculpture: each line stacked vertically.
function sampleTextToVoxelsMultiline(text: string, cellSize: number): VoxelGrid {
  const lines = wrappedLines(text, cellSize);
  const charH = 7;
  const lineSpacing = charH + 4; // rows between lines

  const lineVoxels = lines.map((line) => sampleTextLine(line.toUpperCase()));
  const maxWidth = Math.max(...lineVoxels.map((v) => v.width));
  const totalHeight = lineVoxels.length * lineSpacing - 4;

  // Re-offset each line's pixels so they share a common y-origin, and
  // center each line horizontally within maxWidth.
  // p.y comes from sampleTextLine where row 0 is the top of the glyph.
  // We want p.y=0 to map to the highest y in our assembly (top of
  // sculpture) — since the placement formula does y_world = centerY -
  // p.y*cellSize (subtracting p.y), p.y must already be in "world up"
  // convention here.
  const pixels: { x: number; y: number }[] = [];
  for (let li = 0; li < lineVoxels.length; li++) {
    const lv = lineVoxels[li];
    const xOffset = Math.floor((maxWidth - lv.width) / 2);
    // Stack lines so the first text line ends up at the top of the
    // sculpture (lowest y values), and the last line at the bottom.
    // First line is li=0, second is li=1, etc.
    for (const p of lv.pixels) {
      pixels.push({
        x: p.x + xOffset,
        y: li * lineSpacing + p.y,
      });
    }
  }

  return {
    width: maxWidth,
    height: totalHeight,
    pixels,
  };
}

// Tiny 5x7 pixel font for the voxel sculpture. Sufficient for readable
// short phrases. Each pattern[row] is an array of 0/1 per column.
function buildGlyphSet(w: number, h: number): Record<string, number[][]> {
  // We'll always render into w x h, but the patterns below are designed
  // for 5x7. We pad/truncate.
  const base5x7: Record<string, string[]> = {
    " ": [".....", ".....", ".....", ".....", ".....", ".....", "....."],
    "A": ["..1..", ".1.1.", "1...1", "11111", "1...1", "1...1", "1...1"],
    "B": ["1111.", "1...1", "1...1", "1111.", "1...1", "1...1", "1111."],
    "C": [".1111", "1....", "1....", "1....", "1....", "1....", ".1111"],
    "D": ["1111.", "1...1", "1...1", "1...1", "1...1", "1...1", "1111."],
    "E": ["11111", "1....", "1....", "111..", "1....", "1....", "11111"],
    "F": ["11111", "1....", "1....", "111..", "1....", "1....", "1...."],
    "G": [".1111", "1....", "1....", "1.111", "1...1", "1...1", ".1111"],
    "H": ["1...1", "1...1", "1...1", "11111", "1...1", "1...1", "1...1"],
    "I": ["11111", "..1..", "..1..", "..1..", "..1..", "..1..", "11111"],
    "J": ["11111", "...1.", "...1.", "...1.", "...1.", "1..1.", ".11.."],
    "K": ["1...1", "1..1.", "1.1..", "11...", "1.1..", "1..1.", "1...1"],
    "L": ["1....", "1....", "1....", "1....", "1....", "1....", "11111"],
    "M": ["1...1", "11.11", "1.1.1", "1.1.1", "1...1", "1...1", "1...1"],
    "N": ["1...1", "11..1", "1.1.1", "1.1.1", "1..11", "1...1", "1...1"],
    "O": [".111.", "1...1", "1...1", "1...1", "1...1", "1...1", ".111."],
    "P": ["1111.", "1...1", "1...1", "1111.", "1....", "1....", "1...."],
    "Q": [".111.", "1...1", "1...1", "1...1", "1.1.1", "1..1.", ".11.1"],
    "R": ["1111.", "1...1", "1...1", "1111.", "1.1..", "1..1.", "1...1"],
    "S": [".1111", "1....", "1....", ".111.", "....1", "....1", "1111."],
    "T": ["11111", "..1..", "..1..", "..1..", "..1..", "..1..", "..1.."],
    "U": ["1...1", "1...1", "1...1", "1...1", "1...1", "1...1", ".111."],
    "V": ["1...1", "1...1", "1...1", "1...1", "1...1", ".1.1.", "..1.."],
    "W": ["1...1", "1...1", "1...1", "1.1.1", "1.1.1", "11.11", "1...1"],
    "X": ["1...1", "1...1", ".1.1.", "..1..", ".1.1.", "1...1", "1...1"],
    "Y": ["1...1", "1...1", ".1.1.", "..1..", "..1..", "..1..", "..1.."],
    "Z": ["11111", "....1", "...1.", "..1..", ".1...", "1....", "11111"],
    "Ñ": ["..1..", "1...1", "11..1", "1.1.1", "1..11", "1...1", "1...1"],
    "0": [".111.", "1...1", "1..11", "1.1.1", "11..1", "1...1", ".111."],
    "1": ["..1..", ".11..", "..1..", "..1..", "..1..", "..1..", ".111."],
    "2": [".111.", "1...1", "....1", "...1.", "..1..", ".1...", "11111"],
    "3": [".111.", "1...1", "....1", "..11.", "....1", "1...1", ".111."],
    "4": ["...1.", "..11.", ".1.1.", "1..1.", "11111", "...1.", "...1."],
    "5": ["11111", "1....", "1....", "1111.", "....1", "1...1", ".111."],
    "6": [".111.", "1....", "1....", "1111.", "1...1", "1...1", ".111."],
    "7": ["11111", "....1", "...1.", "..1..", ".1...", ".1...", ".1..."],
    "8": [".111.", "1...1", "1...1", ".111.", "1...1", "1...1", ".111."],
    "9": [".111.", "1...1", "1...1", ".1111", "....1", "....1", ".111."],
    ",": [".....", ".....", ".....", ".....", ".....", "..1..", ".1..."],
    ".": [".....", ".....", ".....", ".....", ".....", ".....", "..1.."],
    ":": [".....", "..1..", "..1..", ".....", "..1..", "..1..", "....."],
    "!": ["..1..", "..1..", "..1..", "..1..", "..1..", ".....", "..1.."],
    "?": [".111.", "1...1", "....1", "...1.", "..1..", ".....", "..1.."],
    "Á": ["..1..", ".1.1.", "..1..", ".1.1.", "1...1", "11111", "1...1"],
    "É": ["..1..", "1....", "1....", "111..", "1....", "1....", "11111"],
    "Í": [".1...", "..1..", "..1..", "..1..", "..1..", "..1..", "11111"],
    "Ó": [".1...", ".111.", "1...1", "1...1", "1...1", "1...1", ".111."],
    "Ú": [".1...", "1...1", "1...1", "1...1", "1...1", "1...1", ".111."],
  };

  const out: Record<string, number[][]> = {};
  for (const ch of Object.keys(base5x7)) {
    const rows = base5x7[ch];
    const matrix: number[][] = [];
    for (let r = 0; r < h; r++) {
      const row = rows[Math.min(r, rows.length - 1)] || ".....";
      const cols: number[] = [];
      for (let c = 0; c < w; c++) {
        cols.push(row[c] === "1" ? 1 : 0);
      }
      matrix.push(cols);
    }
    out[ch] = matrix;
  }
  return out;
}

// --- Layout: pick voxel size, depth, position based on text length ---

interface VoxelLayout {
  cellSize: number;
  depth: number;       // how many voxels deep (z-axis)
  centerX: number;
  centerY: number;
  centerZ: number;
  voxelCount: number;
}

function planVoxelLayout(lenOrText: number | string, voxel: VoxelGrid): VoxelLayout {
  // For short text: bigger voxels, thicker. For long text: smaller, thinner.
  const len = typeof lenOrText === "string" ? lenOrText.length : lenOrText;
  // Y is already flipped in sampling (y=0 is the bottom row). centerY
  // positive offsets downward so the sculpture sits centered on the origin.
  if (len < 30) {
    return {
      cellSize: 0.45,
      depth: 5,
      centerX: -voxel.width * 0.45 * 0.5,
      centerY: voxel.height * 0.45 * 0.5,
      centerZ: -1.0,
      voxelCount: voxel.pixels.length * 5,
    };
  }
  if (len < 60) {
    return {
      cellSize: 0.30,
      depth: 3,
      centerX: -voxel.width * 0.30 * 0.5,
      centerY: voxel.height * 0.30 * 0.5,
      centerZ: -0.5,
      voxelCount: voxel.pixels.length * 3,
    };
  }
  return {
    cellSize: 0.22,
    depth: 2,
    centerX: -voxel.width * 0.22 * 0.5,
    centerY: voxel.height * 0.22 * 0.5,
    centerZ: -0.25,
    voxelCount: voxel.pixels.length * 2,
  };
}

// --- HTML emission: self-contained Three.js piece ---

function emitHTML(
  palette: Palette,
  voxel: VoxelGrid,
  layout: VoxelLayout,
  seed: number,
  meta: { id: string; category: string; content: string },
): string {
  const paletteJSON = JSON.stringify(palette).replace(/<\/script/g, "<\\/script");
  const voxelJSON = JSON.stringify({
    width: voxel.width,
    height: voxel.height,
    pixels: voxel.pixels,
  }).replace(/<\/script/g, "<\\/script");
  const layoutJSON = JSON.stringify(layout).replace(/<\/script/g, "<\\/script");
  const metaJSON = JSON.stringify(meta).replace(/<\/script/g, "<\\/script");

  // We import Three.js from a CDN. The viewer bundles it locally; for
  // standalone IPFS viewing this means the piece needs internet.
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Huaca, Sistemas Mágicos · ${meta.id.slice(0, 8)}</title>
<style>
  html, body { margin: 0; padding: 0; background: ${palette.bg}; overflow: hidden; font-family: ui-monospace, "Courier New", monospace; }
  canvas { display: block; width: 100vw; height: 100vh; }
  .meta {
    position: fixed;
    left: 14px;
    bottom: 10px;
    color: ${palette.accent};
    font-size: 10px;
    letter-spacing: 3px;
    text-transform: uppercase;
    opacity: 0.85;
    pointer-events: none;
    z-index: 10;
  }
  .meta.right { left: auto; right: 14px; bottom: 10px; }
</style>
</head>
<body>
<div class="meta">${palette.label}</div>
<div class="meta right">№ ${meta.id.slice(0, 6).toUpperCase()}</div>
<script type="importmap">
{
  "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js"
  }
}
</script>
<script type="module">
import * as THREE from 'three';

const PALETTE = ${paletteJSON};
const VOXEL = ${voxelJSON};
const LAYOUT = ${layoutJSON};
const META = ${metaJSON};
const SEED = ${seed};

// --- Mulberry32 ---
function mulberry32(s) {
  return function() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(SEED);

// --- Scene ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.bg);

// Camera positioned so the entire voxel sculpture fits comfortably.
// We compute the required distance from the sculpture's bounding box.
const sculptureWidth = VOXEL.width * LAYOUT.cellSize;
const sculptureHeight = VOXEL.height * LAYOUT.cellSize;
const fovRad = 70 * Math.PI / 180;
const margin = 1.4; // padding around sculpture
const distH = (sculptureHeight * 0.5 * margin) / Math.tan(fovRad * 0.5);
const distW = (sculptureWidth * 0.5 * margin) / Math.tan(fovRad * 0.5) / (window.innerWidth / window.innerHeight);
const radius = Math.max(6, Math.max(distH, distW));

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 100);
// Camera at +Z so the sculpture (which sits at origin facing +Z) reads
// in its natural left-to-right orientation. Animating in the XZ plane
// orbits the sculpture, but we start at theta=0 (z = +radius) so the
// very first frame is the canonical view, not the mirror image.
let theta = 0;

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// --- Lights ---
const light = new THREE.PointLight(0xffffff, 2, 0, 0);
camera.add(light);
scene.add(camera);

const ambient = new THREE.AmbientLight(0x404040, 1);
scene.add(ambient);

// --- Voxel text sculpture ---
const voxelGeom = new THREE.BoxGeometry(LAYOUT.cellSize, LAYOUT.cellSize, LAYOUT.cellSize);
const voxelMat = new THREE.MeshStandardMaterial({
  color: new THREE.Color(PALETTE.fg),
  roughness: 0.3,
  metalness: 0.7,
});
const voxelMesh = new THREE.InstancedMesh(voxelGeom, voxelMat, LAYOUT.voxelCount);
const m = new THREE.Matrix4();
let i = 0;
for (const p of VOXEL.pixels) {
  for (let d = 0; d < LAYOUT.depth; d++) {
    if (i >= LAYOUT.voxelCount) break;
    m.makeTranslation(
      LAYOUT.centerX + p.x * LAYOUT.cellSize,
      LAYOUT.centerY - p.y * LAYOUT.cellSize,
      LAYOUT.centerZ + (d - LAYOUT.depth / 2) * LAYOUT.cellSize,
    );
    voxelMesh.setMatrixAt(i++, m);
  }
}
voxelMesh.count = i;
scene.add(voxelMesh);

// --- 300 decorative cubes ---
const cubeGeom = new THREE.BoxGeometry(1, 1, 1);
const cubeMatA = new THREE.MeshStandardMaterial({
  color: new THREE.Color(PALETTE.cubeLight),
  roughness: 0.7,
  metalness: 0.0,
});
const cubeMatB = new THREE.MeshStandardMaterial({
  color: new THREE.Color(PALETTE.cubeDark),
  roughness: 0.7,
  metalness: 0.0,
});

const decorCubes = [];
for (let k = 0; k < 300; k++) {
  const cube = new THREE.Mesh(cubeGeom, k % 2 === 0 ? cubeMatA : cubeMatB);
  cube.position.set(
    rng() * 80 - 40,
    rng() * 80 - 40,
    rng() * 80 - 40,
  );
  cube.rotation.set(rng() * Math.PI * 2, rng() * Math.PI * 2, rng() * Math.PI * 2);
  const scale = rng() * 0.3 + 0.2;
  cube.scale.set(scale, scale, scale);
  cube.userData.rotationSpeed = {
    x: rng() * 0.02 - 0.01,
    y: rng() * 0.02 - 0.01,
    z: rng() * 0.02 - 0.01,
  };
  scene.add(cube);
  decorCubes.push(cube);
}

// --- Resize ---
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Pulse state for voxel sculpture ---
let pulsePhase = 0;

// --- Render loop ---
function animate() {
  theta += 0.03;
  // Camera orbits in the XZ plane; lookAt(origin) keeps the sculpture centered.
  camera.position.x = radius * Math.sin(theta * Math.PI / 180);
  camera.position.y = radius * Math.sin(theta * 0.5 * Math.PI / 180) * 0.5;
  camera.position.z = radius * Math.cos(theta * Math.PI / 180);
  camera.lookAt(0, 0, 0);

  pulsePhase += 0.01;
  const pulse = 1 + Math.sin(pulsePhase) * 0.05;
  voxelMesh.scale.set(pulse, pulse, pulse);

  for (const cube of decorCubes) {
    if (cube.userData.rotationSpeed) {
      cube.rotation.x += cube.userData.rotationSpeed.x;
      cube.rotation.y += cube.userData.rotationSpeed.y;
      cube.rotation.z += cube.userData.rotationSpeed.z;
    }
  }

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();
</script>
</body>
</html>
`;
}

// --- Public API ---

export interface ThreeArtworkInput {
  content: string;
  category: string;
  attribution: string;
  source: string;
  sourceUrl: string;
  postUri?: string;
  postAuthor?: string;
  postIndexedAt?: string;
  scrapedAt?: string;
}

export interface ThreeArtworkOutput {
  htmlPath: string;
  metadataPath: string;
  runDir: string;
  voxelCount: number;
  category: string;
}

export async function generateThreeArtwork(
  input: ThreeArtworkInput,
): Promise<ThreeArtworkOutput> {
  const category = input.category in PALETTES ? input.category : "other";
  const palette = PALETTES[category];
  const seed = hashSeed(input.content);

  // Truncate to keep voxel sculpture manageable
  const truncated = input.content.slice(0, 200);
  // Provisional layout to get cellSize, then re-sample using that cellSize
  // so charsPerLine matches the rendered geometry.
  const provisionalLayout = planVoxelLayout(truncated.length, { width: 1, height: 1, pixels: [] });
  const voxel = sampleTextToVoxelsMultiline(truncated, provisionalLayout.cellSize);
  const layout = planVoxelLayout(truncated.length, voxel);

  const id =
    "t_" +
    crypto
      .createHash("sha256")
      .update(input.content.toLowerCase().replace(/[^a-z0-9áéíóúñü]/g, "").slice(0, 200))
      .digest("hex")
      .slice(0, 16);

  const now = new Date();
  const runTimestamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const runDir = path.join(RUNS_DIR, `${runTimestamp}_Petra_2026`);

  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(ARTWORKS_DIR, { recursive: true });

  const html = emitHTML(palette, voxel, layout, seed, {
    id,
    category,
    content: input.content,
  });

  const htmlPath = path.join(runDir, `${id}.html`);
  const metadataPath = path.join(runDir, `${id}.json`);

  fs.writeFileSync(htmlPath, html, "utf-8");

  const metadata = {
    id,
    content: input.content,
    language: detectLanguage(input.content),
    category,
    attribution: input.attribution,
    source: input.source,
    sourceUrl: input.sourceUrl,
    postUri: input.postUri,
    postAuthor: input.postAuthor,
    postIndexedAt: input.postIndexedAt,
    scrapedAt: input.scrapedAt || now.toISOString(),
    artworkGeneratedAt: now.toISOString(),
    voxel: { width: voxel.width, height: voxel.height },
    layout,
    palette,
    path: htmlPath,
    format: "html/three.js/voxel-sculpture",
  };

  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), "utf-8");

  fs.writeFileSync(path.join(ARTWORKS_DIR, `${id}.html`), html, "utf-8");
  fs.writeFileSync(
    path.join(ARTWORKS_DIR, `${id}.json`),
    JSON.stringify(metadata, null, 2),
    "utf-8",
  );

  return {
    htmlPath,
    metadataPath,
    runDir,
    voxelCount: layout.voxelCount,
    category,
  };
}

function detectLanguage(text: string): string {
  if (/[ñáéíóú¿¡]/i.test(text)) return "es";
  if (/[àâçèéêëîïôûùüÿœæ]/i.test(text)) return "fr";
  if (/[äöüß]/i.test(text)) return "de";
  return "en";
}

// --- Self-test ---

if (require.main === module) {
  (async () => {
    const samples: ThreeArtworkInput[] = [
      {
        content: "Calidad del aire en el Valle de Aburrá sigue lejos de lo exigido por la OMS",
        category: "air_pollution",
        attribution: "Anonymous",
        source: "bsky:test",
        sourceUrl: "https://bsky.app/profile/test/post/air",
      },
      {
        content: "Rio Medellín receives untreated sewage from twelve municipalities",
        category: "water_pollution",
        attribution: "Anonymous",
        source: "bsky:test",
        sourceUrl: "https://bsky.app/profile/test/post/water",
      },
      {
        content: "Museo Subacuático de Arte off the coast of Cancún",
        category: "mexico_weird",
        attribution: "Anonymous",
        source: "r/surreal",
        sourceUrl: "https://reddit.com/r/surreal/test",
      },
      {
        content: "Carlos Slim's museum has 66000 pieces but little provenance transparency",
        category: "mexico_weird",
        attribution: "Anonymous",
        source: "r/Art",
        sourceUrl: "https://reddit.com/r/Art/test",
      },
    ];

    for (const s of samples) {
      const out = await generateThreeArtwork(s);
      console.log(
        `✓ Generated [${out.category}] ${out.voxelCount} voxels → ${out.htmlPath}`,
      );
    }
  })();
}
