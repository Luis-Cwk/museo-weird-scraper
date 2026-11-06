const hre = require("hardhat");
async function main() {
  const d = require("./deployments/sepolia.json");
  const NFT = await hre.ethers.getContractFactory("MuseoWeirdNFT");
  const AUC = await hre.ethers.getContractFactory("MuseoWeirdAuction");
  const nft = NFT.attach(d.contracts.MuseoWeirdNFT.address);
  const auc = AUC.attach(d.contracts.MuseoWeirdAuction.address);

  const supply = Number(await nft.totalSupply());
  console.log("totalSupply (debe ser 1):", supply);

  const owner0 = await nft.ownerOf(0);
  console.log("ownerOf(0):", owner0, "(debe ser auction = escrow)");

  const a = await auc.getAuction(d.contracts.MuseoWeirdNFT.address, 0);
  console.log("=== Auction token 0 ===");
  console.log("seller:", a.seller);
  console.log("startingBid (wei):", a.startingBid.toString());
  console.log("highestBid:", a.highestBid.toString());
  console.log("highestBidder:", a.highestBidder);
  console.log("endTime:", a.endTime.toString());
  console.log("settled:", a.settled, "| cancelled:", a.cancelled);
  console.log("seller == artista:", a.seller.toLowerCase() === "0x1A49138cCb61C50D72A44a299F6C74c690f6c67f".toLowerCase());

  const uri = await nft.tokenURI(0);
  console.log("tokenURI(0):", uri);
}
main().catch((e) => { console.error(e); process.exit(1); });
