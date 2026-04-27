// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {AggregatorV3Interface} from  "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract AphexToken is ERC20, Ownable, ReentrancyGuard {
    // Total supply bucket - 18 decimals
    uint256 public constant INITIAL_SUPPLY = 10000 * 1e18;
    uint128 public constant usdPrice = 30;
    AggregatorV3Interface internal immutable priceFeed;

    event Refund(address indexed to, uint256 amount);

    /**
     * Initialize total token ever available bucket
    */
    constructor(address _initialOwner, address _priceFeed)
        ERC20("Aphex", "APX")
        Ownable(_initialOwner)
    {
        _mint(msg.sender, INITIAL_SUPPLY);
        priceFeed = AggregatorV3Interface(_priceFeed);
    }

    /**
     * Returns required amount of ETH at a moment in time, in wei.
     */
    function getRequiredETH() public view returns (uint256) {
        (,int256 price,,,) = priceFeed.latestRoundData();
        uint256 ethPrice = uint256(price) * 1e10; // Price comes generally in amount * 10^8, so *10^10 = 10^18;

        return (usdPrice * 1e18 * 1e18 / ethPrice);
    }

    /**
     * @param tokenAmount 18-decimal based amount
     */
    function buy(uint256 tokenAmount) payable public nonReentrant {
        require(tokenAmount <= balanceOf(owner()), "Invalid requested amount");
        uint256 ethRequired = (getRequiredETH() * (tokenAmount)) / 1e18;
        require(msg.value >= ethRequired, "Invalid ETH amount");

        _transfer(owner(), msg.sender, tokenAmount);

        if (msg.value > ethRequired) {
            uint256 refund = msg.value - ethRequired;
            (bool success,) = payable(msg.sender).call{value: refund}("");
            require(success, "Could not send refund.");
            emit Refund(msg.sender, refund);
        }
    }

    /**
     * Transfer token from $sender to $target
     * @param target Target Address
     * @param amount Amount in APX
     */
    function safeTransfer(address target, uint256 amount) public {
        _transfer(msg.sender, target, amount);
    }
}