const hre = require("hardhat");
async function main() {
  const d = require("./deployments/sepolia.json");
  const NFT = await hre.ethers.getContractFactory("MuseoWeirdNFT");
  const nft = NFT.attach(d.contracts.MuseoWeirdNFT.address);

  const tokenId = 0;
  const newUri = "https://petrasynthetic.com/huaca/metadata-1.json";

  console.log("Antes tokenURI(0):", await nft.tokenURI(tokenId));
  const tx = await nft.updateMetadata(tokenId, newUri);
  await tx.wait();
  console.log("updateMetadata tx:", tx.hash);
  console.log("Después tokenURI(0):", await nft.tokenURI(tokenId));
}
main().catch((e) => { console.error(e); process.exit(1); });
