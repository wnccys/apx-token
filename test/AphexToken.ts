import hre from "hardhat";
import { expect } from "chai";

const { ethers: hardhatEthers, networkHelpers } = await hre.network.create();

describe("ApexToken ERC20 Logic", () => {
  const INITIAL_SUPPLY = hardhatEthers.parseEther("10000"); // 10,000 tokens with 18 decimals
  const TOKEN_USD_PRICE = 30n; // $30 per token

  // We define a fixture to reuse the same setup
  async function deployApexTokenFixture() {
    const [owner, buyer, otherAccount] = await hardhatEthers.getSigners();

    // Deploy MockV3Aggregator (decimals = 8, initial price = $3000)
    const MockV3Aggregator = await hardhatEthers.getContractFactory("MockV3Aggregator");
    // $3000 * 10^8
    const initialPrice = 3000n * 10n ** 8n;
    const mockPriceFeed = await MockV3Aggregator.deploy(8, initialPrice);
    const mockPriceFeedAddress = await mockPriceFeed.getAddress();

    // Deploy ApexToken
    const ApexToken = await hardhatEthers.getContractFactory("AphexToken");
    const apexToken = await ApexToken.deploy(owner.address, mockPriceFeedAddress);

    return { apexToken, mockPriceFeed, owner, buyer, otherAccount };
  }

  describe("A. Deployment & Basic Setup", () => {
    it("should have the correct name and symbol", async () => {
      const { apexToken } = await networkHelpers.loadFixture(deployApexTokenFixture);
      expect(await apexToken.name()).to.equal("Aphex");
      expect(await apexToken.symbol()).to.equal("APX");
    });

    it("should have 18 decimals", async () => {
      const { apexToken } = await networkHelpers.loadFixture(deployApexTokenFixture);
      expect(await apexToken.decimals()).to.equal(18n);
    });

    it("should mint the initial supply to the owner", async () => {
      const { apexToken, owner } = await networkHelpers.loadFixture(deployApexTokenFixture);
      expect(await apexToken.totalSupply()).to.equal(INITIAL_SUPPLY);
      expect(await apexToken.balanceOf(owner.address)).to.equal(INITIAL_SUPPLY);
    });

    it("should set the correct owner and USD price", async () => {
      const { apexToken, owner } = await networkHelpers.loadFixture(deployApexTokenFixture);
      expect(await apexToken.owner()).to.equal(owner.address);
      expect(await apexToken.usdPrice()).to.equal(TOKEN_USD_PRICE);
    });
  });

  describe("B. Oracle Pricing (getRequiredETH)", () => {
    it("should accurately calculate the ETH required based on a mock ETH price", async () => {
      const { apexToken } = await networkHelpers.loadFixture(deployApexTokenFixture);
      // Mock price is set to $3000 per ETH. Token is $30.
      // Required ETH per token = $30 / $3000 = 0.01 ETH.
      // Since it returns required ETH for 1 token (1e18), it should be 0.01 * 1e18
      const requiredEth = await apexToken.getRequiredETH();
      expect(requiredEth).to.equal(hardhatEthers.parseEther("0.01"));
    });

    it("should dynamically update the required ETH if oracle price drops", async () => {
      const { apexToken, mockPriceFeed } = await networkHelpers.loadFixture(deployApexTokenFixture);

      // Update price to $1500 per ETH
      await mockPriceFeed.updateAnswer(1500n * 10n ** 8n);

      // Token is $30. $30 / $1500 = 0.02 ETH
      const requiredEth = await apexToken.getRequiredETH();
      expect(requiredEth).to.equal(hardhatEthers.parseEther("0.02"));
    });

    it("should dynamically update the required ETH if oracle price spikes", async () => {
        const { apexToken, mockPriceFeed } = await networkHelpers.loadFixture(deployApexTokenFixture);

        // Update price to $6000 per ETH
        await mockPriceFeed.updateAnswer(6000n * 10n ** 8n);

        // Token is $30. $30 / $6000 = 0.005 ETH
        const requiredEth = await apexToken.getRequiredETH();
        expect(requiredEth).to.equal(hardhatEthers.parseEther("0.005"));
      });
  });

  describe("C. Token Purchasing (buy)", () => {
    it("should revert with 'Invalid requested amount' if asking for more tokens than owner has", async () => {
      const { apexToken, buyer } = await networkHelpers.loadFixture(deployApexTokenFixture);

      const requestedTokens = INITIAL_SUPPLY + 1n; // More than what owner holds

      await expect(
        apexToken.connect(buyer).buy(requestedTokens)
      ).to.be.revertedWith("Invalid requested amount");
    });

    it("should revert with 'Invalid ETH amount' if buyer sends less ETH than required", async () => {
      const { apexToken, buyer } = await networkHelpers.loadFixture(deployApexTokenFixture);

      const tokensToBuy = hardhatEthers.parseEther("10"); // 10 tokens
      // 10 tokens * 0.01 ETH/token = 0.1 ETH required
      const sentEth = hardhatEthers.parseEther("0.09"); // Not enough

      await expect(
        apexToken.connect(buyer).buy(tokensToBuy, { value: sentEth })
      ).to.be.revertedWith("Invalid ETH amount");
    });

    it("should successfully transfer tokens when exact ETH is sent", async () => {
        const { apexToken, owner, buyer } = await networkHelpers.loadFixture(deployApexTokenFixture);

        const tokensToBuy = hardhatEthers.parseEther("10"); // 10 tokens
        const exactEthRequired = hardhatEthers.parseEther("0.1"); // 10 * 0.01

        // Initial balances
        const ownerInitialBalance = await apexToken.balanceOf(owner.address);
        const buyerInitialBalance = await apexToken.balanceOf(buyer.address);

        // Buy tokens
        await apexToken.connect(buyer).buy(tokensToBuy, { value: exactEthRequired });

        // Check balances after
        expect(await apexToken.balanceOf(owner.address)).to.equal(ownerInitialBalance - tokensToBuy);
        expect(await apexToken.balanceOf(buyer.address)).to.equal(buyerInitialBalance + tokensToBuy);
    });

    it("should refund excess ETH and emit Refund event when buyer sends more ETH than required", async () => {
        const { apexToken, owner, buyer } = await networkHelpers.loadFixture(deployApexTokenFixture);

        const tokensToBuy = hardhatEthers.parseEther("10"); // 10 tokens
        const exactEthRequired = hardhatEthers.parseEther("0.1"); // 10 * 0.01
        const sentEth = hardhatEthers.parseEther("0.5"); // Sending too much
        const expectedRefund = sentEth - exactEthRequired;

        // Initial balances
        const buyerInitialEthBalance = await hardhatEthers.provider.getBalance(buyer.address);

        // Execute transaction
        const tx = await apexToken.connect(buyer).buy(tokensToBuy, { value: sentEth });
        const receipt = await tx.wait();

        // Calculate gas cost
        const gasUsed = receipt?.gasUsed ?? 0n;
        const gasPrice = tx.gasPrice ?? 0n;
        const gasCost = gasUsed * gasPrice;

        // Verify Refund event
        await expect(tx)
            .to.emit(apexToken, "Refund")
            .withArgs(buyer.address, expectedRefund);

        // Verify buyer ETH balance
        const buyerFinalEthBalance = await hardhatEthers.provider.getBalance(buyer.address);

        // Final Balance = Initial - Sent - GasCost + Refund
        // Which means: Final Balance = Initial - ExactEthRequired - GasCost
        expect(buyerFinalEthBalance).to.equal(buyerInitialEthBalance - exactEthRequired - gasCost);

        // Verify token balance
        expect(await apexToken.balanceOf(buyer.address)).to.equal(tokensToBuy);
    });

    it("should allow a buyer to buy directly from the owner using buy() function even without explicit ERC20 allowance", async () => {
        const { apexToken, owner, buyer } = await networkHelpers.loadFixture(deployApexTokenFixture);

        // The contract's `buy` function internally uses `_transfer` which bypasses `allowance`.
        // We verify that allowance is indeed 0, but the buy still succeeds.
        const allowance = await apexToken.allowance(owner.address, buyer.address);
        expect(allowance).to.equal(0n);

        const tokensToBuy = hardhatEthers.parseEther("1");
        const ethRequired = hardhatEthers.parseEther("0.01");

        await apexToken.connect(buyer).buy(tokensToBuy, { value: ethRequired });
        expect(await apexToken.balanceOf(buyer.address)).to.equal(tokensToBuy);
    });
  });

  describe("D. Safe Transfer (safeTransfer)", () => {
    it("should successfully transfer tokens without needing approval", async () => {
        const { apexToken, owner, buyer } = await networkHelpers.loadFixture(deployApexTokenFixture);

        const amount = hardhatEthers.parseEther("10");

        // Execute safeTransfer
        await apexToken.connect(owner).safeTransfer(buyer.address, amount);

        // Verify balances
        expect(await apexToken.balanceOf(buyer.address)).to.equal(amount);
    });
  });
});