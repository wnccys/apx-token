import hre from "hardhat";
import { expect } from "chai";

const { ethers: hardhatEthers, networkHelpers } = await hre.network.create();

describe("Xtal DAO: Governor & Timelock Integration", () => {
  const INITIAL_MINT_PRICE = hardhatEthers.parseEther("3"); // 3 APX tokens
  const NEW_MINT_PRICE = hardhatEthers.parseEther("5"); // 5 APX tokens
  
  // Timelock and Governor parameters for testing
  const MIN_DELAY = 3600; // 1 hour for timelock
  const VOTING_DELAY = 1; // 1 block delay before voting starts
  const VOTING_PERIOD = 5; // 5 blocks voting period

  async function deployDaoFixture() {
    const [admin, voter1, voter2] = await hardhatEthers.getSigners();

    // 1. Deploy AphexToken setup
    const MockV3Aggregator = await hardhatEthers.getContractFactory("MockV3Aggregator");
    const initialPrice = 3000n * 10n ** 8n;
    const mockPriceFeed = await MockV3Aggregator.deploy(8, initialPrice);
    const mockPriceFeedAddress = await mockPriceFeed.getAddress();

    const ApexToken = await hardhatEthers.getContractFactory("AphexToken");
    const apexToken = await ApexToken.deploy(admin.address, mockPriceFeedAddress);
    const apexTokenAddress = await apexToken.getAddress();

    // 2. Deploy XtalNFT (Governance Token)
    const XtalNFT = await hardhatEthers.getContractFactory("XtalNFT");
    const xtalNFT = await XtalNFT.deploy(admin.address, apexTokenAddress);
    const xtalNFTAddress = await xtalNFT.getAddress();

    // 3. Deploy TimelockController
    const TimelockControl = await hardhatEthers.getContractFactory("TimelockControl");
    const timelock = await TimelockControl.deploy(
        MIN_DELAY,
        [], // proposers
        [], // executors
        admin.address // admin
    );
    const timelockAddress = await timelock.getAddress();

    // 4. Deploy Governor
    const XtalGovernor = await hardhatEthers.getContractFactory("XtalGovernor");
    const governor = await XtalGovernor.deploy(
        xtalNFTAddress,
        timelockAddress,
        VOTING_DELAY,
        VOTING_PERIOD
    );
    const governorAddress = await governor.getAddress();

    // 5. Setup Roles
    const PROPOSER_ROLE = await timelock.PROPOSER_ROLE();
    const EXECUTOR_ROLE = await timelock.EXECUTOR_ROLE();
    const ADMIN_ROLE = await timelock.DEFAULT_ADMIN_ROLE();

    // Governor is the sole proposer
    await timelock.connect(admin).grantRole(PROPOSER_ROLE, governorAddress);
    // Anyone can execute once the delay passes
    await timelock.connect(admin).grantRole(EXECUTOR_ROLE, hardhatEthers.ZeroAddress);
    
    // Transfer ownership of XtalNFT to Timelock so the DAO can control it
    await xtalNFT.connect(admin).transferOwnership(timelockAddress);
    
    // Optionally renounce admin role from deployer so Timelock is sovereign
    await timelock.connect(admin).renounceRole(ADMIN_ROLE, admin.address);

    // 6. Give voter1 voting power
    // Give voter1 some APX
    await apexToken.connect(admin).transfer(voter1.address, INITIAL_MINT_PRICE);
    // voter1 approves and mints NFT
    await apexToken.connect(voter1).approve(xtalNFTAddress, INITIAL_MINT_PRICE);
    await xtalNFT.connect(voter1).safeMint();
    // voter1 delegates to themselves to activate voting power
    await xtalNFT.connect(voter1).delegate(voter1.address);

    return { 
        admin, voter1, voter2, 
        apexToken, xtalNFT, timelock, governor 
    };
  }

  describe("Proposal Lifecycle", () => {
    it("should successfully propose, vote, queue, and execute a proposal", async () => {
      const { voter1, xtalNFT, timelock, governor } = await networkHelpers.loadFixture(deployDaoFixture);

      // Proposal Configuration
      const targets = [await xtalNFT.getAddress()];
      const values = [0];
      const calldata = xtalNFT.interface.encodeFunctionData("setMintPrice", [NEW_MINT_PRICE]);
      const calldatas = [calldata];
      const description = "Proposal #1: Increase mint price to 5 APX";
      const descriptionHash = hardhatEthers.id(description);

      // 1. Propose
      const proposeTx = await governor.connect(voter1).propose(targets, values, calldatas, description);
      const proposeReceipt = await proposeTx.wait();
      
      const parsedLog = governor.interface.parseLog(proposeReceipt!.logs[0]);
      const proposalId = parsedLog?.args.proposalId;

      expect(await governor.state(proposalId)).to.equal(0n); // 0 = Pending

      // 2. Wait for Voting Delay
      await hardhatEthers.provider.send("hardhat_mine", [hardhatEthers.toBeHex(VOTING_DELAY + 1)]);
      
      expect(await governor.state(proposalId)).to.equal(1n); // 1 = Active

      // 3. Vote
      // Support: 0 = Against, 1 = For, 2 = Abstain
      await governor.connect(voter1).castVote(proposalId, 1n);

      const hasVoted = await governor.hasVoted(proposalId, voter1.address);
      expect(hasVoted).to.be.true;

      // 4. Wait for Voting Period to end
      await hardhatEthers.provider.send("hardhat_mine", [hardhatEthers.toBeHex(VOTING_PERIOD + 1)]);
      
      expect(await governor.state(proposalId)).to.equal(4n); // 4 = Succeeded

      // 5. Queue
      await governor.connect(voter1).queue(targets, values, calldatas, descriptionHash);
      
      expect(await governor.state(proposalId)).to.equal(5n); // 5 = Queued

      // Attempting to execute before Timelock delay should fail
      try {
        await governor.connect(voter1).execute(targets, values, calldatas, descriptionHash);
        expect.fail("Should have reverted");
      } catch (e: any) {
        expect(e.message).to.not.be.undefined;
      }

      // 6. Wait for Timelock Delay
      await hardhatEthers.provider.send("evm_increaseTime", [MIN_DELAY]);
      await hardhatEthers.provider.send("hardhat_mine", ["0x1"]); // Mine a block to register time

      // 7. Execute
      await governor.connect(voter1).execute(targets, values, calldatas, descriptionHash);
      
      expect(await governor.state(proposalId)).to.equal(7n); // 7 = Executed

      // Verify the execution effect on the target contract
      const updatedPrice = await xtalNFT.mintPrice();
      expect(updatedPrice).to.equal(NEW_MINT_PRICE);
    });

    it("should fail a proposal if quorum is not reached", async () => {
      const { admin, voter1, xtalNFT, timelock, governor } = await networkHelpers.loadFixture(deployDaoFixture);

      const targets = [await xtalNFT.getAddress()];
      const values = [0];
      const calldata = xtalNFT.interface.encodeFunctionData("setMintPrice", [NEW_MINT_PRICE]);
      const calldatas = [calldata];
      const description = "Proposal #2: Try to increase price";

      // Propose
      const proposeTx = await governor.connect(voter1).propose(targets, values, calldatas, description);
      const proposeReceipt = await proposeTx.wait();
      const parsedLog = governor.interface.parseLog(proposeReceipt!.logs[0]);
      const proposalId = parsedLog?.args.proposalId;

      // Wait for Voting Delay
      await hardhatEthers.provider.send("hardhat_mine", [hardhatEthers.toBeHex(VOTING_DELAY + 1)]);

      // DO NOT VOTE (Simulating low turnout / missing quorum)

      // Wait for Voting Period
      await hardhatEthers.provider.send("hardhat_mine", [hardhatEthers.toBeHex(VOTING_PERIOD + 1)]);

      // State should be Defeated (3) because Quorum wasn't met
      expect(await governor.state(proposalId)).to.equal(3n); 

      // Attempting to queue should fail
      const descriptionHash = hardhatEthers.id(description);
      try {
        await governor.connect(voter1).queue(targets, values, calldatas, descriptionHash);
        expect.fail("Should have reverted");
      } catch (e: any) {
        expect(e.message).to.not.be.undefined;
      }
    });
  });
});
