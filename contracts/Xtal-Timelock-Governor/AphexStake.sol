// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {XtalNFT} from "./XtalNFT.sol";

contract AphexStake {
    IERC20 public immutable apxToken;
    XtalNFT public immutable xtalNFT;

    uint256 public constant REQUIRED_LOCK_AMOUNT = 50 * 1e18;
    uint256 public constant LOCK_DURATION = 15 days;

    event LockAndMinted(address who, uint256 tokenId1, uint256 tokenId2);
    event UnlockedAndBurned(address who, uint256 tokenId1, uint256 tokenId2);

    struct LockInfo {
        uint256 amountLocked;
        uint256 unlockTimestamp;
        uint256 linkedTokenId1;
        uint256 linkedTokenId2;
        bool isActive;
    }

    mapping(address => LockInfo) public userLocks;

    constructor(address _apxToken, address _xtalNFT) {
        apxToken = IERC20(_apxToken);
        xtalNFT = XtalNFT(_xtalNFT);
    }

    /**
     * @notice No reentrant lock is needed, once the operations does not trigger any callback fn
     * @notice This fn must be called after (approve) is casted over the contract and sender
     */
    function lockAndMint() external {
        require(!userLocks[msg.sender].isActive, "Already locked");

        bool success = apxToken.transferFrom(msg.sender, address(this), REQUIRED_LOCK_AMOUNT);
        require(success, "Could not send apxToken. Check approval.");

        (uint256 tokenId1, uint256 tokenId2) = xtalNFT.stakeMint(msg.sender);

        userLocks[msg.sender] = LockInfo({
            amountLocked: REQUIRED_LOCK_AMOUNT,
            unlockTimestamp: block.timestamp + LOCK_DURATION,
            linkedTokenId1: tokenId1,
            linkedTokenId2: tokenId2,
            isActive: true
        });

        emit LockAndMinted(msg.sender, tokenId1, tokenId2);
    }

    /**
     * @notice Burn NFTs and return staked APX
     */
    function unlockAndBurn() public {
        LockInfo storage lock = userLocks[msg.sender];
        require(lock.isActive, "No active lock");
        require(block.timestamp >= lock.unlockTimestamp, "Lock duration not met");

        lock.isActive = false;

        xtalNFT.burn(lock.linkedTokenId1);
        xtalNFT.burn(lock.linkedTokenId2);

        bool success = apxToken.transfer(msg.sender, lock.amountLocked);
        require(success, "Failed to return APX tokens");

        emit UnlockedAndBurned(msg.sender, lock.linkedTokenId1, lock.linkedTokenId2);
    }
}