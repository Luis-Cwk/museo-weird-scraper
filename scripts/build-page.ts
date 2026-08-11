/**
 * build-page.ts
 * Lee el contrato + IPFS server-side y genera un HTML estático con todos
 * los datos embebidos. La página resultante no hace fetch() a IPFS en el
 * navegador (evita el CORS de file:// → https://gateway.pinata.cloud).
 * Solo usa <img> para imágenes (sin CORS) y ethers RPC en vivo para subastas.
 */
import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';
import 'dotenv/config';

const CONFIG = {
  rpc: process.env.SEPOLIA_RPC || 'https://ethereum-sepolia-rpc.publicnode.com',
  chainId: 11155111,
  nft: process.env.NFT_CONTRACT || '0x87E57042C8a4cd95D3aF635940294802aabfFc85',
  auction: process.env.AUCTION_CONTRACT || '0x54dEdeBC156044E3de51f54264Db26eC393bbB0D',
  pinataGateway: 'https://gateway.pinata.cloud/ipfs/',
  pinataGateway2: 'https://ipfs.io/ipfs/',
  pinataGateway3: 'https://dweb.link/ipfs/',
  etherscanToken: 'https://sepolia.etherscan.io/token/',
  etherscanAuction: 'https://sepolia.etherscan.io/address/',
  outPath: path.resolve(process.cwd(), 'dist', 'weird-museo.html'),
};

const ABI = {
  nft: [
    'function totalSupply() view returns (uint256)',
    'function tokenURI(uint256) view returns (string)',
    'function ownerOf(uint256) view returns (address)',
    'function name() view returns (string)',
    'function symbol() view returns (string)',
  ],
  auction: [
    'function auctions(uint256) view returns (tuple(address seller, uint256 tokenId, uint256 startingBid, uint256 highestBid, address highestBidder, uint256 endTime, bool settled, bool cancelled))',
  ],
};

function ipfsToHttp(uri: string, gateway = CONFIG.pinataGateway): string {
  if (!uri) return '';
  if (uri.startsWith('ipfs://')) return gateway + uri.slice(7);
  if (uri.startsWith('http')) return uri;
  if (uri.startsWith('Qm') || uri.startsWith('bafy') || uri.startsWith('bafk')) return gateway + uri;
  return uri;
}

async function fetchMetadata(uri: string): Promise<any | null> {
  const gateways = [CONFIG.pinataGateway, CONFIG.pinataGateway2, CONFIG.pinataGateway3];
  for (const gw of gateways) {
    const url = ipfsToHttp(uri, gw);
    try {
      const r = await fetch(url, { redirect: 'follow' });
      if (r.ok) return await r.json();
    } catch (_) {}
  }
  return null;
}

function auctionId(nftAddr: string, tokenId: number): string {
  return ethers.keccak256(ethers.solidityPacked(['address', 'uint256'], [nftAddr, BigInt(tokenId)]));
}

function escapeHtml(s: any): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function shortAddr(a: string): string {
  if (!a) return '—';
  return a.slice(0, 6) + '…' + a.slice(-4);
}

function formatCountdown(secs: number): string {
  if (secs <= 0) return 'finalizada';
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (d > 0) return d + 'd ' + h + 'h';
  if (h > 0) return h + 'h ' + m + 'm';
  return m + 'm ' + s + 's';
}

async function main() {
  console.log('→ Conectando a RPC público…');
  const provider = new ethers.JsonRpcProvider(CONFIG.rpc);
  const nft = new ethers.Contract(CONFIG.nft, ABI.nft, provider);
  const auction = new ethers.Contract(CONFIG.auction, ABI.auction, provider);

  const [total, name, symbol] = await Promise.all([
    nft.totalSupply(),
    nft.name(),
    nft.symbol(),
  ]);
  const totalN = Number(total);
  console.log(`✓ ${name} (${symbol}): ${totalN} NFTs`);

  console.log('→ Leyendo NFTs y metadata de IPFS…');
  const items: any[] = [];
  for (let i = 0; i < totalN; i++) {
    try {
      const [uri, owner] = await Promise.all([
        nft.tokenURI(i),
        nft.ownerOf(i),
      ]);
      const meta = await fetchMetadata(uri);
      let auctionData = null;
      try {
        const aid = auctionId(CONFIG.nft, i);
        auctionData = await auction.auctions(aid);
      } catch (_) {}
      items.push({
        tokenId: i,
        uri,
        owner,
        metadata: meta,
        auction: auctionData && Number(auctionData.endTime) > 0 ? {
          seller: auctionData.seller,
          startingBid: auctionData.startingBid.toString(),
          highestBid: auctionData.highestBid.toString(),
          highestBidder: auctionData.highestBidder,
          endTime: Number(auctionData.endTime),
          settled: auctionData.settled,
          cancelled: auctionData.cancelled,
        } : null,
      });
      console.log(`  ✓ #${i} ${meta?.name || '—'} (${meta?.image?.slice(0, 30) || 'no image'}…)`);
    } catch (e: any) {
      console.log(`  ✗ #${i}: ${e.message}`);
      items.push({ tokenId: i, error: e.message });
    }
  }

  // Mark duplicates by metadata URI
  const seenUri = new Map<string, number>();
  items.forEach(r => { if (r.uri) seenUri.set(r.uri, (seenUri.get(r.uri) || 0) + 1); });
  items.forEach(r => { if (r.uri && seenUri.get(r.uri) as number > 1) r.duplicateOf = true; });

  console.log(`→ Generando HTML en ${CONFIG.outPath}…`);
  const html = renderHtml(items, name, symbol);
  fs.mkdirSync(path.dirname(CONFIG.outPath), { recursive: true });
  fs.writeFileSync(CONFIG.outPath, html);
  console.log(`✓ Página lista: ${CONFIG.outPath} (${(fs.statSync(CONFIG.outPath).size / 1024).toFixed(1)} KB)`);
  console.log(`  Abre con doble-click o: file://${CONFIG.outPath.replace(/\\/g, '/')}`);
}

function renderHtml(items: any[], name: string, symbol: string): string {
  const dataJson = JSON.stringify(items).replace(/</g, '\\u003c');
  const date = new Date().toISOString();

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Huaca, Sistemas Mágicos · Lo raro es político</title>
<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
<meta http-equiv="Pragma" content="no-cache">
<meta http-equiv="Expires" content="0">
<meta name="description" content="Museo Weird es un archivo vivo de hechos anómalos: rarezas, rumores, historias que el canon oficial borra. Cada pieza es una grieta en la memoria. Subastar lo raro es una forma de no olvidar — y de financiarlo." />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
<script src="https://cdn.jsdelivr.net/npm/ethers@6.13.0/dist/ethers.umd.min.js"></script>
<style>
  :root {
    --bg: #ffffff;
    --text: #000000;
    --text-secondary: rgba(0, 0, 0, 0.6);
    --border: rgba(0, 0, 0, 0.1);
    --border-strong: rgba(0, 0, 0, 0.2);
    --warn: #c2410c;
    --bid: #166534;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html { scroll-behavior: smooth; }
  #bgShader {
    position: fixed;
    inset: 0;
    width: 100vw;
    height: 100vh;
    z-index: 0;
    pointer-events: none;
    opacity: 0.7;
  }
  body > *:not(#bgShader) { position: relative; z-index: 1; }
  body {
    font-family: 'Space Grotesk', -apple-system, BlinkMacSystemFont, sans-serif;
    background: var(--bg);
    color: var(--text);
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
    overflow-x: hidden;
  }

  nav {
    position: sticky;
    top: 0;
    z-index: 100;
    background: rgba(255, 255, 255, 0.95);
    backdrop-filter: blur(10px);
    border-bottom: 1px solid var(--border);
  }
  .nav-container {
    max-width: 1400px;
    margin: 0 auto;
    padding: 18px 3vw;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .nav-brand {
    font-size: clamp(1.3rem, 3vw, 1.7rem);
    font-weight: 700;
    letter-spacing: 2px;
    text-transform: uppercase;
    text-decoration: none;
    color: var(--text);
  }
  .nav-meta {
    display: flex;
    gap: 1.5vw;
    font-size: 0.7rem;
    color: var(--text-secondary);
    letter-spacing: 1px;
    text-transform: uppercase;
    flex-wrap: wrap;
  }
  .nav-meta a { color: var(--text); text-decoration: none; border-bottom: 1px solid var(--border-strong); }
  .nav-meta a:hover { color: var(--text); border-bottom-color: var(--text); }

  header.hero {
    max-width: 1400px;
    margin: 0 auto;
    padding: clamp(40px, 8vw, 100px) 3vw 60px;
    border-bottom: 1px solid var(--border);
  }
  .hero-tag {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 2px;
    color: var(--text-secondary);
    margin-bottom: 18px;
  }
  h1 {
    font-size: clamp(2.5rem, 8vw, 6rem);
    font-weight: 700;
    letter-spacing: -0.03em;
    line-height: 0.95;
    margin-bottom: 24px;
  }
  h1 .h-letter {
    display: inline-block;
    opacity: 0;
    transform: translateY(20px);
    transition: opacity 0.5s ease, transform 0.5s ease;
  }
  h1.animate .h-letter { opacity: 1; transform: translateY(0); }
  h1 .h-letter:nth-child(1)  { transition-delay: 0.00s; }
  h1 .h-letter:nth-child(2)  { transition-delay: 0.04s; }
  h1 .h-letter:nth-child(3)  { transition-delay: 0.08s; }
  h1 .h-letter:nth-child(4)  { transition-delay: 0.12s; }
  h1 .h-letter:nth-child(5)  { transition-delay: 0.16s; }
  h1 .h-letter:nth-child(6)  { transition-delay: 0.20s; }
  h1 .h-letter:nth-child(7)  { transition-delay: 0.24s; }
  h1 .h-letter:nth-child(8)  { transition-delay: 0.28s; }
  h1 .h-letter:nth-child(9)  { transition-delay: 0.32s; }
  h1 .h-letter:nth-child(10) { transition-delay: 0.36s; }
  h1 .h-letter:nth-child(11) { transition-delay: 0.40s; }
  h1 .h-letter:nth-child(12) { transition-delay: 0.44s; }
  h1 .h-letter:nth-child(13) { transition-delay: 0.48s; }
  h1 .h-letter:nth-child(14) { transition-delay: 0.52s; }
  h1 .h-letter:nth-child(15) { transition-delay: 0.56s; }
  h1 .h-letter:nth-child(16) { transition-delay: 0.60s; }
  h1 .h-letter:nth-child(17) { transition-delay: 0.64s; }
  h1 .h-letter:nth-child(18) { transition-delay: 0.68s; }
  h1 .h-letter:nth-child(19) { transition-delay: 0.72s; }
  h1 .h-letter:nth-child(20) { transition-delay: 0.76s; }
  h1 .h-letter:nth-child(21) { transition-delay: 0.80s; }
  h1 .h-letter:nth-child(22) { transition-delay: 0.84s; }
  h1 .h-accent { color: var(--bid); }
  .hero-sub {
    font-size: clamp(1rem, 2vw, 1.3rem);
    font-weight: 300;
    color: var(--text-secondary);
    max-width: 600px;
    line-height: 1.5;
  }
  .hero-sub em { font-style: normal; font-weight: 600; color: var(--text); border-bottom: 2px solid var(--text); padding-bottom: 1px; }
  .hero-sub strong { font-weight: 600; color: var(--text); }
  .hero-quote {
    margin-top: 24px;
    font-size: 0.85rem;
    font-weight: 400;
    color: var(--text-secondary);
    font-style: italic;
    letter-spacing: 0.02em;
    max-width: 600px;
  }
  .hero-stats {
    display: flex;
    gap: 3vw;
    margin-top: 40px;
    padding-top: 24px;
    border-top: 1px solid var(--border);
    flex-wrap: wrap;
  }
  .hero-stat { display: flex; flex-direction: column; }
  .hero-stat-label {
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 2px;
    color: var(--text-secondary);
  }
  .hero-stat-value {
    font-size: 1.5rem;
    font-weight: 600;
    margin-top: 4px;
  }
  .hero-stat-value code { font-size: 0.85rem; font-weight: 400; font-family: 'Space Grotesk', monospace; }

  .toolbar {
    max-width: 1400px;
    margin: 0 auto;
    padding: 30px 3vw;
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    align-items: center;
  }
  .toolbar button {
    background: transparent;
    color: var(--text);
    border: 1px solid var(--border-strong);
    padding: 10px 18px;
    font-family: inherit;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 1.5px;
    cursor: pointer;
    transition: all 0.2s;
  }
  .toolbar button:hover { background: var(--text); color: var(--bg); }
  .toolbar button.active { background: var(--text); color: var(--bg); }
  .toolbar button.ghost { margin-left: auto; border-style: dashed; }
  .toolbar button.ghost:hover { background: transparent; color: var(--text); border-style: solid; }
  .toolbar .sync-status { font-size: 0.7rem; color: var(--text-secondary); letter-spacing: 0.05em; margin-left: 0.5rem; }
  .toolbar .count {
    margin-left: auto;
    font-size: 0.75rem;
    color: var(--text-secondary);
    letter-spacing: 1px;
    text-transform: uppercase;
  }

  .grid {
    max-width: 1400px;
    margin: 0 auto;
    padding: 0 3vw 80px;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 3vw;
  }
  .card {
    display: flex;
    flex-direction: column;
    border-top: 1px solid var(--text);
    padding-top: 18px;
    transition: transform 0.3s;
  }
  .card:hover { transform: translateY(-2px); }
  .card.duplicate { opacity: 0.7; }
  .card.duplicate .card-meta::before {
    content: 'META DUP · ';
    color: var(--warn);
    font-weight: 600;
  }
  .card-art {
    width: 100%;
    aspect-ratio: 1;
    background: transparent;
    margin-bottom: 16px;
    overflow: hidden;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .card-art img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    transition: transform 0.4s;
  }
  .card:hover .card-art img { transform: scale(1.03); }
  .card-title {
    font-size: 0.85rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 1.5px;
    margin-bottom: 8px;
  }
  .card-meta {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 1.5px;
    color: var(--text-secondary);
    margin-bottom: 12px;
  }
  .card-desc {
    font-size: 0.85rem;
    font-weight: 300;
    line-height: 1.6;
    color: var(--text);
    margin-bottom: 14px;
    display: -webkit-box;
    -webkit-line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .card-attrs {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 14px;
  }
  .attr {
    font-size: 0.6rem;
    text-transform: uppercase;
    letter-spacing: 1px;
    padding: 4px 10px;
    border: 1px solid var(--border);
    color: var(--text-secondary);
  }
  .auction {
    border-top: 1px solid var(--border);
    padding-top: 12px;
    margin-top: auto;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .auction-row {
    display: flex;
    justify-content: space-between;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  .auction-row .label { color: var(--text-secondary); }
  .auction-row .value { color: var(--text); font-weight: 500; }
  .auction-row .value.bid { color: var(--bid); font-weight: 600; }
  .auction-row .value.ended { color: var(--warn); }
  .countdown { font-variant-numeric: tabular-nums; }
  .card-actions {
    display: flex;
    gap: 8px;
    margin-top: 14px;
  }
  .card-actions a, .card-actions button {
    font-family: inherit;
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 1.5px;
    padding: 10px 16px;
    border: 1px solid var(--text);
    color: var(--text);
    background: transparent;
    text-decoration: none;
    cursor: pointer;
    transition: all 0.2s;
  }
  .card-actions a:hover, .card-actions button:hover {
    background: var(--text);
    color: var(--bg);
  }
  .card-actions button.primary {
    background: var(--text);
    color: var(--bg);
  }
  .card-actions button.primary:hover {
    background: transparent;
    color: var(--text);
  }

  footer {
    max-width: 1400px;
    margin: 0 auto;
    padding: 40px 3vw;
    border-top: 1px solid var(--border);
    font-size: 0.7rem;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 1.5px;
    text-align: center;
  }

  .empty {
    grid-column: 1 / -1;
    padding: 60px 20px;
    text-align: center;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 2px;
    font-size: 0.8rem;
  }

  /* modal */
  .modal-bg {
    position: fixed;
    inset: 0;
    background: rgba(255, 255, 255, 0.95);
    backdrop-filter: blur(8px);
    display: none;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 20px;
  }
  .modal-bg.open { display: flex; }
  .modal {
    max-width: 480px;
    width: 100%;
    border: 1px solid var(--text);
    background: var(--bg);
    padding: 30px;
  }
  .modal h3 {
    font-size: 1rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 2px;
    margin-bottom: 24px;
  }
  .modal-row {
    display: flex;
    justify-content: space-between;
    margin-bottom: 12px;
    font-size: 0.8rem;
  }
  .modal-row .label { color: var(--text-secondary); text-transform: uppercase; letter-spacing: 1px; font-size: 0.7rem; }
  .modal input {
    width: 100%;
    padding: 12px;
    border: 1px solid var(--text);
    background: transparent;
    font-family: inherit;
    font-size: 1rem;
    margin: 16px 0;
  }
  .modal-actions {
    display: flex;
    gap: 8px;
    margin-top: 20px;
  }
  .modal-actions button {
    flex: 1;
    padding: 12px;
    font-family: inherit;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 1.5px;
    border: 1px solid var(--text);
    background: transparent;
    color: var(--text);
    cursor: pointer;
  }
  .modal-actions button.primary {
    background: var(--text);
    color: var(--bg);
  }
  .modal-status {
    margin-top: 12px;
    padding: 12px;
    border: 1px solid var(--border);
    font-size: 0.75rem;
    min-height: 1.4em;
  }
  .modal-status.error { border-color: var(--warn); color: var(--warn); }
  .modal-status.ok { border-color: var(--bid); color: var(--bid); }

  @media (max-width: 600px) {
    .nav-meta { display: none; }
    .grid { grid-template-columns: 1fr; }
  }
</style>
</head>
<body>
<canvas id="bgShader"></canvas>
<nav>
  <div class="nav-container">
    <a href="#" class="nav-brand">${escapeHtml(name)}</a>
    <div class="nav-meta">
      <span>${items.length} NFTs · ${items.filter((x: any) => x.auction).length} en subasta</span>
      <a href="${CONFIG.etherscanToken + CONFIG.nft}" target="_blank" rel="noopener">contrato ↗</a>
      <a href="${CONFIG.etherscanAuction + CONFIG.auction}" target="_blank" rel="noopener">subastas ↗</a>
    </div>
  </div>
</nav>

<header class="hero">
  <div class="hero-tag">// archivo de lo que el canon no guarda · scraper → LLM guard → SVG → IPFS → Sepolia · ${escapeHtml(symbol)}</div>
  <h1 id="hero-title"><span class="h-letter">H</span><span class="h-letter">u</span><span class="h-letter">a</span><span class="h-letter">c</span><span class="h-letter">a</span><span class="h-letter">,</span><span class="h-letter">&nbsp;</span><span class="h-letter">S</span><span class="h-letter">i</span><span class="h-letter">s</span><span class="h-letter">t</span><span class="h-letter">e</span><span class="h-letter">m</span><span class="h-letter">a</span><span class="h-letter">s</span><br/><span class="h-letter h-accent">M</span><span class="h-letter h-accent">á</span><span class="h-letter h-accent">g</span><span class="h-letter h-accent">i</span><span class="h-letter h-accent">c</span><span class="h-letter h-accent">o</span><span class="h-letter h-accent">s</span><span class="h-letter">.</span></h1>
  <p class="hero-sub">Cada hecho raro es una <em>grieta</em> en el canon. Donde el archivo oficial borra, lo raro preserva. Esta subasta no vende arte: <strong>subvenciona la memoria de lo anómalo</strong> — lo que no cabe en el museo, lo que no sale en la prensa, lo que sobrevive en reddit y bluesky a pesar del olvido.</p>
  <p class="hero-quote">«La tecnología es solo una extensión de lo que el cuerpo ya sabe.»</p>
  <div class="hero-stats">
    <div class="hero-stat">
      <span class="hero-stat-label">Edición</span>
      <span class="hero-stat-value">${items.length}</span>
    </div>
    <div class="hero-stat">
      <span class="hero-stat-label">En subasta</span>
      <span class="hero-stat-value" id="liveCount">${items.filter((x: any) => x.auction).length}</span>
    </div>
    <div class="hero-stat">
      <span class="hero-stat-label">Red</span>
      <span class="hero-stat-value">Sepolia</span>
    </div>
    <div class="hero-stat">
      <span class="hero-stat-label">NFT</span>
      <span class="hero-stat-value"><code>${CONFIG.nft.slice(0, 6)}…${CONFIG.nft.slice(-4)}</code></span>
    </div>
  </div>
</header>

<div class="toolbar">
  <button class="active" data-filter="all">todos</button>
  <button data-filter="listed">en subasta</button>
  <button data-filter="notlisted">sin listar</button>
  <button data-filter="ended">finalizadas</button>
  <button id="refreshBtn" class="ghost" title="Refrescar ahora">↻ refrescar</button>
  <span class="count" id="count">${items.length} NFTs</span>
  <span class="sync-status" id="syncStatus">cargando…</span>
</div>

<div class="grid" id="grid">
${items.length === 0 ? '<div class="empty">No hay NFTs todavía.</div>' :
  items.map((item: any) => {
    const m = item.metadata || {};
    const a = item.auction;
    const isListed = !!a;
    const ended = isListed && (a.settled || a.cancelled || a.endTime * 1000 < Date.now());
    const bid = a ? (Number(a.highestBid) > 0 ? a.highestBid : a.startingBid) : null;
    const secsLeft = isListed ? Math.max(0, a.endTime - Date.now() / 1000) : 0;
    const imageUrl = m.image ? ipfsToHttp(m.image) : '';
    return `
      <article class="card ${item.duplicateOf ? 'duplicate' : ''}" data-id="${item.tokenId}" data-listed="${isListed}" data-notlisted="${!isListed}" data-ended="${ended}">
        <div class="card-art">
          ${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(m.name || ('#' + item.tokenId))}" loading="lazy" />` : '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-secondary);font-size:0.7rem">sin imagen</div>'}
        </div>
        <h3 class="card-title">${escapeHtml(m.name || ('#' + item.tokenId))}</h3>
        <div class="card-meta">#${item.tokenId} · ${escapeHtml(shortAddr(item.owner))}</div>
        <p class="card-desc">${escapeHtml(m.description || '')}</p>
        <div class="card-attrs">
          ${(m.attributes || []).map((at: any) => `<span class="attr">${escapeHtml(at.trait_type)}: ${escapeHtml(String(at.value).slice(0, 40))}</span>`).join('')}
        </div>
        <div class="auction">
          ${isListed ? `
            <div class="auction-row"><span class="label">bid actual</span><span class="value bid">${escapeHtml(ethers.formatEther(bid))} ETH</span></div>
            <div class="auction-row"><span class="label">mínimo</span><span class="value">${escapeHtml(ethers.formatEther(a.startingBid))} ETH</span></div>
            <div class="auction-row"><span class="label">${ended ? 'estado' : 'termina en'}</span><span class="value ${ended ? 'ended' : 'countdown'}" data-end="${a.endTime}">${ended ? (a.settled ? 'liquidada' : (a.cancelled ? 'cancelada' : 'finalizada')) : formatCountdown(secsLeft)}</span></div>
          ` : `
            <div class="auction-row"><span class="label">estado</span><span class="value ended">sin listar</span></div>
          `}
        </div>
        <div class="card-actions">
          <a href="${CONFIG.etherscanToken + CONFIG.nft}?a=${item.tokenId}" target="_blank" rel="noopener">token ↗</a>
          ${isListed && !ended ? `<button class="primary" data-bid="${item.tokenId}">pujar</button>` : ''}
          ${isListed ? `<a href="${CONFIG.etherscanAuction + CONFIG.auction}" target="_blank" rel="noopener">subasta ↗</a>` : ''}
        </div>
      </article>
    `;
  }).join('\n')}
</div>

<div class="modal-bg" id="modalBg">
  <div class="modal">
    <h3 id="modalTitle">Pujar · #—</h3>
    <div class="modal-row"><span class="label">mínimo</span><span class="value" id="modalMin">— ETH</span></div>
    <div class="modal-row"><span class="label">termina en</span><span class="value" id="modalEnd">—</span></div>
    <input type="text" id="bidAmount" placeholder="0.005" />
    <div class="modal-actions">
      <button onclick="closeModal()">cancelar</button>
      <button class="primary" onclick="placeBid()">confirmar puja</button>
    </div>
    <div class="modal-status" id="modalStatus">conecta MetaMask y firma la transacción</div>
  </div>
</div>

<footer>
  Build ${escapeHtml(date.split('T')[0])} · Sin llaves privadas, datos embebidos en build-time · RPC público
</footer>

<script>
(() => {
  'use strict';
  // Datos embebidos en build-time (sin CORS en runtime)
  window.__DATA__ = ${dataJson};
  const RPC = '${CONFIG.rpc}';
  const NFT = '${CONFIG.nft}';
  const AUCTION = '${CONFIG.auction}';

  const AUCTION_ABI = [
    'function auctions(uint256) view returns (tuple(address seller, uint256 tokenId, uint256 startingBid, uint256 highestBid, address highestBidder, uint256 endTime, bool settled, bool cancelled))',
    'function getAuction(address nft, uint256 tokenId) view returns (tuple(address seller, uint256 tokenId, uint256 startingBid, uint256 highestBid, address highestBidder, uint256 endTime, bool settled, bool cancelled))',
    'function bid(address nftContract, uint256 tokenId) payable',
    'function cancelAuction(address nftContract, uint256 tokenId)',
    'function finalizeAuction(address nftContract, uint256 tokenId)',
  ];
  const NFT_ABI = ['function tokenURI(uint256) view returns (string)'];

  let currentItem = null;
  let provider = null, signer = null, auctionWrite = null;

  function shortAddr(a) { return a.slice(0, 6) + '…' + a.slice(-4); }
  function formatCountdown(secs) {
    if (secs <= 0) return 'finalizada';
    const d = Math.floor(secs / 86400);
    const h = Math.floor((secs % 86400) / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    if (d > 0) return d + 'd ' + h + 'h';
    if (h > 0) return h + 'h ' + m + 'm';
    return m + 'm ' + s + 's';
  }

  function renderCard(item) {
    const m = item.metadata || {};
    const a = item.auction;
    const isListed = !!a;
    const ended = isListed && (a.settled || a.cancelled || a.endTime * 1000 < Date.now());
    const bid = a ? (Number(a.highestBid) > 0 ? a.highestBid : a.startingBid) : null;
    const secsLeft = isListed ? Math.max(0, a.endTime - Date.now() / 1000) : 0;
    const imageUrl = m.image ? (m.image.startsWith('ipfs://') ? '${CONFIG.pinataGateway}' + m.image.slice(7) : m.image) : '';
    return \`
      <article class="card \${item.duplicateOf ? 'duplicate' : ''}" data-id="\${item.tokenId}" data-listed="\${isListed}" data-notlisted="\${!isListed}" data-ended="\${ended}">
        <div class="card-art">
          \${imageUrl ? \`<img src="\${imageUrl}" alt="\${(m.name || '#' + item.tokenId).replace(/"/g, '&quot;')}" loading="lazy" />\` : '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-secondary);font-size:0.7rem">sin imagen</div>'}
        </div>
        <h3 class="card-title">\${(m.name || '#' + item.tokenId).replace(/</g, '&lt;')}</h3>
        <div class="card-meta">#\${item.tokenId} · \${shortAddr(item.owner)}</div>
        <p class="card-desc">\${(m.description || '').replace(/</g, '&lt;')}</p>
        <div class="card-attrs">
          \${(m.attributes || []).map((at) => \`<span class="attr">\${String(at.trait_type).replace(/</g, '&lt;')}: \${String(at.value).slice(0, 40).replace(/</g, '&lt;')}</span>\`).join('')}
        </div>
        <div class="auction">
          \${isListed ? \`
            <div class="auction-row"><span class="label">bid actual</span><span class="value bid">\${ethers.formatEther(bid)} ETH</span></div>
            <div class="auction-row"><span class="label">mínimo</span><span class="value">\${ethers.formatEther(a.startingBid)} ETH</span></div>
            <div class="auction-row"><span class="label">\${ended ? 'estado' : 'termina en'}</span><span class="value \${ended ? 'ended' : 'countdown'}" data-end="\${a.endTime}">\${ended ? (a.settled ? 'liquidada' : (a.cancelled ? 'cancelada' : 'finalizada')) : formatCountdown(secsLeft)}</span></div>
          \` : \`
            <div class="auction-row"><span class="label">estado</span><span class="value ended">sin listar</span></div>
          \`}
        </div>
        <div class="card-actions">
          <a href="${CONFIG.etherscanToken + CONFIG.nft}?a=\${item.tokenId}" target="_blank" rel="noopener">token ↗</a>
          \${isListed && !ended ? \`<button class="primary" data-bid="\${item.tokenId}">pujar</button>\` : ''}
          \${isListed ? \`<a href="${CONFIG.etherscanAuction + CONFIG.auction}" target="_blank" rel="noopener">subasta ↗</a>\` : ''}
        </div>
      </article>
    \`;
  }

  function updateCardDom(tokenId, auction) {
    const card = document.querySelector('article.card[data-id="' + tokenId + '"]');
    if (!card) return;
    const item = window.__DATA__.find(x => x.tokenId === tokenId);
    if (!item) return;
    item.auction = auction;
    const isListed = !!auction;
    const ended = isListed && (auction.settled || auction.cancelled || auction.endTime * 1000 < Date.now());
    const bid = isListed ? (Number(auction.highestBid) > 0 ? auction.highestBid : auction.startingBid) : null;
    card.dataset.listed = String(isListed);
    card.dataset.ended = String(ended);
    const auctionDiv = card.querySelector('.auction');
    if (auctionDiv) {
      if (isListed) {
        const innerHtml = '<div class="auction-row"><span class="label">bid actual</span><span class="value bid">' + ethers.formatEther(bid) + ' ETH</span></div>'
          + '<div class="auction-row"><span class="label">mínimo</span><span class="value">' + ethers.formatEther(auction.startingBid) + ' ETH</span></div>'
          + '<div class="auction-row"><span class="label">' + (ended ? 'estado' : 'termina en') + '</span><span class="value ' + (ended ? 'ended' : 'countdown') + '" data-end="' + auction.endTime + '">' + (ended ? (auction.settled ? 'liquidada' : (auction.cancelled ? 'cancelada' : 'finalizada')) : formatCountdown(auction.endTime - Date.now()/1000)) + '</span></div>';
        auctionDiv.innerHTML = innerHtml;
      } else {
        auctionDiv.innerHTML = '<div class="auction-row"><span class="label">estado</span><span class="value ended">sin listar</span></div>';
      }
    }
    const actions = card.querySelector('.card-actions');
    if (actions) {
      const btn = actions.querySelector('[data-bid]');
      if (isListed && !ended && !btn) {
        const b = document.createElement('button');
        b.className = 'primary';
        b.dataset.bid = tokenId;
        b.textContent = 'pujar';
        actions.insertBefore(b, actions.firstChild);
      } else if ((!isListed || ended) && btn) {
        btn.remove();
      }
    }
    applyFilter();
  }

  async function refreshState(silent) {
    const providerRead = new ethers.JsonRpcProvider('${CONFIG.rpc || 'https://ethereum-sepolia-rpc.publicnode.com'}');
    const auctionRead = new ethers.Contract(AUCTION, AUCTION_ABI, providerRead);
    const status = document.getElementById('syncStatus');
    if (!silent && status) status.textContent = 'sincronizando…';
    try {
      const calls = window.__DATA__.map(item =>
        auctionRead.getAuction(NFT, item.tokenId)
          .then(a => {
            const isReal = a && a.seller !== '0x0000000000000000000000000000000000000000' && Number(a.endTime) > 0;
            return {
              tokenId: item.tokenId,
              auction: isReal ? {
                seller: a.seller,
                tokenId: Number(a.tokenId),
                startingBid: a.startingBid.toString(),
                highestBid: a.highestBid.toString(),
                highestBidder: a.highestBidder,
                endTime: Number(a.endTime),
                settled: a.settled,
                cancelled: a.cancelled,
              } : null,
            };
          })
          .catch(() => ({ tokenId: item.tokenId, auction: item.auction }))
      );
      const updates = await Promise.all(calls);
      let changed = 0;
      updates.forEach(u => {
        const item = window.__DATA__.find(x => x.tokenId === u.tokenId);
        if (!item) return;
        const prev = JSON.stringify(item.auction);
        const next = JSON.stringify(u.auction);
        if (prev !== next) {
          changed++;
          updateCardDom(u.tokenId, u.auction);
        }
      });
      lastSync = Date.now();
      if (status) status.textContent = 'actualizado · ' + new Date().toLocaleTimeString('es-MX');
      return changed;
    } catch (e) {
      if (status) status.textContent = 'error sincronizando';
      return 0;
    }
  }
  window.refreshState = refreshState;

  let lastSync = Date.now();

  // initial + auto-poll every 15s
  setTimeout(() => refreshState(true), 1000);
  setInterval(() => refreshState(true), 15000);

  function applyFilter() {
    const filter = document.querySelector('.toolbar button.active')?.dataset.filter || 'all';
    const cards = document.querySelectorAll('.card');
    let visible = 0;
    let countListed = 0, countNotListed = 0, countEnded = 0;
    cards.forEach(c => {
      const listed = c.dataset.listed === 'true';
      const ended = c.dataset.ended === 'true';
      if (listed && !ended) countListed++;
      else if (ended) countEnded++;
      else countNotListed++;
      let show = true;
      if (filter === 'listed') show = listed && !ended;
      else if (filter === 'notlisted') show = !listed;
      else if (filter === 'ended') show = listed && ended;
      c.style.display = show ? '' : 'none';
      if (show) visible++;
    });
    document.getElementById('count').textContent = visible + ' / ' + window.__DATA__.length + ' NFTs';
    const labels = { all: 'TODOS', listed: 'EN SUBASTA', notlisted: 'SIN LISTAR', ended: 'FINALIZADAS' };
    document.querySelectorAll('.toolbar button[data-filter]').forEach(b => {
      const f = b.dataset.filter;
      const cnt = f === 'all' ? window.__DATA__.length : f === 'listed' ? countListed : f === 'notlisted' ? countNotListed : countEnded;
      const base = labels[f] || f;
      b.textContent = base + ' (' + cnt + ')';
    });
  }

  // countdown ticker
  setInterval(() => {
    document.querySelectorAll('.countdown').forEach(el => {
      const end = Number(el.dataset.end);
      if (!end) return;
      const secs = Math.max(0, end - Date.now() / 1000);
      el.textContent = formatCountdown(secs);
      if (secs <= 0) { el.classList.add('ended'); el.textContent = 'finalizada'; }
    });
  }, 1000);

  // pujar modal
  function openModal(tokenId) {
    const item = window.__DATA__.find((x) => x.tokenId === tokenId);
    if (!item || !item.auction) return;
    currentItem = item;
    document.getElementById('modalTitle').textContent = 'Pujar · #' + tokenId;
    document.getElementById('modalMin').textContent = ethers.formatEther(item.auction.startingBid) + ' ETH';
    document.getElementById('modalEnd').textContent = new Date(item.auction.endTime * 1000).toLocaleString('es-MX');
    document.getElementById('bidAmount').value = '';
    document.getElementById('modalStatus').className = 'modal-status';
    document.getElementById('modalStatus').textContent = 'conecta MetaMask y firma la transacción';
    document.getElementById('modalBg').classList.add('open');
  }
  window.openModal = openModal;
  window.closeModal = () => { document.getElementById('modalBg').classList.remove('open'); currentItem = null; };

  async function ensureWallet() {
    if (typeof window.ethereum === 'undefined') {
      document.getElementById('modalStatus').className = 'modal-status error';
      document.getElementById('modalStatus').textContent = 'MetaMask no detectado. Instala la extensión.';
      return false;
    }
    provider = new ethers.BrowserProvider(window.ethereum);
    await provider.send('eth_requestAccounts', []);
    signer = await provider.getSigner();
    auctionWrite = new ethers.Contract(AUCTION, AUCTION_ABI, signer);
    return true;
  }

  window.placeBid = async () => {
    if (!currentItem) return;
    const status = document.getElementById('modalStatus');
    status.className = 'modal-status';
    status.textContent = 'conectando wallet…';
    if (!(await ensureWallet())) return;
    const amount = document.getElementById('bidAmount').value.trim();
    if (!amount || isNaN(Number(amount))) {
      status.className = 'modal-status error';
      status.textContent = 'monto inválido';
      return;
    }
    const minWei = BigInt(currentItem.auction.startingBid);
    const bidWei = ethers.parseEther(amount);
    const highestWei = BigInt(currentItem.auction.highestBid);
    const requiredWei = highestWei > 0n ? (highestWei * 105n) / 100n + 1n : minWei;
    if (bidWei < requiredWei) {
      status.className = 'modal-status error';
      status.textContent = 'mínimo requerido: ' + ethers.formatEther(requiredWei) + ' ETH';
      return;
    }
    try {
      status.textContent = 'firmando transacción…';
      const tx = await auctionWrite.bid(NFT, currentItem.tokenId, { value: bidWei });
      status.textContent = 'tx enviada: ' + tx.hash.slice(0, 12) + '… esperando confirmación';
      await tx.wait();
      status.className = 'modal-status ok';
      status.textContent = '✓ puja confirmada. sincronizando estado…';
      setTimeout(() => closeModal(), 1500);
      setTimeout(() => refreshState(false), 2000);
    } catch (e) {
      status.className = 'modal-status error';
      status.textContent = '✗ ' + (e.shortMessage || e.message).slice(0, 100);
    }
  };

  // wire up filters + bid buttons (event delegation)
  document.querySelectorAll('.toolbar button[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.toolbar button[data-filter]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      applyFilter();
    });
  });
  document.getElementById('refreshBtn')?.addEventListener('click', () => refreshState(false));
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (t?.matches?.('[data-bid]')) openModal(Number(t.dataset.bid));
  });

  applyFilter();
})();

// --- WebGL shader background (eco fantasma) ---
(function initShader() {
  const canvas = document.getElementById('bgShader');
  if (!canvas) return;
  const gl = canvas.getContext('webgl', { alpha: true, antialias: false, premultipliedAlpha: false });
  if (!gl) return;
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    gl.viewport(0, 0, canvas.width, canvas.height);
  }
  resize();
  window.addEventListener('resize', resize);
  const vs = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.0,1.0);}';
  const fs = 'precision highp float;uniform float u_t;uniform vec2 u_r;uniform vec2 u_m;float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}float n(vec2 p){vec2 i=floor(p),f=fract(p);float a=h(i),b=h(i+vec2(1,0)),c=h(i+vec2(0,1)),d=h(i+vec2(1,1));vec2 u=f*f*(3.0-2.0*f);return mix(a,b,u.x)+(c-a)*u.y*(1.0-u.x)+(d-b)*u.x*u.y;}float fbm(vec2 p){float v=0.0,a=0.5;for(int i=0;i<5;i++){v+=a*n(p);p*=2.0;a*=0.5;}return v;}void main(){vec2 uv=gl_FragCoord.xy/u_r;float t=u_t*0.04;vec2 p=uv*2.0+vec2(t*0.1,t*0.05);float v=fbm(p);v=mix(v,fbm(p*2.0+v),0.5);vec2 c=uv-0.5;float vig=smoothstep(0.95,0.15,length(c));vec3 paper=vec3(0.96,0.94,0.91);vec3 dust=vec3(0.10,0.06,0.03);vec3 col=paper-dust*(v*0.42);float band=sin(uv.y*5.0+t*0.3)*0.5+0.5;col+=vec3(0.05,0.025,0.0)*band*0.10;float mDist=length(uv-u_m);col+=vec3(0.04,0.02,0.0)*smoothstep(0.25,0.0,mDist)*0.3;col*=vig;gl_FragColor=vec4(col,1.0);}';
  function compile(t,s){const sh=gl.createShader(t);gl.shaderSource(sh,s);gl.compileShader(sh);if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS))console.error(gl.getShaderInfoLog(sh));return sh;}
  const prog=gl.createProgram();
  gl.attachShader(prog,compile(gl.VERTEX_SHADER,vs));
  gl.attachShader(prog,compile(gl.FRAGMENT_SHADER,fs));
  gl.linkProgram(prog);gl.useProgram(prog);
  const buf=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buf);
  gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
  const pLoc=gl.getAttribLocation(prog,'p');gl.enableVertexAttribArray(pLoc);gl.vertexAttribPointer(pLoc,2,gl.FLOAT,false,0,0);
  const uT=gl.getUniformLocation(prog,'u_t'),uR=gl.getUniformLocation(prog,'u_r'),uM=gl.getUniformLocation(prog,'u_m');
  const t0=performance.now();
  const mouse={x:0.5,y:0.5};
  window.addEventListener('mousemove',e=>{mouse.x=e.clientX/window.innerWidth;mouse.y=1-e.clientY/window.innerHeight;});
  window.addEventListener('touchmove',e=>{if(e.touches[0]){mouse.x=e.touches[0].clientX/window.innerWidth;mouse.y=1-e.touches[0].clientY/window.innerHeight;}});
  function frame(){gl.uniform1f(uT,(performance.now()-t0)/1000);gl.uniform2f(uR,canvas.width,canvas.height);gl.uniform2f(uM,mouse.x,mouse.y);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);requestAnimationFrame(frame);}
  frame();
})();
</script>
<script>
  // Hero title stagger reveal (one-shot, prefers-reduced-motion safe)
  document.addEventListener('DOMContentLoaded', function () {
    var title = document.getElementById('hero-title');
    if (!title) return;
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { title.classList.add('animate'); return; }
    requestAnimationFrame(function () {
      setTimeout(function () { title.classList.add('animate'); }, 120);
    });
  });
</script>
<script>
  // Hero title stagger reveal (one-shot, prefers-reduced-motion safe)
  document.addEventListener('DOMContentLoaded', function () {
    var title = document.getElementById('hero-title');
    if (!title) return;
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { title.classList.add('animate'); return; }
    requestAnimationFrame(function () {
      setTimeout(function () { title.classList.add('animate'); }, 120);
    });
  });
</script>
</body>
</html>`;
}

main().catch((e) => {
  console.error('✗ build failed:', e);
  process.exit(1);
});