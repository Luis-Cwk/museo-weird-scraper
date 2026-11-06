// Repair script: añade metadata + card de galería para token 59 (queue #81)
// La subasta ya se creó con repair-token59.js. Este paso NO toca gas/on-chain,
// solo sube metadata-81.json y actualiza deploy/huaca/index.html (igual que
// el flujo normal del agente, Paso 3-3.5).
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = __dirname;
const DEPLOY_DIR = path.join(ROOT, "deploy", "huaca");
const FTP_STASH = path.join(DEPLOY_DIR, ".ftp_stash.json");

function readStash(file) {
  const raw = fs.readFileSync(file, "utf-8");
  const data = JSON.parse(raw);
  return data;
}

const QUEUE_ID = 81;
const TOKEN_ID = 59;
const NFT_CONTRACT = "0xcb6a534EF769416f7a7EC766df9928665a92858b";
const AUCTION_CONTRACT = "0xa0610efed22c6fa68954b35a11bc59d674691d77";

async function uploadToHosting(localPath, remoteName) {
  const ftp = readStash(FTP_STASH);
  const url = `ftp://***@${ftp.host}/huaca/${remoteName}`;
  console.log(`  Uploading ${remoteName}...`);
  execSync(`curl -s --connect-timeout 20 --max-time 120 -T "${localPath}" --user "${ftp.user}:${ftp.password}" "${url}"`, { stdio: "pipe", timeout: 150000 });
}

async function uploadJsonToHosting(obj, remoteName) {
  const tmpPath = path.join(DEPLOY_DIR, remoteName);
  fs.writeFileSync(tmpPath, JSON.stringify(obj, null, 2), "utf-8");
  await uploadToHosting(tmpPath, remoteName);
  fs.unlinkSync(tmpPath);
}

function appendCardToGallery(queueId, tokenId, content, source, nftContract, auctionContract) {
  const galleryPath = path.join(DEPLOY_DIR, "index.html");
  let html = fs.readFileSync(galleryPath, "utf-8");

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
  const cardTitleEscaped = cardTitle.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const voxelRel = `voxel-${queueId}.html`;
  const coverRel = `covers/p${queueId}.webp`;
  const cb = Date.now();
  const card = `
        <article class="card" data-id="${tokenId}" data-token-id="${tokenId}">
          <div class="card-art" data-voxel="${voxelRel}?cb=${cb}">
            <img class="card-cover" src="${coverRel}?cb=${cb}" alt="Voxel sculpture #${queueId}" loading="lazy" decoding="async" width="1120" height="630">
          </div>
          <div class="card-body">
            <h3 class="card-title">${cardTitleEscaped}</h3>
            <div class="card-attrs">
              <span class="attr">Type: story</span>
              <span class="attr">Source: ${source}</span>
            </div>
            <div class="auction" data-token-id="${tokenId}">
              <div class="auction-row"><span class="label">Status</span><span class="value status-cell">cargando...</span></div>
              <div class="auction-row"><span class="label">Bid actual</span><span class="value bid bid-cell">—</span></div>
              <div class="auction-row"><span class="label">Bidder</span><span class="value bidder-cell">—</span></div>
              <div class="auction-row"><span class="label">Seller</span><span class="value seller-cell">—</span></div>
              <div class="auction-row"><span class="label">Termina</span><span class="value time-cell">—</span></div>
            </div>
            <div class="card-desc-wrap"><p class="card-desc">${content.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}</p></div>
            <div class="card-actions">
              <button class="btn-bid" data-token-id="${tokenId}" data-bid-amount="0.001">Pujar</button>
              <button class="btn-settle" data-token-id="${tokenId}" style="display:none">Settle</button>
            </div>
          </div>
        </article>
`;
  const marker = "</main>";
  const idx = html.lastIndexOf(marker);
  if (idx === -1) return false;
  html = html.slice(0, idx) + card + html.slice(idx);
  fs.writeFileSync(galleryPath, html, "utf-8");
  return true;
}

async function main() {
  const q = JSON.parse(fs.readFileSync("data/art-queue.json", "utf-8"));
  const item = q.items.find((i) => i.tokenId === TOKEN_ID);
  if (!item) throw new Error("item no encontrado en art-queue.json");

  const hostBase = "https://petrasynthetic.com/huaca/";
  const voxelUrl = `${hostBase}voxel-${QUEUE_ID}.html`;
  const metadata = {
    name: `Huaca, Sistemas Mágicos #${QUEUE_ID}`,
    description: item.content,
    image: `${hostBase}preview-${QUEUE_ID}.png`,
    animation_url: voxelUrl,
    external_url: undefined,
    attributes: [
      { trait_type: "Type", value: item.type || "fact" },
      { trait_type: "Attribution", value: item.attribution || "Anonymous" },
      { trait_type: "Source", value: item.source },
      { trait_type: "Edition", value: "Huaca, Sistemas Mágicos" },
      { trait_type: "Queue ID", value: String(QUEUE_ID) },
    ],
  };

  console.log("1. Subiendo metadata-81.json...");
  await uploadJsonToHosting(metadata, `metadata-${QUEUE_ID}.json`);
  console.log("   ✓ metadata subida");

  console.log("2. Agregando card a la galería local...");
  const added = appendCardToGallery(QUEUE_ID, TOKEN_ID, item.content, item.source, NFT_CONTRACT, AUCTION_CONTRACT);
  console.log("   card added:", added);

  console.log("3. Subiendo index.html actualizado...");
  await uploadToHosting(path.join(DEPLOY_DIR, "index.html"), "index.html");
  console.log("   ✓ galería subida");

  console.log("4. Actualizando art-queue.json (status: done)...");
  item.status = "done";
  item.listTx = "0xae28d3b42d0fbc9e22065dcdc47d7d36abddc3713431aa49ed0d7d748da22961";
  fs.writeFileSync("data/art-queue.json", JSON.stringify(q, null, 2), "utf-8");
  console.log("   ✓ queue actualizado");

  console.log("LISTO — token 59 (queue 81) reparado.");
}

main().catch((e) => {
  console.error("ERROR:", e.message || e);
  process.exit(1);
});
