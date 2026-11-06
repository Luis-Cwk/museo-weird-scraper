#!/bin/bash
# ============================================================
# Huaca v5 deploy helper — for Petra to run MANUALLY
# ============================================================
# This script does 3 things:
#   1. Deploys MuseoWeirdNFT + MuseoWeirdAuction to Sepolia
#   2. Saves deployment to deployments/sepolia.v5.json
#   3. Updates ../deploy/huaca/.upload_stash.json with new addresses
#
# After this script finishes, the next cron run (11:30am CST)
# will mint the first v5 NFT automatically.
#
# Run from smart-contracts/ directory:
#   cd smart-contracts && bash ../scripts/deploy-v5.sh
#
# Cost: ~0.001-0.003 ETH in Sepolia gas (well under wallet balance)
# Time: 2-5 minutes
# ============================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACTS_DIR="$SCRIPT_DIR/../smart-contracts"
STASH_PATH="$SCRIPT_DIR/../deploy/huaca/.upload_stash.json"

cd "$CONTRACTS_DIR"

echo "=========================================="
echo "Huaca v5 deploy — $(date)"
echo "=========================================="
echo "Contracts dir:  $CONTRACTS_DIR"
echo "Stash path:     $STASH_PATH"
echo ""

# ---- Step 1: Confirm the network is Sepolia ----
echo "[1/4] Pre-deploy checks..."
SEPOLIA_RPC=$(grep sepolia_rpc "$STASH_PATH" | sed -E 's/.*"sepolia_rpc": "([^"]+)".*/\1/')
if [ -z "$SEPOLIA_RPC" ]; then
  echo "ERROR: could not read sepolia_rpc from $STASH_PATH"
  exit 1
fi
echo "  ✓ RPC: $SEPOLIA_RPC"

# ---- Step 2: Run the deploy ----
echo ""
echo "[2/4] Deploying MuseoWeirdNFT + MuseoWeirdAuction to Sepolia..."
echo "  (this takes 30s-2min)"
npx hardhat run scripts/deploy.js --network sepolia

# ---- Step 3: Save deployment as v5 ----
echo ""
echo "[3/4] Saving deployment as v5..."
if [ -f deployments/sepolia.json ]; then
  cp deployments/sepolia.json deployments/sepolia.v5.json
  echo "  ✓ Copied to deployments/sepolia.v5.json"
else
  echo "ERROR: deployments/sepolia.json not found after deploy"
  exit 1
fi

# Read the new addresses
NEW_NFT=$(grep -A 3 '"MuseoWeirdNFT"' deployments/sepolia.v5.json | grep '"address"' | head -1 | sed -E 's/.*"address": "([^"]+)".*/\1/')
NEW_AUCTION=$(grep -A 3 '"MuseoWeirdAuction"' deployments/sepolia.v5.json | grep '"address"' | head -1 | sed -E 's/.*"address": "([^"]+)".*/\1/')

if [ -z "$NEW_NFT" ] || [ -z "$NEW_AUCTION" ]; then
  echo "ERROR: could not parse new addresses from deployments/sepolia.v5.json"
  exit 1
fi

echo ""
echo "  ✓ New NFT contract:      $NEW_NFT"
echo "  ✓ New auction contract:  $NEW_AUCTION"

# ---- Step 4: Update .upload_stash.json ----
echo ""
echo "[4/4] Updating $STASH_PATH with new addresses..."

# Use a Node one-liner to update the stash in place (preserves private_key, etc.)
node -e "
const fs = require('fs');
const stash = JSON.parse(fs.readFileSync('$STASH_PATH', 'utf-8'));
stash.nft_contract = '$NEW_NFT';
stash.auction_contract = '$NEW_AUCTION';
fs.writeFileSync('$STASH_PATH', JSON.stringify(stash, null, 2));
console.log('  ✓ Updated nft_contract and auction_contract');
"

echo ""
echo "=========================================="
echo "DONE — v5 deployed and stash updated"
echo "=========================================="
echo ""
echo "Old v4 NFT:      0x87E57042C8a4cd95D3aF635940294802aabfFc85  (still on-chain, 25 NFTs)"
echo "Old v4 Auction:  0x54dEdeBC156044E3de51f54264Db26eC393bbB0D  (still on-chain)"
echo "New v5 NFT:      $NEW_NFT"
echo "New v5 Auction:  $NEW_AUCTION"
echo ""
echo "The next cron run (11:30am CST) will mint the first v5 NFT."
echo "Previous v4 NFTs remain visible on Sepolia at the old addresses."
echo ""
echo "Run 'cat deploy/huaca/.upload_stash.json' to verify the new addresses are in place."
echo "=========================================="
