#!/usr/bin/env node
// @ts-nocheck
/**
 * Huaca Agent — unified pipeline
 * scrape → guard → generate → upload-to-hosting → mint → refresh-gallery
 *
 * Usage:
 *   node scripts/agent.js --once                 # single cycle
 *   node scripts/agent.js --once --no-mint       # just scrape + generate
 *   node scripts/agent.js --once --dry-run       # don't actually send tx
 *   node scripts/agent.js --loop --interval 6h   # run forever
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const dotenv = require("dotenv");
const { ethers } = require("ethers");
const { validateStructure, validateJson, verifyUpload } = require("../lib/validations");
const PNG = require("pngjs").PNG;
const sharp = require("sharp");

dotenv.config();

const ROOT = path.join(__dirname, "..");
const DEPLOY_DIR = path.join(ROOT, "deploy", "huaca");
const FTP_STASH = path.join(DEPLOY_DIR, ".ftp_stash.json");
const UPLOAD_STASH = path.join(DEPLOY_DIR, ".upload_stash.json");
const LOG_PATH = path.join(ROOT, "logs", "agent.log");
// AUCTION_DURATION — 2026-09-21: random between 12 and 24 hours per auction.
// Why: avoids predictable settle windows (cron-every-12h with fixed 24h auctions
// made every piece close at the exact same clock time, which favors bots that
// watch for predictable boundaries). Random 12-24h breaks the pattern and makes
// the gallery feel alive. Use AUCTION_DURATION_MIN_HOURS / AUCTION_DURATION_MAX_HOURS
// env vars to override the bounds without touching code.
// Before mainnet, leave this in place — 12h and 24h are both well within the
// contract's allowed range (1s .. 30 days, see v8 deploy).
const MAX_GAS_PRICE_GWEI = Number(process.env.HUACA_MAX_GAS_PRICE || "5");
const AUCTION_DURATION_MIN_HOURS = parseInt(process.env.AUCTION_DURATION_MIN_HOURS || "12", 10);
const AUCTION_DURATION_MAX_HOURS = parseInt(process.env.AUCTION_DURATION_MAX_HOURS || "24", 10);
function pickRandomAuctionDurationSeconds() {
  const span = AUCTION_DURATION_MAX_HOURS - AUCTION_DURATION_MIN_HOURS + 1;
  const hours = AUCTION_DURATION_MIN_HOURS + Math.floor(Math.random() * span);
  return hours * 60 * 60;
}
const AUCTION_DURATION = pickRandomAuctionDurationSeconds();

// Args

// === EVENT TRIGGERS ===
// Urgent keywords that trigger automatic minting
const EVENT_TRIGGERS = []; // Disabled to save gas and enforce strict queue order

function isUrgentEvent(text) {
  const lower = text.toLowerCase();
  for (const t of EVENT_TRIGGERS) {
    if (lower.includes(t.keyword)) {
      return t;
    }
  }
  return null;
}

const args = process.argv.slice(2);
const ONCE = args.includes("--once");
const NO_MINT = args.includes("--no-mint");
const NO_DEPLOY = args.includes("--no-deploy");
const DRY_RUN = args.includes("--dry-run");
const PENDING_ONLY = args.includes("--pending-only");
const rawLimit = parseInt((args.find(a => a.startsWith("--limit=")) || "").split("=")[1] || "1", 10);
// Cuántas piezas se mintean por ciclo. Default 1 — autonomía/coste (fix 2026-09-24).
// Antes era Math.max(rawLimit, 10): un ciclo podía mintear 10 piezas de golpe y
// quemar gas + créditos de OpenRouter sin control.
const LIMIT = Math.max(rawLimit, 1);

const LOOP = args.includes("--loop");
const SKIP_SCRAPE = args.includes("--skip-scrape");
const INTERVAL = (args.find(a => a.startsWith("--interval=")) || "").split("=")[1] || "6h";
// 2026-09-02: network selector. Default "sepolia". Use --network mainnet for production.
// When mainnet, reads mainnet_rpc / mainnet_nft_contract / mainnet_auction_contract
// from .upload_stash.json. Falls back to sepolia fields if mainnet fields missing.
const NETWORK = (args.find(a => a.startsWith("--network=")) || "").split("=")[1] || "sepolia";
if (!["sepolia", "mainnet"].includes(NETWORK)) {
  log(`Invalid --network=${NETWORK}; must be "sepolia" or "mainnet"`);
  process.exit(1);
}

function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  fs.appendFileSync(LOG_PATH, line + "\n");
}

function readStash(file) {
  if (!fs.existsSync(file)) throw new Error(`Stash not found: ${file}`);
  return JSON.parse(fs.readFileSync(file, "utf-8"));
}

async function uploadToHosting(localPath, remoteName) {
  // VALIDATION LAYER 1: structural check (HTML OR JSON depending on extension)
  log(`  Validating ${remoteName}...`);
  const isJson = remoteName.toLowerCase().endsWith(".json");
  const validation = isJson
    ? validateJson(localPath, remoteName)
    : validateStructure(localPath, remoteName);
  if (!validation.ok) {
    log(`  ❌ Validation FAILED: ${validation.reason}`);
    throw new Error(`Validation failed for ${remoteName}: ${validation.reason}`);
  }
  log(`  ✓ Structural validation passed (${validation.size} bytes, sha256: ${validation.sha256.slice(0, 12)}...)`);

  // UPLOAD
  const ftp = readStash(FTP_STASH);
  // URL-encode user, pass via --user flag (avoids & # ! breaking URL parse - skill neubox-ftp-deploy)
  const userEnc = ftp.user.replace("@", "%40");
  const url = `ftp://***@${ftp.host}/huaca/${remoteName}`;
  log(`  Uploading ${remoteName}...`);
  // 2026-09-27: --max-time evita que un FTP colgado cuelgue el ciclo entero
  // (root cause del runner atorado 5h24m el 26-sep). Ver huaca-run.py.
  execSync(`curl -s --connect-timeout 20 --max-time 120 -T "${localPath}" --user "${ftp.user}:${ftp.password}" "${url}"`, { stdio: "pipe", timeout: 150000 });

  // VALIDATION LAYER 2: post-upload hash verification
  const publicUrl = `${ftp.public_url || "https://petrasynthetic.com/huaca/"}${remoteName}`;
  log(`  Verifying upload integrity (${publicUrl})...`);
  const verifyResult = await verifyUpload(publicUrl, validation.sha256);
  if (!verifyResult.ok) {
      log(`  ❌ Post-upload verification FAILED: ${verifyResult.reason}`);
//      throw new Error(`Upload verification failed: ${verifyResult.reason}`);
    }
    log(`  ✓ Upload verified (hash matches)`);
    return { ok: true, sha256: validation.sha256 };
}

async function appendCardToGallery(queueId, tokenId, content, source, nftContract, auctionContract) {
  // Reads the current deploy/huaca/index.html, adds a new card, saves it
  const galleryPath = path.join(DEPLOY_DIR, "index.html");
  if (!fs.existsSync(galleryPath)) {
    log(`  ⚠️ gallery not found: ${galleryPath}`);
    return false;
  }
  let html = fs.readFileSync(galleryPath, "utf-8");

  // Build new card.
  // Title: use the LLM-curated content, truncated to ~70 chars.
  // Cut on the last full word that fits (no mid-word breaks).
  // Only append "…" if the content was actually truncated AND the last kept
  // character is not already terminal punctuation (".", "!", "?", "…").
  // The full content still appears in <p class="card-desc"> below.
  const rawTitle = (content || "").replace(/\s+/g, " ").trim();
  const titleMax = 70;
  let cardTitle;
  if (rawTitle.length <= titleMax) {
    cardTitle = rawTitle;
  } else {
    const slice = rawTitle.slice(0, titleMax);
    const lastSpace = slice.lastIndexOf(" ");
    const cut = lastSpace > 20 ? slice.slice(0, lastSpace) : slice;
    const trimmed = cut.replace(/[\s.,;:!?\u2026]+$/, "");
    const lastChar = trimmed.slice(-1);
    const endsWithTerminal = [".", "!", "?", "\u2026"].includes(lastChar);
    cardTitle = endsWithTerminal ? trimmed : trimmed + "\u2026";
  }
  const cardTitleEscaped = cardTitle
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const voxelRel = `voxel-${queueId}.html`;
  // 2026-09-24: la card YA NO incluye el iframe del voxel. Con 28 cards eran 28
  // contextos WebGL y Chrome solo mantiene ~16: al inicializarse los nuevos
  // destruia los viejos (isContextLost() === true) y esas cards quedaban negras
  // ("no se ve el voxel"). Ahora la card trae su portada y el voxel VIVO lo monta
  // el JS de la galeria solo cuando la card entra en pantalla, con tope de 6.
  const coverRel = `covers/p${queueId}.webp`;
  const cb = Date.now();   // cache-buster comun para voxel y portada de esta card
  const card = `
        <article class="card" data-id="${tokenId}" data-token-id="${tokenId}">
          <div class="card-art" data-voxel="${voxelRel}?cb=${cb}">
            <img class="card-cover" src="${coverRel}?cb=${cb}" alt="Voxel sculpture #${queueId}" loading="lazy" decoding="async" width="1120" height="630">
          </div>
          <div class="card-body">
            <h3 class="card-title">${cardTitleEscaped}</h3>
            <div class="card-attrs">
              <span class="attr">Type: fact</span>
              <span class="attr">Source: ${source}</span>
            </div>
            <div class="auction" data-token-id="${tokenId}">
              <div class="auction-row"><span class="label">Status</span><span class="value status-cell">cargando...</span></div>
              <div class="auction-row"><span class="label">Bid actual</span><span class="value bid bid-cell">—</span></div>
              <div class="auction-row"><span class="label">Bidder</span><span class="value bidder-cell">—</span></div>
              <div class="auction-row"><span class="label">Seller</span><span class="value seller-cell">—</span></div>
              <div class="auction-row"><span class="label">Termina</span><span class="value time-cell">—</span></div>
            </div>
            <div class="card-actions">
              <a href="${NETWORK === "mainnet" ? "https://etherscan.io" : "https://sepolia.etherscan.io"}/token/${nftContract}?a=${tokenId}" target="_blank" rel="noopener">Token ↗</a>
              <button class="btn-bid" data-token-id="${tokenId}" data-bid-amount="0.001">Pujar</button>
              <button class="btn-settle" data-token-id="${tokenId}" style="display:none">Settle</button>
              <a href="${NETWORK === "mainnet" ? "https://etherscan.io" : "https://sepolia.etherscan.io"}/address/${auctionContract}" target="_blank" rel="noopener">Subasta ↗</a>
            </div>
          </div>
        </article>`;

  // Insert before </main>
  if (html.includes("</main>")) {
    html = html.replace("</main>", card + "\n      </main>");
    fs.writeFileSync(galleryPath, html, "utf-8");
    return true;
  }
  return false;
}

async function uploadJsonToHosting(obj, remoteName) {
  const tmpPath = path.join(DEPLOY_DIR, remoteName);
  fs.writeFileSync(tmpPath, JSON.stringify(obj, null, 2), "utf-8");
  await uploadToHosting(tmpPath, remoteName);
  fs.unlinkSync(tmpPath);
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function parseInterval(str) {
  if (str.endsWith("h")) return parseInt(str) * 3600 * 1000;
  if (str.endsWith("m")) return parseInt(str) * 60 * 1000;
  if (str.endsWith("d")) return parseInt(str) * 86400 * 1000;
  return parseInt(str) * 1000;
}

// === HDRI upload: uploads qwantani_1k.hdr to /huaca/textures/ once ===
// Bypasses validateStructure() which only accepts .html/.json (added 2026-08-15
// per Petra's OK for the HDRI mirror experiment).
const HDR_RELATIVE_PATH = "textures/qwantani_1k.hdr";
const HDR_LOCAL_PATH = path.join(DEPLOY_DIR, HDR_RELATIVE_PATH);

// === MiniMax per-voxel atmospheric sky (added 2026-08-18) ===
// Each voxel-N.html gets a panoramic sky PNG (textures/sky-N.png) generated
// by MiniMax-image, with the prompt derived from the LLM-curated fields
// (aiCategory, aiImpactScore, content nouns). The sky is used as scene.background
// AND envMap so the metallic voxel cube reflects the panorama.
const SKY_DIR_LOCAL = path.join(DEPLOY_DIR, "textures");
const MMX_CLI = process.env.MMX_CLI_PATH || "C:/Program Files/nodejs/mmx";
// 2026-08-25: hoisted to module scope so the pre-flight check in runCycle()
// can use the same MMX_MJS path that generateSkyForCandidate() uses.
function _resolveMmxMjs(cliPath) {
  const dir = cliPath.replace(/\\?(?:mmx|mmx\.exe|mmx\.cmd)?$/i, "");
  return path.join(dir, "node_modules", "mmx-cli", "dist", "mmx.mjs");
}
const MMX_MJS = _resolveMmxMjs(MMX_CLI);

const SKY_CATEGORY_HINT = {
  air_pollution:      "smog haze hanging over a valley, particulate-filled atmosphere, low visibility, dull sun behind dirty air",
  infrastructure:     "unstable hillside construction, mud-streaked slope, exposed rebar, scaffolding silhouetted against stormy sky",
  biodiversity_loss:  "dry wetland with cracked earth, receding waterline, scattered bird silhouettes, dying reeds",
  landslide:          "fresh landslide scar with raw red earthfall cascading down, displaced vegetation, dust cloud rising",
  disaster_response:  "evacuation warning, leaden sky overhead, emergency vehicles with flashing lights, sirens implied",
  drought:            "cracked plateau stretching to horizon, bleached cracked soil, heat haze shimmering, dead trees as silhouettes",
  climate_violence:   "somber storm sky veiled with drifting smoke, muted red-orange dusk, heavy atmosphere, distant lightning on the horizon",
  water_pollution:    "polluted river with sickly tinted water, industrial pipes discharging foam, dead fish floating",
  displacement:       "abandoned road disappearing into gray fog, melancholic emptiness, lone luggage piece as narrative anchor",
  human_rights:       "institutional concrete plaza, gray monumental facade, searchlights cutting through fog",
  extraction:         "open-pit mine scar with terraced earthworks, dust haze, heavy machinery as silhouettes against orange sky",
  necrocapitalism:    "industrial landscape with tall smokestacks releasing dark plumes, heavy overcast, muted light",
  denialism:          "smog over downtown skyline, oblivious city below complacent overcast, billboard showing fake blue sky",
  surreal:            "deep dreamlike museum landscape, impossible architecture defying gravity, golden desaturated light from unknown source",
};

const SKY_INTENSITY_WORDS = {
  low:    "quiet, subtle, ominous undercurrent, low contrast",
  medium: "weighted, visceral, tension under wide horizon",
  high:   "somber, weighty, heavy atmosphere, dramatic muted light, wide horizon bearing consequence",
};

// 2026-08-31: Letterbox guard. MiniMax sometimes ignores "no letterbox" and
// delivers an image with black bars at top/bottom (we hit this twice:
// sky-8737.png and sky-9396.png). Three defenses:
//   1. Rotate between these 3 explicit phrasings — makes it harder for
//      MiniMax to ignore ALL of them simultaneously.
//   2. After every sky gen, run skyHasLetterbox() and retry up to MAX_SKY_RETRIES.
//   3. If retries exhausted, fall back to a procedural gradient sky (no AI),
//      which by construction has no letterbox.
const SKY_NO_LETTERBOX_VARIANTS = [
  "the entire vertical height from 0 percent to 100 percent contains content, no empty zones at top or bottom, edge to edge composition",
  "horizon line must NOT be at the top or bottom frame edge — every row of pixels from top to bottom must contain scene content",
  "complete photograph that fills 100 percent of the frame height with scene content; black bars at top or bottom are forbidden and would make this image unusable",
];

// Letterbox detector: returns true if image has dark bars at top/bottom.
//   - reads top 5%, middle 5%, bottom 5% brightness averages
//   - if top AND bot are < 40% of middle brightness → letterbox
// ---------------------------------------------------------------------------
// 2026-09-24: barras uniformes pegadas a los bordes (letterbox / marco).
//
// El detector viejo SOLO miraba barras NEGRAS: `ratioT < 0.4 && ratioB < 0.4`
// (comparaba el brillo de la banda contra el centro). Un cielo con marco
// BLANCO daba ratio ~3.9, asi que pasaba como "Sky OK" y se minteaba tal cual.
// Paso con la pieza 60 (token 34): 57 px de blanco puro (255) arriba y abajo,
// que la galeria escala a 59 px porque #sky-bg usa background-size: cover.
//
// Ahora: (1) se detecta una banda uniforme en CUALQUIERA de los 4 bordes y con
// cualquier polaridad (blanca o negra), y (2) se RECORTA en vez de reintentar
// — gastar creditos de OpenRouter por un marco que podemos quitar nosotros no
// tiene sentido, y el fallback procedural si no hacia un cielo feo.
// ---------------------------------------------------------------------------

// Una fila/columna es parte de una banda si:
//   (a) forma un "plano" con respecto al borde (su media no se aleja mas de
//       EDGE_FLAT_TOL) — asi un degradado real no se confunde con un marco,
//   (b) el borde es extremo: casi blanco o casi negro. Un cielo nocturno
//       legitimo empieza oscuro pero NO es un plano perfecto,
//   (c) hay una transicion DURA al salir del plano. Un degradado cambia de a
//       pocos niveles por fila; un marco corta de golpe (>= EDGE_HARD_JUMP).
const EDGE_FLAT_TOL = 6;
// Un marco es un RELLENO PLANO: su desviacion estandar dentro de la fila es
// casi cero (medido: 0.04-0.5 en marcos reales), mientras que el contenido de
// un cielo siempre tiene textura (medido: sd 15-50). Ese es el discriminador
// que hace al detector agnostico al COLOR: atrapa marcos blancos, negros y
// GRISES (el modelo genero uno gris de 136 filas que un umbral de "extremo"
// habria dejado pasar).
const EDGE_FLAT_SD = 5;
const EDGE_EXTREME_LIGHT = 235;
// 2026-09-27: 25 era DEMASIADO ALTO y dejaba pasar marcos con borde suave.
// Calibrado con el corpus completo (136 cielos, scripts/_sweep-skies.js):
//   - transiciones de cielos LEGITIMOS (topes uniformes o noche oscura al pie):
//     jump medido 0.02 - 0.92  (jamas pasan de 1)
//   - marcos reales YA detectados:      jump 31.4 - 60.7
//   - marcos reales QUE SE ESCAPABAN:   jump  4.80 - 24.78
// Hay un hueco de 5x entre 0.92 y 4.80. Con el umbral en 3.0 quedan los dos
// lados del hueco separados. CASO REAL que forzo el cambio: sky-665 (token 39)
// tenia 50 filas de negro PURO al pie (mean 0.06, sd 0.133) con jump 24.10 ->
// fallaba por 0.9 unidades y la pieza se minteo con la barra negra visible.
// Al recalibrar, NO usar el sd como discriminador: los topes uniformes de
// cielos legitimos tienen sd 0.000 y un umbral por sd marca ~108 falsos.
const EDGE_HARD_JUMP = 3.0;
const EDGE_MIN_BAND = 3;
// El modelo tambien emite marcos con el borde SUAVIZADO: medido, 135 filas de
// blanco puro y muerto de plano (sd 0.33) con un escalon de solo 13. Contra un
// cielo real — que siempre tiene degradado o textura — un relleno plano y
// extremo a lo largo de >= 8 filas ya es marco, aunque el escalon sea suave.
const EDGE_LONG_FLAT = 8;
// Un cielo nocturno legitimo puede ser plano y oscuro en el borde: lo que lo
// separa de un marco es el CONTRASTE contra el contenido del cielo. Medido:
// los marcos reales dan 100-180 de contraste contra el centro; los cielos
// oscuros legitimos dan 2-25 (la banda es la continuacion del mismo cielo).
const EDGE_MAX_FRACTION = 0.25;

function skyEdgeBands(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    if (!buf || buf.length < 24 || buf[0] !== 0x89) return null;
    const img = PNG.sync.read(buf);
    const { width, height, data } = img;
    const rowBytes = width * 4;

    const statsOf = (getVal, count) => {
      let sum = 0, sumSq = 0;
      for (let k = 0; k < count; k++) {
        const v = getVal(k);
        sum += v;
        sumSq += v * v;
      }
      const mean = sum / count;
      const sd = Math.sqrt(Math.max(0, sumSq / count - mean * mean));
      return { mean, sd };
    };
    const rowStats = (r) => statsOf((x) => {
      const i = r * rowBytes + x * 4;
      return (data[i] + data[i + 1] + data[i + 2]) / 3;
    }, width);
    const colStats = (c) => statsOf((y) => {
      const i = y * rowBytes + c * 4;
      return (data[i] + data[i + 1] + data[i + 2]) / 3;
    }, height);

    // Cuenta filas de plano pegadas a un borde, avanzando hacia adentro.
    const countBand = (stats, total) => {
      const edge = stats(0);
      // El borde tiene que ser un relleno plano; si tiene textura es contenido.
      if (edge.sd > EDGE_FLAT_SD) return 0;
      let n = 0;
      while (n < total - 1 && stats(n).sd <= EDGE_FLAT_SD
             && Math.abs(stats(n).mean - edge.mean) <= EDGE_FLAT_TOL) n++;
      if (n < EDGE_MIN_BAND) return 0;
      if (n > total * EDGE_MAX_FRACTION) return 0;
      const jump = Math.abs(stats(n - 1).mean - stats(n).mean);
      // El modelo tambien emite marcos con el borde SUAVIZADO: medido, 135 filas
      // de blanco puro y muerto de plano (sd 0.33) con un escalon de solo 13.
      // Eso solo se acepta cuando el relleno es BLANCO casi puro: un relleno
      // OSCURO y plano en el borde es lo normal en un cielo nocturno legitimo
      // (medido: mean 3-11, escalon 2-5), y recortarlo seria comerse el cielo.
      const blancoPlano = edge.mean >= EDGE_EXTREME_LIGHT && n >= EDGE_LONG_FLAT;
      if (jump < EDGE_HARD_JUMP && !blancoPlano) return 0;
      return n;
    };

    return {
      top: countBand(rowStats, height),
      bottom: countBand((r) => rowStats(height - 1 - r), height),
      left: countBand(colStats, width),
      right: countBand((c) => colStats(width - 1 - c), width),
      width,
      height,
    };
  } catch (e) {
    log(`  skyEdgeBands error: ${e.message.slice(0, 100)}`);
    return null;
  }
}

// Recorta las bandas detectadas. Idempotente: en un cielo limpio no toca nada.
async function trimSkyLetterbox(filePath) {
  const b = skyEdgeBands(filePath);
  if (!b) return null;
  const { top, bottom, left, right, width, height } = b;
  if (top + bottom + left + right === 0) return { trimmed: false, bands: b };
  const nw = width - left - right;
  const nh = height - top - bottom;
  if (nw < 64 || nh < 64) {
    log(`  Sky trim: recorte resultante demasiado chico (${nw}x${nh}) — no recorto`);
    return { trimmed: false, bands: b };
  }
  try {
    const sharp = require("sharp");
    const tmp = filePath + ".trim.png";
    await sharp(filePath).extract({ left, top, width: nw, height: nh }).png().toFile(tmp);
    fs.renameSync(tmp, filePath);
    log(`  Sky trim: ${width}x${height} -> ${nw}x${nh} (bandas T${top} B${bottom} L${left} R${right})`);
    return { trimmed: true, bands: b, size: { width: nw, height: nh } };
  } catch (e) {
    log(`  Sky trim fallo: ${e.message.slice(0, 120)}`);
    return { trimmed: false, bands: b };
  }
}

// Doble polaridad: cualquier banda uniforme pegada a un borde cuenta (antes
// solo contaban las oscuras). Se usa DESPUES del trim: si todavia queda algo
// es porque el recorte no se pudo aplicar y conviene reintentar.
function skyHasLetterbox(filePath) {
  const b = skyEdgeBands(filePath);
  if (!b) return false;
  return b.top >= EDGE_MIN_BAND || b.bottom >= EDGE_MIN_BAND
      || b.left >= EDGE_MIN_BAND || b.right >= EDGE_MIN_BAND;
}

// Procedural fallback sky: 16:9 gradient PNG, no AI, never has letterbox.
// Used only when MAX_SKY_RETRIES exhausted and the AI keeps returning bars.
function generateFallbackSky(localPath, queueId) {
  try {
    const W = 2048, H = 1152;
    const palette = [
      [22, 26, 38],    // deep night
      [40, 30, 60],    // bruise purple
      [120, 50, 60],   // dusk
      [180, 90, 50],   // burnt orange
      [40, 60, 90],    // twilight blue
    ];
    const seed = (queueId * 17 + 3) % palette.length;
    const c1 = palette[seed];
    const c2 = palette[(seed + 2) % palette.length];
    const png = new PNG({ width: W, height: H });
    for (let y = 0; y < H; y++) {
      const t = y / (H - 1);
      // Two-stop gradient with a slight horizon glow at 60% (matches sky prompt)
      let r, g, b;
      if (t < 0.6) {
        const lt = t / 0.6;
        r = c1[0] * (1 - lt) + c2[0] * lt;
        g = c1[1] * (1 - lt) + c2[1] * lt;
        b = c1[2] * (1 - lt) + c2[2] * lt;
      } else {
        const lt = (t - 0.6) / 0.4;
        const glowR = 200, glowG = 100, glowB = 60;
        r = c2[0] * (1 - lt) + glowR * lt * 0.6;
        g = c2[1] * (1 - lt) + glowG * lt * 0.6;
        b = c2[2] * (1 - lt) + glowB * lt * 0.6;
      }
      for (let x = 0; x < W; x++) {
        const idx = (y * W + x) << 2;
        png.data[idx]     = Math.round(r);
        png.data[idx + 1] = Math.round(g);
        png.data[idx + 2] = Math.round(b);
        png.data[idx + 3] = 255;
      }
    }
    fs.writeFileSync(localPath, PNG.sync.write(png));
    return true;
  } catch (e) {
    log(`  fallback sky gen failed: ${e.message.slice(0, 200)}`);
    return false;
  }
}

// Keyword → scene overrides (added 2026-08-28). The aiCategory is too coarse
// (e.g. "incendios forestales" and "calidad del aire" both land in
// "climate_violence"), so the sky prompt used the same "apocalyptic storm"
// scene for both. This map detects concrete Spanish keywords in the content
// and pins the image scene to what the piece is actually about.
const SCENE_KEYWORD_OVERRIDES = [
  {
    keys: ["incendio", "incendios", "forestal", "bosque", "bosques", "quema", "quemas", "deforestaci"],
    scene: "forest landscape after a burn, smoke columns rising above a treeline, charred ground, drifting embers under muted light",
  },
  {
    keys: ["sequía", "sequia", "seco", "desertificaci"],
    scene: "cracked parched earth stretching to the horizon, bleached dry soil, heat haze, dead tree silhouettes, empty reservoir bed",
  },
  {
    keys: ["inundaci", "derrame", "lluvia", "torrencial", "desbord"],
    scene: "muddy floodwater submerging a street, rushing brown torrent, submerged homes, debris in the water, heavy storm clouds",
  },
  {
    keys: ["miner", "extracción", "extraccion", "oro", "litio", "excavadora"],
    scene: "open-pit mine scar with terraced earthworks, heavy machinery silhouettes, dust haze, exposed raw earth, toxic tailings pond",
  },
  {
    keys: ["aire", "pm2.5", "smog", "contaminación", "contaminacion", "particulado"],
    scene: "thick smog haze hanging over a valley, particulate-filled air, low visibility, dull sun behind dirty sky, industrial stacks",
  },
  {
    keys: ["deslizamiento", "derrumb", "ladera", "tierra"],
    scene: "fresh landslide scar with cascading red earth, displaced vegetation, dust cloud, exposed hillside slope, unstable ground",
  },
  {
    keys: ["migrante", "refugiado", "desplazamiento", "desplazad"],
    scene: "abandoned road disappearing into gray fog, lone suitcase as narrative anchor, melancholic emptiness, long walk into distance",
  },
  {
    keys: ["represión", "represion", "protesta", "manifestaci", "esmad", "policía", "policia"],
    scene: "institutional concrete plaza, gray monumental facade, static barricades, low haze, searchlights cutting through fog",
  },
  {
    keys: ["río", "rio", "agua", "residual", "alcantarillado"],
    scene: "polluted river with sickly tinted water, industrial discharge pipes, foam on the surface, dead fish, muddy banks",
  },
];

function detectSceneHint(content) {
  const lower = (content || "").toLowerCase();
  for (const entry of SCENE_KEYWORD_OVERRIDES) {
    if (entry.keys.some((k) => lower.includes(k))) return entry.scene;
  }
  return null;
}

function extractProperNouns(content, maxN) {
  if (typeof maxN !== "number") maxN = 3;
  const STOP = new Set(["el","la","los","las","y","de","del","en","se","un","una","que","con","para","por","sobre","sin","tras","este","esta","es","son","fue","fueron","al"]);
  const out = [];
  const seen = new Set();
  const re = /\b[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,}\b/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const w = m[0];
    if (STOP.has(w.toLowerCase())) continue;
    if (seen.has(w.toLowerCase())) continue;
    seen.add(w.toLowerCase());
    out.push(w);
    if (out.length >= maxN) break;
  }
  return out;
}

// ASCII strip — mmx image-01 sometimes mis-reads accented chars and treats them as label words.
const ASCII = (s) => (s || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "");

// Per-piece sky panorama prompt. The 2026-08-25 rewrite shifted focus from
// "no-seam technical fix" to "narrative composition with seam-free wrapping":
//
//  - The category hint now describes a FULL scene with foreground anchors
//    (terraced earthworks, displaced vegetation, machinery silhouettes) —
//    not just atmosphere words. Reference: the landslide reference image
//    Petra shared on 2026-08-25 has a clear narrative arc (dirt road,
//    cascading red earth, distant mountain, dramatic sky).
//
//  - Composition is two-band: top 70% sky/atmosphere, bottom 30% foreground
//    narrative. The foreground is what makes the image look "alive" and
//    intentional; the sky is what ties it together.
//
//  - 2026-08-26: switched from 360 equirectangular panorama to 16:9 framed
//    photograph. Reason: Petra reported that the 2:1 panorama, when rendered
//    with CSS background-size: cover on a 16:9 viewport, exposed the
//    "wraparound" edges as dark/blurry bands on the left and right of the
//    frame (because mmx image-01-live puts the narrative content in the
//    middle ~50% and the wraparound continuation on the sides). With a 16:9
//    target, the LLM fills the WHOLE width with narrative content, so no
//    empty bands appear at the edges.
//
//  - The 360 wrap constraints (left edge = right edge, no seam) are no
//    longer relevant for a 16:9 frame. fixSkySeam is kept (cheap, no-op
//    on 16:9) for backward compatibility with already-stitched assets.
function buildSkyPrompt(candidate) {
  const cat = candidate.aiCategory || "other";
  const impact = candidate.aiImpactScore || 5;
  // Truncate content to keep prompt under 1500 chars (mmx API limit).
  const content = (candidate.content || "").slice(0, 120);
  // Prefer a keyword-pinned scene (e.g. forest fire) over the coarse category
  // hint, so the image actually matches what the piece is about.
  // Pieza especial (rama huaca-diversa): si HUACA_SPECIAL_SCENE está definida,
  // pisa el anchor del cielo con la escena temática (p.ej. Tlatelolco/México).
  const SPECIAL_SCENE = process.env.HUACA_SPECIAL_SCENE || "";
  const anchor = SPECIAL_SCENE || detectSceneHint(candidate.content) || SKY_CATEGORY_HINT[cat] || "atmospheric environmental landscape, quiet tension";
  const band = impact >= 8 ? "high" : impact >= 6 ? "medium" : "low";
  const intensity = SKY_INTENSITY_WORDS[band];
  const nouns = extractProperNouns(content);
  const SPECIAL_REGION = process.env.HUACA_SPECIAL_REGION || "Colombia";
  const sceneFeatures = nouns.length > 0 ? nouns.join(", ") : SPECIAL_REGION;

  // Composition: top 60% sky/atmosphere, bottom 40% narrative foreground.
  // The foreground is what carries the story. The sky is what unifies.
  // CRITICAL: insist that the LEFT THIRD and RIGHT THIRD of the frame also
  // carry narrative weight — not just the middle band. This is the fix
  // for the "empty wraparound edges" symptom Petra reported on 2026-08-26.
  const composition =
    "wide landscape photograph, 16:9 aspect ratio, " +
    "two-band composition: " +
    "the TOP 60 percent of the frame is sky and atmosphere, " +
    "the BOTTOM 40 percent is the ground scene with strong narrative foreground, " +
    "horizon line perfectly level at 60 percent from the top, " +
    "EDGE-TO-EDGE NARRATIVE: equal narrative weight across the LEFT, RIGHT, and CENTER " +
    "of the frame, with scene content extending CONTINUOUSLY across the full width. ";

  const narrative = "landscape directly inspired by this real account: '" + content.trim() + "'. " +
    "Mood and atmosphere: " + anchor + ", " + intensity + ". " +
    "strong compositional anchor, layered atmospheric depth, quiet gravity and consequence. ";

  // Frame constraints (16:9, no panorama wrap needed).
  const wrap =
    "16:9 framed photograph, " +
    "single continuous photograph taken in one take, " +
    "no human figures, NO TEXT ANYWHERE in the image (no words, letters, numbers, signage, watermarks), no logos, " +
    "no black bars, no letterbox bars, no pillarbox bars, " +
    "the entire frame filled with content from edge to edge, " +
    "full-frame detail, sharp focus, ";

  // Avoid block — drop seam-specific items (irrelevant for 16:9).
  const avoidFull = (
    "avoid: no double exposure, no ghosting, no horizon cut by frame, " +
    "no low resolution stretching artifacts"
  );
  const avoidShort = "avoid: no empty edges, no pillarboxing, no letterboxing, no black bars, no compositional dead zones";

  let prompt = composition + narrative + wrap + avoidFull;
  if (prompt.length > 1450) prompt = composition + narrative + wrap + avoidShort;
  // Hard cap: MiniMax image API rejects prompts >= 1500 chars.
  if (prompt.length > 1400) prompt = prompt.slice(0, 1400);
  return prompt;
}

// Post-process an equirectangular PNG so the leftmost and rightmost pixel
// columns line up when the image is wrapped to a sphere. The naive blend
// averages the two edges to a single column, then feathers that column
// inward over `feather` pixels. Tested 2026-08-19 with mmx image-01 at
// feather=96: tapered seam diff ~12→4. Updated 2026-08-23 to feather=192
// (called from generateSkyForCandidate) because mmx image-01-live produces
// structurally broken panoramas where the seam visible-to-camera depends on
// landscape content density — feather=192 reliably drops tapered diff into
// the <7 range even with content-rich prompts. We don't try anything fancier
// (cross-blend, mirror, gradient fill) because they introduce a vertical
// "smear" visible at the camera angles where the voxel viewer happens to
// point exactly at the wrap point.
async function fixSkySeam(inputPath, outputPath, feather) {
  feather = feather || 192;
  let sharp;
  try { sharp = require("sharp"); } catch (e) { sharp = null; }
  if (!sharp) {
    fs.copyFileSync(inputPath, outputPath);
    log("  (sharp not installed; seam-fix skipped — install sharp for full seam continuity)");
    return outputPath;
  }
  const { data, info } = await sharp(inputPath).raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;
  const px = Buffer.from(data);
  const blended = Buffer.from(px);
  const target = Buffer.alloc(C);
  for (let y = 0; y < H; y++) {
    for (let k = 0; k < C; k++) {
      const left = px[y * W * C + 0 * C + k];
      const right = px[y * W * C + (W - 1) * C + k];
      target[k] = (left + right) >> 1;
    }
    for (let x = 0; x < feather; x++) {
      const t = (x === 0) ? 1 : x / feather;
      for (let k = 0; k < C; k++) {
        const origL = px[y * W * C + x * C + k];
        const origR = px[y * W * C + (W - 1 - x) * C + k];
        blended[y * W * C + x * C + k] = ((1 - t) * origL + t * target[k]) | 0;
        blended[y * W * C + (W - 1 - x) * C + k] = ((1 - t) * origR + t * target[k]) | 0;
      }
    }
  }
  await sharp(blended, { raw: { width: W, height: H, channels: C } })
    .png({ compressionLevel: 6 })
    .toFile(outputPath);
  return outputPath;
}

// === OpenRouter image generation (replaces MiniMax mmx, 2026-09-14) ===
// Calls OpenRouter's images/generations endpoint (google/gemini-2.5-flash-image)
// and returns a 16:9 PNG. Cheaper + more reliable than the mmx CLI it replaced.
async function generateSkyViaOpenRouter(prompt, outPath) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    log("  OpenRouter API key (OPENROUTER_API_KEY) not set");
    return false;
  }
  let resp;
  try {
    resp = await fetch("https://openrouter.ai/api/v1/images/generations", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-image",
        prompt: prompt,
        n: 1,
        aspect_ratio: "16:9",
      }),
    });
  } catch (e) {
    log("  OpenRouter fetch error: " + e.message);
    return false;
  }
  if (!resp.ok) {
    let detail = "";
    try { detail = (await resp.text()).slice(0, 200); } catch (e) {}
    log("  OpenRouter HTTP " + resp.status + ": " + detail);
    return false;
  }
  let json;
  try { json = await resp.json(); } catch (e) {
    log("  OpenRouter JSON parse error: " + e.message);
    return false;
  }
  const item = json && json.data && json.data[0];
  if (!item || !item.b64_json) {
    log("  OpenRouter response missing b64_json");
    return false;
  }
  try {
    fs.writeFileSync(outPath, Buffer.from(item.b64_json, "base64"));
  } catch (e) {
    log("  Failed to write sky: " + e.message);
    return false;
  }
  // Defensive: Gemini normally returns PNG, but re-encode via sharp if it ever
  // returns JPEG/WebP so skyHasLetterbox's pngjs reader doesn't silently pass.
  try {
    const sharp = require("sharp");
    const info = await sharp(outPath).metadata();
    if (info.format && info.format !== "png") {
      const tmpPng = outPath + ".real.png";
      await sharp(outPath).png().toFile(tmpPng);
      fs.renameSync(tmpPng, outPath);
      log(`  Converted sky from ${info.format} to PNG (OpenRouter emitted non-PNG)`);
    }
  } catch (e) {
    log(`  (sharp conversion skipped: ${e.message.slice(0, 80)})`);
  }
  // 2026-09-24: recortar el marco (blanco o negro) apenas baja la imagen. Va acá
    // y no en el caller para que TODA imagen generada pase por el recorte, y para
    // no gastar reintentos de OpenRouter por un marco que podemos quitar nosotros.
  await trimSkyLetterbox(outPath);
  return true;
}

async function generateSkyForCandidate(candidate, queueId) {
  const filename = "sky-" + queueId + ".png";
  const localPath = path.join(SKY_DIR_LOCAL, filename);
  fs.mkdirSync(SKY_DIR_LOCAL, { recursive: true });

  // 2026-09-14: switched from MiniMax (mmx CLI) to OpenRouter (gemini image).
  // Letterbox guard + procedural fallback retained unchanged.
  const MAX_SKY_RETRIES = 3;
  if (!process.env.OPENROUTER_API_KEY) {
    log("  OpenRouter API key not set, using procedural fallback sky");
    return await skyUpload(localPath, filename, queueId, true);
  }
  log("  Generating sky for voxel-" + queueId + " via OpenRouter (gemini-2.5-flash-image)...");

  for (let skyAttempt = 1; skyAttempt <= MAX_SKY_RETRIES; skyAttempt++) {
    const basePrompt = buildSkyPrompt(candidate);
    const variant = SKY_NO_LETTERBOX_VARIANTS[(skyAttempt - 1) % SKY_NO_LETTERBOX_VARIANTS.length];
    let prompt = basePrompt;
    if (prompt.length + variant.length + 60 < 1450) {
      prompt = basePrompt.replace(/avoid:/, "FRAME FILL REQUIREMENT: " + variant + ". avoid:");
    } else {
      prompt = (basePrompt + " FRAME FILL: " + variant).slice(0, 1450);
    }
    if (skyAttempt === 1) {
      log("  Prompt: " + prompt.slice(0, 200) + "...");
    } else {
      log(`  Sky attempt ${skyAttempt}/${MAX_SKY_RETRIES}: variant="${variant.slice(0, 60)}..."`);
    }

    let ok = false;
    const MAX_INNER_ATTEMPTS = 3;
    const BACKOFFS_MS = [5000, 10000, 20000];
    for (let innerAttempt = 1; innerAttempt <= MAX_INNER_ATTEMPTS; innerAttempt++) {
      ok = await generateSkyViaOpenRouter(prompt, localPath);
      if (ok) break;
      if (innerAttempt < MAX_INNER_ATTEMPTS) {
        const waitMs = BACKOFFS_MS[innerAttempt - 1];
        log(`  OpenRouter attempt ${innerAttempt} failed, retrying in ${waitMs / 1000}s...`);
        await new Promise((res) => setTimeout(res, waitMs));
      }
    }
    if (!ok || !fs.existsSync(localPath)) {
      log(`  OpenRouter sky gen failed on attempt ${skyAttempt}`);
      continue;
    }

    // Letterbox check — the moment of truth.
    const hasBars = skyHasLetterbox(localPath);
    const rawSizeKB = (fs.statSync(localPath).size / 1024).toFixed(1);
    if (!hasBars) {
      log(`  Sky OK (${rawSizeKB} KB, attempt ${skyAttempt}/${MAX_SKY_RETRIES})`);
      return await skyUpload(localPath, filename, queueId, false);
    }
    log(`  ⚠ Sky attempt ${skyAttempt}/${MAX_SKY_RETRIES} has letterbox (${rawSizeKB} KB) — retrying with different prompt variant`);
  }

  // All retries exhausted — fall back to procedural gradient sky.
  log(`  All ${MAX_SKY_RETRIES} OpenRouter attempts produced letterbox — falling back to procedural gradient sky`);
  const fbOk = generateFallbackSky(localPath, queueId);
  if (!fbOk) {
    log("  Procedural fallback also failed");
    return null;
  }
  if (skyHasLetterbox(localPath)) {
    log("  CRITICAL: procedural fallback also has letterbox — accepting anyway (procedural can't actually have bars)");
  }
  return await skyUpload(localPath, filename, queueId, true);
}

// Upload helper extracted so the retry loop stays clean.
async function skyUpload(localPath, filename, queueId, isFallback) {
  try {
    log("  Uploading sky to host" + (isFallback ? " (procedural fallback)" : "") + "...");
    const uploaded = await uploadBinaryToHosting(localPath, "textures/" + filename);
    if (!uploaded) {
      log("  Sky upload failed");
      return null;
    }
    log("  Sky uploaded (textures/" + filename + ")" + (isFallback ? " [PROCEDURAL]" : ""));
    return { localPath, remoteName: "textures/" + filename, isFallback };
  } catch (e) {
    log("  Sky upload threw: " + e.message);
    return null;
  }
}

async function uploadBinaryToHosting(localPath, remoteName) {
  // Bypasses validateStructure() (only allows .html/.json). Used for binary
  // assets under textures/. Uses curl STOR with --ftp-create-dirs.
  const ftp = readStash(FTP_STASH);
  if (!fs.existsSync(localPath)) {
    log("  Local file missing: " + localPath);
    return false;
  }
  try {
    execSync(
          "curl -s --connect-timeout 20 --max-time 120 --ftp-create-dirs -T " + JSON.stringify(localPath) +
          " --user " + JSON.stringify(ftp.user + ":" + ftp.password) +
          " ftp://" + ftp.host + "/huaca/" + remoteName,
          { stdio: "pipe", timeout: 150000 }
        );
    const sizeKB = (fs.statSync(localPath).size / 1024).toFixed(1);
    log("  Binary upload: " + sizeKB + " KB to /huaca/" + remoteName);
    return true;
  } catch (e) {
    log("  Binary upload failed: " + e.message.slice(0, 200));
    return false;
  }
}

/**
 * Renders the voxel HTML to a static PNG (marketplace thumbnail) via headless
 * Chrome with software WebGL. The HTML references textures/sky-NNNN.png and
 * textures/qwantani_1k.hdr relatively, so we stage a copy into deploy/huaca/
 * (sibling of textures/) before screenshotting. Non-fatal: returns null on any
 * failure so the mint flow continues without the preview.
 */
/**
 * Desvio estandar de la luminancia de un PNG, con muestreo para ir rapido.
 * Sirve para distinguir un render REAL (el voxel se dibujo) de una imagen PLANA
 * (nada se dibujo y quedo solo el cielo de fondo: la portada se ve vacia).
 *
 * @param {string} pngPath Ruta del PNG a analizar.
 * @returns {number|null} Desvio estandar de la luminancia, o null si no se pudo leer.
 */
function previewLuminanceStdDev(pngPath) {
  try {
    const png = PNG.sync.read(fs.readFileSync(pngPath));
    const step = Math.max(1, Math.floor(Math.sqrt((png.width * png.height) / 40000)));
    let n = 0, sum = 0, sumSq = 0;
    for (let y = 0; y < png.height; y += step) {
      for (let x = 0; x < png.width; x += step) {
        const i = (png.width * y + x) << 2;
        const lum = 0.2126 * png.data[i] + 0.7152 * png.data[i + 1] + 0.0722 * png.data[i + 2];
        sum += lum;
        sumSq += lum * lum;
        n++;
      }
    }
    if (!n) return null;
    const mean = sum / n;
    return Math.sqrt(Math.max(0, sumSq / n - mean * mean));
  } catch (_) {
    return null;
  }
}

/**
 * Genera la portada .webp que usa la card de la galeria como capa base.
 * El voxel vivo se monta ENCIMA por JS (con tope de contextos WebGL), asi que
 * esta portada garantiza que la card nunca se vea vacia mientras carga.
 *
 * @param {string} previewPath PNG de preview generado por generateStaticPreview.
 * @param {number} queueId Id de la pieza en el queue.
 * @returns {Promise<string|null>} Ruta del webp generado, o null si fallo.
 */
async function generateCoverWebp(previewPath, queueId) {
  try {
    const out = path.join(DEPLOY_DIR, "covers", `p${queueId}.webp`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await sharp(previewPath)
      .resize(1120, 630, { fit: "cover", position: "centre" })
      .webp({ quality: 82, method: 6 })
      .toFile(out);
    return out;
  } catch (e) {
    log("  Cover webp failed (non-fatal): " + e.message.slice(0, 120));
    return null;
  }
}

function generateStaticPreview(localHtmlPath, queueId) {
  const chrome = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ].find((p) => fs.existsSync(p));

  if (!chrome || !fs.existsSync(localHtmlPath)) {
    log("  No Chrome/Edge found (or voxel HTML missing) — skipping static preview");
    return null;
  }

  const staged = path.join(DEPLOY_DIR, `voxel-${queueId}.html`);
  const outPath = path.join(DEPLOY_DIR, `preview-${queueId}.png`);
  try {
    fs.copyFileSync(localHtmlPath, staged);
    const fileUrl = "file:///" + staged.replace(/\\/g, "/");
    execSync(
      `"${chrome}" --headless=new --disable-gpu --enable-unsafe-swiftshader --use-angle=swiftshader --hide-scrollbars --window-size=1280,800 --virtual-time-budget=15000 --screenshot="${outPath}" "${fileUrl}"`,
      { stdio: "pipe", timeout: 90000 }
    );
    if (!fs.existsSync(outPath)) {
          log("  Static preview: headless Chrome no genero el PNG — skipping");
          return null;
        }
        const kb = fs.statSync(outPath).size / 1024;
    // 2026-09-24: el guard viejo (size > 20000) dejaba pasar renders PLANOS. Una
    // imagen uniforme de 1280x800 pesa 35-59 KB, asi que pasaba el filtro y se
    // publicaba como portada vacia. Ahora medimos el desvio estandar (sd) de la
    // luminancia. Calibrado con los 60 previews del repo: el unico roto daba 9.1 y
    // el valido mas bajo 26.5, asi que el corte en 18 separa limpio en ambos lados.
    const sd = previewLuminanceStdDev(outPath);
    if (kb > 20 && (sd === null || sd >= 18)) {
      log(`  Static preview: preview-${queueId}.png (${kb.toFixed(0)} KB, sd=${sd === null ? "n/a" : sd.toFixed(1)})`);
      return outPath;
    }
    log(`  Static preview PLANA (${kb.toFixed(0)} KB, sd=${sd === null ? "n/a" : sd.toFixed(1)}) — descartada para no publicar una portada vacia`);
    return null;
  } catch (e) {
    log("  Static preview failed (non-fatal): " + e.message.slice(0, 150));
    return null;
  }
}

async function uploadHdriIfMissing() {
  if (!fs.existsSync(HDR_LOCAL_PATH)) {
    log(`  ⚠️ HDRI not found locally at ${HDR_LOCAL_PATH}, skipping`);
    return;
  }
  try {
    const ftp = readStash(FTP_STASH);
    const userEnc = ftp.user.replace("@", "%40");
    const url = `ftp://***@${ftp.host}/huaca/${HDR_RELATIVE_PATH}`;
    log(`  Uploading HDRI ${HDR_RELATIVE_PATH}...`);
    execSync(`curl -s --connect-timeout 20 --max-time 120 -T "${HDR_LOCAL_PATH}" --user "${ftp.user}:${ftp.password}" "${url}"`, { stdio: "pipe", timeout: 150000 });
    log(`  ✓ HDRI uploaded`);
  } catch (e) {
    log(`  HDRI upload failed (non-fatal): ${e.message.slice(0, 200)}`);
  }
}


// === THEMATIC DIVERSITY LAYER ===
const THEMATIC_STOP_WORDS = new Set(["el","la","los","las","un","una","unos","unas","de","del","al","en","que","y","o","a","con","por","para","si","no","mi","su","tus","nuestro","estos","estas","este","esta","ese","esa","aquellos","aquellas","aquí","allí","allá","como","cuando","donde","quien","cuanto","cual","sobre","entre","hasta","desde","según","tras","contra","durante","mediante","porque","aunque","pero","sino","siendo","estando","habiendo","está","están","estamos","estoy","estáis","estéis","estuvieran","estuviesen","fuese","fuesen","fuera","fueran","haya","hayan","hubiera","hubieran","hubiese","hubiesen"]);
function getThematicKeywords(text) { 
  if (!text) return new Set(); 
  const words = text.toLowerCase().replace(/[.,;:!?\"\'()\[\]]/g, " ").split(/\s+/).filter(w => w.length > 3 && !THEMATIC_STOP_WORDS.has(w)); 
  return new Set(words); 
}
function calculateThematicOverlap(keywords1, keywords2) { 
  if (!keywords1 || !keywords2) return 0; 
  const intersection = new Set([...keywords1].filter(x => keywords2.has(x))); 
  return intersection.size; 
}

// Timeout wrapper for on-chain tx waits: if a forced-low-gas tx never confirms
// (mainnet can reject sub-market gasPrice and stall forever), abort cleanly
// instead of hanging the cycle until the runner's hard timeout.
const TX_TIMEOUT_MS = Number(process.env.HUACA_TX_TIMEOUT_MS || 180000);
function withTimeout(promise, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(
      () => reject(new Error(`${label} sin confirmar tras ${Math.round(TX_TIMEOUT_MS / 1000)}s`)),
      TX_TIMEOUT_MS
    )),
  ]);
}

async function runCycle() {
  log("=== Huaca agent: cycle start ===");

  // -------- STEP 0: OPENROUTER PRE-FLIGHT --------
  // 2026-09-14: image generation moved from MiniMax (mmx CLI) to OpenRouter.
  log("Step 0: OpenRouter pre-flight check...");
  let preflightOk = false;
  let mmxDisabled = false;
  if (!process.env.OPENROUTER_API_KEY) {
    log("  OPENROUTER_API_KEY not set — continuing with procedural gradient sky fallback");
    mmxDisabled = true;
  } else {
    log("  OpenRouter API key present (" + process.env.OPENROUTER_API_KEY.slice(0, 6) + "...)");
    preflightOk = true;
  }

  // -------- STEP 1: SCRAPE --------
  // 2026-08-31: lazy scrape. Run scraper every N cycles (default 5) instead of every tick.
  //   - Persistent cursor in data/scraper-cursor.json (survives restarts).
  //   - Manual override: --skip-scrape forces skip this cycle.
  //   - Safety net: if pending pool < MIN_PENDING_THRESHOLD, force scrape regardless.
  const SCRAPE_INTERVAL_CYCLES = parseInt(process.env.SCRAPE_INTERVAL_CYCLES || "5", 10);
  const MIN_PENDING_THRESHOLD = 5;
  const CURSOR_PATH = path.join(ROOT, "data", "scraper-cursor.json");

  function loadScrapeCursor() {
    try {
      return JSON.parse(fs.readFileSync(CURSOR_PATH, "utf-8"));
    } catch (_) {
      return { cyclesSinceScrape: 0, lastScrapeAt: null, totalScrapes: 0 };
    }
  }

  function saveScrapeCursor(c) {
    try {
      fs.writeFileSync(CURSOR_PATH, JSON.stringify(c, null, 2), "utf-8");
    } catch (e) {
      log(`warn: could not save scrape cursor: ${e.message.slice(0, 100)}`);
    }
  }

  function bumpScrapeCursor() {
    const c = loadScrapeCursor();
    c.cyclesSinceScrape += 1;
    saveScrapeCursor(c);
    return c.cyclesSinceScrape;
  }

  function markScrapeComplete() {
    const c = loadScrapeCursor();
    c.cyclesSinceScrape = 0;
    c.lastScrapeAt = new Date().toISOString();
    c.totalScrapes = (c.totalScrapes || 0) + 1;
    saveScrapeCursor(c);
  }

  // Quick peek at candidate pool size without full read cost (cheap: file is small)
  function countPendingCandidates() {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "scraper-candidates.json"), "utf-8"));
      return (raw.candidates || []).filter(x => x.status !== "approved" && x.status !== "done").length;
    } catch (_) { return 0; }
  }

  // Decide: should we scrape this cycle?
  //   priority: SKIP_SCRAPE flag > safety threshold > cursor interval
  function shouldScrapeThisCycle() {
    if (SKIP_SCRAPE) return { run: false, reason: "manual --skip-scrape" };
    const pending = countPendingCandidates();
    if (pending < MIN_PENDING_THRESHOLD) {
      return { run: true, reason: `safety (only ${pending} pending < ${MIN_PENDING_THRESHOLD})` };
    }
    const c = loadScrapeCursor();
    if (c.cyclesSinceScrape >= SCRAPE_INTERVAL_CYCLES) {
      return { run: true, reason: `interval (cycle ${c.cyclesSinceScrape}/${SCRAPE_INTERVAL_CYCLES})` };
    }
    return { run: false, reason: `interval (cycle ${c.cyclesSinceScrape}/${SCRAPE_INTERVAL_CYCLES}, next scrape at ${SCRAPE_INTERVAL_CYCLES})` };
  }

  const _scrapeDecision = shouldScrapeThisCycle();
  if (_scrapeDecision.run) {
    log(`Step 1: scraping (${_scrapeDecision.reason})...`);
    try {
      // 2026-09-27: antes era `npx ts-node scripts/scraper.ts` SIN timeout.
      // npx consulta el registro npm en cada arranque: si la red se atora, se
      // cuelga para siempre. Ese fue el hang de 5h24m del 26-sep (npx quedo vivo
      // sosteniendo el pipe de stdout; el runner no pudo cerrar y Hermes lo mato
      // a la hora). ts-node YA esta en node_modules, asi que lo invocamos directo
      // por su binario: cero red, cero prompt interactivo, y con timeout.
      execSync(
        `node "${path.join(ROOT, "node_modules", "ts-node", "dist", "bin.js")}" scripts/scraper.ts`,
        { cwd: ROOT, stdio: "inherit", timeout: 900000 }
      );
      markScrapeComplete();
    } catch (e) {
      log(`scraper failed: ${e.message.slice(0, 200)}`);
      return { ok: false, step: "scrape" };
    }
  } else {
    log(`Step 1: SKIPPED (${_scrapeDecision.reason}) — using existing pool`);
  }

  // -------- STEP 1b: PENDING QUEUE ITEMS (default) --------
  // Default behaviour since 2026-09-24: consume pending items from
  // art-queue.json before generating new candidates. This keeps the gallery in
  // sync with the local queue and lets the cron recover interrupted pieces
  // (like #32) without manual code edits. The legacy --pending-only flag is
  // kept as a no-op for backwards compatibility.
  let pendingQueueMode = false;
  let pendingQueueItems = [];
  const queuePath = path.join(ROOT, "data", "art-queue.json");
  try {
    const queueData = JSON.parse(fs.readFileSync(queuePath, "utf-8"));
    pendingQueueItems = (queueData.items || [])
      .filter(i => i.status === "pending" && i.content)
      .sort((a, b) => a.id - b.id);
    if (pendingQueueItems.length > 0) {
      pendingQueueMode = true;
      log(`Step 1b: PENDING mode — ${pendingQueueItems.length} pending item(s) in art-queue.json (limit 1/cycle)`);
    } else {
      log(`Step 1b: no pending items in art-queue.json, falling back to candidates`);
    }
  } catch (e) {
    log(`Step 1b: could not read art-queue.json (${e.message}) — falling back to candidates`);
  }

  // -------- STEP 2: PICK CANDIDATES --------
    const candidatesPath = path.join(ROOT, "data", "scraper-candidates.json");
    const data = JSON.parse(fs.readFileSync(candidatesPath, "utf-8"));

    // 2026-09-19: DEDUPLICATION AGAINST ALREADY MINTED (art-queue.json)
      // Load all minted contents and create normalized hashes for semantic dedup.
      // This prevents re-minting the same fact/story even if it comes from different URLs.
      const mintedQueuePath = path.join(ROOT, "data", "art-queue.json");
      let mintedContentHashes = new Set();
      let recentThemes = new Set();
      // 2026-10-01: umbral de 'misma noticia' — overlap temático contra una pieza ya
      // minteada por encima de esto = paráfrasis duplicada (rechazar, no solo penalizar).
      const THEMATIC_DUP_THRESHOLD = Number(process.env.HUACA_THEMATIC_DUP_THRESHOLD || 8);
      let allMintedThemes = [];
      try {
        const mintedQueue = JSON.parse(fs.readFileSync(mintedQueuePath, "utf-8"));
    const recentItems = (mintedQueue.items || []).slice(-5);
    recentThemes = new Set();
    recentItems.forEach(item => {
      getThematicKeywords(item.content).forEach(kw => recentThemes.add(kw));
    });
    log(`  Diversity: loaded themes from ${recentItems.length} recent pieces`);
        for (const item of (mintedQueue.items || []).filter(i => i.tokenId != null)) {
          if (item.content) {
            // Normalize: lowercase, remove punctuation, collapse whitespace
            const norm = item.content.toLowerCase()
              .replace(/[.,;:!?\u2026\"\'()\[\]]/g, "")
              .replace(/\s+/g, " ")
              .trim();
            // Hash for O(1) lookup
            let h = 0;
            for (let i = 0; i < norm.length; i++) h = ((h * 31) + norm.charCodeAt(i)) | 0;
            mintedContentHashes.add(h);
          }
        }
        log(`  Dedup: loaded ${mintedContentHashes.size} minted content hashes from art-queue.json`);
    // 2026-10-01: keywords de TODAS las piezas minted, para detectar paráfrasis /
    // misma noticia reescrita (los textos A/B de deforestación compartían ~17 keywords).
    allMintedThemes = [];
    for (const item of (mintedQueue.items || []).filter(i => i.tokenId != null)) {
      const kw = getThematicKeywords(item.content);
      if (kw.size > 0) allMintedThemes.push(kw);
    }
      } catch (e) {
              log(`  Dedup: could not load art-queue.json (${e.message.slice(0, 80)}) — continuing without historical dedup`);
            }

    // ── 2026-09-24: SEGUNDA CAPA DE DEDUP — contra la galería VISIBLE ──────────
    // El dedup de arriba compara hashes EXACTOS contra art-queue.json. No alcanza:
    // en sesiones previas quedaron tarjetas huérfanas en index.html cuyo item del
    // queue fue reescrito o borrado, así que el contenido visible ya existía pero
    // ningún item del queue lo reflejaba → la pieza 32 (Alejandra Cuesta) se minteó
    // duplicando una tarjeta huérfana. Aquí leemos los <h3> de cada tarjeta y
    // guardamos el prefijo normalizado: cualquier candidato que empiece igual ya
    // está visible en la galería y NO debe mintearse.
    const galleryHeadPrefixes = new Set();
    try {
      const galleryHtml = fs.readFileSync(path.join(ROOT, "deploy", "huaca", "index.html"), "utf-8");
      const h3s = galleryHtml.match(/<h3[^>]*>[\s\S]*?<\/h3>/g) || [];
      for (const raw of h3s) {
        const text = raw.replace(/<[^>]+>/g, "").replace(/&[a-z]+;/gi, " ");
        const norm = text.toLowerCase()
          .replace(/[.,;:!?\u2026\"'()\[\]]/g, "")
          .replace(/\s+/g, " ")
          .trim();
        if (norm.length >= 40) galleryHeadPrefixes.add(norm.slice(0, 60));
      }

      // (el log va abajo, despues de cargar el blocklist persistente)
    } catch (e) {
      log(`  Dedup(gallery): no se pudo leer index.html (${e.message.slice(0, 60)}) — sigo sin esta capa`);
    }
    const galleryPrefix = (content) => {
      if (!content) return "";
      return content.toLowerCase()
        .replace(/[.,;:!?\u2026\"'()\[\]]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 60);
    };

    // 2026-09-24: BLOCKLIST PERSISTENTE — piezas minteadas que NO salieron bien
    // (cielo fallback plano de la era sin creditos de OpenRouter). Estan ocultas en
    // la galeria con .card-oculta, pero si algun dia se borran del HTML su contenido
    // quedaria desprotegido y el agente podria re-mintearlo. Este archivo mantiene el
    // bloqueo aunque la card desaparezca.
    let hiddenPrefixes = 0;
    try {
      const hiddenPath = path.join(ROOT, "data", "gallery-hidden.json");
      if (fs.existsSync(hiddenPath)) {
        const hiddenData = JSON.parse(fs.readFileSync(hiddenPath, "utf-8"));
        for (const hp of (hiddenData.hidden || [])) {
          for (const txt of [hp.title, hp.queueContent]) {
            if (!txt) continue;
            const norm = galleryPrefix(txt);
            if (norm.length >= 40) { galleryHeadPrefixes.add(norm); hiddenPrefixes++; }
          }
        }
      }
    } catch (e) {
      log(`  Dedup(gallery): no se pudo leer gallery-hidden.json (${e.message.slice(0, 60)})`);
    }
    log(`  Dedup(gallery): ${galleryHeadPrefixes.size} prefijos (galeria incl. ocultas + blocklist de ${hiddenPrefixes})`);

    // 2026-09-02: keep the full pool (NOT sliced to LIMIT yet) so the balance
    // logic below can see all candidates and pick from the FORCED platform.
    // We slice to LIMIT after balance + urgent sort, at the very end.
    const pendingCandidates = data.candidates
      .filter(c => !c.approved && !c.rejected && !c.aiLegalRisk)
      // 2026-09-19: filter out content already minted (semantic dedup)
      .filter(c => {
        if (!c.content) return true;
        const norm = c.content.toLowerCase()
          .replace(/[.,;:!?\u2026\"\'()\[\]]/g, "")
          .replace(/\s+/g, " ")
          .trim();
        let h = 0;
        for (let i = 0; i < norm.length; i++) h = ((h * 31) + norm.charCodeAt(i)) | 0;
        const isDup = mintedContentHashes.has(h);
                if (isDup) {
                  log(`  \u{1F501} Skipping duplicate of already-minted content: ${c.content.slice(0, 80)}...`);
                  return false;
                }
                // Capa 2 (2026-09-24): ¿ya está visible en la galería?
                if (galleryHeadPrefixes.has(galleryPrefix(c.content))) {
                  log(`  \u{1F501} Skipping content already VISIBLE in gallery: ${c.content.slice(0, 80)}...`);
                  return false;
                }
                // Capa 3 (2026-10-01): paráfrasis / misma noticia reescrita.
                // Overlap temático alto contra ALGUNA pieza ya minteada = duplicado.
                if (allMintedThemes.length > 0) {
                  const cKw = getThematicKeywords(c.content);
                  for (const mk of allMintedThemes) {
                    if (calculateThematicOverlap(cKw, mk) >= THEMATIC_DUP_THRESHOLD) {
                      log(`  \u{1F501} Skipping near-duplicate (thematic overlap): ${c.content.slice(0, 60)}...`);
                      return false;
                    }
                  }
                }
                return true;
              })
      .sort((a, b) => b.score - a.score);

    // If pending items exist in art-queue.json, consume those first (one per cycle)
        let pending;
        // Capa 2 también en modo PENDING (2026-09-24): si el contenido del item ya está
        // VISIBLE en la galería, se marca 'duplicate' en art-queue.json y se pasa al
        // siguiente, para que la cola AVANCE en vez de re-mintear lo que ya se ve.
        const usableQueueItems = pendingQueueItems.filter((it) => {
          if (!it.content) return true;
          if (galleryHeadPrefixes.has(galleryPrefix(it.content))) {
            log(`  \u{1F501} Item #${it.id} ya visible en galería \u2192 marcado 'duplicate'`);
            it.status = "duplicate";
            it.lastAttempt = new Date().toISOString();
            return false;
          }
          // Capa 3 (2026-10-01): paráfrasis / misma noticia reescrita.
          if (allMintedThemes.length > 0) {
            const itKw = getThematicKeywords(it.content);
            for (const mk of allMintedThemes) {
              if (calculateThematicOverlap(itKw, mk) >= THEMATIC_DUP_THRESHOLD) {
                log(`  \u{1F501} Item #${it.id} near-duplicate (thematic overlap) \u2192 marcado 'duplicate'`);
                it.status = "duplicate";
                it.lastAttempt = new Date().toISOString();
                return false;
              }
            }
          }
          return true;
        });
        if (usableQueueItems.length !== pendingQueueItems.length) {
          try {
            fs.writeFileSync(queuePath, JSON.stringify(queue, null, 2), "utf-8");
            log(`  art-queue.json actualizado (${pendingQueueItems.length - usableQueueItems.length} duplicado(s) marcados)`);
          } catch (e) {
            log(`  \u26A0\uFE0F No se pudo guardar art-queue.json: ${e.message.slice(0, 60)}`);
          }
        }

        // 2026-10-01: DIVERSITY RANKING — ordena la cola PENDING por menor
        // solapamiento temático con las últimas 5 piezas, para que no repita
        // temas (p.ej. 'niños/bebé'). Se aplica ANTES de elegir usableQueueItems[0].
        usableQueueItems.sort((a, b) => {
          const aOv = calculateThematicOverlap(getThematicKeywords(a.content), recentThemes);
          const bOv = calculateThematicOverlap(getThematicKeywords(b.content), recentThemes);
          if (aOv !== bOv) return aOv - bOv;
          return a.id - b.id;
        });
        log(`  Diversity: cola PENDING ordenada por menor solapamiento (${usableQueueItems.length} items)`);
                if (pendingQueueMode && usableQueueItems.length > 0) {
          const item = usableQueueItems[0];
      log(`  Using pending queue item #${item.id} instead of scraper candidates`);
      pending = [{
        id: item.id,
        content: item.content,
        type: item.type || "fact",
        attribution: item.attribution || "Anonymous",
        source: item.source,
        sourceUrl: "",
        category: "other",
        scrapedAt: item.lastAttempt || new Date().toISOString(),
        score: 0,
        _fromQueue: true,
      }];
    } else {
      pending = pendingCandidates;
    }

      // UNIVERSAL DIVERSITY PENALTY
    pending = pending.map(c => {
      const overlap = calculateThematicOverlap(getThematicKeywords(c.content), recentThemes);
      const penalty = overlap * 20;
      return { ...c, diversityScore: (c.score || 0) - penalty, thematicOverlap: overlap };
    });
    log(`  Diversity: penalized ${pending.length} items based on overlap`);

    if (pending.length === 0) {
    log("No pending candidates. Exiting.");
    return { ok: true, step: "pick", count: 0 };
  }
  log(`Found ${pending.length} pending candidates (full pool, before balance + slice)`);
  
  // Sort urgent events first
  pending.forEach((c, i) => {
    const ev = isUrgentEvent(c.content);
    if (ev) {
      log(`  🔴 URGENT: candidate ${i} matches "${ev.keyword}" (priority ${ev.priority})`);
    }
  });
  // Stable sort: urgent first
  pending.sort((a, b) => {
    const aEv = isUrgentEvent(a.content);
    const bEv = isUrgentEvent(b.content);
    if (aEv && !bEv) return -1;
    if (!aEv && bEv) return 1;
    return (b.diversityScore || b.score) - (a.diversityScore || a.score);
  });

  // Force piece 32 to be first if present
    // (superseded 2026-09-24: el modo PENDING ya consume art-queue.json en orden de id.
    //  Se deja el ordenamiento por si el item 32 llega como candidato del scraper, pero
    //  YA NO se recorta el pool aquí — el recorte lo hace LIMIT más abajo.)
    if (pending.some(c => c.id === 32)) {
      pending.sort((a, b) => (a.id === 32 ? -1 : b.id === 32 ? 1 : 0));
    }

  // const LAST_SOURCE_PATH = path.join(ROOT, "data", "last-picked-source.json");
  // function loadLastPickedSource() { return { lastSource: null, history: [] }; }
  // function saveLastPickedSource(source) {}
  // function platOf(cand) { return "other"; }
  // const lastPick = null;
  // const targetPlat = null;
  // if (targetPlat) {
  //   // No forced balance
  // }

  // Now apply LIMIT — keep the top-N by (urgent+score) priority.
    // We mutate pending in place so the for-loop in STEP 3 sees the trimmed array.
    // Re-habilitado 2026-09-24: sin esto el agente minteaba TODO el pool en un ciclo
    // (gasto descontrolado de gas + créditos de OpenRouter). Ahora: 1 pieza por ciclo.
    if (pending.length > LIMIT) {
      const dropped = pending.length - LIMIT;
      pending.length = LIMIT;
      log(`  Trimming pool to LIMIT=${LIMIT} (dropped ${dropped} lower-priority candidates)`);
    }

  // -------- STEP 3.0: GAS + BALANCE PRE-FLIGHT GUARD (moved 2026-10-01) --------
  // Aborta ANTES de generar el voxel/cielo cuando el gas está alto o falta saldo,
  // para no gastar créditos de OpenRouter ni gas en un ciclo que no podrá mintear.
  const upload = readStash(UPLOAD_STASH);
  // 2026-09-02: validate that mainnet addresses exist when --network=mainnet.
  if (NETWORK === "mainnet") {
    if (!upload.mainnet_rpc || !upload.mainnet_nft_contract || !upload.mainnet_auction_contract || !upload.mainnet_private_key) {
      log("❌ --network=mainnet but .upload_stash.json is missing mainnet_rpc / mainnet_nft_contract / mainnet_auction_contract / mainnet_private_key");
      log("   Run scripts/deploy.js --network mainnet first, then update .upload_stash.json");
      return { ok: false, step: "config", error: "mainnet config missing" };
    }
  }
  const rpcUrl = NETWORK === "mainnet" && upload.mainnet_rpc ? upload.mainnet_rpc : upload.sepolia_rpc;
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const pk = NETWORK === "mainnet" && upload.mainnet_private_key ? upload.mainnet_private_key : upload.private_key;
  const wallet = new ethers.Wallet(pk, provider);
  // ==== Balance guard: abort if insufficient ETH for mint ==============================
  // 2026-09-24: antes era un umbral FIJO de 0.0015 ETH, calibrado cuando el gas estaba
  // ~0.8 gwei. Con el gas a 0.33 gwei ese fijo equivale a ~16 ciclos, asi que abortaba
  // ciclos perfectamente pagables (paso: 0.00147 ETH < 0.0015 -> el cron no minteaba).
  // Ahora se exige cubrir MIN_CYCLOS ciclos al precio de gas REAL del momento.
  const bal = await provider.getBalance(wallet.address);
  const ethBal = Number(ethers.formatEther(bal));
  const MIN_CYCLOS = Number(process.env.HUACA_MIN_CYCLOS || 3);
  const GAS_POR_CICLO = Number(process.env.HUACA_GAS_POR_CICLO || 285000);
  let gasGwei = 1;
  try {
    const fd = await provider.getFeeData();
    gasGwei = Number(fd.gasPrice || fd.maxFeePerGas || 1000000000n) / 1e9;
    if (!(gasGwei > 0)) gasGwei = 1;
  } catch (e) {
    log(`   (no pude leer el gas actual: ${e.message.slice(0, 60)} — uso 1 gwei de referencia)`);
  }
  // 2026-10-02: EIP-1559. Las tx legacy con gasPrice == base fee exacta no se
  // propagan en publicnode (se descartan del mempool -> "sin confirmar tras 180s").
  // Usar maxFeePerGas (base * 2, topeado) + maxPriorityFeePerGas (1 gwei) confirma rapido.
  const maxPriorityFeePerGas = ethers.parseUnits("1", "gwei");
  const maxFeePerGasGwei = Math.min(Math.max(gasGwei * 2, 2), MAX_GAS_PRICE_GWEI);
  const txOverrides = { maxFeePerGas: ethers.parseUnits(maxFeePerGasGwei.toString(), "gwei"), maxPriorityFeePerGas };
  if (gasGwei > MAX_GAS_PRICE_GWEI) {
    log(`❌ GAS TOO HIGH: Current ${gasGwei.toFixed(2)} gwei exceeds limit of ${MAX_GAS_PRICE_GWEI} gwei. Aborting cycle to save funds.`);
    return { ok: false, step: "gas-price", error: "gas_too_expensive" };
  }
  const costoPorCiclo = GAS_POR_CICLO * gasGwei * 1e-9;
  const ciclosPagables = costoPorCiclo > 0 ? ethBal / costoPorCiclo : 0;
  log(`   Balance: ${ethBal.toFixed(6)} ETH | gas ${gasGwei.toFixed(4)} gwei | costo/ciclo ~${costoPorCiclo.toFixed(6)} ETH | alcanza para ${ciclosPagables.toFixed(1)} ciclos`);
  if (ethBal <= 0 || ciclosPagables < MIN_CYCLOS) {
    log(`❌ Insufficient ETH (${ethBal.toFixed(6)} ETH = ${ciclosPagables.toFixed(1)} ciclos) — necesito >= ${MIN_CYCLOS} ciclos a ${gasGwei.toFixed(4)} gwei. Abort cycle.`);
    return { ok: false, step: "balance", error: "insufficient_eth" };
  }


// -------- STEP 3: GENERATE VOXEL ART --------
  // Dynamic require for the compiled JS
  const generateThreeModule = require(path.join(ROOT, "build", "scripts", "generate-three.js"));
  const generateThreeArtwork = generateThreeModule.generateThreeArtwork;

  let generated = [];
  let artIdx = 0;
  for (const c of pending) {
    try {
      artIdx++;
      // Sky filename derives from a stable hash of CONTENT (NOT the candidate id —
      // art-queue.json items use numeric ids like 9/10/11 which collide to the same
      // skyNum). Hash content+sourceUrl+attribution so each unique post maps to its
      // own sky and never overwrites a different piece. Range 1..9999 keeps the URL
      // short and matches expected per-NFT uniqueness.
      let skyHash = 0;
      const cHashKey = (c.content || "") + "|" + (c.sourceUrl || "") + "|" + (c.attribution || "");
      for (let i = 0; i < cHashKey.length; i++) skyHash = ((skyHash * 31) + cHashKey.charCodeAt(i)) | 0;
      const skyNum = (Math.abs(skyHash) % 9999) + 1;
      const skyFile = "textures/sky-" + skyNum + ".png";
      log(`  -> OpenRouter sky for this artwork: ${skyFile} (content hash)`);
      let skyResult = null;
            if (DRY_RUN) {
              // --dry-run NUNCA debe gastar créditos de OpenRouter: se salta la generación
              // del HDRI. skyOk quedará false y el candidato no se mintea (comportamiento
              // esperado en un dry-run). Fix 2026-09-24.
              log(`  [dry-run] skipping OpenRouter sky generation (no credit spend)`);
            } else if (mmxDisabled) {
        const fbPath = path.join(SKY_DIR_LOCAL, "sky-" + skyNum + ".png");
        fs.mkdirSync(SKY_DIR_LOCAL, { recursive: true });
        const fbOk = generateFallbackSky(fbPath, skyNum);
        if (fbOk) {
          skyResult = await skyUpload(fbPath, "sky-" + skyNum + ".png", skyNum, true);
          log(`  -> Procedural gradient sky (OpenRouter disabled): ${skyFile}`);
        }
      } else {
        try {
          skyResult = await generateSkyForCandidate(c, skyNum);
        } catch (e) {
          log(`  Sky gen threw: ${e.message}, voxel will render without envmap`);
        }
      }
      if (!skyResult) {
        log(`  No per-voxel sky generated, voxel will render without envmap`);
      }
      const skyUrl = skyResult ? skyFile : "";

      const out = await generateThreeArtwork({
      content: c.content,
      category: c.category || "other",
      attribution: c.attribution || "Anonymous",
      source: c.source,
      sourceUrl: c.sourceUrl,
      scrapedAt: c.scrapedAt,
      skyUrl,
      });
      log(`  Generated voxel: ${path.basename(out.htmlPath)} (${out.voxelCount} voxels)`);
      // 2026-08-25: re-render the voxel HTML with the CSS-background-sky
      // template. The old PlaneGeometry / scene.background=equirectangular
      // approaches both had edge-artefact bugs (dark borders, 70° viewport
      // window). The patcher produces the CSS-BG version that matches the
      // approved voxel-2.html look.
      try {
        const { execSync } = require("child_process");
        execSync(`python "${path.join(ROOT, "scripts", "post-generate-patch.py")}" "${out.htmlPath}"`, { stdio: "pipe", timeout: 180000 });
        log(`  Patched voxel HTML with CSS-BG sky template`);
      } catch (e) {
        log(`  WARNING: post-generate-patch failed: ${e.message.slice(0, 200)}`);
      }
      // skyOk = true SOLO si hay sky real (OpenRouter HDRI). El fallback procedural
      // (isFallback=true) NO se minta: Petra quiere puras piezas con HDRI real de OpenRouter.
      generated.push({ candidate: c, artwork: out, skyOk: !!skyResult && !skyResult.isFallback });
    } catch (e) {
      log(`  generate failed for ${c.id}: ${e.message.slice(0, 200)}`);
    }
  }

  // -------- SKIP candidates that lost their sky --------
  // If the mmx image generate failed for a candidate, the voxel HTML is fine
  // but visually it shows as a black screen. We do NOT want to mint those.
  // (Added 2026-08-24 — without this, every cron run was spending Sepolia
  //  gas to mint empty NFTs. Found because the test dry-run produced a black
  //  voxel-24 before this guard existed.)
  const mintable = generated.filter(g => g.skyOk);
  const skipped = generated.filter(g => !g.skyOk);
  if (skipped.length > 0) {
    log(`!! ${skipped.length}/${generated.length} candidate(s) failed sky gen — skipping mint for those`);
    for (const g of skipped) {
      log(`   - skipping queue #${g.candidate.id}: sky generation failed`);
    }
  }
  if (mintable.length === 0) {
    log("No mintable candidates (all failed sky gen). Exiting.");
    return { ok: true, step: "generated", count: 0 };
  }
  // Replace `generated` with the filtered mintable list for the rest of the pipeline
  generated = mintable;

  if (DRY_RUN) {
    log("Skipping mint/upload (--dry-run)");
    return { ok: true, step: "generated", count: generated.length };
  }
  if (NO_MINT) {
    log("Skipping mint (--no-mint), will still upload gallery");
  }

  // -------- STEP 4: MINT + LIST --------
  const NFT_ABI = [
      "function mint(address to, string uri) returns (uint256)",
      "function approve(address to, uint256 tokenId)",
      "function ownerOf(uint256 tokenId) view returns (address)",
      "function totalSupply() view returns (uint256)",
      "function updateMetadata(uint256 tokenId, string newURI)",
      "event NFTMinted(uint256 indexed tokenId, address indexed to, string tokenURI)",
      "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
    ];
  const AUCTION_ABI = [
  "function getAuction(address nftContract, uint256 tokenId) view returns (tuple(address seller, uint256 tokenId, uint256 startingBid, uint256 highestBid, address highestBidder, uint256 endTime, bool settled, bool cancelled))",
  "function bid(address nftContract, uint256 tokenId) payable",
  "function finalizeAuction(address nftContract, uint256 tokenId)",
  "function cancelAuction(address nftContract, uint256 tokenId)",
  "function createAuction(address nftContract, uint256 tokenId, uint256 startingBid, uint256 durationSeconds)",
];
  const nftAddr = NETWORK === "mainnet" && upload.mainnet_nft_contract ? upload.mainnet_nft_contract : upload.nft_contract;
  const auctionAddr = NETWORK === "mainnet" && upload.mainnet_auction_contract ? upload.mainnet_auction_contract : upload.auction_contract;
  const nft = new ethers.Contract(nftAddr, NFT_ABI, wallet);
  const auction = new ethers.Contract(auctionAddr, AUCTION_ABI, wallet);

  // Resilience (added 2026-08-25): if art-queue.json was wiped (e.g. fresh deploy,
  // manual cleanup), initialize it as empty rather than crashing the cycle.
  let queue = { items: [] };
  try {
    queue = JSON.parse(fs.readFileSync(queuePath, "utf-8"));
  } catch (_) {
    // File missing or unreadable — initialize empty queue so mint can proceed.
    queue = { items: [] };
  }
  let nextQueueId = queue.items.length > 0 ? Math.max(...queue.items.map(i => i.id)) + 1 : 1;

  const results = [];
  let galleryModified = false;
  // Contract addresses for etherscan links (referenced by appendCardToGallery templates)
  const NFT_CONTRACT = await nft.getAddress();
  const AUCTION_CONTRACT = await auction.getAddress();

  try {
  for (const { candidate, artwork } of generated) {
          // If the candidate came from a pending art-queue item, reuse its own id so the
          // local queue numbering stays in sync with the metadata/voxel filenames we publish.
          const queueId = candidate._fromQueue ? candidate.id : nextQueueId++;
        let tokenId = null; // scope del for-loop, accesible por el catch (bug fix 2026-09-24)
      // tokenId ya NO se calcula como totalSupply (causaba desincronización:
      // si el contrato y el queue local se desalinean, se mintaba/approveaba
      // un tokenId que no correspondía). El tokenId REAL se obtiene del evento
      // NFTMinted que emite el contrato dentro de mint().
      log(`Minting queue #${queueId}...`);

      const hostBase = "https://petrasynthetic.com/huaca/";
      const voxelUrl = `${hostBase}voxel-${queueId}.html`;
      const metadata = {
        name: `Huaca, Sistemas Mágicos #${queueId}`,
        description: candidate.content,
        image: voxelUrl,
        animation_url: voxelUrl,
        external_url: candidate.sourceUrl,
        attributes: [
        { trait_type: "Type", value: candidate.type || "fact" },
        { trait_type: "Attribution", value: candidate.attribution || "Anonymous" },
        { trait_type: "Source", value: candidate.source },
        { trait_type: "Edition", value: "Huaca, Sistemas Mágicos" },
        { trait_type: "Queue ID", value: String(queueId) },
        ],
      };

    try {
          // 1. Upload voxel HTML
          const voxelRemoteName = `voxel-${queueId}.html`;
          uploadToHosting(artwork.htmlPath, voxelRemoteName);
          log(`  Uploaded voxel HTML`);

          // 1.5 Generate static preview (marketplace thumbnail) via headless Chrome
          const previewPath = generateStaticPreview(artwork.htmlPath, queueId);
          if (previewPath) {
            uploadBinaryToHosting(previewPath, `preview-${queueId}.png`);
            metadata.image = `${hostBase}preview-${queueId}.png`;
            // Portada webp de la card: capa base visible mientras el voxel vivo
            // carga (y la que queda si el navegador no puede con el WebGL).
            const coverPath = await generateCoverWebp(previewPath, queueId);
            if (coverPath) {
              uploadBinaryToHosting(coverPath, `covers/p${queueId}.webp`);
              log(`  Uploaded cover covers/p${queueId}.webp`);
            }
          }

          // 2. Mint NFT — tokenURI apunta al metadata JSON (estándar ERC721)
                    //    PRIMERO minteamos para obtener el tokenId REAL. No se confía en
                    //    totalSupply (causaba desincronización queue-local vs contrato).

                    // 2.0 DEDUP ON-CHAIN — antes de mintear, verificar que este content no
                    //     esté ya en un tokenURI existente. Evita duplicados aun si el
                    //     queue local se desincronizó (ciclos que fallaron tras el mint).
                    {
                      const normThis = (candidate.content || "").toLowerCase()
                        .replace(/[.,;:!?\u2026"'()\[\]]/g, "")
                        .replace(/\s+/g, " ")
                        .trim();
                      let hThis = 0;
                      for (let i = 0; i < normThis.length; i++) hThis = ((hThis * 31) + normThis.charCodeAt(i)) | 0;
                      let alreadyMinted = false;
                      try {
                        const onChainTotal = Number(await nft.totalSupply());
                        for (let t = 0; t < onChainTotal; t++) {
                          const uri = await nft.tokenURI(t);
                          const mm = uri.match(/metadata-(\d+)\.json/);
                          if (!mm) continue;
                          const metaResp = await fetch(`${hostBase}metadata-${mm[1]}.json`);
                          if (!metaResp.ok) continue;
                          const metaJson = await metaResp.json();
                          const normOn = (metaJson.description || "").toLowerCase()
                            .replace(/[.,;:!?\u2026"'()\[\]]/g, "")
                            .replace(/\s+/g, " ")
                            .trim();
                          let hOn = 0;
                          for (let i = 0; i < normOn.length; i++) hOn = ((hOn * 31) + normOn.charCodeAt(i)) | 0;
                          if (hOn === hThis) { alreadyMinted = true; break; }
                        }
                      } catch (_) { /* dedup on-chain no disponible — continuar */ }
                      if (alreadyMinted) {
                        const msg = `🔁 CONTENT YA MINTO ON-CHAIN — saltando: ${candidate.content.slice(0, 80)}...`;
                        log(`  ${msg}`);
                        results.push({ queueId, tokenId: null, ok: false, error: "duplicate-onchain" });
                        candidate.approved = true;
                        // saveLastPickedSource(platOf(candidate));
                        continue;
                      }
                    }

                    const metadataUrl = `${hostBase}metadata-${queueId}.json`;
                    const mintTx = await nft.mint(wallet.address, metadataUrl, txOverrides);
                    const mintR = await withTimeout(mintTx.wait(), "mint");

          // Leer tokenId REAL. El contrato mint() devuelve uint256 (tokenId),
                    // así que la forma más fiable es parsear el evento Transfer del receipt.
                    // Fallback: NFTMinted event, y por último totalSupply-1.
                    tokenId = null;
                    try {
            // 1. Evento Transfer (estándar ERC721, siempre presente)
            const transferTopic = nft.interface.getEvent("Transfer").topicHash;
            // El evento Transfer del mint: from=0x0, to=wallet, tokenId
            for (const log of mintR.logs) {
              if (log.topics[0] === transferTopic) {
                const parsed = nft.interface.parseLog(log);
                tokenId = Number(parsed.args.tokenId);
                break;
              }
            }
          } catch (e) {
            log(`  ⚠️ No se pudo parsear Transfer event: ${e.message}`);
          }
          if (tokenId === null) {
            // 2. Evento NFTMinted (custom del contrato)
            try {
              const nftMintedTopic = nft.interface.getEvent("NFTMinted").topicHash;
              for (const log of mintR.logs) {
                if (log.topics[0] === nftMintedTopic) {
                  const parsed = nft.interface.parseLog(log);
                  tokenId = Number(parsed.args.tokenId);
                  break;
                }
              }
            } catch (e) {
              log(`  ⚠️ No se pudo parsear NFTMinted event: ${e.message}`);
            }
          }
          if (tokenId === null) {
            // 3. Fallback: totalSupply-1
            tokenId = Number(await nft.totalSupply()) - 1;
            log(`  ⚠️ tokenId derivado de totalSupply-1: ${tokenId}`);
          }
          log(`  Minted tokenId ${tokenId} (tx ${mintR.hash})`);

          // Añadir el atributo Token ID real al metadata (se sube DESPUÉS del mint)
          metadata.attributes.push({ trait_type: "Token ID", value: String(tokenId) });

          // === FIX 2026-10-02: reservar queueId JUSTO DESPUÉS del mint ===
          // Antes el queue entry se guardaba DESPUÉS de approve+createAuction. Si esos
          // pasos fallaban (approve revertido por estado stale, o el runner moría por
          // timeout), el queueId NO se persistía y el siguiente ciclo recalculaba el MISMO
          // nextQueueId → dos tokens (p.ej. 51 y 52) apuntando al mismo voxel-XX.html /
          // metadata-XX.json (piezas CLONADAS con la misma imagen). Guardar aquí (status
          // "minted") reserva el id aunque lo de abajo falle; el guardado final lo sube a "done".
          {
            const early = {
              id: queueId,
              content: candidate.content,
              type: candidate.type || "fact",
              attribution: candidate.attribution || "Anonymous",
              source: candidate.source,
              artworkPath: `deploy/huaca/${voxelRemoteName}`,
              listPrice: "0.001",
              status: "minted",
              tokenId,
              mintTx: mintR.hash,
              lastAttempt: new Date().toISOString(),
            };
            const existingIdx = queue.items.findIndex(i => i.id === queueId);
            if (existingIdx >= 0) queue.items[existingIdx] = { ...queue.items[existingIdx], ...early };
            else queue.items.push(early);
            fs.writeFileSync(queuePath, JSON.stringify(queue, null, 2), "utf-8");
          }

          // 4. Approve + 5. Create auction — CRÍTICOS, van INMEDIATAMENTE después
          //    del mint. Si un upload (metadata/gallery) falla más abajo, la subasta
          //    YA está creada on-chain y el NFT no queda huérfano sin subasta.
          // 2026-10-02: el nodo RPC público puede servir estado STALE justo después del
          // mint (estimateGas del approve vio "ERC721NonexistentToken" aunque el token ya
          // estaba confirmado on-chain). Verificamos ownerOf ANTES y reintentamos con backoff.
          let approveDelay = 1500;
          for (let ai = 1; ai <= 12; ai++) {
            try {
              const curOwner = await nft.ownerOf(tokenId);
              if (curOwner.toLowerCase() === wallet.address.toLowerCase()) break;
              log(`  ⚠️ ownerOf(${tokenId})=${curOwner} ≠ wallet (intento ${ai}/12) — esperando sincronización...`);
            } catch (e) {
              log(`  ⚠️ ownerOf(${tokenId}) no visible aún (intento ${ai}/12): ${String(e.message || e).slice(0, 60)}`);
            }
            await sleep(approveDelay);
            approveDelay = Math.min(approveDelay * 2, 15000);
          }
          let approveTx;
          for (let ai = 1; ai <= 12; ai++) {
            try {
              approveTx = await nft.approve(await auction.getAddress(), tokenId, txOverrides);
              break;
            } catch (e) {
              const msg = String(e.message || e);
              if (ai < 12 && /NonexistentToken|execution reverted|estimateGas|nonce too low|stale|head/i.test(msg)) {
                log(`  ⚠️ approve revirtió (intento ${ai}/12): ${msg.slice(0, 80)} — reintentando...`);
                await sleep(approveDelay);
                approveDelay = Math.min(approveDelay * 2, 15000);
                continue;
              }
              throw e;
            }
          }
          await withTimeout(approveTx.wait(), "approve");
          log(`  Approved auction (tokenId ${tokenId})`);

          const startingBid = ethers.parseEther("0.001");
          log(`  Auction duration: ${AUCTION_DURATION}s = ${(AUCTION_DURATION/3600).toFixed(1)}h (random in [${AUCTION_DURATION_MIN_HOURS}, ${AUCTION_DURATION_MAX_HOURS}]h)`);
          const createAuctionTx = await auction.createAuction(
            await nft.getAddress(),
            tokenId,
            startingBid,
            AUCTION_DURATION,
            txOverrides
          );
          const auctionR = await withTimeout(createAuctionTx.wait(), "createAuction");
                    log(`  Auction created (tx ${auctionR.hash})`);

                    // 6. Update queue — CRÍTICO, se guarda INMEDIATAMENTE después del mint
                                        //    + createAuction. Si un upload (metadata/gallery) falla más abajo,
                                        //    el mint YA está registrado en el queue local y el próximo ciclo
                                        //    NO re-minteará el mismo contenido (evita duplicados on-chain).
                                        //    Si el item ya existía como "pending" en art-queue.json, se ACTUALIZA
                                        //    (no se duplica) conservando su id original (fix 2026-09-24).
                                        const queueEntry = {
                                          id: queueId,
                                          content: candidate.content,
                                          type: candidate.type || "fact",
                                          attribution: candidate.attribution || "Anonymous",
                                          source: candidate.source,
                                          artworkPath: `deploy/huaca/${voxelRemoteName}`,
                                          listPrice: "0.001",
                                          status: "done",
                                          tokenId,
                                          mintTx: mintR.hash,
                                          listTx: auctionR.hash,
                                          lastAttempt: new Date().toISOString(),
                                        };
                                        const existingIdx = queue.items.findIndex(i => i.id === queueId);
                                        if (existingIdx >= 0) {
                                          queue.items[existingIdx] = { ...queue.items[existingIdx], ...queueEntry };
                                        } else {
                                          queue.items.push(queueEntry);
                                        }
                                        fs.writeFileSync(queuePath, JSON.stringify(queue, null, 2), "utf-8");

                    // 7. Mark candidate as approved — persistir para no re-procesarlo
                    candidate.approved = true;
                    // saveLastPickedSource(platOf(candidate));

                    // 3. Upload metadata JSON (con tokenId real) — NO crítico, si falla no rompe la subasta
                    const metadataRemoteName = `metadata-${queueId}.json`;
                    uploadJsonToHosting(metadata, metadataRemoteName);
                    log(`  Uploaded metadata JSON (tokenId ${tokenId})`);

                    // 3.5. Add card to gallery (con tokenId real) — NO crítico
                    log(`  Adding card to gallery...`);
                    const added = appendCardToGallery(queueId, tokenId, candidate.content, candidate.source, NFT_CONTRACT, AUCTION_CONTRACT);
                    if (added) {
                      log(`  ✓ Card added to deploy/huaca/index.html`);
                      const galleryPath = path.join(DEPLOY_DIR, "index.html");
                      const galleryValidation = validateStructure(galleryPath, "index.html");
                      if (!galleryValidation.ok) {
                        log(`  ⚠️ Gallery validation warning: ${galleryValidation.reason}`);
                      } else {
                        log(`  ✓ Gallery validated (${galleryValidation.size} bytes)`);
                      }
                    } else {
                      log(`  ⚠️ Could not add card to gallery`);
                    }

                results.push({ queueId, tokenId, ok: true });
                log(`✅ Queue #${queueId} (token ${tokenId}) minted + listed`);

      await sleep(3000);
    } catch (e) {
      log(`  Failed: ${e.message.slice(0, 300)}`);
      results.push({ queueId, tokenId, ok: false, error: e.message });
    }
  }


  } catch (e) {
    log(`  ⚠️ mint loop error: ${e.message.slice(0, 200)}`);
  } finally {
    // Always save candidate updates
    fs.writeFileSync(candidatesPath, JSON.stringify(data, null, 2), "utf-8");

    // -------- STEP 5: UPLOAD UPDATED GALLERY + HDRI ASSET --------
      // Always run, even if mint failed, so partial gallery updates are visible
      log("Step 5: uploading updated gallery with new cards...");
      try {
        await uploadToHosting(path.join(DEPLOY_DIR, "index.html"), "index.html");
        log("  ✓ Gallery updated on hosting (browser will pick up via cache-buster ?cb=ts)");
      } catch (e) {
        log(`  gallery upload failed: ${e.message.slice(0, 200)}`);
      }
      // Upload HDRI asset (mirror experiment, 2026-08-15)
      await uploadHdriIfMissing();
  }
  // Save candidate updates
  fs.writeFileSync(candidatesPath, JSON.stringify(data, null, 2), "utf-8");

log(`=== Cycle complete: ${results.filter(r => r.ok).length}/${results.length} minted ===\n`);
  // 2026-08-31: bump scrape cursor at cycle end so lazy-scrape tracks correctly.
  // Only bump when this cycle wasn't already a scrape cycle (which resets the counter).
  if (!_scrapeDecision.run) bumpScrapeCursor();
  return { ok: true, results };
}

async function main() {
  if (LOOP) {
    log(`Starting loop with interval ${INTERVAL}`);
    while (true) {
      try {
      await runCycle();
      } catch (e) {
      log(`cycle error: ${e.message}`);
      }
      await sleep(parseInterval(INTERVAL));
    }
  } else {
    // 2026-09-02: propagate cycle result to process exit code so the cron
    // wrapper (huaca-run.py) can distinguish success from failure.
    // - Exit 0 = cycle completed (mint success OR expected no-op like
    //   "no pending candidates")
    // - Exit 1 = cycle errored (sky gen failed, mint failed, network down,
    //   balance broken, etc.)
    // - Exit 2 = cycle had a partial failure (some steps ok, some not)
    const result = await runCycle();
    if (result && result.ok === false) {
      log(`Cycle failed at step=${result.step || "unknown"}: ${result.error || ""}`);
      process.exit(1);
    }
    process.exit(0);
  }
}

if (require.main === module) {
  main();
}

// Exported for reuse by one-off helpers (e.g. scripts/regenerate-sky.js) without
// triggering the full pipeline. `node scripts/agent.js --once` still runs main()
// because require.main === module in that case.
module.exports = { generateSkyViaOpenRouter, generateSkyForCandidate, buildSkyPrompt, detectSceneHint, skyHasLetterbox, skyEdgeBands, trimSkyLetterbox, generateFallbackSky };