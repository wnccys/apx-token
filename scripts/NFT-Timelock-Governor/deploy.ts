import hre from "hardhat";
import { type TimelockControl } from "../../types/ethers-contracts/index.js";

const PRICE_FEED = "0x694AA1769357215DE4FAC081bf1f309aDC325306";

async function main() {
    const { ethers, networkName } = await hre.network.getOrCreate("localhost");

    console.log("Using network: ", networkName);
    const isLocal = networkName === "hardhat" || networkName === "localhost";
    // Simulates env vars when using mainnet
    const votingDelay = isLocal ? 1 : 86400;   // 1 block for tests, 1 day for Mainnet
    const votingPeriod = isLocal ? 5 : 50400;  // 5 blocks for tests, 1 week for Mainnet

    const [deployer] = await ethers.getSigners();
    const deployerAddress = await deployer.getAddress();
    console.log("I am: ", deployerAddress);

    ethers.provider.send("anvil_setCode", [deployerAddress, "0x"]);
    const newCode = await ethers.provider.getCode(deployerAddress);
    console.log("Removed code from deployer; New length: ", newCode.length);

    const apxToken = await ethers.deployContract("AphexToken", [deployerAddress, PRICE_FEED]);
    console.log("Deployed Aphex Token");

    const xtal = await ethers.deployContract("XtalNFT", [deployerAddress, await apxToken.getAddress()]);
    console.log("Deployed Xtal NFT");

    const apxStake = await ethers.deployContract("AphexStake", [await apxToken.getAddress(), await xtal.getAddress()]);
    console.log("Deployed Aphex Stake");

    const timelock = await ethers.deployContract("TimelockControl", [
        votingDelay,
        [],
        [],
        deployerAddress
    ]) as unknown as TimelockControl;
    console.log("Deployed Timelock Controller");

    const governor = await ethers.deployContract("XtalGovernor", [
        await xtal.getAddress(),
        await timelock.getAddress(),
        votingDelay,
        votingPeriod
    ]);
    console.log("Deployed Governor");

    const PROPOSER_ROLE = await timelock.PROPOSER_ROLE();
    const EXECUTOR_ROLE = await timelock.EXECUTOR_ROLE();

    await timelock.grantRole(PROPOSER_ROLE, await governor.getAddress());
    console.log("Granted Proposers");
    await timelock.grantRole(EXECUTOR_ROLE, "0x0000000000000000000000000000000000000000");
    console.log("Granted Executors");
    
    await xtal.setStakeContract(await apxStake.getAddress());
    console.log("Set AphexStake as minter in XtalNFT");

    await xtal.transferOwnership(await timelock.getAddress());
    console.log("Set Timelock as owner of NFT");

    const ADMIN_ROLE = await timelock.DEFAULT_ADMIN_ROLE();
    console.log("Renouncing admin role for deployer...");

    const tx = await timelock.renounceRole(ADMIN_ROLE, deployerAddress);
    await tx.wait();
    console.log("Deployer is no longer an Admin. The DAO is now sovereign.");

    const stillAdmin = await timelock.hasRole(ADMIN_ROLE, deployerAddress);
    console.log("Is deployer still admin?", stillAdmin);

    console.log(`
        --- 💸 ALL DEPLOYS DONE ---

        Xtal: ${await xtal.getAddress()}
        Timelock: ${await timelock.getAddress()},
        Governor: ${await governor.getAddress()},
        AphexStake: ${await apxStake.getAddress()}
    `);

    console.log("Current balance: ", ethers.formatEther(await ethers.provider.getBalance(deployerAddress)));

    let nonce = await ethers.provider.getTransactionCount(deployer);

    let mintPrice = await xtal.mintPrice();
    const totalApxNeeded = mintPrice * 5n;
    
    // Approve XtalNFT to spend APX tokens
    const approveTx = await apxToken.approve(await xtal.getAddress(), totalApxNeeded, { nonce: nonce++ });
    await approveTx.wait();

    for (let i = 0; i < 5; i++) {
        const tx = await xtal.safeMint({
            nonce: nonce++
        });

        await tx.wait();
    }
    console.log("=== All standard mints sent ===");

    await (await xtal.delegate(deployerAddress, { nonce: nonce++ })).wait();
    console.log("Votes delegated");

    let balance = await xtal.balanceOf(deployerAddress);
    let votes = await xtal.getVotes(deployerAddress);
    console.log("NFTs Owned (before stake): ", balance.toString());
    console.log("Votes power (before stake): ", ethers.formatUnits(votes, 0));

    // Demonstrate AphexStake
    const stakeAmount = ethers.parseEther("50");
    console.log(`\n=== Approving and Staking ${ethers.formatEther(stakeAmount)} APX... ===`);
    await apxToken.approve(await apxStake.getAddress(), stakeAmount, { nonce: nonce++ }).then(tx => tx.wait());
    await apxStake.lockAndMint({ nonce: nonce++ }).then(tx => tx.wait());
    
    balance = await xtal.balanceOf(deployerAddress);
    votes = await xtal.getVotes(deployerAddress);
    console.log("NFTs Owned (after stake): ", balance.toString());
    console.log("Votes power (after stake): ", ethers.formatUnits(votes, 0));
    console.log("=== Staking successful! Received 2 bonus NFTs ===\n");

    const xtalInterface = xtal.interface;
    const calldata = xtalInterface.encodeFunctionData("setMintPrice", [500n]);
    const targets = [await xtal.getAddress()];
    const values = [0];
    const calldatas = [calldata];
    const description = "Proposal #1: Increase mint price to 0.05 ETH";

    const proposeTx = await governor.propose(targets, values, calldatas, description);
    const txReceipt = await proposeTx.wait();
    console.log("Proposal sent");

    const descriptionHash = ethers.id(description);
    console.log("DescriptionHash: ", descriptionHash);

    const parsedLog = governor.interface.parseLog(txReceipt!.logs[0]);
    const proposalId = parsedLog?.args.proposalId;
    console.log(`Proposal ID created: ${proposalId}`);

    const [againstVotes, forVotes, abstainVotes] = await governor.proposalVotes(proposalId);
    console.log(`--- Current Standings ---`);
    console.log(`For:     ${ethers.formatEther(forVotes)} XTAL`);
    console.log(`Against: ${ethers.formatEther(againstVotes)} XTAL`);
    console.log(`Abstain: ${ethers.formatEther(abstainVotes)} XTAL`);

    const states = ["Pending", "Active", "Canceled", "Defeated", "Succeeded", "Queued", "Expired", "Executed"];
    const currentState = await governor.state(proposalId);
    console.log(`Current Status: ${states[currentState as unknown as number]}`);

    const snapshot = await governor.proposalSnapshot(proposalId);
    const deadline = await governor.proposalDeadline(proposalId);
    const currentBlock = await ethers.provider.getBlockNumber();

    console.log(`Snapshot Block: ${snapshot}`);
    console.log(`Deadline Block: ${deadline}`);
    console.log(`Current Block:  ${currentBlock}`);

    if (currentBlock < deadline) {
        console.log(`Blocks remaining: ${deadline - BigInt(currentBlock)}`);
    }

    if (snapshot > currentBlock) {
        const blocksToSkip = Number(snapshot - BigInt(currentBlock)) + 1;

        console.log(`Advancing time by ${blocksToSkip} blocks...`);

        // This forces Hardhat to mine the necessary blocks instantly
        await ethers.provider.send("hardhat_mine", [ethers.toBeHex(blocksToSkip)]);
    }
    console.log("Time advanced");

    const quorumRequired = await governor.quorum(snapshot);
    console.log(`Quorum Needed: ${ethers.formatEther(quorumRequired)} XTAL`);

    const totalVotesCast = forVotes + againstVotes + abstainVotes;
    if (totalVotesCast < quorumRequired) {
        console.log(`⚠️ Warning: Quorum not yet reached.`);
    }

    let hasVoted = await governor.hasVoted(proposalId, deployerAddress);
    console.log(`Did I vote? ${hasVoted ? "✅ Yes" : "❌ Not yet"}`);

    const voteTx = await governor.castVote(proposalId, 1);
    const receipt = await voteTx.wait();

    console.log("Vote cast successfully! TX Hash:", receipt?.hash);

    hasVoted = await governor.hasVoted(proposalId, deployerAddress);
    console.log(`Did I vote? ${hasVoted ? "✅ Yes" : "❌ Not yet"}`);

    const currentStateNew = await governor.state(proposalId);
    console.log(`Current Status: ${states[currentStateNew as unknown as number]}`);

    await ethers.provider.send("hardhat_mine", [ethers.toBeHex(deadline - BigInt(currentBlock))]);
    const deadline1 = await governor.proposalDeadline(proposalId);
    const currentBlock1 = await ethers.provider.getBlockNumber();
    console.log(`
        Advanced!
        Current Block: ${currentBlock1}
        Deadline: ${deadline1}
    `);

    const currentStateNew2 = await governor.state(proposalId);
    console.log(`Current Status: ${states[currentStateNew2 as unknown as number]}`);

    await governor.queue(targets, values, calldatas, descriptionHash);

    const currentStateNew3 = await governor.state(proposalId);
    console.log(`Current Status (After Queue): ${states[currentStateNew3 as unknown as number]}`);

    await ethers.provider.send("evm_increaseTime", [Number(votingDelay)]);
    console.log("Advanced Timelock delay");

    const currentStateNew4 = await governor.state(proposalId);
    console.log(`Current Status (After Timelock delay advance): ${states[currentStateNew4 as unknown as number]}`);

    console.log("NFT USD Mint before execute: ", await xtal.mintPrice());

    const executeTx = await governor.execute(
        targets,
        values,
        calldatas,
        descriptionHash
    );

    await executeTx.wait();
    console.log("NFT USD Mint after execute: ", await xtal.mintPrice());

    const currentStateNew5 = await governor.state(proposalId);
    console.log(`Current Status (After Execution): ${states[currentStateNew5 as unknown as number]}`);
}

main().catch((e) => {
    console.log(e);
    process.exitCode = 1;
})
