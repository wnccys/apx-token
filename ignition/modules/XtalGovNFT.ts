import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const OWNER_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const PRICE_FEED_ADDRESS = "0x694AA1769357215DE4FAC081bf1f309aDC325306";

export default buildModule("XtalModule", (m) => {
    const xtal = m.contract("XtalGovNFT", [OWNER_ADDRESS, PRICE_FEED_ADDRESS]);
    return { xtal };
});