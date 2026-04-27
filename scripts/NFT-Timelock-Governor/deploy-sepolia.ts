import hre from "hardhat";
import { type TimelockControl } from "../../types/ethers-contracts/index.js";

const SEPOLIA_PRICE_FEED = "0x694AA1769357215DE4FAC081bf1f309aDC325306";

async function main() {
    const { ethers, networkName } = await hre.network.create();
    console.log(`Starting deployment to ${networkName}...`);
    
    // Hardcoded parameters for a production-like testnet DAO
    const votingDelay = 1; // 1 block
    const votingPeriod = 50400; // 1 week in blocks
    
    const [deployer] = await ethers.getSigners();
    const deployerAddress = await deployer.getAddress();
    console.log("Deploying contracts with account:", deployerAddress);
    console.log("Account balance:", ethers.formatEther(await ethers.provider.getBalance(deployerAddress)));

    console.log("\n1. Deploying AphexToken (ERC-20)...");
    const apxToken = await ethers.deployContract("AphexToken", [deployerAddress, SEPOLIA_PRICE_FEED]);
    await apxToken.waitForDeployment();
    console.log("AphexToken deployed to:", await apxToken.getAddress());

    console.log("\n2. Deploying XtalNFT (ERC-721)...");
    const xtal = await ethers.deployContract("XtalNFT", [deployerAddress, await apxToken.getAddress()]);
    await xtal.waitForDeployment();
    console.log("XtalNFT deployed to:", await xtal.getAddress());

    console.log("\n3. Deploying AphexStake (Staking)...");
    const apxStake = await ethers.deployContract("AphexStake", [await apxToken.getAddress(), await xtal.getAddress()]);
    await apxStake.waitForDeployment();
    console.log("AphexStake deployed to:", await apxStake.getAddress());

    console.log("\n4. Deploying TimelockController...");
    const timelock = await ethers.deployContract("TimelockControl", [
        votingDelay, // minDelay
        [],          // proposers
        [],          // executors
        deployerAddress // admin
    ]) as unknown as TimelockControl;
    await timelock.waitForDeployment();
    console.log("TimelockController deployed to:", await timelock.getAddress());

    console.log("\n5. Deploying XtalGovernor...");
    const governor = await ethers.deployContract("XtalGovernor", [
        await xtal.getAddress(),
        await timelock.getAddress(),
        votingDelay,
        votingPeriod
    ]);
    await governor.waitForDeployment();
    console.log("XtalGovernor deployed to:", await governor.getAddress());

    console.log("\n--- Configuring the DAO ---");

    console.log("Setting AphexStake as an authorized minter in XtalNFT...");
    const txStake = await xtal.setStakeContract(await apxStake.getAddress());
    await txStake.wait();

    console.log("Granting PROPOSER_ROLE to Governor...");
    const PROPOSER_ROLE = await timelock.PROPOSER_ROLE();
    const txProposer = await timelock.grantRole(PROPOSER_ROLE, await governor.getAddress());
    await txProposer.wait();

    console.log("Granting EXECUTOR_ROLE to zero address (anyone can execute)...");
    const EXECUTOR_ROLE = await timelock.EXECUTOR_ROLE();
    const txExecutor = await timelock.grantRole(EXECUTOR_ROLE, "0x0000000000000000000000000000000000000000");
    await txExecutor.wait();

    console.log("Transferring XtalNFT ownership to the TimelockController...");
    const txOwnership = await xtal.transferOwnership(await timelock.getAddress());
    await txOwnership.wait();

    console.log("Renouncing Timelock admin role from the deployer...");
    const ADMIN_ROLE = await timelock.DEFAULT_ADMIN_ROLE();
    const txRenounce = await timelock.renounceRole(ADMIN_ROLE, deployerAddress);
    await txRenounce.wait();

    console.log("\n🎉 Deployment and DAO Configuration Complete!");
    console.log(`
        XtalNFT: ${await xtal.getAddress()}
        AphexToken: ${await apxToken.getAddress()}
        AphexStake: ${await apxStake.getAddress()}
        TimelockController: ${await timelock.getAddress()}
        XtalGovernor: ${await governor.getAddress()}
    `);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
