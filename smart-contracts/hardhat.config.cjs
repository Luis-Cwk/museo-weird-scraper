require("@nomicfoundation/hardhat-toolbox");
require("@nomicfoundation/hardhat-verify");

// Load env vars from the local .env (in smart-contracts folder)
require("dotenv").config({ path: __dirname + "/.env" });

const PRIVATE_KEY = process.env.PRIVATE_KEY || "";
const MAINNET_PRIVATE_KEY = process.env.MAINNET_PRIVATE_KEY || PRIVATE_KEY;
const SEPOLIA_RPC = process.env.SEPOLIA_RPC || "https://ethereum-sepolia.publicnode.com";
const MAINNET_RPC = process.env.MAINNET_RPC || "https://ethereum-rpc.publicnode.com";
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || "";

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.26",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "cancun",
    },
  },
  networks: {
    hardhat: { chainId: 31337 },
    sepolia: {
      url: SEPOLIA_RPC,
      accounts: [PRIVATE_KEY],
      chainId: 11155111,
      gasPrice: "auto",
    },
    mainnet: {
      url: MAINNET_RPC,
      accounts: [MAINNET_PRIVATE_KEY],
      chainId: 1,
      gasPrice: "auto",
    },
  },
  etherscan: {
    apiKey: ETHERSCAN_API_KEY,
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};
