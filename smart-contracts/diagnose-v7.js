// Diagnose Huaca v7: who owns token 0, what happened in the auction,
// did the finalization tx execute, did it transfer to the bidder?
const hre = require("hardhat");

async function main() {
  const d = require("./deployments/sepolia.json");
  const NFT = await hre.ethers.getContractFactory("MuseoWeirdNFT");
  const AUC = await hre.ethers.getContractFactory("MuseoWeirdAuction");
  const nft = NFT.attach(d.contracts.MuseoWeirdNFT.address);
  const auc = AUC.attach(d.contracts.MuseoWeirdAuction.address);
  const RPC = hre.ethers.provider;

  console.log("=== Huaca v7 — diagnose token 0 ===\n");

  // 1. Owner of token 0 (right now)
  const ownerNow = await nft.ownerOf(0);
  console.log("ownerOf(0) NOW:", ownerNow);

  // 2. Full auction state
  const a = await auc.getAuction(d.contracts.MuseoWeirdNFT.address, 0);
  console.log("\n=== auction state ===");
  console.log("seller:       ", a.seller);
  console.log("startingBid:  ", hre.ethers.formatEther(a.startingBid));
  console.log("highestBid:   ", hre.ethers.formatEther(a.highestBid));
  console.log("highestBidder:", a.highestBidder);
  console.log("endTime:      ", new Date(Number(a.endTime) * 1000).toISOString());
  console.log("settled:      ", a.settled);
  console.log("cancelled:    ", a.cancelled);

  // 3. Pending withdrawals for the bidder (if any)
  const bidder = a.highestBidder;
  if (bidder && bidder !== "0x0000000000000000000000000000000000000000") {
    const pending = await auc.pendingWithdrawals(bidder);
    console.log("\npendingWithdrawals[bidder]:", hre.ethers.formatEther(pending), "ETH");
  }

  // 4. Search Transfer events for token 0 (NFT movements)
  console.log("\n=== Transfer history for token 0 ===");
  const filter = nft.filters.Transfer(null, null, 0n);
  const events = await nft.queryFilter(filter, 0, "latest");
  console.log("Found", events.length, "Transfer events:");
  for (const ev of events) {
    const block = await ev.getBlock();
    console.log(`  block ${ev.blockNumber} (${block.timestamp ? new Date(Number(block.timestamp)*1000).toISOString() : "?"})`);
    console.log(`    ${ev.args.from} → ${ev.args.to}  tx=${ev.transactionHash}`);
  }

  // 5. Search AuctionFinalized events for token 0
  console.log("\n=== AuctionFinalized events ===");
  const finalized = await auc.queryFilter(auc.filters.AuctionFinalized(), 0, "latest");
  for (const ev of finalized) {
    console.log(`  block ${ev.blockNumber} tx=${ev.transactionHash}`);
    console.log(`    winner=${ev.args.winner} amount=${hre.ethers.formatEther(ev.args.amount)}`);
  }

  // 6. Recent transactions on the auction contract
  console.log("\n=== Recent tx on auction contract ===");
  const block = await RPC.getBlockNumber();
  console.log("Current block:", block);

  // Also check seller cell: is the auction "settled" but the NFT still in escrow?
  if (a.settled && ownerNow === d.contracts.MuseoWeirdAuction.address) {
    console.log("\n⚠️ AUCTION MARKED SETTLED but NFT is still in the auction contract!");
    console.log("   This is the bug: finalizeAuction() didn't transfer the NFT to the bidder.");
    console.log("   Either the NFT transfer reverted, or the function is incomplete.");
  }
  if (a.settled && ownerNow === bidder) {
    console.log("\n✅ Token 0 settled correctly — NFT is with the bidder.");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });