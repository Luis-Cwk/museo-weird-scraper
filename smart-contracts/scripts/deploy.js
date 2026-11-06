const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

/**
 * Deploy MuseoWeirdAuction + MuseoWeirdNFT to the configured network.
 *
 * Order matters now:
 *   1. Auction is deployed FIRST (needs the treasury address).
 *   2. NFT is deployed SECOND with royaltyReceiver = auction address,
 *      so ERC2981 royalties flow into the auction's receive(), which splits 50/50.
 *   3. nft.setAuctionContract(auction) wires them together.
 *
 * Treasury (50% of proceeds + royalties): betapetra.eth
 */
const TREASURY_ADDRESS = process.env.HUACA_TREASURY || "0xE99c3Ecbc68868602CF558325BC6ab6A9807dFa9";

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const network = hre.network.name;
  const chainId = (await hre.ethers.provider.getNetwork()).chainId;

  // 2026-09-02: safety gate for mainnet. Deploying on mainnet costs real
  // ETH, so we require an explicit MAINNET_CONFIRM=YES env var to proceed.
  // Without it, abort cleanly with a clear message.
  if (network === "mainnet") {
    if (process.env.MAINNET_CONFIRM !== "YES") {
      console.error("\n❌ ABORTED: Mainnet deploy requires MAINNET_CONFIRM=YES env var.");
      console.error("This is a safety guard against accidental mainnet deploys.");
      console.error("Re-run with:");
      console.error("  MAINNET_CONFIRM=YES npx hardhat run scripts/deploy.js --network mainnet\n");
      process.exit(2);
    }
    console.log("\n⚠️  MAINNET DEPLOY — using real ETH. Confirm with deployer:");
    console.log(`   Address: ${deployer.address}`);
    console.log(`   Balance: ${hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address))} ETH`);
    console.log(`   Treasury: ${TREASURY_ADDRESS}`);
    console.log(`   Type 'yes' to proceed or Ctrl+C to abort (3 second wait)\n`);
    // Brief wait for human confirmation in interactive terminals.
    // In CI/non-TTY this still proceeds after timeout (MAINNET_CONFIRM already passed).
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 3000);
      if (process.stdin.isTTY) {
        process.stdin.once("data", (data) => {
          clearTimeout(timer);
          if (data.toString().trim().toLowerCase() !== "yes") {
            console.error("Aborted by user.");
            process.exit(2);
          }
          resolve();
        });
      }
    });
  }

  console.log(`\nDeploying to network: ${network} (chainId: ${chainId})`);
  console.log(`Deployer (owner/artist): ${deployer.address}`);
  console.log(`Treasury (50%):          ${TREASURY_ADDRESS}\n`);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log(`Balance: ${hre.ethers.formatEther(balance)} ETH\n`);

  // 1. Deploy Auction (treasury baked into constructor)
  console.log("Deploying MuseoWeirdAuction...");
  const Auction = await hre.ethers.getContractFactory("MuseoWeirdAuction");
  const auction = await Auction.deploy(deployer.address, TREASURY_ADDRESS);
  await auction.waitForDeployment();
  const auctionAddress = await auction.getAddress();
  console.log(`  ✓ MuseoWeirdAuction: ${auctionAddress}`);

  // 2. Deploy NFT (royaltyReceiver = auction address)
  console.log("\nDeploying MuseoWeirdNFT...");
  const NFT = await hre.ethers.getContractFactory("MuseoWeirdNFT");
  const nft = await NFT.deploy(deployer.address, auctionAddress);
  await nft.waitForDeployment();
  const nftAddress = await nft.getAddress();
  console.log(`  ✓ MuseoWeirdNFT: ${nftAddress}`);

  // 3. Wire them together
  console.log("\nWiring auction contract into NFT...");
  const tx = await nft.setAuctionContract(auctionAddress);
  await tx.wait();
  console.log(`  ✓ setAuctionContract(${auctionAddress})`);

  // 4. Save deployment info
  const deploymentsDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(deploymentsDir, { recursive: true });

  const deploymentInfo = {
    network,
    chainId: Number(chainId),
    deployer: deployer.address,
    treasury: TREASURY_ADDRESS,
    timestamp: new Date().toISOString(),
    contracts: {
      MuseoWeirdNFT: {
        address: nftAddress,
        auctionContract: auctionAddress,
        royaltyReceiver: auctionAddress,
        royaltyFeeBps: 1500,
      },
      MuseoWeirdAuction: {
        address: auctionAddress,
        treasury: TREASURY_ADDRESS,
      },
    },
    explorerUrl: network === "sepolia"
      ? `https://sepolia.etherscan.io/address/${nftAddress}`
      : network === "mainnet"
      ? `https://etherscan.io/address/${nftAddress}`
      : null,
  };

  const deploymentFile = path.join(deploymentsDir, `${network}.json`);
  fs.writeFileSync(deploymentFile, JSON.stringify(deploymentInfo, null, 2));
  console.log(`\n✓ Deployment saved to ${deploymentFile}`);

  console.log("\n========================================");
  console.log("DEPLOYMENT COMPLETE");
  console.log("========================================");
  console.log(`Network:           ${network} (chainId ${chainId})`);
  console.log(`MuseoWeirdNFT:     ${nftAddress}`);
  console.log(`MuseoWeirdAuction: ${auctionAddress}`);
  console.log(`Treasury:          ${TREASURY_ADDRESS}`);
  if (deploymentInfo.explorerUrl) {
    console.log(`Explorer:          ${deploymentInfo.explorerUrl}`);
  }
  console.log("========================================\n");

  // 5. Update root .env with contract addresses
  const envPath = path.join(__dirname, "..", "..", ".env");
  if (fs.existsSync(envPath)) {
    let env = fs.readFileSync(envPath, "utf-8");
    env = env.replace(/^NEXT_PUBLIC_CONTRACT_ADDRESS=.*$/m,
                      `NEXT_PUBLIC_CONTRACT_ADDRESS=${nftAddress}`);
    env = env.replace(/^NEXT_PUBLIC_AUCTION_ADDRESS=.*$/m,
                      `NEXT_PUBLIC_AUCTION_ADDRESS=${auctionAddress}`);
    if (!env.includes("NEXT_PUBLIC_AUCTION_ADDRESS=")) {
      env += `\nNEXT_PUBLIC_AUCTION_ADDRESS=${auctionAddress}\n`;
    }
    fs.writeFileSync(envPath, env);
    console.log("✓ Updated root .env with contract addresses");
  }

  // 2026-09-02: also update deploy/huaca/.upload_stash.json so the agent
  // knows where the deployed contracts are for this network.
  const stashPath = path.join(__dirname, "..", "..", "deploy", "huaca", ".upload_stash.json");
  if (fs.existsSync(stashPath)) {
    const stash = JSON.parse(fs.readFileSync(stashPath, "utf-8"));
    if (network === "sepolia") {
      stash.sepolia_rpc = stash.sepolia_rpc || process.env.SEPOLIA_RPC || "https://ethereum-sepolia.publicnode.com";
      stash.nft_contract = nftAddress;
      stash.auction_contract = auctionAddress;
    } else if (network === "mainnet") {
      stash.mainnet_rpc = stash.mainnet_rpc || process.env.MAINNET_RPC || "https://ethereum-rpc.publicnode.com";
      stash.mainnet_nft_contract = nftAddress;
      stash.mainnet_auction_contract = auctionAddress;
    }
    fs.writeFileSync(stashPath, JSON.stringify(stash, null, 2));
    console.log(`✓ Updated deploy/huaca/.upload_stash.json (${network} addresses)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
