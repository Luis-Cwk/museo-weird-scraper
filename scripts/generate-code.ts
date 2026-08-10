import fs from "fs";
import path from "path";
import crypto from "crypto";

/**
 * HUACA, SISTEMAS MÁGICOS — Generative Code Art Generator
 *
 * Replaces the SVG generator with an HTML+Canvas2D+WebGL pipeline that
 * produces self-contained, animated HTML per piece. Compatible with:
 *   - Our own viewer (`weird-museo.html`) via <iframe src="...html">
 *   - OpenSea `animation_url` (HTML pages with scripts and relative paths
 *     are explicitly supported per docs.opensea.io/docs/media-and-traits)
 *   - IPFS gateways with HTML preview
 *
 * Visual direction: text rides a procedural flow field (Perlin-derived
 * curl-noise), deforming live while staying readable. Background is
 * dynamic per category (dark for environmental crisis, light for
 * museum/curatorial categories).
 *
 * Categories (active, 4):
 *   - mexico_weird     : light bg, archive/editorial mood
 *   - medellin_weird   : light bg, archive/editorial mood
 *   - air_pollution    : dark bg, projection/cartel mood
 *   - water_pollution  : dark bg, projection/cartel mood
 *
 * Output:
 *   - <id>.html : self-contained artwork, runs anywhere HTML renders
 *   - <id>.json : metadata (original URL, author, timestamp, category, layout)
 */

const ARTWORKS_DIR = path.join(__dirname, "..", "data", "artworks");
const RUNS_DIR = path.join(__dirname, "..", "data", "runs");

// --- Category palettes (4 active) ---

type Mood = "light" | "dark";

interface Palette {
  bg: string;
  fg: string;       // text primary
  accent: string;   // text secondary / marks
  glow: string;     // particle / glow tint
  ink: string;      // text-on-light variant
  mood: Mood;
  label: string;    // category chip in viewer
}

const PALETTES: Record<string, Palette> = {
  // Legacy museum categories (Mexico + Medellín), light archival mood
  mexico_weird: {
    bg: "#f4efe6",
    fg: "#1a1a1a",
    accent: "#7a3b2e",
    glow: "#c2410c",
    ink: "#1a1a1a",
    mood: "light",
    label: "MUSEO WEIRD · MÉXICO",
  },
  medellin_weird: {
    bg: "#f1ece4",
    fg: "#1a1a1a",
    accent: "#5b3a29",
    glow: "#a0522d",
    ink: "#1a1a1a",
    mood: "light",
    label: "MUSEO WEIRD · MEDELLÍN",
  },
  // Environmental crisis categories, dark projection mood
  air_pollution: {
    bg: "#0a0a0a",
    fg: "#ff7a1a",
    accent: "#cc4d00",
    glow: "#ff6b00",
    ink: "#0a0a0a",
    mood: "dark",
    label: "AIRE · MEDELLÍN",
  },
  water_pollution: {
    bg: "#070d18",
    fg: "#6fb8e0",
    accent: "#225a85",
    glow: "#88aacc",
    ink: "#070d18",
    mood: "dark",
    label: "AGUA · ABURRÁ",
  },
  // Fallback
  other: {
    bg: "#0e0e0e",
    fg: "#e0e0e0",
    accent: "#888888",
    glow: "#aaaaaa",
    ink: "#0e0e0e",
    mood: "dark",
    label: "HUACA",
  },
};

// --- Seeded RNG (Mulberry32) for deterministic flow field ---

// Mulberry32 is duplicated inside the emitted HTML so each piece is fully
// self-contained. Keeping the server-side RNG out of the runtime keeps the
// emitted HTML smaller. (TS server-side version is unused so we drop it.)
function hashSeed(text: string): number {
  const h = crypto.createHash("sha256")
    .update(text.toLowerCase().replace(/[^a-z0-9áéíóúñü]/g, ""))
    .digest("hex");
  return parseInt(h.slice(0, 8), 16);
}

// --- Layouts: where text gets placed on the canvas ---

interface LayoutPlan {
  name: string;
  width: number;
  height: number;
  // Lines of text + per-line font size in CSS px
  lines: { text: string; size: number; weight: number; font: string }[];
  // Anchor for the first line (others stack below or relative to)
  anchor: "center" | "left";
  startX: number;
  startY: number;
  lineGap: number;
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

function planLayout(
  text: string,
  _category: string,
  fonts: { body: string; display: string },
): LayoutPlan {
  // Seed layout selection by content hash so the same text gets the same layout
  const seed = hashSeed(text);
  const layoutIdx = seed % 4;
  const W = 800;
  const H = 600;

  if (layoutIdx === 0) {
    // Stacked centered (poster)
    const lines = wordWrap(text, 32);
    const size = lines.length <= 2 ? 48 : lines.length <= 4 ? 38 : 30;
    return {
      name: "stacked",
      width: W,
      height: H,
      lines: lines.map((t) => ({
        text: t.toUpperCase(),
        size,
        weight: 700,
        font: fonts.body,
      })),
      anchor: "center",
      startX: W / 2,
      startY: 220,
      lineGap: size * 1.15,
    };
  }

  if (layoutIdx === 1) {
    // Asymmetric: first word as huge display, body below
    const lines = wordWrap(text, 26);
    const firstWord = (lines[0] || "X").split(" ")[0] || "X";
    const rest = lines.join(" ").substring(firstWord.length).trim();
    const bodyLines = wordWrap(rest, 32);
    return {
      name: "asymmetric",
      width: W,
      height: H,
      lines: [
        { text: firstWord.toUpperCase(), size: 120, weight: 900, font: fonts.display },
        ...bodyLines.map((t) => ({
          text: t.toUpperCase(),
          size: 22,
          weight: 600,
          font: fonts.body,
        })),
      ],
      anchor: "left",
      startX: 60,
      startY: 180,
      lineGap: 34,
    };
  }

  if (layoutIdx === 2) {
    // Fragmented: words scattered with controlled jitter (computed at runtime)
    const words = text.split(/\s+/).filter(Boolean);
    return {
      name: "fragmented",
      width: W,
      height: H,
      lines: words.map((w) => ({
        text: w.toUpperCase(),
        size: 36,
        weight: 800,
        font: fonts.body,
      })),
      anchor: "left",
      startX: 0,
      startY: 0,
      lineGap: 0,
    };
  }

  // Vertical column
  const lines = wordWrap(text, 20);
  return {
    name: "vertical",
    width: 560,
    height: 800,
    lines: lines.map((t) => ({
      text: t.toUpperCase(),
      size: 28,
      weight: 700,
      font: fonts.body,
    })),
    anchor: "center",
    startX: 280,
    startY: 140,
    lineGap: 42,
  };
}

// --- HTML emission: full self-contained doc per piece ---

function emitHTML(
  palette: Palette,
  layout: LayoutPlan,
  seed: number,
  meta: { id: string; category: string; content: string; source: string },
): string {
  // Layout config JSON for the script
  const layoutJSON = JSON.stringify({
    name: layout.name,
    width: layout.width,
    height: layout.height,
    anchor: layout.anchor,
    startX: layout.startX,
    startY: layout.startY,
    lineGap: layout.lineGap,
    lines: layout.lines,
  }).replace(/<\/script/g, "<\\/script");

  const paletteJSON = JSON.stringify({
    bg: palette.bg,
    fg: palette.fg,
    accent: palette.accent,
    glow: palette.glow,
    mood: palette.mood,
    label: palette.label,
  });

  const metaJSON = JSON.stringify(meta).replace(/<\/script/g, "<\\/script");

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
<canvas id="c"></canvas>
<div class="meta">${palette.label}</div>
<div class="meta right">№ ${meta.id.slice(0, 6).toUpperCase()}</div>
<script>
(() => {
  const LAYOUT = ${layoutJSON};
  const PALETTE = ${paletteJSON};
  const META = ${metaJSON};
  const SEED = ${seed};

  // --- Seeded RNG ---
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

  // --- Flow field: deterministic angle noise ---
  // Build a coarse grid of angles, then sample with bilinear interp.
  const GRID = 24;
  const field = new Float32Array(GRID * GRID);
  for (let i = 0; i < field.length; i++) field[i] = rng() * Math.PI * 2;

  function angleAt(x, y, t) {
    const u = (x / LAYOUT.width) * (GRID - 1);
    const v = (y / LAYOUT.height) * (GRID - 1);
    const i0 = Math.floor(u), j0 = Math.floor(v);
    const i1 = Math.min(i0 + 1, GRID - 1);
    const j1 = Math.min(j0 + 1, GRID - 1);
    const fx = u - i0, fy = v - j0;
    const a = field[j0 * GRID + i0];
    const b = field[j0 * GRID + i1];
    const c = field[j1 * GRID + i0];
    const d = field[j1 * GRID + i1];
    const ab = a + (b - a) * fx;
    const cd = c + (d - c) * fx;
    const base = ab + (cd - ab) * fy;
    // Slow temporal drift so the field breathes
    return base + Math.sin(t * 0.0003) * 0.3;
  }

  // --- Canvas setup with DPR cap ---
  const cvs = document.getElementById("c");
  const ctx = cvs.getContext("2d");
  let DPR = Math.min(window.devicePixelRatio || 1, 1.5);

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 1.5);
    cvs.width = LAYOUT.width * DPR;
    cvs.height = LAYOUT.height * DPR;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  resize();
  window.addEventListener("resize", resize);

  // --- Per-word state for fragmented layout ---
  // Each "glyph cluster" carries its base position and per-frame offset
  // derived from the flow field. Non-fragmented layouts just animate as
  // a single block following the field at one anchor point.
  const fragments = [];
  if (LAYOUT.name === "fragmented") {
    const cols = 3;
    for (let i = 0; i < LAYOUT.lines.length; i++) {
      const row = Math.floor(i / cols);
      const col = i % cols;
      const baseX = 60 + col * 240 + rng() * 20;
      const baseY = 120 + row * 90 + rng() * 20;
      const rot = (rng() - 0.5) * 0.18;
      fragments.push({ ...LAYOUT.lines[i], baseX, baseY, rot, phase: rng() * 1000 });
    }
  }

  // --- Render loop ---
  function frame(t) {
    // Background: subtle vignette over solid bg (no shader needed for portability)
    ctx.fillStyle = PALETTE.bg;
    ctx.fillRect(0, 0, LAYOUT.width, LAYOUT.height);

    // Soft inner vignette using radial gradient
    const grad = ctx.createRadialGradient(
      LAYOUT.width / 2, LAYOUT.height / 2, LAYOUT.width * 0.2,
      LAYOUT.width / 2, LAYOUT.height / 2, LAYOUT.width * 0.75,
    );
    if (PALETTE.mood === "dark") {
      grad.addColorStop(0, "rgba(0,0,0,0)");
      grad.addColorStop(1, "rgba(0,0,0,0.55)");
    } else {
      grad.addColorStop(0, "rgba(255,255,255,0)");
      grad.addColorStop(1, "rgba(0,0,0,0.12)");
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, LAYOUT.width, LAYOUT.height);

    // Particles drifting along the flow field (subtle ambient layer)
    const particles = 24;
    for (let i = 0; i < particles; i++) {
      const px = ((SEED * (i + 1) * 53) % LAYOUT.width);
      const py = ((SEED * (i + 1) * 37 + 11) % LAYOUT.height);
      const a = angleAt(px, py, t);
      const jitter = Math.sin(t * 0.0008 + i) * 12;
      const x = px + Math.cos(a) * jitter;
      const y = py + Math.sin(a) * jitter;
      const r = 0.8 + ((i * 7) % 3) * 0.4;
      ctx.fillStyle = PALETTE.accent;
      ctx.globalAlpha = 0.15 + (i % 4) * 0.04;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Text rendering
    ctx.fillStyle = PALETTE.fg;
    ctx.textBaseline = "middle";

    if (LAYOUT.name === "fragmented") {
      for (const f of fragments) {
        const a = angleAt(f.baseX, f.baseY, t);
        const drift = Math.sin(t * 0.0009 + f.phase) * 6;
        const x = f.baseX + Math.cos(a) * drift;
        const y = f.baseY + Math.sin(a) * drift;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(f.rot + a * 0.05);
        ctx.font = \`\${f.weight} \${f.size}px \${f.font}\`;
        ctx.textAlign = "left";
        ctx.fillText(f.text, 0, 0);
        ctx.restore();
      }
    } else {
      // Block layouts: anchor drifts with the field at its center
      const a = angleAt(LAYOUT.startX, LAYOUT.startY, t);
      const drift = Math.sin(t * 0.0009) * 4;
      ctx.save();
      ctx.translate(LAYOUT.startX, LAYOUT.startY);
      ctx.translate(Math.cos(a) * drift, Math.sin(a) * drift);
      ctx.textAlign = LAYOUT.anchor === "center" ? "center" : "left";

      // Display the first line at its base position; subsequent lines stack
      for (let i = 0; i < LAYOUT.lines.length; i++) {
        const ln = LAYOUT.lines[i];
        ctx.font = \`\${ln.weight} \${ln.size}px \${ln.font}\`;
        const y = (i === 0 ? 0 : LAYOUT.lineGap * i);
        ctx.fillText(ln.text, 0, y);
      }
      ctx.restore();
    }

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
</script>
</body>
</html>
`;
}

// --- Public API ---

export interface CodeArtworkInput {
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

export interface CodeArtworkOutput {
  htmlPath: string;
  metadataPath: string;
  runDir: string;
  layoutName: string;
  category: string;
}

export async function generateCodeArtwork(
  input: CodeArtworkInput,
): Promise<CodeArtworkOutput> {
  const category = input.category in PALETTES ? input.category : "other";
  const palette = PALETTES[category];
  const seed = hashSeed(input.content);

  // Font selection: keep system-font only for true portability
  const fonts = {
    body: "Georgia, 'Times New Roman', serif",
    display: "Impact, 'Arial Black', sans-serif",
  };

  const layout = planLayout(input.content, category, fonts);

  const id =
    "h_" +
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

  const html = emitHTML(palette, layout, seed, {
    id,
    category,
    content: input.content,
    source: input.source,
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
    layout: layout.name,
    palette,
    dimensions: { width: layout.width, height: layout.height },
    path: htmlPath,
    format: "html/canvas2d+flow-field",
  };

  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), "utf-8");

  // Canonical copy for backwards compat with existing pipelines
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
    layoutName: layout.name,
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
    const samples: CodeArtworkInput[] = [
      {
        content: "Calidad del aire en el Valle de Aburrá sigue lejos de lo exigido por la OMS",
        category: "air_pollution",
        attribution: "Anonymous",
        source: "bsky:test",
        sourceUrl: "https://bsky.app/profile/test/post/air",
      },
      {
        content: "Rio Medellín receives untreated sewage from twelve municipalities despite court orders dating back to 2019",
        category: "water_pollution",
        attribution: "Anonymous",
        source: "bsky:test",
        sourceUrl: "https://bsky.app/profile/test/post/water",
      },
      {
        content: "The Museo Subacuático de Arte off the coast of Cancún has over 500 life-size sculptures submerged underwater",
        category: "mexico_weird",
        attribution: "Anonymous",
        source: "r/surreal",
        sourceUrl: "https://reddit.com/r/surreal/test",
      },
      {
        content: "Carlos Slim's museum has over 66,000 pieces but very little transparency about provenance",
        category: "mexico_weird",
        attribution: "Anonymous",
        source: "r/Art",
        sourceUrl: "https://reddit.com/r/Art/test",
      },
    ];

    for (const s of samples) {
      const out = await generateCodeArtwork(s);
      console.log(
        `✓ Generated [${out.category}] ${out.layoutName.padEnd(12)} → ${out.htmlPath}`,
      );
    }
  })();
}
