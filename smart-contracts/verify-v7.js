const hre = require("hardhat");
async function main() {
  const d = require("./deployments/sepolia.json");
  const NFT = await hre.ethers.getContractFactory("MuseoWeirdNFT");
  const AUC = await hre.ethers.getContractFactory("MuseoWeirdAuction");
  const nft = NFT.attach(d.contracts.MuseoWeirdNFT.address);
  const auc = AUC.attach(d.contracts.MuseoWeirdAuction.address);

  const owner = await nft.owner();
  const aucOwner = await auc.owner();
  const treasury = await auc.treasury();

  const salePrice = hre.ethers.parseEther("1");
  const [receiver, amount] = await nft.royaltyInfo(0, salePrice);
  const pct = (Number(amount) / Number(salePrice)) * 100;

  console.log("=== VERIFICACION v7 ===");
  console.log("NFT address:", d.contracts.MuseoWeirdNFT.address);
  console.log("Auction address:", d.contracts.MuseoWeirdAuction.address);
  console.log("NFT owner (artista):", owner);
  console.log("Auction owner:", aucOwner);
  console.log("Auction treasury:", treasury);
  console.log("Treasury == betapetra.eth:", treasury.toLowerCase() === "0xE99c3Ecbc68868602CF558325BC6ab6A9807dFa9".toLowerCase());
  console.log("royaltyInfo receiver (debe ser auction):", receiver);
  console.log("royaltyInfo receiver == auction:", receiver.toLowerCase() === d.contracts.MuseoWeirdAuction.address.toLowerCase());
  console.log("royalty % (debe ser 15):", pct);
  console.log("nft.auctionContract:", await nft.auctionContract());
  console.log("nft.totalSupply:", Number(await nft.totalSupply()));
}
main().catch((e) => { console.error(e); process.exit(1); });
