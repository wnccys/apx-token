import hre from "hardhat";
import { expect } from "chai";

const { ethers: hardhatEthers, networkHelpers } = await hre.network.create();

describe("AphexStake", function () {
    async function deployStakeFixture() {
        const [owner, user1, user2] = await hardhatEthers.getSigners();

        const MockV3Aggregator = await hardhatEthers.getContractFactory("MockV3Aggregator");
        const mockPriceFeed = await MockV3Aggregator.deploy(8, 3000n * 10n ** 8n);
        const priceFeedAddress = await mockPriceFeed.getAddress();

        const AphexToken = await hardhatEthers.getContractFactory("AphexToken");
        const apxToken = await AphexToken.deploy(owner.address, priceFeedAddress);
        const apxTokenAddress = await apxToken.getAddress();

        const XtalNFT = await hardhatEthers.getContractFactory("XtalNFT");
        const xtalNFT = await XtalNFT.deploy(owner.address, apxTokenAddress);
        const xtalNFTAddress = await xtalNFT.getAddress();

        const AphexStake = await hardhatEthers.getContractFactory("AphexStake");
        const aphexStake = await AphexStake.deploy(apxTokenAddress, xtalNFTAddress);
        const aphexStakeAddress = await aphexStake.getAddress();

        await xtalNFT.setStakeContract(aphexStakeAddress);

        // Give user1 enough APX to stake
        const REQUIRED_LOCK_AMOUNT = hardhatEthers.parseEther("50");
        await apxToken.transfer(user1.address, REQUIRED_LOCK_AMOUNT * 2n);

        return { apxToken, xtalNFT, aphexStake, owner, user1, user2, REQUIRED_LOCK_AMOUNT };
    }

    it("should allow a user to lock tokens and receive 2 NFTs", async function () {
        const { apxToken, xtalNFT, aphexStake, user1, REQUIRED_LOCK_AMOUNT } = await networkHelpers.loadFixture(deployStakeFixture);

        await apxToken.connect(user1).approve(await aphexStake.getAddress(), REQUIRED_LOCK_AMOUNT);
        
        await expect(aphexStake.connect(user1).lockAndMint())
            .to.emit(aphexStake, "LockAndMinted");

        // User should have 2 NFTs
        expect(await xtalNFT.balanceOf(user1.address)).to.equal(2n);

        const lockInfo = await aphexStake.userLocks(user1.address);
        expect(lockInfo.isActive).to.be.true;
        expect(lockInfo.amountLocked).to.equal(REQUIRED_LOCK_AMOUNT);
    });

    it("should allow unlock and burn after duration", async function () {
        const { apxToken, xtalNFT, aphexStake, user1, REQUIRED_LOCK_AMOUNT } = await networkHelpers.loadFixture(deployStakeFixture);

        await apxToken.connect(user1).approve(await aphexStake.getAddress(), REQUIRED_LOCK_AMOUNT);
        await aphexStake.connect(user1).lockAndMint();

        // Fast forward 15 days using hardhat provider
        const fifteenDaysInSeconds = 15 * 24 * 60 * 60;
        await hardhatEthers.provider.send("evm_increaseTime", [fifteenDaysInSeconds]);
        await hardhatEthers.provider.send("hardhat_mine", ["0x1"]); // Mine a block

        const initialBalance = await apxToken.balanceOf(user1.address);

        await expect(aphexStake.connect(user1).unlockAndBurn())
            .to.emit(aphexStake, "UnlockedAndBurned");

        // User should have 0 NFTs
        expect(await xtalNFT.balanceOf(user1.address)).to.equal(0n);

        // User should have got their APX back
        const finalBalance = await apxToken.balanceOf(user1.address);
        expect(finalBalance - initialBalance).to.equal(REQUIRED_LOCK_AMOUNT);

        const lockInfo = await aphexStake.userLocks(user1.address);
        expect(lockInfo.isActive).to.be.false;
    });

    it("should fail to unlock before duration", async function () {
        const { apxToken, aphexStake, user1, REQUIRED_LOCK_AMOUNT } = await networkHelpers.loadFixture(deployStakeFixture);

        await apxToken.connect(user1).approve(await aphexStake.getAddress(), REQUIRED_LOCK_AMOUNT);
        await aphexStake.connect(user1).lockAndMint();

        await expect(aphexStake.connect(user1).unlockAndBurn())
            .to.be.revertedWith("Lock duration not met");
    });
});
