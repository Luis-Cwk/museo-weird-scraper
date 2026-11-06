#!/usr/bin/env node
/**
 * withdraw-pending.js — auto-withdraw pending ETH from Huaca auctions
 *
 * After a settle, the auction contract credits 50% to the seller and 50% to
 * the treasury (PULL pattern). This script calls withdraw() for both wallets
 * so the ETH actually lands in their accounts without manual intervention.
 *
 * Wallets:
 *   - Seller (bot): mainnet_private_key in .upload_stash.json
 *   - Treasury:     TREASURY_PRIVATE_KEY in .env (if set)
 *
 * Usage:
 *   node scripts/withdraw-pending.js
 *
 * Exit codes:
 *   0 = ok (withdrew, or nothing pending)
 *   1 = error
 */

const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const dotenv = require("dotenv");

dotenv.config();

const ROOT = path.join(__dirname, "..");
const UPLOAD_STASH = path.join(ROOT, "deploy", "huaca", ".upload_stash.json");

function log(msg) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}`);
}

async function main() {
  const stash = JSON.parse(fs.readFileSync(UPLOAD_STASH, "utf-8"));
  const rpcUrl = stash.mainnet_rpc || process.env.MAINNET_RPC || "https://ethereum-rpc.publicnode.com";
  const auctionAddr = stash.mainnet_auction_contract;

  const ABI = [
    "function pendingWithdrawals(address) view returns (uint256)",
    "function withdraw()",
  ];

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const contract = new ethers.Contract(auctionAddr, ABI, provider);

  const results = {};

  // 1. Seller (bot wallet)
  const sellerPk = stash.mainnet_private_key;
  if (sellerPk) {
    const sellerWallet = new ethers.Wallet(sellerPk, provider);
    const sellerPending = await contract.pendingWithdrawals(sellerWallet.address);
    log(`Seller (${sellerWallet.address}): ${ethers.formatEther(sellerPending)} ETH pending`);
    if (sellerPending > 0n) {
      const tx = await contract.connect(sellerWallet).withdraw();
      log(`  Withdraw tx sent: ${tx.hash}`);
      await tx.wait();
      log(`  ✓ Seller withdrew ${ethers.formatEther(sellerPending)} ETH`);
      results.seller = ethers.formatEther(sellerPending);
    }
  } else {
    log("⚠️ No seller private key found");
  }

  // 2. Treasury
  const treasuryPk = process.env.TREASURY_PRIVATE_KEY;
  if (treasuryPk) {
    const treasuryWallet = new ethers.Wallet(treasuryPk, provider);
    const treasuryPending = await contract.pendingWithdrawals(treasuryWallet.address);
    log(`Treasury (${treasuryWallet.address}): ${ethers.formatEther(treasuryPending)} ETH pending`);
    if (treasuryPending > 0n) {
      const tx = await contract.connect(treasuryWallet).withdraw();
      log(`  Withdraw tx sent: ${tx.hash}`);
      await tx.wait();
      log(`  ✓ Treasury withdrew ${ethers.formatEther(treasuryPending)} ETH`);
      results.treasury = ethers.formatEther(treasuryPending);
    }
  } else {
    log("⚠️ TREASURY_PRIVATE_KEY not set — treasury share will remain pending");
  }

  const total = Object.values(results).reduce((acc, v) => acc + parseFloat(v || "0"), 0);
  log(`=== Withdraw summary: ${total.toFixed(4)} ETH total ===`);

  // Report to stdout (cron delivers this)
  const parts = [];
  if (results.seller) parts.push(`seller: ${results.seller} ETH`);
  if (results.treasury) parts.push(`treasury: ${results.treasury} ETH`);
  if (parts.length === 0) {
    console.log("Nada pendiente para retirar.");
  } else {
    console.log("Retirado: " + parts.join(", "));
  }

  return results;
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    log(`❌ Withdraw failed: ${e.message}`);
    process.exit(1);
  });