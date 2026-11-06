// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/common/ERC2981.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MuseoWeirdNFT
 * @notice ERC-721 NFT contract for typographic art extracted from Bluesky
 *         posts about climate/environmental crisis in Medellín / Aburrá Valley.
 *
 * Adaptado de VideoDanzaNFT.sol (videodanza-nft).
 * Cambios:
 *  - Nombre/symbol: "Museo Weird" / "MWEIRD"
 *  - Mint: solo owner (no pagable, no seed-tracker). El bot es el minter.
 *  - Storage de tokenURI custom (mismo patrón que VideoDanzaNFT).
 */
contract MuseoWeirdNFT is ERC721, ERC2981, Ownable {
    uint256 private _tokenIdCounter;

    /// @notice tokenId → tokenURI (IPFS)
    mapping(uint256 => string) private _tokenURIs;

    /// @notice Address of the auction contract (optional, for cross-contract integration)
    address public auctionContract;

    uint96 private constant ROYALTY_FEE_NUMERATOR = 1500; // 15% (default)

    event NFTMinted(uint256 indexed tokenId, address indexed to, string tokenURI);
    event MetadataUpdated(uint256 indexed tokenId, string newURI);
    event AuctionContractSet(address indexed auctionContract);

    constructor(address initialOwner, address royaltyReceiver)
        ERC721("Museo Weird", "MWEIRD")
        Ownable(initialOwner)
    {
        _setDefaultRoyalty(royaltyReceiver, ROYALTY_FEE_NUMERATOR);
    }

    /**
     * @notice Mint a new NFT with metadata pointing to IPFS.
     * @param to Recipient address (typically the artist wallet).
     * @param uri IPFS URI for the metadata JSON.
     * @return tokenId The ID of the newly minted token.
     */
    function mint(address to, string calldata uri) external onlyOwner returns (uint256) {
        require(bytes(uri).length > 0, "MuseoWeirdNFT: tokenURI required");

        uint256 tokenId = _tokenIdCounter;
        _tokenIdCounter++;

        _safeMint(to, tokenId);
        _tokenURIs[tokenId] = uri;

        emit NFTMinted(tokenId, to, uri);
        return tokenId;
    }

    /**
     * @notice Update metadata URI for an existing token (only owner/admin).
     */
    function updateMetadata(uint256 tokenId, string calldata newURI) external onlyOwner {
        require(bytes(newURI).length > 0, "MuseoWeirdNFT: tokenURI required");

        _tokenURIs[tokenId] = newURI;
        emit MetadataUpdated(tokenId, newURI);
    }

    /**
     * @notice Set the auction contract address (called once after deploy).
     */
    function setAuctionContract(address _auctionContract) external onlyOwner {
        require(_auctionContract != address(0), "MuseoWeirdNFT: zero address");
        auctionContract = _auctionContract;
        emit AuctionContractSet(_auctionContract);
    }

    /**
     * @notice Update the default royalty (receiver + fee in basis points).
     * @param receiver Address that will receive royalties on secondary sales.
     * @param feeNumerator Royalty in basis points (e.g. 1500 = 15%).
     */
    function setDefaultRoyalty(address receiver, uint96 feeNumerator) external onlyOwner {
        require(receiver != address(0), "MuseoWeirdNFT: zero receiver");
        require(feeNumerator <= 5000, "MuseoWeirdNFT: royalty too high"); // max 50%
        _setDefaultRoyalty(receiver, feeNumerator);
    }

    function totalSupply() external view returns (uint256) {
        return _tokenIdCounter;
    }

    // ==================== OVERRIDE FUNCTIONS ====================

    function tokenURI(uint256 tokenId)
        public
        view
        override
        returns (string memory)
    {
        require(_ownerOf(tokenId) != address(0), "MuseoWeirdNFT: Token does not exist");
        return _tokenURIs[tokenId];
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC2981)
        returns (bool)
    {
        return ERC721.supportsInterface(interfaceId) ||
               ERC2981.supportsInterface(interfaceId);
    }
}