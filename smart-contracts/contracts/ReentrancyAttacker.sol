// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IAuction {
    function bid(address nftContract, uint256 tokenId) external payable;
}

contract ReentrancyAttacker {
    address public auction;
    address public nft;
    uint256 public tokenId;
    bool public entered;

    constructor(address _auction, address _nft, uint256 _tokenId) {
        auction = _auction;
        nft = _nft;
        tokenId = _tokenId;
    }

    function placeFirstBidAndTryReenter() external payable {
        require(msg.value >= 0.01 ether, "send at least 0.01");
        IAuction(auction).bid{value: msg.value}(nft, tokenId);
    }

    receive() external payable {
        if (!entered) {
            entered = true;
            // Try to re-enter bid(): should be blocked by nonReentrant
            try IAuction(auction).bid(nft, tokenId) {
                // No-op
            } catch {
                // Expected: reentrancy guard reverts
            }
        }
    }
}
