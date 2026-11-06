// scripts/deploy-donations.js
// Deploy HuacaDonations contract using Hardhat
// Run from smart-contracts/ directory: npx hardhat run scripts/deploy-donations.js --network mainnet

require("dotenv").config({ path: "../.env" });

async function main() {
  const beneficiary = "0x4119C2b635B76A2fE7416CB72c8A7bbC14e82375"; // Animals Asia Foundation
  
  console.log("Deploying HuacaDonations...");
  console.log("Beneficiary:", beneficiary, "(Animals Asia Foundation)");
  console.log("Threshold: 0.5 ETH");
  
  const HuacaDonations = await ethers.getContractFactory("HuacaDonations");
  const donations = await HuacaDonations.deploy(beneficiary);
  
  await donations.waitForDeployment();
  
  const address = await donations.getAddress();
  console.log("\n✅ HuacaDonations deployed to:", address);
  
  // Save deployment info
  const fs = require("fs");
  const path = require("path");
  
  const deployInfo = {
    contract: "HuacaDonations",
    address: address,
    beneficiary: "0x4119C2b635B76A2fE7416CB72c8A7bbC14e82375",
    threshold: "0.5 ETH",
    network: network.name,
    deployer: (await ethers.getSigners())[0].address,
    timestamp: new Date().toISOString(),
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    note: "First 0.5 ETH from Huaca auctions goes to Animals Asia Foundation (https://thegivingblock.com/donate/animals-asia-foundation/)"
  };
  
  const deployDir = path.join(__dirname, "..", "deploy", "donations");
  if (!fs.existsSync(deployDir)) {
    fs.mkdirSync(deployDir, { recursive: true });
  }
  
  const deployPath = path.join(deployDir, `.deploy_${network.name}.json`);
  fs.writeFileSync(deployPath, JSON.stringify(deployInfo, null, 2));
  console.log("Deployment info saved to:", deployPath);
  
  console.log("\n✅ Deployment complete!");
  console.log("Contract address:", address);
  console.log("Beneficiary:", "0x4119C2b635B76A2fE7416CB72c8A7bbC14e82375 (Animals Asia Foundation)");
  console.log("Threshold: 0.5 ETH");
  console.log("\nDonations can be sent to:", address);
  console.log("When balance reaches 0.5 ETH, it auto-forwards to Animals Asia Foundation.");
  console.log("Foundation: https://thegivingblock.com/donate/animals-asia-foundation/");
  
  // Verify on Etherscan if not localhost/hardhat
  if (network.name !== "hardhat" && network.name !== "localhost") {
    console.log("Waiting for block confirmations...");
    await donations.deploymentTransaction()?.wait(5);
    
    console.log("Verifying on Etherscan...");
    try {
      await hre.run("verify:verify", {
        address: address,
        constructorArguments: [beneficiary],
      });
      console.log("Contract verified on Etherscan");
    } catch (e) {
      console.log("Verification failed:", e.message);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  });