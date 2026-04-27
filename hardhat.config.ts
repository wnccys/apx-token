import hardhatToolboxMochaEthersPlugin from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import { defineConfig } from "hardhat/config";

export default defineConfig({
  plugins: [hardhatToolboxMochaEthersPlugin],
  solidity: {
    profiles: {
      default: {
        version: "0.8.28",
        settings: {
            optimizer: {
                enabled: true,
                runs: 200,
            }
        }
      },
      production: {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    },
  },
  networks: {
    hardhat: {
        type: "http",
        url: "http://127.0.0.1:8545",
    },
    sepolia: {
        type: "http",
        url: "https://eth-sepolia.g.alchemy.com/v2/1YmKZI8nx3tgI2lhGEFxw",
        accounts: ["YOUR_KEY_HERE"] // The private key of the wallet deploying the contracts
   }
  },
});
