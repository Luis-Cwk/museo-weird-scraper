// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title MuseoWeirdAuction
 * @notice English auction house for ERC-721 tokens (MuseoWeirdNFT).
 *
 * Pattern adapted from ethereum.org's "How to implement an ERC-721 market"
 * tutorial, extended with bidding support for English auctions.
 *
 * Flow:
 *   1. Seller approves this contract on the NFT contract.
 *   2. Seller calls createAuction(nftContract, tokenId, startingBid, duration).
 *      The NFT is transferred into escrow.
 *   3. Bidders call bid(nftContract, tokenId) with msg.value >= current + 5%.
 *      Previous highest bidder is credited via PULL (calls withdraw() later).
 *   4. Anyone calls finalizeAuction(nftContract, tokenId) after endTime:
 *      - NFT goes to highest bidder (or back to seller if no bids)
 *      - Proceeds split 50/50 between seller and treasury (PULL)
 *
 * Cancel: seller can cancel before any bid is placed (NFT returns to seller).
 *
 * Distribution (PULL pattern):
 *   - All credits (bid refunds, seller share, treasury share, royalties) are
 *     stored in `pendingWithdrawals` and withdrawn by each party via withdraw().
 *   - Royalties (ERC2981) are received via receive(), split 50/50 between the
 *     owner (artist) and treasury.
 */
contract MuseoWeirdAuction is Ownable, ReentrancyGuard, IERC721Receiver {

    struct Auction {
        address seller;
        uint256 tokenId;
        uint256 startingBid;
        uint256 highestBid;
        address highestBidder;
        uint256 endTime;
        bool settled;
        bool cancelled;
    }

    /// @notice Minimum bid increment over previous highest (5%)
    uint256 public constant MIN_BID_INCREMENT_BPS = 500;

    /// @notice Treasury address that receives 50% of proceeds and royalties.
    address public treasury;

    /// @notice Pull-based withdrawals: user → pending ETH (bid refunds, seller/treasury shares).
    mapping(address => uint256) public pendingWithdrawals;

    /// @notice auctionId → Auction. auctionId = uint256(keccak256(nft, tokenId))
    mapping(uint256 => Auction) public auctions;

    /// @notice auctionId → bool. True if the namespace is occupied by an active/cancelled auction.
    /// Used to prevent re-listing a tokenId that was previously auctioned (independent of owner checks).
    mapping(uint256 => bool) private _auctionExists;

    event AuctionCreated(
        uint256 indexed auctionId,
        address indexed nftContract,
        uint256 indexed tokenId,
        address seller,
        uint256 startingBid,
        uint256 endTime
    );

    event BidPlaced(
        uint256 indexed auctionId,
        address indexed bidder,
        uint256 amount
    );

    event AuctionFinalized(
        uint256 indexed auctionId,
        address indexed winner,
        uint256 amount
    );

    event AuctionCancelled(uint256 indexed auctionId);

    event Withdrawal(address indexed user, uint256 amount);

    constructor(address initialOwner, address treasury_) Ownable(initialOwner) {
        require(treasury_ != address(0), "Zero treasury");
        treasury = treasury_;
    }

    function _auctionId(address nftContract, uint256 tokenId) public pure returns (uint256) {
        return uint256(keccak256(abi.encodePacked(nftContract, tokenId)));
    }

    /**
     * @notice Create an English auction for an NFT.
     * @param nftContract Address of the ERC-721 contract.
     * @param tokenId The token ID to auction.
     * @param startingBid Minimum first bid in wei.
     * @param durationSeconds How long the auction runs (1h - 30 days).
     */
    function createAuction(
        address nftContract,
        uint256 tokenId,
        uint256 startingBid,
        uint256 durationSeconds
    ) external nonReentrant {
        require(startingBid > 0, "Starting bid must be > 0");
        // v8: removed `durationSeconds >= 1 hours` minimum — enables fast testing
        // with sub-minute durations. Upper bound kept at 30 days for production safety.
        require(durationSeconds > 0 && durationSeconds <= 30 days, "Bad duration");

        IERC721 nft = IERC721(nftContract);
        uint256 id = _auctionId(nftContract, tokenId);
        require(!_auctionExists[id], "Already listed");

        require(nft.ownerOf(tokenId) == msg.sender, "Not token owner");
        require(
            nft.getApproved(tokenId) == address(this) ||
            nft.isApprovedForAll(msg.sender, address(this)),
            "Auction not approved"
        );

        uint256 endTime = block.timestamp + durationSeconds;

        auctions[id] = Auction({
            seller: msg.sender,
            tokenId: tokenId,
            startingBid: startingBid,
            highestBid: 0,
            highestBidder: address(0),
            endTime: endTime,
            settled: false,
            cancelled: false
        });

        _auctionExists[id] = true;

        // Escrow the NFT
        nft.safeTransferFrom(msg.sender, address(this), tokenId);

        emit AuctionCreated(id, nftContract, tokenId, msg.sender, startingBid, endTime);
    }

    /**
     * @notice Place a bid on an active auction.
     */
    function bid(address nftContract, uint256 tokenId) external payable nonReentrant {
        uint256 id = _auctionId(nftContract, tokenId);
        Auction storage a = auctions[id];
        require(_auctionExists[id], "Auction does not exist");
        require(block.timestamp < a.endTime, "Auction ended");
        require(!a.cancelled, "Auction cancelled");
        require(msg.sender != a.seller, "Seller cannot bid");

        uint256 minRequired = a.highestBid == 0
            ? a.startingBid
            : a.highestBid + (a.highestBid * MIN_BID_INCREMENT_BPS / 10000);

        require(msg.value >= minRequired, "Bid too low");

        // EFFECTS: snapshot previous bidder and update state BEFORE external call (CEI)
        address prevBidder = a.highestBidder;
        uint256 prevBid = a.highestBid;
        a.highestBid = msg.value;
        a.highestBidder = msg.sender;

        emit BidPlaced(id, msg.sender, msg.value);

        // INTERACTIONS: credit previous highest bidder (PULL, no push refund).
        if (prevBidder != address(0)) {
            pendingWithdrawals[prevBidder] += prevBid;
        }
    }

    /**
     * @notice Finalize an ended auction. Anyone can call this.
     */
    function finalizeAuction(address nftContract, uint256 tokenId) external nonReentrant {
        uint256 id = _auctionId(nftContract, tokenId);
        Auction storage a = auctions[id];
        require(_auctionExists[id], "Auction does not exist");
        require(block.timestamp >= a.endTime, "Auction not ended");
        require(!a.settled, "Already settled");
        require(!a.cancelled, "Cancelled");

        a.settled = true;

        if (a.highestBidder != address(0)) {
            IERC721(nftContract).safeTransferFrom(address(this), a.highestBidder, a.tokenId);
            // Split proceeds 50/50: seller + treasury (PULL, no push payout).
            uint256 total = a.highestBid;
            uint256 half = total / 2;
            pendingWithdrawals[a.seller] += (total - half);
            pendingWithdrawals[treasury] += half;
            emit AuctionFinalized(id, a.highestBidder, total);
        } else {
            // No bids — return NFT to seller
            IERC721(nftContract).safeTransferFrom(address(this), a.seller, a.tokenId);
            emit AuctionFinalized(id, address(0), 0);
        }
    }

    /**
     * @notice Cancel an auction (only seller, only before any bid).
     */
    function cancelAuction(address nftContract, uint256 tokenId) external nonReentrant {
        uint256 id = _auctionId(nftContract, tokenId);
        Auction storage a = auctions[id];
        require(a.seller == msg.sender, "Not seller");
        require(a.highestBidder == address(0), "Bids exist");
        require(!a.settled && !a.cancelled, "Already settled");

        a.cancelled = true;
        IERC721(nftContract).safeTransferFrom(address(this), a.seller, a.tokenId);

        emit AuctionCancelled(id);
    }

    /**
     * @notice Withdraw any pending ETH credited to msg.sender (pull pattern).
     *         Covers bid refunds, seller/treasury shares, and royalty splits.
     */
    function withdraw() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "Nothing to withdraw");
        pendingWithdrawals[msg.sender] = 0;
        (bool success, ) = payable(msg.sender).call{value: amount}("");
        require(success, "Withdraw failed");
        emit Withdrawal(msg.sender, amount);
    }

    /// @notice Helper to read an auction's full state.
    function getAuction(address nftContract, uint256 tokenId)
        external
        view
        returns (Auction memory)
    {
        return auctions[_auctionId(nftContract, tokenId)];
    }

    function onERC721Received(
        address,
        address,
        uint256,
        bytes calldata
    ) external pure override returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    /// @notice Receives royalty payments (ERC2981) and splits 50/50 between owner (artist) and treasury.
    receive() external payable {
        uint256 half = msg.value / 2;
        pendingWithdrawals[owner()] += (msg.value - half);
        pendingWithdrawals[treasury] += half;
    }
}
