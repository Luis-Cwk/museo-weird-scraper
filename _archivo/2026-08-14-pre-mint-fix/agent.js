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
const { validateStructure, verifyUpload } = require("../lib/validations");

dotenv.config();

const ROOT = path.join(__dirname, "..");
const DEPLOY_DIR = path.join(ROOT, "deploy", "huaca");
const FTP_STASH = path.join(DEPLOY_DIR, ".ftp_stash.json");
const UPLOAD_STASH = path.join(DEPLOY_DIR, ".upload_stash.json");
const LOG_PATH = path.join(ROOT, "logs", "agent.log");
const AUCTION_DURATION = 24 * 60 * 60; // 24h

// Args

// === EVENT TRIGGERS ===
// Urgent keywords that trigger automatic minting
const EVENT_TRIGGERS = [
  { keyword: 'temblor', priority: 'urgent', requiresMultiple: false },
  { keyword: 'sismo', priority: 'urgent', requiresMultiple: false },
  { keyword: 'seísmo', priority: 'urgent', requiresMultiple: false },
  { keyword: 'terremoto', priority: 'urgent', requiresMultiple: false },
  { keyword: 'inundación', priority: 'high', requiresMultiple: false },
  { keyword: 'inundacion', priority: 'high', requiresMultiple: false },
  { keyword: 'deslizamiento', priority: 'high', requiresMultiple: false },
  { keyword: 'incendio', priority: 'high', requiresMultiple: false },
  { keyword: 'sequía', priority: 'high', requiresMultiple: false },
  { keyword: 'sequia', priority: 'high', requiresMultiple: false },
];

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
const LIMIT = parseInt((args.find(a => a.startsWith("--limit=")) || "").split("=")[1] || "1", 10);
const LOOP = args.includes("--loop");
const SKIP_SCRAPE = args.includes("--skip-scrape");
const INTERVAL = (args.find(a => a.startsWith("--interval=")) || "").split("=")[1] || "6h";

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
  // VALIDATION LAYER 1: structural check
  log(`  Validating ${remoteName}...`);
  const validation = validateStructure(localPath, remoteName);
  if (!validation.ok) {
    log(`  ❌ Validation FAILED: ${validation.reason}`);
    throw new Error(`Validation failed for ${remoteName}: ${validation.reason}`);
  }
  log(`  ✓ Structural validation passed (${validation.size} bytes, sha256: ${validation.sha256.slice(0, 12)}...)`);

  // UPLOAD
  const ftp = readStash(FTP_STASH);
  const user = ftp.user.replace("@", "%40");
  const url = `ftp://${user}:${ftp.password}@${ftp.host}/huaca/${remoteName}`;
  log(`  Uploading ${remoteName}...`);
  execSync(`curl -s -P - -T "${localPath}" "${url}"`, { stdio: "pipe" });

  // VALIDATION LAYER 2: post-upload hash verification
  const publicUrl = `${ftp.public_url || "https://petrasynthetic.com/huaca/"}${remoteName}`;
  log(`  Verifying upload integrity (${publicUrl})...`);
  const verifyResult = await verifyUpload(publicUrl, validation.sha256);
  if (!verifyResult.ok) {
      log(`  ❌ Post-upload verification FAILED: ${verifyResult.reason}`);
      throw new Error(`Upload verification failed: ${verifyResult.reason}`);
    }
    log(`  ✓ Upload verified (hash matches)`);
    return { ok: true, sha256: validation.sha256 };
}

async function appendCardToGallery(queueId, tokenId, content, source) {
  // Reads the current deploy/huaca/index.html, adds a new card, saves it
  const galleryPath = path.join(DEPLOY_DIR, "index.html");
  if (!fs.existsSync(galleryPath)) {
    log(`  ⚠️ gallery not found: ${galleryPath}`);
    return false;
  }
  let html = fs.readFileSync(galleryPath, "utf-8");

  // Build new card
  const voxelRel = `voxel-${queueId}.html`;
  const card = `
        <article class="card" data-id="${tokenId}" data-token-id="${tokenId}">
          <div class="card-art">
            <iframe src="${voxelRel}" loading="lazy" title="Voxel sculpture #${queueId}" sandbox="allow-scripts allow-same-origin"></iframe>
          </div>
          <div class="card-body">
            <h3 class="card-title">Huaca, Sistemas Mágicos #${queueId}</h3>
            <div class="card-meta">#${queueId} · Sepolia · token ${tokenId}</div>
            <p class="card-desc">${content}</p>
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
              <button onclick="openVoxel('${voxelRel}')">▶ Ver voxel</button>
              <a href="https://sepolia.etherscan.io/token/${NFT_CONTRACT}?a=${tokenId}" target="_blank" rel="noopener">Token ↗</a>
              <button class="btn-bid" data-token-id="${tokenId}" data-bid-amount="0.001">Pujar</button>
              <button class="btn-settle" data-token-id="${tokenId}" style="display:none">Settle</button>
              <a href="https://sepolia.etherscan.io/address/${AUCTION_CONTRACT}" target="_blank" rel="noopener">Subasta ↗</a>
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

async function runCycle() {
  log("=== Huaca agent: cycle start ===");

  // -------- STEP 1: SCRAPE --------
  if (SKIP_SCRAPE) {
    log("Step 1: SKIPPED (--skip-scrape) — using existing candidates");
  } else {
    log("Step 1: scraping Bluesky...");
    try {
      execSync(`npx ts-node scripts/scraper.ts`, { cwd: ROOT, stdio: "inherit" });
    } catch (e) {
      log(`scraper failed: ${e.message.slice(0, 200)}`);
      return { ok: false, step: "scrape" };
    }
  }

  // -------- STEP 2: PICK CANDIDATES --------
  const candidatesPath = path.join(ROOT, "data", "scraper-candidates.json");
  const data = JSON.parse(fs.readFileSync(candidatesPath, "utf-8"));
  const pending = data.candidates
    .filter(c => !c.approved && !c.rejected && !c.aiLegalRisk)
    .sort((a, b) => b.score - a.score)
    .slice(0, LIMIT);

  if (pending.length === 0) {
    log("No pending candidates. Exiting.");
    return { ok: true, step: "pick", count: 0 };
  }
  log(`Found ${pending.length} pending candidates`);
  
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
    return b.score - a.score;
  });

  // -------- STEP 3: GENERATE VOXEL ART --------
  // Dynamic require for the compiled JS
  const generateThreeModule = require(path.join(ROOT, "build", "scripts", "generate-three.js"));
  const generateThreeArtwork = generateThreeModule.generateThreeArtwork;

  const generated = [];
  for (const c of pending) {
    try {
      const out = await generateThreeArtwork({
        content: c.content,
        category: c.category || "other",
        attribution: c.attribution || "Anonymous",
        source: c.source,
        sourceUrl: c.sourceUrl,
        scrapedAt: c.scrapedAt,
      });
      log(`  Generated voxel: ${path.basename(out.htmlPath)} (${out.voxelCount} voxels)`);
      generated.push({ candidate: c, artwork: out });
    } catch (e) {
      log(`  generate failed for ${c.id}: ${e.message.slice(0, 200)}`);
    }
  }

  if (NO_MINT || DRY_RUN) {
    log("Skipping mint/upload (--no-mint or --dry-run)");
    return { ok: true, step: "generated", count: generated.length };
  }

  // -------- STEP 4: MINT + LIST --------
  const upload = readStash(UPLOAD_STASH);
  const provider = new ethers.JsonRpcProvider(upload.sepolia_rpc);
  const wallet = new ethers.Wallet(upload.private_key, provider);

  const NFT_ABI = [
    "function mint(address to, string uri) returns (uint256)",
    "function approve(address to, uint256 tokenId)",
    "function ownerOf(uint256 tokenId) view returns (address)",
    "function totalSupply() view returns (uint256)",
    "function updateMetadata(uint256 tokenId, string newURI)",
  ];
  const AUCTION_ABI = [
  "function getAuction(address nftContract, uint256 tokenId) view returns (tuple(address seller, uint256 tokenId, uint256 startingBid, uint256 highestBid, address highestBidder, uint256 endTime, bool settled, bool cancelled))",
  "function bid(address nftContract, uint256 tokenId) payable",
  "function finalizeAuction(address nftContract, uint256 tokenId)",
  "function cancelAuction(address nftContract, uint256 tokenId)",
  "function createAuction(address nftContract, uint256 tokenId, uint256 startingBid, uint256 durationSeconds)",
];
  const nft = new ethers.Contract(upload.nft_contract, NFT_ABI, wallet);
  const auction = new ethers.Contract(upload.auction_contract, AUCTION_ABI, wallet);

  const queuePath = path.join(ROOT, "data", "art-queue.json");
  const queue = JSON.parse(fs.readFileSync(queuePath, "utf-8"));
  let nextQueueId = queue.items.length > 0 ? Math.max(...queue.items.map(i => i.id)) + 1 : 1;

  const results = [];
  let galleryModified = false;
  try {
  for (const { candidate, artwork } of generated) {
    const queueId = nextQueueId++;
    const totalSupply = await nft.totalSupply();
    const tokenId = Number(totalSupply);
    log(`Minting token ${tokenId} for queue #${queueId}...`);

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
        { trait_type: "Token ID", value: String(tokenId) },
        { trait_type: "Queue ID", value: String(queueId) },
      ],
    };

    try {
      // 1. Upload voxel HTML
      const voxelRemoteName = `voxel-${queueId}.html`;
      uploadToHosting(artwork.htmlPath, voxelRemoteName);
      log(`  Uploaded voxel HTML`);

      // 2. Upload metadata JSON
      const metadataRemoteName = `metadata-${queueId}.json`;
      uploadJsonToHosting(metadata, metadataRemoteName);
      log(`  Uploaded metadata JSON`);

      // 2.5. Add card to gallery
      log(`  Adding card to gallery...`);
      const added = appendCardToGallery(queueId, tokenId, candidate.content, candidate.source);
      if (added) {
        log(`  ✓ Card added to deploy/huaca/index.html`);
        // Validate the updated gallery
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

      // 3. Mint NFT
      const mintTx = await nft.mint(wallet.address, metadata.image);
      const mintR = await mintTx.wait();
      log(`  Minted (tx ${mintR.hash})`);

      // 4. Approve auction
      const approveTx = await nft.approve(await auction.getAddress(), tokenId);
      await approveTx.wait();
      log(`  Approved auction`);

      // 5. Create auction
      const startingBid = ethers.parseEther("0.001");
      const createAuctionTx = await auction.createAuction(
        await nft.getAddress(),
        tokenId,
        startingBid,
        AUCTION_DURATION
      );
      const auctionR = await createAuctionTx.wait();
      log(`  Auction created (tx ${auctionR.hash})`);

      // 6. Update queue
      queue.items.push({
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
      });
      fs.writeFileSync(queuePath, JSON.stringify(queue, null, 2), "utf-8");

      // 7. Mark candidate as approved
      candidate.approved = true;

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

    // -------- STEP 5: UPLOAD UPDATED GALLERY --------
    // Always run, even if mint failed, so partial gallery updates are visible
    log("Step 5: uploading updated gallery with new cards...");
    try {
      await uploadToHosting(path.join(DEPLOY_DIR, "index.html"), "index.html");
      log("  ✓ Gallery updated on hosting (browser will pick up via cache-buster ?cb=ts)");
    } catch (e) {
      log(`  gallery upload failed: ${e.message.slice(0, 200)}`);
    }
  }
  // Save candidate updates
  fs.writeFileSync(candidatesPath, JSON.stringify(data, null, 2), "utf-8");

log(`=== Cycle complete: ${results.filter(r => r.ok).length}/${results.length} minted ===
`);
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
    await runCycle();
    process.exit(0);
  }
}

main();
