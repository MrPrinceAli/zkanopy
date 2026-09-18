// Chain and contract configuration for the ZKanopy frontend.
// Addresses are written here by the Phase 2 deploy (contracts/script/Deploy.s.sol); grid parameters
// are NOT configured here — they are read from public/data/tree.json at runtime (Phase 3/4).

export const CHAIN_ID = 84532 as const; // Base Sepolia
export const CHAIN_NAME = "Base Sepolia";
export const EXPLORER_URL = "https://sepolia.basescan.org";
// Read/simulation RPC; override with VITE_RPC_URL (see frontend/.env.example). Wallet transactions use the wallet's own RPC.
export const RPC_URL: string = import.meta.env.VITE_RPC_URL || "https://sepolia.base.org";

// Deployed 2026-09-18 by contracts/script/Deploy.s.sol (see contracts/broadcast/Deploy.s.sol/84532/).
export const REGISTRY_ADDRESS = "0xd5569a4557E4CaE10464Ff868f6A3594014D852f" as const;
export const VERIFIER_ADDRESS = "0x0d8958182C99a481b0F76D1C68Fdf7C23921ffBb" as const;
// Block the Registry was deployed at; used as `fromBlock` when scanning `Attested` logs.
export const REGISTRY_DEPLOY_BLOCK = 46963452;
// A known (block, timestamp) pair on this chain — the registerRoot transaction — plus the chain's block time,
// used to estimate the block of an attestation from its timestamp so log queries can stay narrow
// (the public RPC caps eth_getLogs at 10 000 blocks).
export const BLOCK_ANCHOR = { block: 46964085, timestamp: 1789696458 } as const;
export const BLOCK_TIME_S = 2;

// Public signal order of the circuit (frozen since Phase 1, PRD 5.3).
export const PUBLIC_SIGNALS = ["nullifier", "root", "season", "exporter", "lat0S", "lon0S", "stepS"] as const;
