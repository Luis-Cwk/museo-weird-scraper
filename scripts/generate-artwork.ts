import fs from "fs";
import path from "path";
import crypto from "crypto";

/**
 * MUSEO WEIRD — Typographic Art Generator
 *
 * Generates confrontational typographic SVG art from extracted text content.
 * Pure typography + procedural backgrounds — no external image generation.
 *
 * Layouts vary by category and content length so no two pieces look identical.
 * All text is rendered in the original language of the source post.
 *
 * Output:
 *   - <id>.svg — the artwork
 *   - <id>.json — metadata (original URL, author, timestamp, category)
 */

const ARTWORKS_DIR = path.join(__dirname, "..", "data", "artworks");
const RUNS_DIR = path.join(__dirname, "..", "data", "runs");

// --- Color palettes per category (Medellín climate crisis themes) ---

interface Palette {
  bg: string;
  fg: string;
  accent: string;
  noise: string;
}

const PALETTES: Record<string, Palette> = {
  // New: Medellín climate crisis
  air_pollution: { bg: "#0a0a0a", fg: "#ff6b00", accent: "#cc4400", noise: "#331a00" },
  water_pollution: { bg: "#0a0f1a", fg: "#88aacc", accent: "#225588", noise: "#0a1a2a" },
  flooding: { bg: "#0a1a0a", fg: "#00dd88", accent: "#006644", noise: "#0a2a1a" },
  landslide: { bg: "#1a0a0a", fg: "#cc6633", accent: "#663300", noise: "#2a0a0a" },
  biodiversity_loss: { bg: "#0a1a0a", fg: "#88dd44", accent: "#446622", noise: "#1a2a0a" },
  denialism: { bg: "#1a1a0a", fg: "#dddd99", accent: "#666633", noise: "#2a2a1a" },
  corruption: { bg: "#0a1a0a", fg: "#00ff88", accent: "#006400", noise: "#0a2a0a" },
  infrastructure: { bg: "#1a1a1a", fg: "#aaaaaa", accent: "#555555", noise: "#2a2a2a" },
  social_conflict: { bg: "#1a0a1a", fg: "#ff44aa", accent: "#882244", noise: "#2a0a1a" },
  disaster_response: { bg: "#0a0a1a", fg: "#ffaa00", accent: "#664400", noise: "#1a0a0a" },
  // Legacy: museo weird
  theft: { bg: "#1a0a0a", fg: "#ff4444", accent: "#8b0000", noise: "#330a0a" },
  trafficking: { bg: "#0a0a1a", fg: "#ff6b35", accent: "#8b4513", noise: "#1a0a0a" },
  censorship: { bg: "#0a0a0a", fg: "#ffffff", accent: "#333333", noise: "#1a1a1a" },
  surreal: { bg: "#1a0a2e", fg: "#e040fb", accent: "#7c4dff", noise: "#0a0a1a" },
  ritual: { bg: "#1a1a0a", fg: "#ffd700", accent: "#8b6914", noise: "#2a2a0a" },
  abandonment: { bg: "#1a1a1a", fg: "#888888", accent: "#444444", noise: "#2a2a2a" },
  narco: { bg: "#0a0a0a", fg: "#ff0000", accent: "#330000", noise: "#1a0000" },
  colonial: { bg: "#2e1a0a", fg: "#d4a574", accent: "#8b4513", noise: "#3a1a0a" },
  remains: { bg: "#0a0a0a", fg: "#cccccc", accent: "#555555", noise: "#1a1a1a" },
  black_market: { bg: "#0a0a0a", fg: "#ffaa00", accent: "#664400", noise: "#1a0a00" },
  gender_violence: { bg: "#1a0a0a", fg: "#ff66cc", accent: "#883366", noise: "#2a0a1a" },
  other: { bg: "#0a0a0a", fg: "#ffffff", accent: "#333333", noise: "#1a1a1a" },
};

const FONT_STACKS = [
  "'Courier New', 'Courier', monospace",
  "'Georgia', 'Times New Roman', serif",
  "'Impact', 'Arial Black', sans-serif",
  "'Trebuchet MS', 'Helvetica', sans-serif",
  "'Palatino', 'Palatino Linotype', serif",
  "'Lucida Console', monospace",
];

// --- Procedural noise background ---

function noisePattern(seed: number, color: string, density = 80): string {
  // Deterministic pseudo-random based on seed
  let rng = seed;
  const random = () => {
    rng = (rng * 9301 + 49297) % 233280;
    return rng / 233280;
  };

  const dots: string[] = [];
  for (let i = 0; i < density; i++) {
    const cx = Math.floor(random() * 600);
    const cy = Math.floor(random() * 1000);
    const r = random() < 0.85 ? 1 : 2;
    const opacity = (random() * 0.4 + 0.1).toFixed(2);
    dots.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" opacity="${opacity}"/>`);
  }
  return dots.join("");
}

function scanlines(width: number, height: number, color: string): string {
  const lines: string[] = [];
  for (let y = 0; y < height; y += 4) {
    lines.push(`<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="${color}" stroke-width="0.5" opacity="0.15"/>`);
  }
  return lines.join("");
}

// --- Layout strategies ---

type LayoutFn = (text: string, palette: Palette, fonts: { body: string; display: string }) => {
  width: number;
  height: number;
  body: string;
};

function wordWrap(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if ((current + " " + word).trim().length > maxChars && current) {
      lines.push(current.trim());
      current = word;
    } else {
      current = (current + " " + word).trim();
    }
  }
  if (current) lines.push(current);
  return lines;
}

// Layout 1: Stacked centered (classic poster)
function layoutStacked(text: string, palette: Palette, fonts: { body: string; display: string }) {
  const lines = wordWrap(text, 28);
  const lineHeight = 38;
  const width = 600;
  const height = Math.max(420, lines.length * lineHeight + 160);
  const fontSize = lines.length <= 2 ? 36 : lines.length <= 4 ? 30 : 24;

  const textElements = lines.map((line, i) => {
    const y = 100 + i * lineHeight;
    return `<text x="${width / 2}" y="${y}" text-anchor="middle" fill="${palette.fg}" font-family="${fonts.body}" font-size="${fontSize}" font-weight="bold" letter-spacing="${fontSize > 30 ? 2 : 0}">${escapeXml(line.toUpperCase())}</text>`;
  }).join("\n");

  return {
    width,
    height,
    body: `
      <!-- fondo transparente intencional: el viewer proyecta shader -->
      ${noisePattern(text.length + lines.length, palette.noise, 100)}
      <rect x="20" y="20" width="${width - 40}" height="${height - 40}" fill="none" stroke="${palette.accent}" stroke-width="1"/>
      <text x="${width / 2}" y="55" text-anchor="middle" fill="${palette.accent}" font-family="${fonts.display}" font-size="11" letter-spacing="6">M U S E O   W E I R D</text>
      <line x1="200" y1="70" x2="400" y2="70" stroke="${palette.accent}" stroke-width="0.5"/>
      ${textElements}
      <text x="${width / 2}" y="${height - 30}" text-anchor="middle" fill="${palette.accent}" font-family="${fonts.display}" font-size="9" letter-spacing="3">${escapeXml(categoryLabel(text))}</text>
    `,
  };
}

// Layout 2: Asymmetric left-aligned with display font
function layoutAsymmetric(text: string, palette: Palette, fonts: { body: string; display: string }) {
  const lines = wordWrap(text, 22);
  const width = 600;
  const height = Math.max(480, lines.length * 50 + 200);
  const displayFontSize = 96;
  const bodyFontSize = lines.length <= 3 ? 28 : 22;

  // First word as huge display text
  const firstWord = (lines[0] || "").split(" ")[0] || "X";
  const remaining = lines.join(" ").substring(firstWord.length).trim();

  const bodyLines = wordWrap(remaining, 24);
  const bodyElements = bodyLines.map((line, i) => {
    const y = 220 + i * 36;
    return `<text x="50" y="${y}" fill="${palette.fg}" font-family="${fonts.body}" font-size="${bodyFontSize}" font-weight="bold">${escapeXml(line.toUpperCase())}</text>`;
  }).join("\n");

  return {
    width,
    height,
    body: `
      <!-- fondo transparente intencional: el viewer proyecta shader -->
      ${scanlines(width, height, palette.noise)}
      <text x="50" y="140" fill="${palette.fg}" font-family="${fonts.display}" font-size="${displayFontSize}" font-weight="900" letter-spacing="-2">${escapeXml(firstWord.toUpperCase())}</text>
      <line x1="50" y1="170" x2="${width - 50}" y2="170" stroke="${palette.accent}" stroke-width="2"/>
      ${bodyElements}
      <text x="50" y="${height - 40}" fill="${palette.accent}" font-family="${fonts.display}" font-size="10" letter-spacing="4">MUSEO WEIRD · ${escapeXml(categoryLabel(text))}</text>
      <text x="${width - 50}" y="${height - 40}" text-anchor="end" fill="${palette.accent}" font-family="${fonts.display}" font-size="10" letter-spacing="4">№ ${hashShort(text)}</text>
    `,
  };
}

// Layout 3: Diagonal / fragmented
function layoutFragmented(text: string, palette: Palette, fonts: { body: string; display: string }) {
  const words = text.split(/\s+/).filter(Boolean);
  const width = 600;
  const rows = Math.ceil(words.length / 3);
  const height = Math.max(500, rows * 110 + 80);
  const fontSize = 38;

  let rng = text.length * 7;
  const random = () => {
    rng = (rng * 9301 + 49297) % 233280;
    return rng / 233280;
  };

  const wordElements = words.map((word, i) => {
    const row = Math.floor(i / 3);
    const col = i % 3;
    const x = 50 + col * 180 + random() * 30;
    const y = 90 + row * 100 + random() * 20;
    const rot = (random() - 0.5) * 8;
    const sizeVariant = fontSize + (random() - 0.5) * 12;
    return `<text x="${x}" y="${y}" fill="${palette.fg}" font-family="${fonts.body}" font-size="${sizeVariant}" font-weight="900" transform="rotate(${rot} ${x} ${y})">${escapeXml(word.toUpperCase())}</text>`;
  }).join("\n");

  return {
    width,
    height,
    body: `
      <!-- fondo transparente intencional: el viewer proyecta shader -->
      ${noisePattern(text.length * 3, palette.noise, 60)}
      <line x1="0" y1="40" x2="${width}" y2="40" stroke="${palette.accent}" stroke-width="0.5"/>
      <text x="20" y="30" fill="${palette.accent}" font-family="${fonts.display}" font-size="10" letter-spacing="3">MUSEO WEIRD</text>
      <text x="${width - 20}" y="30" text-anchor="end" fill="${palette.accent}" font-family="${fonts.display}" font-size="10" letter-spacing="3">${escapeXml(categoryLabel(text))}</text>
      ${wordElements}
      <line x1="0" y1="${height - 40}" x2="${width}" y2="${height - 40}" stroke="${palette.accent}" stroke-width="0.5"/>
      <text x="${width / 2}" y="${height - 20}" text-anchor="middle" fill="${palette.accent}" font-family="${fonts.display}" font-size="9" letter-spacing="3">№ ${hashShort(text)}</text>
    `,
  };
}

// Layout 4: Vertical column (for short punchy text)
function layoutVertical(text: string, palette: Palette, fonts: { body: string; display: string }) {
  const lines = wordWrap(text, 18);
  const width = 480;
  const lineHeight = 44;
  const height = Math.max(700, lines.length * lineHeight + 160);
  const fontSize = 26;

  const textElements = lines.map((line, i) => {
    const y = 100 + i * lineHeight;
    return `<text x="${width / 2}" y="${y}" text-anchor="middle" fill="${palette.fg}" font-family="${fonts.body}" font-size="${fontSize}" font-weight="bold">${escapeXml(line.toUpperCase())}</text>`;
  }).join("\n");

  return {
    width,
    height,
    body: `
      <!-- fondo transparente intencional: el viewer proyecta shader -->
      ${scanlines(width, height, palette.noise)}
      <rect x="40" y="40" width="${width - 80}" height="${height - 80}" fill="none" stroke="${palette.accent}" stroke-width="0.5"/>
      <rect x="60" y="60" width="${width - 120}" height="${height - 120}" fill="none" stroke="${palette.accent}" stroke-width="0.5"/>
      <text x="${width / 2}" y="${height - 30}" text-anchor="middle" fill="${palette.accent}" font-family="${fonts.display}" font-size="9" letter-spacing="4">M W · ${escapeXml(categoryLabel(text))} · ${hashShort(text)}</text>
      ${textElements}
    `,
  };
}

// --- Layout selection ---

const LAYOUTS: LayoutFn[] = [layoutStacked, layoutAsymmetric, layoutFragmented, layoutVertical];

function pickLayout(text: string): LayoutFn {
  let seed = text.length;
  for (let i = 0; i < text.length; i++) seed = (seed + text.charCodeAt(i)) % 233280;
  const idx = seed % LAYOUTS.length;
  return LAYOUTS[idx];
}

function pickFonts(seed: number): { body: string; display: string } {
  let s = seed;
  const r = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  return {
    body: FONT_STACKS[Math.floor(r() * FONT_STACKS.length)],
    display: FONT_STACKS[Math.floor(r() * FONT_STACKS.length)],
  };
}

function hashShort(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 6).toUpperCase();
}

function categoryLabel(_text: string): string {
  // Just a placeholder; the actual category comes from the caller
  return "EXTRACTED";
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// --- Public API ---

export interface ArtworkInput {
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

export interface ArtworkOutput {
  svgPath: string;
  metadataPath: string;
  runDir: string;
  layoutName: string;
}

/**
 * Generate a typographic SVG from extracted content.
 * Creates the artwork, writes metadata, and saves both to a per-run directory.
 *
 * @param input - the candidate content + source metadata
 * @returns paths to the generated files
 */
export async function generateArtwork(input: ArtworkInput): Promise<ArtworkOutput> {
  const palette = PALETTES[input.category] || PALETTES.other;
  const fonts = pickFonts(input.content.length);
  const layout = pickLayout(input.content);
  const layoutIdx = LAYOUTS.indexOf(layout);
  const layoutNames = ["stacked", "asymmetric", "fragmented", "vertical"];

  const result = layout(input.content, palette, fonts);
  const id = "m_" + crypto.createHash("sha256")
    .update(input.content.toLowerCase().replace(/[^a-z0-9áéíóúñü]/g, "").slice(0, 200))
    .digest("hex").slice(0, 16);

  const now = new Date();
  const runTimestamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19); // YYYY-MM-DDTHH-MM-SS
  const runDir = path.join(RUNS_DIR, `${runTimestamp}_Petra_2026`);

  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(ARTWORKS_DIR, { recursive: true });

  const seed = (input.content.length * 7 + (input.content.charCodeAt(0) || 0)) % 1000;
  const seed2 = (seed * 13 + 7) % 1000;
  // Genera N partículas que derivan por el SVG (SMIL puro, viaja con el NFT)
  let particles = '';
  for (let i = 0; i < 18; i++) {
    const cx = ((seed + i * 53) % result.width);
    const cy = ((seed2 + i * 37) % result.height);
    const r = ((i * 7 + 3) % 4) * 0.5 + 0.6;
    const dur = 18 + (i % 5) * 4;
    const dx = ((i * 11) % 60) - 30;
    const dy = ((i * 17) % 60) - 30;
    const op = 0.18 + ((i % 4) * 0.05);
    particles += `<circle cx="${cx}" cy="${cy}" r="${r.toFixed(2)}" fill="#000" opacity="${op.toFixed(2)}">
      <animate attributeName="cx" values="${cx};${cx + dx};${cx}" dur="${dur}s" repeatCount="indefinite"/>
      <animate attributeName="cy" values="${cy};${cy + dy};${cy}" dur="${dur}s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="${op.toFixed(2)};${(op*0.3).toFixed(2)};${op.toFixed(2)}" dur="${dur}s" repeatCount="indefinite"/>
    </circle>\n`;
  }

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${result.width}" height="${result.height}" viewBox="0 0 ${result.width} ${result.height}">
<defs>
  <!-- Shader procedural: ruido fractal coloreado, no es fondo de color sino noise pintado -->
  <filter id="weird-shader" x="0%" y="0%" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.011" numOctaves="3" seed="${seed2}" result="noise">
      <animate attributeName="baseFrequency" values="0.008;0.014;0.008" dur="14s" repeatCount="indefinite"/>
      <animate attributeName="numOctaves" values="2;4;2" dur="11s" repeatCount="indefinite"/>
    </feTurbulence>
    <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0.96   0 0 0 0 0.94   0 0 0 0 0.91   0 0 0 0.55 0"/>
  </filter>
  <!-- Capa de tinta extra: lineas de escaneo / grunge -->
  <filter id="weird-scanlines" x="0%" y="0%" width="100%" height="100%">
    <feTurbulence type="turbulence" baseFrequency="0.9 0.04" numOctaves="1" seed="${seed}" result="scan"/>
    <feColorMatrix in="scan" type="matrix" values="0 0 0 0 0   0 0 0 0 0   0 0 0 0 0   0 0 0 0.08 0"/>
  </filter>
  <!-- Distorsión animada del texto -->
  <filter id="weird-breathe" x="-3%" y="-3%" width="106%" height="106%">
    <feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="2" seed="${seed}" result="noise">
      <animate attributeName="baseFrequency" values="0.015;0.024;0.015" dur="9s" repeatCount="indefinite"/>
    </feTurbulence>
    <feDisplacementMap in="SourceGraphic" in2="noise" scale="2.5"/>
  </filter>
  <!-- Halo sutil -->
  <filter id="weird-glow" x="-10%" y="-10%" width="120%" height="120%">
    <feGaussianBlur stdDeviation="0.6"/>
  </filter>
</defs>

<!-- Capa shader: rect lleno de noise procedural, no color sólido -->
<rect width="100%" height="100%" fill="#ffffff" filter="url(#weird-shader)"/>
<rect width="100%" height="100%" fill="#000000" filter="url(#weird-scanlines)"/>

<!-- Partículas derivando (SMIL, sin JS) -->
${particles}

<!-- Texto distorsionado -->
<g filter="url(#weird-breathe)">
${result.body}
</g>
</svg>`;

  const svgPath = path.join(runDir, `${id}.svg`);
  const metadataPath = path.join(runDir, `${id}.json`);

  fs.writeFileSync(svgPath, svg, "utf-8");

  const metadata = {
    id,
    content: input.content,
    language: detectLanguage(input.content),
    category: input.category,
    attribution: input.attribution,
    source: input.source,
    sourceUrl: input.sourceUrl,
    postUri: input.postUri,
    postAuthor: input.postAuthor,
    postIndexedAt: input.postIndexedAt,
    scrapedAt: input.scrapedAt || now.toISOString(),
    artworkGeneratedAt: now.toISOString(),
    layout: layoutNames[layoutIdx],
    palette,
    fonts,
    dimensions: { width: result.width, height: result.height },
    path: svgPath,
  };

  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), "utf-8");

  // Also write a copy to the canonical artworks directory for backwards compat
  fs.writeFileSync(path.join(ARTWORKS_DIR, `${id}.svg`), svg, "utf-8");

  return {
    svgPath,
    metadataPath,
    runDir,
    layoutName: layoutNames[layoutIdx],
  };
}

/**
 * Lightweight language detection — looks for distinctive characters or
 * common words in the major languages we expect on Bluesky.
 */
function detectLanguage(text: string): string {
  if (/[ñáéíóú¿¡]/i.test(text)) return "es";
  if (/[àâçèéêëîïôûùüÿœæ]/i.test(text)) return "fr";
  if (/[äöüß]/i.test(text)) return "de";
  if (/[àèéìòóùù]/i.test(text)) return "it";
  if (/[\u4e00-\u9fff]/.test(text)) return "zh";
  if (/[\u3040-\u30ff]/.test(text)) return "ja";
  if (/[\uac00-\ud7af]/.test(text)) return "ko";
  if (/[\u0600-\u06ff]/.test(text)) return "ar";
  if (/[\u0400-\u04ff]/.test(text)) return "ru";
  return "en";
}

// --- Self-test ---
if (require.main === module) {
  (async () => {
    const samples: ArtworkInput[] = [
      {
        content: "Calidad del aire en el Valle de Aburrá sigue lejos de lo exigido por la OMS",
        category: "air_pollution",
        attribution: "Anonymous",
        source: "bsky:test",
        sourceUrl: "https://bsky.app/profile/aireenvigado.bsky.social/post/3lkq3qrnztc2z",
        postUri: "at://did:plc:test/app.bsky.feed.post/abc",
        postAuthor: "aireenvigado.bsky.social",
        postIndexedAt: "2026-08-04T16:00:00Z",
      },
      {
        content: "Six espèces d'arbres pourraient combattre la pollution de l'air à Medellín",
        category: "air_pollution",
        attribution: "Anonymous",
        source: "bsky:test",
        sourceUrl: "https://bsky.app/profile/test/post/xyz",
      },
      {
        content: "Air quality crisis.",
        category: "air_pollution",
        attribution: "Anonymous",
        source: "bsky:test",
        sourceUrl: "https://bsky.app/profile/test/post/short",
      },
      {
        content: "Rio Medellín receives untreated sewage from twelve municipalities despite court orders dating back to 2019",
        category: "water_pollution",
        attribution: "Anonymous",
        source: "bsky:test",
        sourceUrl: "https://bsky.app/profile/test/post/water",
      },
    ];

    for (const s of samples) {
      const out = await generateArtwork(s);
      console.log(`✓ Generated ${out.layoutName.padEnd(12)} → ${out.svgPath}`);
    }
  })();
}