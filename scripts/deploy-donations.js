const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  // Beneficiary wallet: 0x4119C2b635B76A2fE7416CB72c8A7bbC14e82375
  const beneficiary = "0x4119C2b635B76A2fE7416CB72c8A7bbC14e82375";
  
  console.log("Deploying HuacaDonations...");
  console.log("Beneficiary:", beneficiary);
  console.log("Threshold: 0.5 ETH");
  
  const HuacaDonations = await ethers.getContractFactory("HuacaDonations");
  const donations = await HuacaDonations.deploy(beneficiary);
  
  await donations.waitForDeployment();
  
  const address = await donations.getAddress();
  console.log("HuacaDonations deployed to:", address);
  
  // Save deployment info
  const deployInfo = {
    contract: "HuacaDonations",
    address: address,
    beneficiary: beneficiary,
    threshold: "0.5 ETH",
    network: network.name,
    deployer: (await ethers.getSigners())[0].address,
    timestamp: new Date().toISOString(),
    chainId: (await ethers.provider.getNetwork()).chainId
  };
  
  const deployDir = path.join(__dirname, "..", "deploy", "donations");
  if (!fs.existsSync(deployDir)) {
    fs.mkdirSync(deployDir, { recursive: true });
  }
  
  const deployPath = path.join(deployDir, `.deploy_${network.name}.json`);
  fs.writeFileSync(deployPath, JSON.stringify(deployInfo, null, 2));
  console.log("Deployment info saved to:", deployPath);
  
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
    console.error(error);
    process.exit(1);
  });