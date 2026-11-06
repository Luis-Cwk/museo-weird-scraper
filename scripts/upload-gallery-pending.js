// Append minted items to gallery and upload to FTP
// 2026-08-27: post-mint uploader for items that didn't get auto-appended

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const DEPLOY_DIR = path.join(ROOT, "deploy", "huaca");
const GALLERY = path.join(DEPLOY_DIR, "index.html");
const FTP_USER = "huaca@petrasynthetic.com";
const FTP_PASS = "&v0fNGy!!vr9U6L#";
const FTP_HOST = "ftp.petrasynthetic.com";

const NFT_CONTRACT = "0x46Bf7fEf25ad054B5Da2F41417E7d6676B9Bac81";
const AUCTION_CONTRACT = "0x82c5aBce122A131dB3016dA4cF91d36E5216245a";

// Load queue
const queue = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "art-queue.json"), "utf-8"));
console.log(`Queue has ${queue.items.length} items`);

// Read current gallery
let html = fs.readFileSync(GALLERY, "utf-8");
const initialCardCount = (html.match(/<article\s+class="card"/g) || []).length;
console.log(`Current gallery has ${initialCardCount} cards`);

// Process minted items (status: "done" or has tokenId)
const mintedItems = queue.items.filter(i => i.tokenId !== null && i.tokenId !== undefined);
console.log(`Minted items: ${mintedItems.length}`);

let added = 0;
for (const item of mintedItems) {
  // Skip if already in gallery (check by voxel-N reference)
  if (html.includes(`voxel-${item.id}.html?thumb=1`) || html.includes(`voxel-${item.id}.html"`)) {
    console.log(`Item ${item.id} already in gallery`);
    continue;
  }

  // Find the matching voxel HTML in latest build directory
  const runs = fs.readdirSync(path.join(ROOT, "data", "runs"))
    .filter(d => d.startsWith("2026-"))
    .sort()
    .reverse();

  let voxelHtml = null;
  for (const runDir of runs.slice(0, 10)) {
    const runPath = path.join(ROOT, "data", "runs", runDir);
    if (!fs.statSync(runPath).isDirectory()) continue;
    const files = fs.readdirSync(runPath).filter(f => f.startsWith("t_") && f.endsWith(".html"));
    for (const f of files) {
      const content = fs.readFileSync(path.join(runPath, f), "utf-8");
      // Match by content snippet (first 50 chars)
      if (content.includes((item.content || "").substring(0, 50))) {
        voxelHtml = `voxel-${item.id}.html`;
        // Also copy this HTML to deploy/huaca/voxel-N.html
        const deployPath = path.join(DEPLOY_DIR, voxelHtml);
        fs.copyFileSync(path.join(runPath, f), deployPath);
        console.log(`  Found voxel HTML: ${f} -> ${deployPath}`);
        break;
      }
    }
    if (voxelHtml) break;
  }

  if (!voxelHtml) {
    console.log(`  Could not find voxel HTML for item ${item.id}`);
    continue;
  }

  // Find associated metadata
  for (const runDir of runs.slice(0, 10)) {
    const runPath = path.join(ROOT, "data", "runs", runDir);
    if (!fs.statSync(runPath).isDirectory()) continue;
    const metaFiles = fs.readdirSync(runPath).filter(f => f.startsWith("t_") && f.endsWith(".json"));
    for (const f of metaFiles) {
      const meta = JSON.parse(fs.readFileSync(path.join(runPath, f), "utf-8"));
      if ((meta.content || "").substring(0, 50) === (item.content || "").substring(0, 50)) {
        // Copy metadata
        const deployMetaPath = path.join(DEPLOY_DIR, `metadata-${item.tokenId}.json`);
        fs.copyFileSync(path.join(runPath, f), deployMetaPath);
        console.log(`  Copied metadata to ${deployMetaPath}`);
        break;
      }
    }
  }

  // Build card title (truncate to 70 chars at word boundary)
  const rawTitle = (item.content || "").replace(/\s+/g, " ").trim();
  const titleMax = 70;
  let cardTitle;
  if (rawTitle.length <= titleMax) {
    cardTitle = rawTitle;
  } else {
    const slice = rawTitle.slice(0, titleMax);
    const lastSpace = slice.lastIndexOf(" ");
    const cut = lastSpace > 20 ? slice.slice(0, lastSpace) : slice;
    const trimmed = cut.replace(/[\s.,;:!?…]+$/, "");
    const lastChar = trimmed.slice(-1);
    const endsWithTerminal = [".", "!", "?", "…"].includes(lastChar);
    cardTitle = endsWithTerminal ? trimmed : trimmed + "…";
  }
  const cardTitleEscaped = cardTitle
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Build card HTML
  const cardHtml = `
        <article class="card" data-id="${item.id - 1}" data-token-id="${item.tokenId}">
          <div class="card-art">
            <iframe src="${voxelHtml}?thumb=1" loading="lazy" title="Voxel sculpture #${item.id}" sandbox="allow-scripts allow-same-origin"></iframe>
          </div>
          <div class="card-body">
            <h3 class="card-title">${cardTitleEscaped}</h3>
            <div class="card-attrs">
              <span class="attr">Type: ${item.type || "fact"}</span>
              <span class="attr">Source: ${(item.source || "").substring(0, 60)}</span>
            </div>
            <div class="auction" data-token-id="${item.tokenId}">
              <div class="auction-row"><span class="label">Status</span><span class="value status-cell">cargando...</span></div>
              <div class="auction-row"><span class="label">Bid actual</span><span class="value bid bid-cell">—</span></div>
              <div class="auction-row"><span class="label">Bidder</span><span class="value bidder-cell">—</span></div>
              <div class="auction-row"><span class="label">Seller</span><span class="value seller-cell">—</span></div>
              <div class="auction-row"><span class="label">Termina</span><span class="value time-cell">—</span></div>
            </div>
            <div class="card-actions">
              <a href="https://sepolia.etherscan.io/token/${NFT_CONTRACT}?a=${item.tokenId}" target="_blank" rel="noopener">Token ↗</a>
              <button class="btn-bid" data-token-id="${item.tokenId}" data-bid-amount="0.001">Pujar</button>
              <button class="btn-settle" data-token-id="${item.tokenId}" style="display:none">Settle</button>
              <a href="https://sepolia.etherscan.io/address/${AUCTION_CONTRACT}" target="_blank" rel="noopener">Subasta ↗</a>
            </div>
          </div>
        </article>
`;

  // Insert before </main>
  html = html.replace("</main>", cardHtml + "\n      </main>");
  added++;
  console.log(`Added card for item ${item.id} (token ${item.tokenId}): "${cardTitleEscaped.substring(0, 60)}"`);
}

if (added > 0) {
  fs.writeFileSync(GALLERY, html);
  console.log(`\nGallery saved with ${added} new cards (${initialCardCount} → ${initialCardCount + added})`);
} else {
  console.log("\nNo new cards added");
}

console.log("\n--- Now uploading to FTP ---");

// Upload gallery
try {
  const r = execSync(`curl -T "${GALLERY}" --user "${FTP_USER}:${FTP_PASS}" "ftp://${FTP_HOST}/huaca/index.html" --max-time 60`, { encoding: "utf-8" });
  console.log(`Gallery uploaded: ${r}`);
} catch (e) {
  console.log(`Gallery upload error: ${e.message}`);
}

// Upload voxel-N.html files
const voxelFiles = fs.readdirSync(DEPLOY_DIR).filter(f => f.match(/^voxel-\d+\.html$/));
for (const vf of voxelFiles) {
  try {
    execSync(`curl -T "${path.join(DEPLOY_DIR, vf)}" --user "${FTP_USER}:${FTP_PASS}" "ftp://${FTP_HOST}/huaca/${vf}" --max-time 60`, { encoding: "utf-8" });
    console.log(`Uploaded ${vf}`);
  } catch (e) {
    console.log(`Upload error for ${vf}: ${e.message}`);
  }
}

// Upload metadata files
const metaFiles = fs.readdirSync(DEPLOY_DIR).filter(f => f.match(/^metadata-\d+\.json$/));
for (const mf of metaFiles) {
  try {
    execSync(`curl -T "${path.join(DEPLOY_DIR, mf)}" --user "${FTP_USER}:${FTP_PASS}" "ftp://${FTP_HOST}/huaca/${mf}" --max-time 60`, { encoding: "utf-8" });
    console.log(`Uploaded ${mf}`);
  } catch (e) {
    console.log(`Upload error for ${mf}: ${e.message}`);
  }
}

console.log("\nDone.");
