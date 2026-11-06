import { ethers } from "ethers";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
dotenv.config();

async function main() {
  const beneficiary = "0x4119C2b635B76A2fE7416CB72c8A7bbC14e82375";

  console.log("Deploying HuacaDonations...");
  console.log("Beneficiary:", beneficiary, "(Animals Asia Foundation)");
  console.log("Threshold: 0.5 ETH");

  const rpcUrl = process.env.MAINNET_RPC || "https://ethereum-rpc.publicnode.com";
  const privateKey = process.env.MAINNET_PRIVATE_KEY;

  if (!privateKey) {
    console.error("ERROR: MAINNET_PRIVATE_KEY not set in .env");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const walletSigner = new ethers.Wallet(privateKey, provider);

  console.log("Deployer:", walletSigner.address);

  // Read and compile contract with solc (CommonJS)
  const contractPath = path.join(process.cwd(), "contracts", "donations", "HuacaDonations.sol");
  const source = fs.readFileSync(contractPath, "utf8");

  console.log("Compiling with solc...");

  // Use require for solc (CommonJS)
  const solc = require("solc");

  const input = {
    language: "Solidity",
    sources: {
      "HuacaDonations.sol": {
        content: source
      }
    },
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      },
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode.object"]
        }
      }
    }
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input)));

  if (output.errors) {
    for (const error of output.errors) {
      console.error(error.formattedMessage);
    }
    if (output.errors.some(e => e.severity === "error")) {
      process.exit(1);
    }
  }

  const contract = output.contracts["HuacaDonations.sol"]["HuacaDonations"];
  const abi = contract.abi;
  const bytecode = contract.evm.bytecode.object;

  console.log("Contract compiled successfully");

  // Save ABI for later use
  const artifactsDir = path.join(process.cwd(), "artifacts", "donations");
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(
    path.join(artifactsDir, "HuacaDonations.json"),
    JSON.stringify({ abi, bytecode }, null, 2)
  );

  const factory = new ethers.ContractFactory(abi, bytecode, walletSigner);

  console.log("\nDeploying HuacaDonations...");
  console.log("Beneficiary:", beneficiary, "(Animals Asia Foundation)");
  console.log("Threshold: 0.5 ETH");
  console.log("Deployer:", walletSigner.address);

  const deployedContract = await factory.deploy(
    "0x4119C2b635B76A2fE7416CB72c8A7bbC14e82375"
  );

  await deployedContract.waitForDeployment();

  const address = await deployedContract.getAddress();
  console.log("\n✅ HuacaDonations deployed to:", address);

  // Save deployment info
  const deployInfo = {
    contract: "HuacaDonations",
    address: address,
    beneficiary: "0x4119C2b635B76A2fE7416CB72c8A7bbC14e82375",
    threshold: "0.5 ETH",
    network: "mainnet",
    deployer: walletSigner.address,
    timestamp: new Date().toISOString(),
    chainId: 1,
    note: "First 0.5 ETH from Huaca auctions goes to Animals Asia Foundation (https://thegivingblock.com/donate/animals-asia-foundation/)"
  };

  const deployDir = path.join(process.cwd(), "deploy", "donations");
  fs.mkdirSync(deployDir, { recursive: true });

  const deployPath = path.join(deployDir, `.deploy_mainnet.json`);
  fs.writeFileSync(deployPath, JSON.stringify(deployInfo, null, 2));
  console.log("Deployment info saved to:", deployPath);

  console.log("\n✅ Deployment complete!");
  console.log("Contract address:", address);
  console.log("Beneficiary:", "0x4119C2b635B76A2fE7416CB72c8A7bbC14e82375 (Animals Asia Foundation)");
  console.log("Threshold: 0.5 ETH");
  console.log("\nDonations can be sent to:", address);
  console.log("When balance reaches 0.5 ETH, it auto-forwards to Animals Asia Foundation.");
  console.log("Foundation: https://thegivingblock.com/donate/animals-asia-foundation/");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  });