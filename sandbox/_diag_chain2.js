
const { ethers } = require("ethers");
const RPC = "https://ethereum-sepolia.publicnode.com";
const NFT = "0xFe9aC9343296951f12bd4CD0bAE678F0203c9934";   // NEW (v5)
const AUCTION = "0x548DCE9dD67442be7cC6C48c44319c1FBcCfD314"; // NEW (v5)

const NFT_ABI = ["function totalSupply() view returns (uint256)", "function ownerOf(uint256) view returns (address)"];
const AUCTION_ABI = ["function getAuction(address,uint256) view returns (tuple(address seller,uint256 tokenId,uint256 startingBid,uint256 highestBid,address highestBidder,uint256 endTime,bool settled,bool cancelled))"];

(async () => {
  const p = new ethers.JsonRpcProvider(RPC);
  const nft = new ethers.Contract(NFT, NFT_ABI, p);
  const auc = new ethers.Contract(AUCTION, AUCTION_ABI, p);
  const ts = await nft.totalSupply();
  console.log("NEW totalSupply =", ts.toString());
  const now = Math.floor(Date.now()/1000);
  for (let i = 0; i <= 8; i++) {
    let owner = "?";
    try { owner = await nft.ownerOf(i); owner = owner.slice(0,10); } catch(e){ owner = "NONE"; }
    let a = null;
    try { a = await auc.getAuction(NFT, i); } catch(e){ a = null; }
    if (a) {
      const endSec = Number(a.endTime);
      const remaining = endSec - now;
      const status = a.cancelled ? "CANCELLED" : (a.settled ? "SETTLED" : (remaining <= 0 ? "EXPIRED" : "ACTIVE"));
      console.log(`token ${i}: owner=${owner} ${status} remaining=${Math.floor(remaining/3600)}h bid=${ethers.formatEther(a.highestBid)}`);
    } else {
      console.log(`token ${i}: owner=${owner} auction=NONE`);
    }
  }
})().catch(e => console.error("ERR", e.message));
