import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const PRICE_FEED_ADDRESS = "0x694AA1769357215DE4FAC081bf1f309aDC325306";

export default buildModule("MyNFTModule", (m) => {
    const nft = m.contract("MyNFTVotes", [PRICE_FEED_ADDRESS]);
    return { nft };
});