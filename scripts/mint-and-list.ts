import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { ethers } from "../smart-contracts/node_modules/ethers";
import { PinataService } from "./pinata-service";
import { computeQueueHmac, loadQueue, saveQueue, QueueItem } from "./scraper";

dotenv.config();

type Deployment = {
  contracts: {
    MuseoWeirdNFT: { address: string };
    MuseoWeirdAuction: { address: string };
  };
};

const NFT_ABI = [
  "function mint(address to, string uri) returns (uint256)",
  "function approve(address to, uint256 tokenId)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function totalSupply() view returns (uint256)",
];
const AUCTION_ABI = [
  "function createAuction(address nftContract, uint256 tokenId, uint256 startingBid, uint256 durationSeconds)",
];

function loadDeployment(): Deployment {
  const network = process.env.MUSEO_NETWORK || "sepolia";
  const deploymentPath = path.join(__dirname, "..", "smart-contracts", "deployments", `${network}.json`);
  if (!fs.existsSync(deploymentPath)) {
    throw new Error(`Deployment not found: ${deploymentPath}`);
  }
  return JSON.parse(fs.readFileSync(deploymentPath, "utf8")) as Deployment;
}

function getProvider(): ethers.JsonRpcProvider {
  const rpcUrl = process.env.SEPOLIA_RPC_URL || process.env.SEPOLIA_RPC || process.env.BASE_SEPOLIA_RPC_URL;
  if (!rpcUrl) throw new Error("Set SEPOLIA_RPC_URL or BASE_SEPOLIA_RPC_URL in .env");
  return new ethers.JsonRpcProvider(rpcUrl);
}

function metadataFor(item: QueueItem, imageUrl: string, animationUrl?: string): Record<string, unknown> {
  return {
    name: `Huaca, Sistemas Mágicos #${item.id}`,
    description: item.content,
    image: imageUrl,
    ...(animationUrl ? { animation_url: animationUrl } : {}),
    external_url: item.source,
    attributes: [
      { trait_type: "Type", value: item.type },
      { trait_type: "Attribution", value: item.attribution },
      { trait_type: "Source", value: item.source },
    ],
  };
}

async function processItem(item: QueueItem, pinata: PinataService, nft: ethers.Contract, auction: ethers.Contract, walletAddress: string): Promise<void> {
  if (!item.artworkPath) throw new Error("Queue item has no artwork path");
  const artworkPath = path.resolve(__dirname, "..", item.artworkPath);

  // Detect file type: .html (voxel sculpture) vs .svg (legacy typography).
  // HTML is uploaded as `animation_url` so OpenSea renders the live piece
  // while a PNG preview can be used for the `image` field.
  const isHtml = artworkPath.toLowerCase().endsWith(".html");
  const fileName = isHtml ? `museo-weird-${item.id}.html` : `museo-weird-${item.id}.svg`;

  const image = await pinata.uploadFile(artworkPath, { name: fileName, keyvalues: { queueId: String(item.id) } });
  item.imageCid = image.cid;
  item.status = "uploading";

  // For HTML pieces, `image` is the same file but most marketplaces need
  // a static image preview. For now we point `image` to the HTML as well
  // (OpenSea will pick a frame). If/when we add a PNG snapshot step, this
  // is where it would slot in.
  const imageUrl = pinata.getGatewayUrl(image.cid);
  const animationUrl = isHtml ? imageUrl : undefined;

  const metadata = await pinata.uploadJSON(
    metadataFor(item, imageUrl, animationUrl),
    `museo-weird-${item.id}.json`,
    { name: `Museo Weird #${item.id}` },
  );
  item.metadataCid = metadata.cid;

  const mintTx = await nft.mint(walletAddress, metadata.ipfsUri);
  const mintReceipt = await mintTx.wait();
  // 2026-08-27: bug fix — reading `totalSupply() - 1` after `mintTx.wait()`
  // is racy. The Transfer event in the receipt log is the canonical source
  // for the new tokenId and survives concurrent mints correctly.
  // Transfer(address from, address to, uint256 tokenId) — tokenId is the
  // 3rd topic (index 3, since topics[0] is the event sig).
  const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c20b676f7d3fbc6c56f5f7d0d6c0f3a9a5e3a4e5b6c7d8e";
  let tokenId = -1;
  for (const log of mintReceipt.logs as Array<{ topics: ReadonlyArray<string> }>) {
    if (log.topics.length === 4 && log.topics[0] === TRANSFER_TOPIC) {
      tokenId = Number(BigInt(log.topics[3]));
      break;
    }
  }
  if (tokenId < 0) {
    // Fallback: read pre-mint totalSupply as the new tokenId. The script's
    // own mint is the only thing that incremented the counter, so reading
    // immediately after wait() is fine — but if a concurrent mint happened
    // in between, this still mis-assigns. The Transfer event path above is
    // the safe one; this fallback only triggers if the receipt log is missing.
    tokenId = Number(await nft.totalSupply()) - 1;
    console.warn(`  [warn] no Transfer event for queue item; falling back to totalSupply-1 = ${tokenId}`);
  }
  item.tokenId = tokenId;
  item.mintTx = mintReceipt.hash;
  item.status = "minting";

  const approveTx = await nft.approve(await auction.getAddress(), tokenId);
  await approveTx.wait();
  const duration = Number(process.env.AUCTION_DURATION_SECONDS || 86400);
  const startingBid = ethers.parseEther(item.listPrice || "0.001");
  const listTx = await auction.createAuction(await nft.getAddress(), tokenId, startingBid, duration);
  const listReceipt = await listTx.wait();
  item.listTx = listReceipt.hash;
  item.status = "done";
  item.lastAttempt = new Date().toISOString();
  item.hmac = computeQueueHmac(item);
}

async function main(): Promise<void> {
  const requestedId = process.argv.slice(2).find((arg) => /^\d+$/.test(arg));
  const queue = loadQueue();
  const pending = queue.items.filter((item) => (item.status === "pending" || item.status === "failed") && (!requestedId || item.id === Number(requestedId)));
  if (pending.length === 0) throw new Error("No pending or failed queue item found");

  const provider = getProvider();
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY || "", provider);
  const deployment = loadDeployment();
  const nft = new ethers.Contract(deployment.contracts.MuseoWeirdNFT.address, NFT_ABI, wallet);
  const auction = new ethers.Contract(deployment.contracts.MuseoWeirdAuction.address, AUCTION_ABI, wallet);
  const pinata = new PinataService();

  for (const item of pending) {
    item.status = "uploading";
    item.lastAttempt = new Date().toISOString();
    saveQueue(queue);
    try {
      await processItem(item, pinata, nft, auction, wallet.address);
      console.log(`✓ Queue #${item.id}: token ${item.tokenId}, listed (${item.listTx})`);
    } catch (error) {
      item.status = "failed";
      item.retries = (item.retries || 0) + 1;
      item.error = error instanceof Error ? error.message : String(error);
      console.error(`✗ Queue #${item.id}: ${item.error}`);
    }
    saveQueue(queue);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
