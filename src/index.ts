import { ponder } from "ponder:registry";
import { pool as poolSchema, token as tokenSchema, position as positionSchema, swap as swapSchema } from "ponder:schema";
import { encodePacked, keccak256 } from "viem";
import { sqrtPriceX96ToTokenPrices } from "./utils/pricing";
import { zero } from "./utils/constants";

// Define minimal ERC20 ABI
const ERC20_ABI = [
  {
    type: "function",
    name: "name",
    inputs: [],
    outputs: [{ type: "string" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "symbol",
    inputs: [],
    outputs: [{ type: "string" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "decimals",
    inputs: [],
    outputs: [{ type: "uint8" }],
    stateMutability: "view"
  }
];

// Define context type
type PonderContext = {
  db: any;
  client: any;
  network: { chainId: number; name: string };
};

// Helper function to safely fetch token metadata
async function getTokenMetadata(
  context: PonderContext,
  address: string,
  chainId: number
) {
  // Special case for address(0) which represents native ETH
  if (address === "0x0000000000000000000000000000000000000000") {
    const token = { name: "Ethereum", symbol: "ETH" };
    return { name: "Ethereum", symbol: "ETH", decimals: 18 };
  }

  try {
    // Fetch token metadata
    const name = await context.client.readContract({
      abi: ERC20_ABI,
      address,
      functionName: "name",
    });

    const symbol = await context.client.readContract({
      abi: ERC20_ABI,
      address,
      functionName: "symbol",
    });

    const decimals = await context.client.readContract({
      abi: ERC20_ABI,
      address,
      functionName: "decimals",
    });

    return { name, symbol, decimals };
  } catch (error) {
    console.error(`Failed to get metadata for token ${address} on chain ${chainId}:`, error);
    // Return fallback values if token metadata cannot be fetched
    return { name: "Unknown Token", symbol: "UNKNOWN", decimals: 18 };
  }
}

// Index token metadata
async function indexToken(
  context: PonderContext,
  address: string,
  chainId: number
) {
  // Check if token already exists in database
  const existingToken = await context.db.find(tokenSchema, {
    address,
    chainId
  });

  // If token already exists, no need to fetch metadata again
  if (existingToken) {
    return {
      name: existingToken.name,
      symbol: existingToken.symbol,
      decimals: existingToken.decimals
    } as { name: string, symbol: string, decimals: number };
  }

  // Get token metadata
  const { name, symbol, decimals } = await getTokenMetadata(context, address, chainId);

  // Save token to database
  await context.db.insert(tokenSchema).values({
    address,
    chainId,
    name,
    symbol,
    decimals,
    creationBlock: context.client.blockNumber || 0,
  })

  return { name, symbol, decimals } as { name: string, symbol: string, decimals: number };
}

ponder.on("PoolManager:Initialize", async ({ event, context }) => {
  const chainId = context.network.chainId;

  // Index the tokens first
  const token0 = await indexToken(context, event.args.currency0, chainId);
  const token1 = await indexToken(context, event.args.currency1, chainId);

  const [price0, price1] = sqrtPriceX96ToTokenPrices(event.args.sqrtPriceX96, token0.decimals, token1.decimals)
  // Index pool
  await context.db.insert(poolSchema).values({
    poolId: event.args.id,
    currency0: event.args.currency0,
    currency1: event.args.currency1,
    fee: event.args.fee,
    tickSpacing: event.args.tickSpacing,
    tick: event.args.tick,
    sqrtPriceX96: event.args.sqrtPriceX96,
    liquidity: zero,
    token0Price: price0.toString(),
    token1Price: price1.toString(),
    hooks: event.args.hooks,
    chainId,
    creationBlock: Number(event.block.number),
  });
});

ponder.on("PoolManager:Swap", async ({ event, context }) => {

  const pool = await context.db.find(poolSchema, {
    poolId: event.args.id,
    chainId: context.network.chainId,
  });

  if (!pool) {
    console.error(`Pool not found for pool ${event.args.id} on chain ${context.network.chainId}`);
    return;
  }

  const token0 = await context.db.find(tokenSchema, {
    address: pool.currency0,
    chainId: context.network.chainId,
  });

  const token1 = await context.db.find(tokenSchema, {
    address: pool.currency1,
    chainId: context.network.chainId,
  });

  if (!token0 || !token1) {
    console.error(`Token not found for pool ${pool.poolId} on chain ${context.network.chainId}`);
    return;
  }

  const [price0, price1] = sqrtPriceX96ToTokenPrices(event.args.sqrtPriceX96, token0.decimals, token1.decimals)

  await context.db.update(poolSchema, {
    poolId: event.args.id,
    chainId: context.network.chainId,
  }).set({
    liquidity: event.args.liquidity,
    tick: event.args.tick,
    sqrtPriceX96: event.args.sqrtPriceX96,
    token0Price: price0.toString(),
    token1Price: price1.toString(),
  })


  await context.db.insert(swapSchema).values({
    id: event.log.id,
    poolId: event.args.id,
    sender: event.args.sender,
    amount0: event.args.amount0,
    amount1: event.args.amount1,
    sqrtPriceX96: event.args.sqrtPriceX96,
    liquidity: event.args.liquidity,
    tick: event.args.tick,
    fee: event.args.fee,
    chainId: context.network.chainId,
    blockNumber: event.block.number,
  });
});

ponder.on("PoolManager:ModifyLiquidity", async ({ event, context }) => {
  // determine the positionId, the same hash used by PoolManager / Position.sol
  const positionId = keccak256(encodePacked(["address", "int24", "int24", "bytes32"], [event.args.sender, event.args.tickLower, event.args.tickUpper, event.args.salt]));

  const pool = await context.db.find(poolSchema, {
    poolId: event.args.id,
    chainId: context.network.chainId,
  });

  if (!pool) {
    console.error(`Pool not found for pool ${event.args.id} on chain ${context.network.chainId}`);
    return;
  }

  // Pools liquidity tracks the currently active liquidity given pools current tick.
  // We only want to update it if the new position includes the current tick.
  if (
    pool.tick !== null &&
    event.args.tickLower <= pool.tick &&
    event.args.tickUpper >= pool.tick
  ) {
    await context.db.update(poolSchema, {
      poolId: event.args.id,
      chainId: context.network.chainId,
    }).set({
      liquidity: pool.liquidity + event.args.liquidityDelta
    })
  }

  // upsert into `position` table
  // for cases where the position exists, update the position's liquidity according to the event
  await context.db.insert(positionSchema).values({
    positionId: positionId,
    poolId: event.args.id,
    owner: event.args.sender,
    tickLower: BigInt(event.args.tickLower),
    tickUpper: BigInt(event.args.tickUpper),
    liquidity: event.args.liquidityDelta,
    salt: event.args.salt,
    chainId: context.network.chainId,
  }).onConflictDoUpdate((row) => ({ liquidity: row.liquidity + event.args.liquidityDelta }));
});
