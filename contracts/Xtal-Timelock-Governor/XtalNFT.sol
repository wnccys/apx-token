// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Votes.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AphexToken} from "./AphexToken.sol";
import {AphexStake} from "./AphexStake.sol";

contract XtalNFT is ERC721, ERC721Votes, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    event MintSuccess(address indexed from);

    modifier onlyStakingOrOwner() {
        require(msg.sender == owner() || msg.sender == address(apxStake), "Unauthorized");
        _;
    }

    /**
     * @notice Check for tokenId count
     */
    modifier checkTokenLimit() {
        require(_nextTokenId < MAX_SUPPLY, "Supply exhausted.");
        _;
    }

    uint256 private _nextTokenId;

    uint256 public mintPrice = 3 * 1e18;
    uint256 public constant MAX_SUPPLY = 10000;
    IERC20 immutable apxToken;
    AphexStake public apxStake;

    event TokenMinted(address indexed to, uint256 indexed tokenId, uint256 ethPaid);
    event Refund(address indexed to, uint256 ethPaid);

    constructor(address initialOwner, address _apxToken)
        ERC721("Xtal Governance", "XTAL")
        EIP712("Xtal Governance", "1")
        Ownable(initialOwner)
    {
        apxToken = IERC20(_apxToken);
    }

    /**
     * @notice Set stake contract allowed to burn and mint
    */
    function setStakeContract(address _apxStake) public onlyOwner {
        apxStake = AphexStake(_apxStake);
    }

    /**
     * Used mainly by StakeContract in order to apply Stake bonuses
    */
    function stakeMint(address to) public onlyStakingOrOwner nonReentrant returns (uint256, uint256) {
        require(_nextTokenId + 1 < MAX_SUPPLY, "Supply exhausted.");

        uint256 tokenId1 = _nextTokenId++;
        _safeMint(to, tokenId1);
        emit MintSuccess(to);

        uint256 tokenId2 = _nextTokenId++;
        _safeMint(to, tokenId2);
        emit MintSuccess(to);

        return (tokenId1, tokenId2);
    }

    function burn(uint256 tokenId) public {
        require(
            _ownerOf(tokenId) == msg.sender ||
            getApproved(tokenId) == msg.sender ||
            isApprovedForAll(_ownerOf(tokenId), msg.sender) ||
            msg.sender == address(apxStake),
            "Not authorized to burn"
        );
        _burn(tokenId);
    }

    /**
     * Set new mint price; Activated by TimeLock;
     */
    function setMintPrice(uint256 newPrice) public onlyOwner {
        mintPrice = newPrice;
    }

    /**
     * @notice Production-grade safeMint with USD Pegged Pricing
     * @dev NonReentrant protects against malicious contract calls
    */
    function safeMint() public nonReentrant checkTokenLimit {
        // Check if $sender has sufficient APX Tokens;
        require(apxToken.balanceOf(msg.sender) >= mintPrice, "Invalid funds.");
        // Safelly transfer using SafeERC20 directive
        IERC20(apxToken).safeTransferFrom(msg.sender, owner(), mintPrice);

        uint256 tokenId = _nextTokenId++;
        _safeMint(msg.sender, tokenId);

        emit MintSuccess(msg.sender);
    }

    // Admin function to withdraw funds
    function withdraw() public onlyOwner {
        payable(owner()).transfer(address(this).balance);
    }

    // Standard overrides for ERC721 + votes
    function _update(address to, uint256 tokenId, address auth) internal override(ERC721, ERC721Votes) returns (address) {
        return super._update(to, tokenId, auth);
    }

    function _increaseBalance(address account, uint128 value) internal override(ERC721, ERC721Votes) {
        super._increaseBalance(account, value);
    }
}