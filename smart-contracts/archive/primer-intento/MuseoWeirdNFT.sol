// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/token/common/ERC2981.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MuseoWeirdNFT
 * @notice ERC-721 NFT contract for typographic art extracted from Bluesky
 *         posts about climate/environmental crisis in Medellín / Aburrá Valley.
 *
 * ERC721URIStorage ya hereda de ERC721, así que solo listamos los hijos directos.
 * Cada tokenId es único (1/1). El owner mintea NFTs y los puede listar en MuseoWeirdAuction.
 *
 * Features:
 *  - 7.5% royalty on secondary sales (ERC-2981)
 *  - Owner-only mint (no public sale)
 */
contract MuseoWeirdNFT is ERC721URIStorage, ERC2981, Ownable {
    uint256 private _nextTokenId;

    address public auctionContract;

    event AuctionContractSet(address indexed auctionContract);
    event NFTMinted(uint256 indexed tokenId, address indexed to, string tokenURI);

    constructor(address initialOwner)
        ERC721("Museo Weird", "MWEIRD")
        Ownable(initialOwner)
    {
        _setDefaultRoyalty(initialOwner, 750);
    }

    function mint(address to, string memory uri) external onlyOwner returns (uint256) {
        _nextTokenId++;
        uint256 tokenId = _nextTokenId;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, uri);
        emit NFTMinted(tokenId, to, uri);
        return tokenId;
    }

    function setAuctionContract(address _auctionContract) external onlyOwner {
        auctionContract = _auctionContract;
        emit AuctionContractSet(_auctionContract);
    }

    function totalSupply() external view returns (uint256) {
        return _nextTokenId;
    }

    // The following overrides are required by Solidity for multiple inheritance.
    // ERC721URIStorage already provides _update and tokenURI; we just re-declare
    // which parent contracts they override.

    function _update(address to, uint256 tokenId, address auth)
        internal
        override(ERC721URIStorage, ERC721)
        returns (address)
    {
        return super._update(to, tokenId, auth);
    }

    function tokenURI(uint256 tokenId)
        public
        view
        override(ERC721URIStorage)
        returns (string memory)
    {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721URIStorage, ERC2981)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}