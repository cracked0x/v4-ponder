import { createConfig } from "ponder";
import { http } from "viem";

import { PoolManagerAbi } from "./abis/PoolManager";

export default createConfig({
  ordering: "multichain",
  networks: {
    mainnet: {
      chainId: 1,
      transport: http(process.env.PONDER_RPC_URL_1),
    },

  },
  contracts: {
    PoolManager: {
      network: {
        mainnet: {
          address: "0x000000000004444c5dc75cb358380d2e3de08a90",
          startBlock: 21688329,
          endBlock: 21746115
        },

      },
      abi: PoolManagerAbi,
      filter: [
        {
          event: "Initialize",
          args: {}
        },
        {
          event: "Swap",
          args: {}
        },
      ],
    },
  },
});
