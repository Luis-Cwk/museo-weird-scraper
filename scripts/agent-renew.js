#!/usr/bin/env node
// @ts-nocheck
/**
 * Huaca Auto-Renew
 * Checks for ended auctions and renews them with a fresh voxel.
 * 
 * Flow:
 *  1. Query all active auctions
 *  2. Identify ended ones (endTime < now AND !settled AND !cancelled)
 *  3. Settle them (if has bids) or cancel (if no bids)
 *  4. Generate new voxel art from a fresh scrape
 *  5. Mint + list new auction
 * 
 * Usage: node scripts/agent-renew.js [--dry-run]
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { ethers } = require("ethers");
const dotenv = require("dotenv");
dotenv.config();

const ROOT = path.join(__dirname, "..");
const DEPLOY_DIR = path.join(ROOT, "deploy", "huaca");
const FTP_STASH = path.join(DEPLOY_DIR, ".ftp_stash.json");
const UPLOAD_STASH = path.join(DEPLOY_DIR, ".upload_stash.json");
const LOG_PATH = path.join(ROOT, "logs", "renew.log");

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");

const AUCTION_DURATION = 24 * 60 * 60;

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

function uploadToHosting(localPath, remoteName) {
  const ftp = readStash(FTP_STASH);
  const user = ftp.user.replace("@", "%40");
  const url = `ftp://${user}:${ftp.password}@${ftp.host}/huaca/${remoteName}`;
  log(`  Uploading ${remoteName}...`);
  execSync(`curl -s -P - -T "${localPath}" "${url}"`, { stdio: "pipe" });
}

function uploadJsonToHosting(obj, remoteName) {
  const tmpPath = path.join(DEPLOY_DIR, remoteName);
  fs.writeFileSync(tmpPath, JSON.stringify(obj, null, 2), "utf-8");
  uploadToHosting(tmpPath, remoteName);
  fs.unlinkSync(tmpPath);
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function runRenew() {
  log("=== Huaca auto-renew: checking for ended auctions ===");

  const upload = readStash(UPLOAD_STASH);
  const provider = new ethers.JsonRpcProvider(upload.sepolia_rpc);
  const wallet = new ethers.Wallet(upload.private_key, provider);

  const NFT_ABI = [
    "function mint(address to, string uri) returns (uint256)",
    "function approve(address to, uint256 tokenId)",
    "function totalSupply() view returns (uint256)",
  ];
  const AUCTION_ABI = [
    "function getAuction(address nftContract, uint256 tokenId) view returns (tuple(address seller, uint256 tokenId, uint256 startingBid, uint256 highestBid, address highestBidder, uint256 endTime, bool settled, bool cancelled))",
    "function finalizeAuction(address nftContract, uint256 tokenId)",
    "function cancelAuction(address nftContract, uint256 tokenId)",
    "function createAuction(address nftContract, uint256 tokenId, uint256 startingBid, uint256 durationSeconds)",
  ];
  const nft = new ethers.Contract(upload.nft_contract, NFT_ABI, wallet);
  const auction = new ethers.Contract(upload.auction_contract, AUCTION_ABI, wallet);

  const totalSupply = await nft.totalSupply();
  const now = Math.floor(Date.now() / 1000);
  log(`Total supply: ${totalSupply}, Now: ${new Date(now * 1000).toISOString()}`);

  // Check every token from 0 to totalSupply
  let ended = [];
  for (let tid = 0; tid < totalSupply; tid++) {
    try {
      const a = await auction.getAuction(upload.nft_contract, tid);
      if (a.settled || a.cancelled) continue;
      if (Number(a.endTime) > now) continue;
      if (a.seller.toLowerCase() !== wallet.address.toLowerCase()) continue;
      ended.push({ tokenId: tid, highestBid: a.highestBid, hasBid: a.highestBid > 0n });
    } catch (e) {
      // Token might not have auction
    }
  }
  log(`Ended auctions: ${ended.length}`);

  // Step 1: settle or cancel ended ones
  for (const e of ended) {
    if (e.hasBid) {
      log(`Settling token ${e.tokenId} (has bid ${ethers.formatEther(e.highestBid)} ETH)...`);
      if (!DRY_RUN) {
        try {
          const tx = await auction.finalizeAuction(upload.nft_contract, e.tokenId);
          const r = await tx.wait();
          log(`  Settled: ${r.hash}`);
        } catch (err) {
          log(`  Settle failed: ${err.message.slice(0, 200)}`);
        }
      }
    } else {
      log(`Cancelling token ${e.tokenId} (no bids)...`);
      if (!DRY_RUN) {
        try {
          const tx = await auction.cancelAuction(upload.nft_contract, e.tokenId);
          const r = await tx.wait();
          log(`  Cancelled: ${r.hash}`);
        } catch (err) {
          log(`  Cancel failed: ${err.message.slice(0, 200)}`);
        }
      }
    }
    await sleep(2000);
  }

  // Step 2: trigger new auction from fresh scrape
  log("\n=== Triggering fresh scrape ===");
  if (!DRY_RUN) {
    try {
      execSync(`node scripts/agent.js --once --limit=1`, {
        cwd: ROOT,
        stdio: "inherit",
        timeout: 300 * 1000,
      });
    } catch (e) {
      log(`agent failed: ${e.message.slice(0, 200)}`);
    }
  } else {
    log("(dry-run: skipped)");
  }

  log("=== Renew complete ===\n");
}

runRenew().catch(e => {
  log(`FATAL: ${e.message}`);
  process.exit(1);
});
