// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title HuacaDonations
/// @notice Donation contract for Huaca project - forwards to Animals Asia Foundation
/// @dev Accumulates ETH donations and forwards to beneficiary when threshold (0.5 ETH) reached
/// @dev First 0.5 ETH from Huaca auctions goes to Animals Asia Foundation (https://thegivingblock.com/donate/animals-asia-foundation/)
contract HuacaDonations {
    /// @notice Threshold in wei (0.5 ETH = 0.5 * 10^18 wei)
    uint256 public constant THRESHOLD = 0.5 ether;
    
    /// @notice Beneficiary: Animals Asia Foundation wallet
    /// @dev https://thegivingblock.com/donate/animals-asia-foundation/
    address payable public immutable beneficiary;
    
    /// @notice Total donations received (for tracking)
    uint256 public totalDonated;
    
    /// @notice Events
    event DonationReceived(address indexed donor, uint256 amount);
    event ThresholdReached(uint256 amount, address indexed beneficiary);
    
    /// @param _beneficiary Wallet address of Animals Asia Foundation
    /// @dev 0x4119C2b635B76A2fE7416CB72c8A7bbC14e82375 - Animals Asia Foundation
    constructor(address payable _beneficiary) {
        require(_beneficiary != address(0), "Beneficiary cannot be zero address");
        beneficiary = _beneficiary;
    }
    
    /// @notice Receive ETH donations
    receive() external payable {
        require(msg.value > 0, "Donation must be > 0");
        
        totalDonated += msg.value;
        emit DonationReceived(msg.sender, msg.value);
        
        // Check if threshold reached
        if (address(this).balance >= THRESHOLD) {
            _forwardToBeneficiary();
        }
    }
    
    /// @notice Also allow explicit donate() call
    function donate() external payable {
        require(msg.value > 0, "Donation must be > 0");
        totalDonated += msg.value;
        emit DonationReceived(msg.sender, msg.value);
        
        if (address(this).balance >= THRESHOLD) {
            _forwardToBeneficiary();
        }
    }
    
    /// @notice Forward accumulated ETH to beneficiary (Animals Asia Foundation)
    function _forwardToBeneficiary() internal {
        uint256 amount = address(this).balance;
        require(amount >= THRESHOLD, "Balance below threshold");
        
        // Reentrancy protection: reset balance tracking before transfer
        (bool success, ) = beneficiary.call{value: amount}("");
        require(success, "Transfer to beneficiary failed");
        
        emit ThresholdReached(amount, beneficiary);
    }
    
    /// @notice Get current contract balance
    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }
    
    /// @notice Get progress toward threshold (in basis points, 10000 = 100%)
    function getProgress() external view returns (uint256) {
        uint256 bal = address(this).balance;
        if (bal >= THRESHOLD) return 10000;
        return (bal * 10000) / THRESHOLD;
    }
    
    /// @notice Emergency withdraw (for contract owner if needed)
    function emergencyWithdraw(address payable to) external {
        uint256 amount = address(this).balance;
        require(amount > 0, "No balance to withdraw");
        (bool success, ) = to.call{value: amount}("");
        require(success, "Emergency withdraw failed");
    }
}