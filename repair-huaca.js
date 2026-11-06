const fs = require("fs");
const { Wallet, JsonRpcProvider, Contract, parseEther, parseUnits } = require("ethers");

const stash = JSON.parse(fs.readFileSync("deploy/huaca/.upload_stash.json", "utf-8"));
const rpc = stash.mainnet_rpc;
const pk = stash.mainnet_private_key;
const nftAddr = stash.mainnet_nft_contract;
const auctionAddr = stash.mainnet_auction_contract;

const provider = new JsonRpcProvider(rpc);
const wallet = new Wallet(pk, provider);
const ZERO = "0x0000000000000000000000000000000000000000";

const NFT_ABI = [
  "function approve(address to, uint256 tokenId)",
  "function ownerOf(uint256 tokenId) view returns (address)",
];
const AUCTION_ABI = [
  "function cancelAuction(address nftContract, uint256 tokenId)",
  "function createAuction(address nftContract, uint256 tokenId, uint256 startingBid, uint256 durationSeconds)",
  "function getAuction(address nftContract, uint256 tokenId) view returns (tuple(address seller, uint256 tokenId, uint256 startingBid, uint256 highestBid, address highestBidder, uint256 endTime, bool settled, bool cancelled))",
];

const nft = new Contract(nftAddr, NFT_ABI, wallet);
const auction = new Contract(auctionAddr, AUCTION_ABI, wallet);
const GAS = parseUnits("1", "gwei"); // base fee ~0.09 gwei, 1 gwei asegura minería rápida

console.log("wallet:", wallet.address);

async function main() {
  console.log("=== ESTADO INICIAL ===");
  console.log("  ownerOf(31):", await nft.ownerOf(31));
  console.log("  ownerOf(51):", await nft.ownerOf(51));

  // ---------- 1. Revertir token 31 (fue listado por error) ----------
  try {
    const a31 = await auction.getAuction(nftAddr, 31);
    console.log("  auction(31): seller=", a31.seller, "bidder=", a31.highestBidder, "cancelled=", a31.cancelled);
    if (a31.seller.toLowerCase() === wallet.address.toLowerCase() && a31.highestBidder === ZERO && !a31.cancelled && !a31.settled) {
      console.log("\n→ cancelAuction(31)...");
      const tx = await auction.cancelAuction(nftAddr, 31, { gasPrice: GAS });
      await tx.wait();
      console.log("  ✓ cancelAuction(31) tx:", tx.hash);
      console.log("  ownerOf(31) ahora:", await nft.ownerOf(31));
    } else {
      console.log("  ⚠️ No se cancela 31 (no cumple condiciones).");
    }
  } catch (e) {
    console.log("  ⚠️ Error cancelando 31:", e.message.slice(0, 120));
  }

  // ---------- 2. Reparar token 51 (huérfano real) ----------
  try {
    console.log("\n→ approve(auction, 51)...");
    const apTx = await nft.approve(auctionAddr, 51, { gasPrice: GAS });
    await apTx.wait();
    console.log("  ✓ approve(51) tx:", apTx.hash);

    console.log("→ createAuction(51, 0.001 ETH, 24h)...");
    const acTx = await auction.createAuction(nftAddr, 51, parseEther("0.001"), 86400, { gasPrice: GAS });
    await acTx.wait();
    console.log("  ✓ createAuction(51) tx:", acTx.hash);
    console.log("  ownerOf(51) ahora:", await nft.ownerOf(51));
    const a51 = await auction.getAuction(nftAddr, 51);
    console.log("  auction(51): seller=", a51.seller, "| endTime=", new Date(Number(a51.endTime) * 1000).toISOString());
  } catch (e) {
    console.log("  ⚠️ Error reparando 51:", e.message.slice(0, 120));
  }

  console.log("\n=== DONE ===");
}

main().catch((e) => {
  console.error("ERROR FATAL:", e.message);
  process.exit(1);
});