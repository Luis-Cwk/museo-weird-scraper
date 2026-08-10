const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

/**
 * Deploy MuseoWeirdNFT + MuseoWeirdAuction to the configured network.
 * After deploy, wires the auction address into the NFT contract and saves
 * the deployment info to deployments/<network>.json.
 */
async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const network = hre.network.name;
  const chainId = (await hre.ethers.provider.getNetwork()).chainId;

  console.log(`\nDeploying to network: ${network} (chainId: ${chainId})`);
  console.log(`Deployer: ${deployer.address}\n`);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log(`Balance: ${hre.ethers.formatEther(balance)} ETH\n`);

  // 1. Deploy NFT contract
  console.log("Deploying MuseoWeirdNFT...");
  const NFT = await hre.ethers.getContractFactory("MuseoWeirdNFT");
  const nft = await NFT.deploy(deployer.address);
  await nft.waitForDeployment();
  const nftAddress = await nft.getAddress();
  console.log(`  ✓ MuseoWeirdNFT: ${nftAddress}`);

  // 2. Deploy Auction contract
  console.log("\nDeploying MuseoWeirdAuction...");
  const Auction = await hre.ethers.getContractFactory("MuseoWeirdAuction");
  const auction = await Auction.deploy(deployer.address);
  await auction.waitForDeployment();
  const auctionAddress = await auction.getAddress();
  console.log(`  ✓ MuseoWeirdAuction: ${auctionAddress}`);

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
    timestamp: new Date().toISOString(),
    contracts: {
      MuseoWeirdNFT: {
        address: nftAddress,
        auctionContract: auctionAddress,
      },
      MuseoWeirdAuction: {
        address: auctionAddress,
      },
    },
    explorerUrl: network === "sepolia"
      ? `https://sepolia.etherscan.io/address/${nftAddress}`
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
  if (deploymentInfo.explorerUrl) {
    console.log(`Explorer:          ${deploymentInfo.explorerUrl}`);
  }
  console.log("========================================\n");

  // 5. Update root .env with contract address
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
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});