const hre = require("hardhat");

async function main() {
  const d = require("./deployments/sepolia.json");
  const NFT = await hre.ethers.getContractFactory("MuseoWeirdNFT");
  const nft = NFT.attach(d.contracts.MuseoWeirdNFT.address);
  const supply = Number(await nft.totalSupply());
  console.log("Total supply:", supply);
  for (let i = 0; i < supply; i++) {
    try {
      const owner = await nft.ownerOf(i);
      console.log(`  #${i}: owner=${owner === d.contracts.MuseoWeirdAuction.address ? "auction(escrow)" : owner}`);
    } catch (e) {}
  }
}
main().catch((e) => { console.error(e); process.exit(1); });