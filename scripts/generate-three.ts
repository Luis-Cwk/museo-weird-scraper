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

// Truncate so the voxel sculpture fits within a budget of lines x chars/line.
// We break at the last sentence boundary if it falls in the last 40% of the
// slice; otherwise at the last space. Prevents mid-word cuts. If the text
// already fits the budget we return it as-is so short texts aren't truncated.
function smartTruncate(text: string, maxLines: number, maxCharsPerLine: number): string {
  const budget = maxLines * maxCharsPerLine;

  // Defensive: if the text (even a SHORT one) trails off mid-sentence without
  // a closing punctuation mark, cut it back to the last complete sentence.
  // This catches LLM-extracted fragments like "…candidatura de" that end
  // with no period. A complete thought beats a longer fragment.
  if (!/[.!?¿¡]$/.test(text.trim())) {
    const lastBoundary = Math.max(
      text.lastIndexOf(". "),
      text.lastIndexOf("? "),
      text.lastIndexOf("! "),
      text.lastIndexOf("…"),
    );
    if (lastBoundary > text.length * 0.4) {
      text = text.slice(0, lastBoundary + 1).trim();
    }
  }

  if (text.length <= budget) return text;
  const slice = text.slice(0, budget);
  const lastPeriod = Math.max(
    slice.lastIndexOf(". "),
    slice.lastIndexOf("? "),
    slice.lastIndexOf("! "),
  );
  if (lastPeriod > budget * 0.6) return slice.slice(0, lastPeriod + 1);
  const lastSpace = slice.lastIndexOf(" ");
  if (lastSpace > budget * 0.7) return slice.slice(0, lastSpace);
  return slice;
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

// Wrap text into lines that produce a roughly square voxel sculpture. We
// target ~8 lines regardless of text length so the voxel doesn't stack
// vertically for long scraped content. charsPerLine scales with text length,
// capped at 6 (minimum legibility) and 20 (won't overflow the viewport).
function wrappedLines(text: string): string[] {
  // 2026-08-27: budget 14 lines × 25 chars = 350 chars max. The previous
  // hard cap of 14 lines silently dropped the last 1–3 lines of any text
  // whose word-wrap output exceeded that (e.g. 228-char content produced
  // 16 lines but the 15th+16th were discarded). Now we let wordWrap
  // produce as many lines as it needs, then enforce a soft cap only when
  // the text would explode (e.g. very long word causing 50+ lines).
  //
  // The actual line budget is enforced by smartTruncate in
  // generateThreeArtwork, which limits the input to 350 chars. That input
  // yields at most ~16 lines at 17 chars/line (the realistic maximum
  // observed in production). Lines beyond ~22 indicate runaway content
  // (extremely long unbreakable strings) and get truncated.
  const targetLines = 14;
  const maxLinesHardCap = 22;
  const maxCharsPerLine = 25;
  const charsPerLine = Math.max(8, Math.min(maxCharsPerLine, Math.ceil(text.length / targetLines)));
  const all = wordWrap(text, charsPerLine);
  // If the natural wrap fits within the soft target (≤ targetLines), keep
  // everything — the voxel will scale to fit, no truncation needed.
  // If it exceeds the hard cap (> maxLinesHardCap), truncate to the cap.
  // Otherwise (between targetLines and hardCap), let it stand — the
  // voxel is slightly taller than ideal but the entire phrase stays
  // legible. This is the trade-off Petra asked for: complete text > uniform height.
  if (all.length <= maxLinesHardCap) return all;
  return all.slice(0, maxLinesHardCap);
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

// Normalize characters that the 5x7 glyph set doesn't have into ones it does,
// so smart quotes/dashes/ellipses never render as a stray "?" glyph.
// (Added 2026-08-28 with the punctuation/orthography fix.)
// 2026-09-02: track which unsupported chars we've logged so we don't spam.
// Attached as a function property (TS allows this when declared with ` // eslint-disable-next-line @typescript-eslint/no-explicit-any`).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const normalizeForVoxelLogged = new Set<string>();
function normalizeForVoxel(text: string): string {
  return text
    // Curly/smart double quotes + guillemets → straight double quote
    .replace(/[\u201C\u201D\u201E\u00AB\u00BB]/g, '"')
    // Curly single quotes → straight apostrophe
    .replace(/[\u2018\u2019\u201A\u02BB]/g, "'")
    // En/em/em-dash variants → plain hyphen
    .replace(/[\u2013\u2014\u2011\u2012\u2212]/g, "-")
    // Ellipsis → three dots
    .replace(/\u2026/g, "...")
    // Non-breaking space → normal space
    .replace(/\u00A0/g, " ")
    // 2026-09-02: defensive lower-case accents (áéíóúü) → uppercase (ÁÉÍÓÚÜ).
    // Without this, .toUpperCase() later would convert them, but if the
    // glyph set has only uppercase versions, a leftover lowercase accent
    // would silently fall back to "?". The voxel text is rendered uppercase
    // anyway, so we normalize all Spanish accents up-front.
    .replace(/[\u00E1\u00E9\u00ED\u00F3\u00FA\u00FC]/g, (m) => m.toUpperCase())
    // Lowercase ñ → Ñ (same reason; voxel renders uppercase)
    .replace(/\u00F1/g, "\u00D1")
    // Any remaining chars outside the glyph set get logged + replaced with "?"
    // (the fallback glyph). This is a SAFETY NET: in the past, an LLM-extracted
    // text containing rare Unicode (e.g. U+2010 hyphen, U+202F narrow nbsp)
    // would silently render as "?" without anyone noticing. Now we at least
    // record what got stripped so the next round of glyph design can fill gaps.
    .replace(/[^\u00BF\u00A1A-Za-z0-9 .,;:!?\\'"()\-ÁÉÍÓÚÑÜáéíóúñü$%#¿¡]/g, (m) => {
      // Log only the first occurrence per char (don't spam the log)
      const key = `normalizev-unknown-${m.charCodeAt(0).toString(16)}`;
      if (!normalizeForVoxelLogged.has(key)) {
        normalizeForVoxelLogged.add(key);
        // Print a warning so future maintainers see it in the agent log.
        // (console.warn is safe in Node.)
        // eslint-disable-next-line no-console
        console.warn(`normalizeForVoxel: replacing unsupported char U+${m.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")} ("${m}") with "?"`);
      }
      return "?";
    });
}

// Sample a multi-line voxel sculpture: each line stacked vertically.
function sampleTextToVoxelsMultiline(text: string): VoxelGrid {
  const lines = wrappedLines(normalizeForVoxel(text));
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
    "?": [".111.", "1...1", "....1", "...1.", "..1..", ".1...", "..1.."],
    "$": ["..1..", ".1111", "1.1..", ".111.", "..1.1", "1111.", "..1.."],
    "%": ["11..1", "11.1.", "..1..", ".1...", "..1..", ".1.11", "1..11"],
    "#": ["..1.1", "..1.1", "11111", "..1.1", "11111", "..1.1", "..1.1"],
    "Á": ["..1..", ".1.1.", "..1..", ".1.1.", "1...1", "11111", "1...1"],
    "É": ["..1..", "1....", "1....", "111..", "1....", "1....", "11111"],
    "Í": [".1...", "..1..", "..1..", "..1..", "..1..", "..1..", "11111"],
    "Ó": [".1...", ".111.", "1...1", "1...1", "1...1", "1...1", ".111."],
    "Ú": [".1...", "1...1", "1...1", "1...1", "1...1", "1...1", ".111."],
    // --- Punctuation & Spanish chars added 2026-08-28 (ortho/punct fix) ---
    // Before this, any char outside A-Z/0-9/Ñ/ÁÉÍÓÚ/,.!?:? rendered as "?",
    // which is what stomped the quotes in "negacionismo climático", the
    // semicolon in "OMS;", and the opening ¿¡ marks across pieces.
    '"': ["..1.1", "..1.1", ".....", ".....", ".....", ".....", "....."],
    "'": ["..1..", "..1..", ".....", ".....", ".....", ".....", "....."],
    ";": [".....", ".....", "..1..", ".....", ".....", "..1..", ".1..."],
    "-": [".....", ".....", ".....", ".111.", ".....", ".....", "....."],
    "(": ["...1.", "..1..", "..1..", "..1..", "..1..", "..1..", "...1."],
    ")": [".1...", "..1..", "..1..", "..1..", "..1..", "..1..", ".1..."],
    "¿": ["..1..", "...1.", "..1..", ".1.1.", ".1...", "1....", ".111."],
    "¡": ["..1..", ".....", "..1..", "..1..", "..1..", "..1..", "..1.."],
    "Ü": ["1.1.1", "1.1.1", "1...1", "1...1", "1...1", "1...1", ".111."],
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
  // 2026-08-27: added a long-text branch that shrinks the voxel even further
  // when the content is very long (≥ 100 chars → 16+ lines). The previous
  // fixed cellSize=0.26 for anything ≥ 60 chars produced a voxel whose
  // height × width exceeded the camera frustum at common viewport aspect
  // ratios, so the camera clipped off the bottom 1-3 lines. Scaling cellSize
  // down with len keeps the entire sculpture on-screen.
  //
  // Thresholds were chosen empirically by rendering test pieces at different
  // lengths and measuring which cellSize keeps the sculpture fully visible
  // inside the camera's fitToViewport() margin.
  let cellSize: number;
  let depth: number;
  let centerZ: number;
  let voxelCountMultiplier: number;

  if (len < 30) {
    cellSize = 0.45;
    depth = 5;
    centerZ = -1.0;
    voxelCountMultiplier = 5;
  } else if (len < 60) {
    cellSize = 0.30;
    depth = 3;
    centerZ = -0.5;
    voxelCountMultiplier = 3;
  } else if (len < 100) {
    cellSize = 0.26;
    depth = 2;
    centerZ = -0.25;
    voxelCountMultiplier = 2;
  } else if (len < 180) {
    cellSize = 0.20;
    depth = 2;
    centerZ = -0.20;
    voxelCountMultiplier = 2;
  } else if (len < 260) {
    // For 200+ chars we know the wrap produces 14-16 lines; shrink further
    // so the camera frustum at any 16:9 viewport fits everything with the
    // 1.5x breathing-room margin.
    cellSize = 0.16;
    depth = 2;
    centerZ = -0.15;
    voxelCountMultiplier = 2;
  } else {
    // Pathological: very long content (>260 chars). Shrink aggressively.
    cellSize = 0.13;
    depth = 1;
    centerZ = 0;
    voxelCountMultiplier = 1;
  }

  return {
    cellSize,
    depth,
    centerX: -voxel.width * cellSize * 0.5,
    centerY: voxel.height * cellSize * 0.5,
    centerZ,
    voxelCount: voxel.pixels.length * voxelCountMultiplier,
  };
}

// --- HTML emission: self-contained Three.js piece ---

function emitHTML(
  palette: Palette,
  voxel: VoxelGrid,
  layout: VoxelLayout,
  seed: number,
  meta: { id: string; category: string; content: string },
  skyUrl: string = "",
): string {
  const paletteJSON = JSON.stringify(palette).replace(/<\/script/g, "<\\/script");
  const voxelJSON = JSON.stringify({
    width: voxel.width,
    height: voxel.height,
    pixels: voxel.pixels,
  }).replace(/<\/script/g, "<\\/script");
  const layoutJSON = JSON.stringify(layout).replace(/<\/script/g, "<\\/script");
  const metaJSON = JSON.stringify(meta).replace(/<\/script/g, "<\\/script");
  // === MiniMax sky (per-voxel atmospheric panorama, added 2026-08-18) ===
  // If skyUrl is provided, the HTML loader below fetches it and uses it as
  // both scene.background AND envMap (so the metallic voxel reflects the sky).
  // If skyUrl is empty, the voxel renders without envmap (legacy behavior).
  // FLAT-SKY (added 2026-08-24): the sky is rendered as a 2D PlaneGeometry
    // positioned far behind the voxel sculpture, NOT wrapped to a sphere.
    // This eliminates the panorama seam visible in the rotated camera and
    // keeps the sky's real colors without the IBL/EquirectangularReflection
    // "opaco" effect. The plane size is auto-fit at runtime via fitToViewport()
    // (see below) based on the sculpture's bounding box.
    const skyUrlEscaped = skyUrl.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const skyLoaderBlock = skyUrl
      ? `
  import * as THREE from 'three';
  // Sky branch: scene + flat 2D sky plane behind the voxel sculpture.
  const scene = new THREE.Scene();
  const skyTex = new THREE.TextureLoader().load("${skyUrlEscaped}");
  skyTex.colorSpace = THREE.SRGBColorSpace;
  skyTex.minFilter = THREE.LinearFilter;
  skyTex.magFilter = THREE.LinearFilter;
  const skyMat = new THREE.MeshBasicMaterial({
    map: skyTex,
    toneMapped: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const skyMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), skyMat);
  skyMesh.renderOrder = -1;
  scene.add(skyMesh);
  // Lights (no envMap on voxelMat, so we need explicit lights)
  scene.add(new THREE.AmbientLight(0xffffff, 0.65));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(5, 10, 7);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xfff5e8, 0.5);
  fill.position.set(-5, 3, -5);
  scene.add(fill);`
      : `
  import * as THREE from 'three';
  // No-sky branch: only declare scene with background color from palette
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.bg);
  scene.add(new THREE.AmbientLight(0xffffff, 0.65));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(5, 10, 7);
  scene.add(sun);`;

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
${skyLoaderBlock}

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
// (scene declared in skyLoaderBlock; main module extends it with camera/lights)

// Camera positioned so the entire voxel sculpture fits comfortably.
// We compute the required distance from the sculpture's bounding box.
// 'radius' is set by fitToViewport() (called below) and re-computed on resize.
const sculptureWidth = VOXEL.width * LAYOUT.cellSize;
const sculptureHeight = VOXEL.height * LAYOUT.cellSize;
const fovRad = 70 * Math.PI / 180;
const margin = 1.4; // padding around sculpture
let radius = 0; // assigned in fitToViewport

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 500);
// Camera at +Z so the sculpture (which sits at origin facing +Z) reads
// in its natural left-to-right orientation. Camera position is set by
// fitToViewport(); we lookAt origin there.

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
// Voxel material (flat-sky, 2026-08-24): non-metal so IBL doesn't darken the
// surface. envMapIntensity=0 ensures no contamination from the sky plane.
const voxelMat = new THREE.MeshStandardMaterial({
  color: 0xf5f0e8,
  roughness: 0.5,
  metalness: 0.0,
  envMapIntensity: 0,
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

// --- Scene group: holds voxelMesh + decorCubes; rotates as a unit so the
//     camera can stay fixed while the sculpture turns. The sky360 is added
//     directly to scene (NOT to sceneGroup) so it stays fixed behind the
//     camera. This way the equirectangular seam — which lives at theta=0/360
//     in the sky texture — sits permanently behind the camera at theta=180°,
//     which is outside the camera frustum (FOV 70 deg, so it spans about
//     ±35 deg around theta=0). The seam is never visible to the viewer.
//     (Added 2026-08-24 to permanently hide the panorama seam.)
const sceneGroup = new THREE.Group();
sceneGroup.add(voxelMesh);

// --- Decorative cubes REMOVED 2026-08-24 (user no longer wanted them) ---
// To restore them, see git history (commit before 2026-08-24 evening).
const decorCubes = [];
for (let k = 0; k < 0; k++) { /* never executes */ }

// --- AUTO-FIT SYSTEM (added 2026-08-24 for flat-sky) ---
// Compute the camera distance so the voxel sculpture fits with margin on
// both axes. Re-runs on resize. Also sizes the sky plane so it covers the
// frustum at a fixed distance behind the sculpture. Everything is derived
// from the sculpture's bounding box — no hardcoded distances.
const SKY_BEHIND_FACTOR = 2;     // sky plane distance = sculpture distance * factor
const SKY_OVERSIZE = 1.2;        // sky plane is 20% larger than needed

// Resize the sky plane so it covers the camera frustum at the given camera
// distance. Called from fitToViewport() AND from the wheel handler so the sky
// stays full-bleed while the user zooms. (2026-08-24: was only called on
// resize, so zoom-out exposed the dark renderer background.)
function sizeSkyToFrustum(cameraDist) {
  if (typeof skyMesh === 'undefined') return;
  const skyDist = cameraDist * SKY_BEHIND_FACTOR;
  // Preserve the original PNG aspect ratio (2048x1024 = 2:1) when sizing the sky
  // plane, so the sky displays exactly as mmx generated it. Cover the canvas by
  // sizing to the canvas aspect if wider than 2:1, otherwise cover the vertical
  // FOV. This eliminates the "franja vertical desplazada" you see at the canvas
  // edges when the frustum aspect doesn't match the PNG aspect. (2026-08-25)
  const canvasAspect = window.innerWidth / window.innerHeight;
  const PNG_ASPECT = 2;  // 2048 / 1024
  // Pick the dimension that needs to be larger so the sky always covers the canvas
  const skyHeightFromFov = 2 * (cameraDist + skyDist) * Math.tan(fovRad / 2);
  const skyWidthFromFov  = skyHeightFromFov * canvasAspect;
  const skyHeightFromAspect = skyWidthFromFov / PNG_ASPECT;
  const skyHeight = Math.max(skyHeightFromFov, skyHeightFromAspect);
  const skyWidth  = skyHeight * PNG_ASPECT;
  skyMesh.geometry.dispose();
  skyMesh.geometry = new THREE.PlaneGeometry(skyWidth, skyHeight);
  skyMesh.position.set(0, 0, -skyDist);
  skyMesh.updateMatrixWorld(true);
}

function fitToViewport() {
  const aspect = window.innerWidth / window.innerHeight;
  camera.aspect = aspect;
  camera.updateProjectionMatrix();

  const hFov = 2 * Math.atan(Math.tan(fovRad / 2) * aspect);
  const distForWidth = (sculptureWidth * 0.5 * margin) / Math.tan(hFov / 2);
  const distForHeight = (sculptureHeight * 0.5 * margin) / Math.tan(fovRad / 2);
  radius = Math.max(distForWidth, distForHeight, 6);

  camera.position.set(0, 0, radius);
  camera.lookAt(0, 0, 0);

  sizeSkyToFrustum(radius);

  // Decor cubes (added 2026-08-24): distributed in 3D around the sculpture —
    // BOTH in front of AND behind the voxel (so they fill the space, not pile
    // up on one side). Deterministic per-index placement so resize doesn't
    // shuffle them. Spread scaled to the sculpture bounds.
    const cubeSpread = Math.max(sculptureWidth, sculptureHeight) * 0.9;
    for (let i = 0; i < decorCubes.length; i++) {
      const cube = decorCubes[i];
      // Use 3 different golden-ratio multipliers per axis for even distribution
      const seed = i * 0.6180339887;
      const fx = ((seed * 13.37) % 1) - 0.5;
      const fy = ((seed * 7.91) % 1) - 0.5;
      const fz = ((seed * 3.13) % 1) - 0.5;
      cube.position.set(
        fx * cubeSpread * 2,
        fy * cubeSpread * 1.4,
        fz * radius * 0.7,  // z range: -radius*0.35 to +radius*0.35, so cubes are both behind AND in front of voxel
      );
    }
  }
fitToViewport();
window.addEventListener('resize', fitToViewport);

// --- Add sceneGroup to scene so its children render.
//     Camera stays fixed at theta=0 looking at the origin; sceneGroup rotates
//     around Y, so the voxel+decorCubes turn in front of the camera. The
//     sky360 stays put, so the panorama seam (theta=0/360 in the texture) is
//     permanently behind the camera at theta=180° — outside the camera's
//     frustum and never visible. (Added 2026-08-24 to permanently hide the
//     panorama seam.)
scene.add(sceneGroup);

// --- Fixed camera placement ---
//     theta=0 puts the camera on the +Z axis looking at the origin, which
//     matches the natural "first frame" of the voxel sculpture (text reads
//     left-to-right). No animation; the camera is locked here.
camera.position.set(0, 0, radius);
camera.lookAt(0, 0, 0);

// --- Pulse state for voxel sculpture ---
let pulsePhase = 0;

// --- Auto-rotation for the scene group (voxel + decorCubes orbit together) ---
//     Slowed from 0.005 to 0.0025 on 2026-08-24 — user reported the previous
//     speed felt rushed. 0.0025 rad/frame is a gentle turntable.
const AUTO_YAW_SPEED = 0.0025; // radians per frame

// --- Manual rotation control (added 2026-08-24) ---
//     The user can drag with the mouse to rotate sceneGroup.rotation.y on
//     top of the auto-rotation. We use raw pointer events on the canvas
//     instead of OrbitControls because OrbitControls moves the camera, and
//     we need the camera to stay locked so the sky360 doesn't shift and
//     expose the panorama seam. Zoom is implemented via wheel events.
let isDragging = false;
let lastPointerX = 0;
const MANUAL_YAW_SENSITIVITY = 0.005; // radians per pixel of drag
const WHEEL_ZOOM_SENSITIVITY = 0.001;

const canvas = renderer.domElement;
canvas.style.cursor = "grab";
canvas.addEventListener("pointerdown", (e) => {
  isDragging = true;
  lastPointerX = e.clientX;
  canvas.style.cursor = "grabbing";
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointermove", (e) => {
  if (!isDragging) return;
  const dx = e.clientX - lastPointerX;
  lastPointerX = e.clientX;
  sceneGroup.rotation.y += dx * MANUAL_YAW_SENSITIVITY;
});
canvas.addEventListener("pointerup", (e) => {
  isDragging = false;
  canvas.style.cursor = "grab";
  try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
});
canvas.addEventListener("pointercancel", () => {
  isDragging = false;
  canvas.style.cursor = "grab";
});
canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  // Move camera along its forward axis (which is -Z from camera.position).
  // We never change camera.position.x or .y, only .z, so the camera stays
  // on the Z axis and the sky360 seam stays hidden behind it.
  const forward = new THREE.Vector3(0, 0, -1);
  const dist = camera.position.distanceTo(controls_target); // = radius
  const newDist = Math.max(radius * 0.4, Math.min(radius * 2.0, dist + e.deltaY * WHEEL_ZOOM_SENSITIVITY * dist));
  camera.position.set(0, 0, newDist);
  // Resize sky plane so it still covers the frustum at the new distance.
  sizeSkyToFrustum(newDist);
}, { passive: false });
const controls_target = new THREE.Vector3(0, 0, 0);

// --- Render loop ---
function animate() {
  // No auto-rotation of sceneGroup (removed 2026-08-24 — user reported it
  // felt rushed). Only the user's manual drag rotates the sculpture.
  // Pulse on the voxel mesh (subtle breathing) stays as a sign of life.

  pulsePhase += 0.01;
  const pulse = 1 + Math.sin(pulsePhase) * 0.05;
  voxelMesh.scale.set(pulse, pulse, pulse);

  for (const cube of decorCubes) {
    if (cube.userData.rotationSpeed) {
      // Slowed down by 10x on 2026-08-24 — user reported the original
      // per-cube rotation was too fast.
      cube.rotation.x += cube.userData.rotationSpeed.x * 0.1;
      cube.rotation.y += cube.userData.rotationSpeed.y * 0.1;
      cube.rotation.z += cube.userData.rotationSpeed.z * 0.1;
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
  /** MiniMax-generated atmospheric panorama URL (added 2026-08-18).
   *  When provided, the HTML uses it as scene.background AND envMap.
   *  When empty, the voxel renders with no envmap (legacy).
   *  Path is relative (e.g. "textures/sky-9.png"); agent.js prepends the host. */
  skyUrl?: string;
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

  // Smart-truncate so the voxel fits within the line budget used by
  // wrappedLines below (14 lines × 25 chars/line = 350 chars max). Short
  // texts are returned untouched. Long texts (>350 chars) get trimmed to
  // the last sentence boundary within budget so we don't cut mid-word.
  //
  // 2026-08-27: budget raised from 8×20=160 → 14×25=350 because 3/8 of the
  // first batch of v6 NFTs were silently losing 30–70 chars of curated text
  // (the END of each phrase). See wrappedLines() below for context.
  const truncated = smartTruncate(input.content, 14, 25);
  const voxel = sampleTextToVoxelsMultiline(truncated);
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
  }, input.skyUrl || "");

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
  if (/[ñáéíóú$%#¿¡]/i.test(text)) return "es";
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
