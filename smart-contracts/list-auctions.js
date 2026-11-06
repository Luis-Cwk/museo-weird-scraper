// Listar estado de TODAS las subastas (settled / expiradas / activas).
const hre = require("hardhat");

async function main() {
  const d = require("./deployments/sepolia.json");
  const NFT = await hre.ethers.getContractFactory("MuseoWeirdNFT");
  const AUC = await hre.ethers.getContractFactory("MuseoWeirdAuction");
  const nft = NFT.attach(d.contracts.MuseoWeirdNFT.address);
  const auc = AUC.attach(d.contracts.MuseoWeirdAuction.address);

  const supply = Number(await nft.totalSupply());
  const now = Math.floor(Date.now() / 1000);
  console.log(`Total supply: ${supply}, now=${new Date(now*1000).toISOString()}\n`);

  for (let i = 0; i < supply; i++) {
    try {
      const owner = await nft.ownerOf(i);
      const a = await auc.getAuction(d.contracts.MuseoWeirdNFT.address, i);
      const end = Number(a.endTime);
      const expired = end < now;
      const age = ((now - end) / 3600).toFixed(1);
      const hb = a.highestBidder === "0x0000000000000000000000000000000000000000" ? null : a.highestBidder;
      console.log(`#${i}: owner=${owner === d.contracts.MuseoWeirdAuction.address ? "auction(escrow)" : owner}`);
      console.log(`     settled=${a.settled} cancelled=${a.cancelled} expired=${expired} (${age}h)`);
      console.log(`     highestBid=${hre.ethers.formatEther(a.highestBid)} ETH bidder=${hb || "none"}`);
      if (a.settled && owner === d.contracts.MuseoWeirdAuction.address) {
        console.log(`     ⚠️ SETTLED but NFT still in auction — BUG`);
      }
      if (!a.settled && expired) {
        console.log(`     ⏳ ready to settle`);
      }
      console.log("");
    } catch (e) {
      console.log(`#${i}: error ${e.message.slice(0,80)}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });