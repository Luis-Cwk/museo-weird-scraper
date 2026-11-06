// Diagnostico completo v8: historial de eventos del token 0
const hre = require("hardhat");

async function main() {
  const d = require("./deployments/sepolia.json");
  const NFT = await hre.ethers.getContractFactory("MuseoWeirdNFT");
  const AUC = await hre.ethers.getContractFactory("MuseoWeirdAuction");
  const nft = NFT.attach(d.contracts.MuseoWeirdNFT.address);
  const auc = AUC.attach(d.contracts.MuseoWeirdAuction.address);

  console.log("=== Diagnóstico completo token 0 (v8) ===\n");

  // 1. Owner y auction state actuales
  const ownerNow = await nft.ownerOf(0);
  console.log("ownerOf(0) AHORA:", ownerNow);

  try {
    const a = await auc.getAuction(d.contracts.MuseoWeirdNFT.address, 0);
    console.log("\n=== auction state ===");
    console.log("seller:       ", a.seller);
    console.log("startingBid:  ", hre.ethers.formatEther(a.startingBid));
    console.log("highestBid:   ", hre.ethers.formatEther(a.highestBid));
    console.log("highestBidder:", a.highestBidder);
    console.log("settled:      ", a.settled);
    console.log("cancelled:    ", a.cancelled);
  } catch (e) {
    console.log("(no hay auction creada para este token — fue cancelada o nunca existio)");
  }

  // 2. Eventos de Transfer en el NFT
  console.log("\n=== Transfer events (NFT) ===");
  try {
    const filter = nft.filters.Transfer();
    const events = await nft.queryFilter(filter, 0, "latest");
    for (const ev of events) {
      console.log(`  block ${ev.blockNumber} tx=${ev.transactionHash.slice(0,20)}...`);
      console.log(`    ${ev.args.from.slice(0,10)}… → ${ev.args.to.slice(0,10)}…  tokenId=${ev.args.tokenId}`);
    }
  } catch (e) {
    console.log("(error leyendo transfers):", e.message.slice(0, 80));
  }

  // 3. Eventos de la subasta: AuctionCreated, BidPlaced, AuctionFinalized, AuctionCancelled
  console.log("\n=== Auction events ===");
  for (const ev of ["AuctionCreated", "BidPlaced", "AuctionFinalized", "AuctionCancelled"]) {
    try {
      const events = await auc.queryFilter(auc.filters[ev](), 0, "latest");
      console.log(`  ${ev}: ${events.length} evento(s)`);
      for (const e of events) {
        console.log(`    block ${e.blockNumber} tx=${e.transactionHash.slice(0,20)}…`);
        console.log(`    args: ${JSON.stringify(e.args, (k, v) => typeof v === "bigint" ? v.toString() : v)}`);
      }
    } catch (e2) {
      console.log(`  ${ev}: error -`, e2.message.slice(0, 60));
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });