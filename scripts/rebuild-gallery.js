#!/usr/bin/env node
/**
 * rebuild-gallery.js — Regenera index.html con el estado REAL on-chain.
 * Lee el contrato (totalSupply + tokenURI) y reconstruye las cards de la
 * galería para que coincidan exactamente con lo minteado, descartando
 * cards huérfanas/duplicadas del queue local.
 */
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const ROOT = path.join(__dirname, "..");
const DEPLOY_DIR = path.join(ROOT, "deploy", "huaca");
const STASH = JSON.parse(fs.readFileSync(path.join(DEPLOY_DIR, ".upload_stash.json"), "utf-8"));
const INDEX = path.join(DEPLOY_DIR, "index.html");

const NFT_ADDR = STASH.mainnet_nft_contract;
const AUCTION_ADDR = STASH.mainnet_auction_contract;
const RPC = STASH.mainnet_rpc || "https://ethereum-rpc.publicnode.com";

const CB = `?cb=${Date.now()}`;

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const nft = new ethers.Contract(NFT_ADDR, [
    "function totalSupply() view returns (uint256)",
    "function tokenURI(uint256) view returns (string)",
  ], provider);

  const total = Number(await nft.totalSupply());
  console.log("totalSupply:", total);

  const cards = [];
  for (let tokenId = 0; tokenId < total; tokenId++) {
    const uri = await nft.tokenURI(tokenId);
    let meta;
    try {
      const resp = await fetch(uri);
      meta = await resp.json();
    } catch (e) {
      console.warn(`tokenId ${tokenId}: no se pudo leer metadata (${uri})`);
      continue;
    }

    const voxel = (meta.animation_url || "").replace("https://petrasynthetic.com/huaca/", "");
    const title = (meta.description || "").slice(0, 120) + "…";
    const type = (meta.attributes || []).find(a => a.trait_type === "Type")?.value || "fact";
    const source = (meta.attributes || []).find(a => a.trait_type === "Source")?.value || "";

    const card = `        <article class="card" data-id="${tokenId}" data-token-id="${tokenId}">
          <div class="card-art">
            <iframe src="${esc(voxel)}${CB}" loading="lazy" title="Voxel sculpture #${tokenId + 1}" sandbox="allow-scripts allow-same-origin"></iframe>
          </div>
          <div class="card-body">
            <h3 class="card-title">${esc(title)}</h3>
            <div class="card-attrs">
              <span class="attr">Type: ${esc(type)}</span>
              <span class="attr">Source: ${esc(source)}</span>
            </div>
            <div class="auction" data-token-id="${tokenId}">
              <div class="auction-row"><span class="label">Status</span><span class="value status-cell">cargando...</span></div>
              <div class="auction-row"><span class="label">Bid actual</span><span class="value bid bid-cell">—</span></div>
              <div class="auction-row"><span class="label">Bidder</span><span class="value bidder-cell">—</span></div>
              <div class="auction-row"><span class="label">Seller</span><span class="value seller-cell">—</span></div>
              <div class="auction-row"><span class="label">Termina</span><span class="value time-cell">—</span></div>
            </div>
            <div class="card-actions">
              <a href="https://etherscan.io/token/${NFT_ADDR}?a=${tokenId}" target="_blank" rel="noopener">Token ↗</a>
              <button class="btn-bid" data-token-id="${tokenId}" data-bid-amount="0.001">Pujar</button>
              <button class="btn-settle" data-token-id="${tokenId}" style="display:none">Settle</button>
              <a href="https://etherscan.io/address/${AUCTION_ADDR}" target="_blank" rel="noopener">Subasta ↗</a>
            </div>
          </div>
        </article>`;
    cards.push(card);
  }

  // Reemplazar el <main class="grid"> en el HTML
  let html = fs.readFileSync(INDEX, "utf-8");
  const newGrid = `<main class="grid" id="grid">\n${cards.join("\n\n")}\n      \n</main>`;
  const re = /<main class="grid" id="grid">[\s\S]*?<\/main>/;
  if (re.test(html)) {
    html = html.replace(re, newGrid);
  } else {
    console.error("No se encontró <main class=grid> — abortando");
    process.exit(1);
  }

  fs.writeFileSync(INDEX, html, "utf-8");
  console.log(`✅ Galería regenerada con ${cards.length} cards (estado on-chain real)`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });