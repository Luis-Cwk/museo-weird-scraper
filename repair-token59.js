require("dotenv").config();
const { JsonRpcProvider, Wallet, Contract, parseEther, parseUnits } = require("ethers");

const NFT_ADDR = "0xcb6a534EF769416f7a7EC766df9928665a92858b";
const AUC_ADDR = "0xa0610efed22c6fa68954b35a11bc59d674691d77";
const TOKEN_ID = 59;

async function main() {
  const p = new JsonRpcProvider(process.env.MAINNET_RPC_URL || "https://ethereum-rpc.publicnode.com");
  const wallet = new Wallet(process.env.MAINNET_PRIVATE_KEY, p);

  const nft = new Contract(NFT_ADDR, [
    "function ownerOf(uint256) view returns(address)",
    "function getApproved(uint256) view returns(address)",
  ], p);
  const auc = new Contract(AUC_ADDR, [
    "function createAuction(address,uint256,uint256,uint256)",
    "function getAuction(address,uint256) view returns (address seller, uint256 tokenId, uint256 startingBid, uint256 highestBid, address highestBidder, uint256 endTime, bool settled, bool cancelled)",
  ], wallet);

  const owner = await nft.ownerOf(TOKEN_ID);
  const approved = await nft.getApproved(TOKEN_ID);
  console.log("owner:", owner, "| approved:", approved);

  const existing = await auc.getAuction(NFT_ADDR, TOKEN_ID);
  if (existing.seller !== "0x0000000000000000000000000000000000000000") {
    console.log("Ya existe una subasta para este token:", existing);
    return;
  }

  const feeData = await p.getFeeData();
  const baseFeeGwei = Number(feeData.gasPrice) / 1e9;
  const maxFeePerGasGwei = Math.min(Math.max(baseFeeGwei * 2, 2), 5);
  const txOverrides = {
    maxFeePerGas: parseUnits(maxFeePerGasGwei.toFixed(6), "gwei"),
    maxPriorityFeePerGas: parseUnits("1", "gwei"),
  };
  console.log("Usando maxFeePerGas:", maxFeePerGasGwei.toFixed(4), "gwei");

  const startingBid = parseEther("0.001");
  const durationSeconds = 18 * 3600; // 18h, dentro del rango 12-24h usado por el agente

  const tx = await auc.createAuction(NFT_ADDR, TOKEN_ID, startingBid, durationSeconds, txOverrides);
  console.log("tx enviada:", tx.hash);
  const r = await tx.wait();
  console.log("confirmada en bloque", r.blockNumber, "| gas usado:", r.gasUsed.toString());
}

main().catch((e) => {
  console.error("ERROR:", e.message || e);
  process.exit(1);
});
