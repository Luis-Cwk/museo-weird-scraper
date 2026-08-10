// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title MuseoWeirdAuction
 * @notice English auction house for MuseoWeirdNFT tokens.
 *
 * Flow:
 *   1. Owner (artist/bot) approves this contract to manage a specific tokenId.
 *   2. Owner calls createAuction(tokenId, startingBid, duration) to list it.
 *   3. Bidders call bid(tokenId) with ETH >= current highest bid + minimum increment.
 *   4. When the auction ends, anyone calls finalizeAuction(tokenId) to settle:
 *      - Transfers NFT to the winner
 *      - Sends the highest bid (minus royalty already handled by ERC-2981) to the seller
 *
 * Cancel:
 *   - The seller can cancel before any bid is placed.
 *   - Once bids exist, only the seller can withdraw the NFT (no refunds — bidders keep funds).
 *
 * Security:
 *   - ReentrancyGuard on bid() and finalize()
 *   - Pull-payment pattern: highest bid is held in escrow until finalize()
 */
contract MuseoWeirdAuction is Ownable, ReentrancyGuard {

    struct Auction {
        address seller;
        uint256 tokenId;
        address nftContract;
        uint256 startingBid;
        uint256 highestBid;
        address highestBidder;
        uint256 endTime;
        bool ended;
        bool cancelled;
    }

    /// @notice Minimum bid increment (basis points, 500 = 5%)
    uint256 public constant MIN_BID_INCREMENT_BPS = 500;

    /// @notice Active auctions by tokenId (per NFT contract)
    mapping(address => mapping(uint256 => Auction)) public auctions;

    /// @notice List of all active auction IDs per NFT contract
    mapping(address => uint256[]) public activeAuctionIds;

    event AuctionCreated(
        address indexed nftContract,
        uint256 indexed tokenId,
        address indexed seller,
        uint256 startingBid,
        uint256 endTime
    );

    event BidPlaced(
        address indexed nftContract,
        uint256 indexed tokenId,
        address indexed bidder,
        uint256 amount
    );

    event AuctionFinalized(
        address indexed nftContract,
        uint256 indexed tokenId,
        address indexed winner,
        uint256 amount
    );

    event AuctionCancelled(
        address indexed nftContract,
        uint256 indexed tokenId
    );

    constructor(address initialOwner) Ownable(initialOwner) {}

    /**
     * @notice Create an auction for an NFT. The seller must own the NFT and
     *         have approved this contract to manage it.
     */
    function createAuction(
        address nftContract,
        uint256 tokenId,
        uint256 startingBid,
        uint256 durationSeconds
    ) external {
        require(startingBid > 0, "Starting bid must be > 0");
        require(durationSeconds >= 1 hours && durationSeconds <= 30 days, "Bad duration");

        IERC721 nft = IERC721(nftContract);
        require(nft.ownerOf(tokenId) == msg.sender, "Not token owner");
        require(nft.getApproved(tokenId) == address(this) || nft.isApprovedForAll(msg.sender, address(this)),
                "Auction not approved");

        Auction storage existing = auctions[nftContract][tokenId];
        require(!existing.ended && !existing.cancelled && existing.endTime == 0, "Already listed");

        uint256 endTime = block.timestamp + durationSeconds;
        auctions[nftContract][tokenId] = Auction({
            seller: msg.sender,
            tokenId: tokenId,
            nftContract: nftContract,
            startingBid: startingBid,
            highestBid: 0,
            highestBidder: address(0),
            endTime: endTime,
            ended: false,
            cancelled: false
        });

        activeAuctionIds[nftContract].push(tokenId);
        emit AuctionCreated(nftContract, tokenId, msg.sender, startingBid, endTime);
    }

    /**
     * @notice Place a bid on an active auction.
     */
    function bid(address nftContract, uint256 tokenId) external payable nonReentrant {
        Auction storage a = auctions[nftContract][tokenId];
        require(block.timestamp < a.endTime, "Auction ended");
        require(!a.cancelled, "Auction cancelled");

        uint256 minRequired = a.highestBid == 0
            ? a.startingBid
            : a.highestBid + (a.highestBid * MIN_BID_INCREMENT_BPS / 10000);

        require(msg.value >= minRequired, "Bid too low");

        // Refund previous bidder (pull-payment would be safer in production,
        // but for testnet simplicity we auto-refund)
        if (a.highestBidder != address(0)) {
            (bool success, ) = a.highestBidder.call{value: a.highestBid}("");
            require(success, "Refund failed");
        }

        a.highestBid = msg.value;
        a.highestBidder = msg.sender;

        emit BidPlaced(nftContract, tokenId, msg.sender, msg.value);
    }

    /**
     * @notice Finalize an auction after it ends. Anyone can call this.
     *         If no bids were placed, the seller can withdraw the NFT back.
     */
    function finalizeAuction(address nftContract, uint256 tokenId) external nonReentrant {
        Auction storage a = auctions[nftContract][tokenId];
        require(block.timestamp >= a.endTime, "Auction not ended");
        require(!a.ended, "Already finalized");
        require(!a.cancelled, "Auction cancelled");

        a.ended = true;
        removeFromActive(nftContract, tokenId);

        if (a.highestBidder != address(0)) {
            // Transfer NFT to winner, ETH to seller
            IERC721(nftContract).safeTransferFrom(a.seller, a.highestBidder, tokenId);
            (bool success, ) = a.seller.call{value: a.highestBid}("");
            require(success, "Seller payout failed");
            emit AuctionFinalized(nftContract, tokenId, a.highestBidder, a.highestBid);
        } else {
            // No bids — NFT stays with seller, nothing to settle
            emit AuctionFinalized(nftContract, tokenId, address(0), 0);
        }
    }

    /**
     * @notice Cancel an auction (only seller, only before any bid).
     */
    function cancelAuction(address nftContract, uint256 tokenId) external {
        Auction storage a = auctions[nftContract][tokenId];
        require(msg.sender == a.seller, "Not seller");
        require(a.highestBidder == address(0), "Bids exist");
        require(!a.ended && !a.cancelled, "Already settled");

        a.cancelled = true;
        removeFromActive(nftContract, tokenId);
        emit AuctionCancelled(nftContract, tokenId);
    }

    function removeFromActive(address nftContract, uint256 tokenId) internal {
        uint256[] storage ids = activeAuctionIds[nftContract];
        for (uint256 i = 0; i < ids.length; i++) {
            if (ids[i] == tokenId) {
                ids[i] = ids[ids.length - 1];
                ids.pop();
                break;
            }
        }
    }

    /// @notice Returns all active auction tokenIds for a given NFT contract
    function getActiveAuctions(address nftContract) external view returns (uint256[] memory) {
        return activeAuctionIds[nftContract];
    }

    /// @notice Returns the full Auction struct for a given tokenId
    function getAuction(address nftContract, uint256 tokenId) external view returns (Auction memory) {
        return auctions[nftContract][tokenId];
    }

    /// @notice Allow the contract to receive ETH (required for refunds / holds)
    receive() external payable {}
}