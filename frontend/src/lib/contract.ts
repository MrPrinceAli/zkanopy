// Registry ABI (kept in sync with contracts/src/Registry.sol, frozen since Phase 2), commodity table
// and helpers to turn viem errors into the contract's error names.
import { BaseError, ContractFunctionRevertedError, keccak256, parseAbi, toBytes, type PublicClient, type Transport } from "viem";
import { baseSepolia } from "viem/chains";
import { EXPLORER_URL } from "../config";

/** The read client wagmi hands out for our single configured chain. */
export type ReadClient = PublicClient<Transport, typeof baseSepolia>;

export const REGISTRY_ABI = parseAbi([
  "struct Grid { uint256 root; uint64 lat0S; uint64 lon0S; uint64 stepS; uint32 cols; uint32 rows; uint32 version; uint64 publishedAt; string metadataURI; }",
  "struct Attestation { uint256 id; address exporter; uint256 gridId; uint256 nullifier; uint32 season; bytes32 commodityHash; uint64 timestamp; }",
  "function attest(uint256[2] a, uint256[2][2] b, uint256[2] c, uint256[7] pubSignals, uint256 gridId, bytes32 commodityHash) returns (uint256 id)",
  "function getAttestation(uint256 id) view returns (Attestation)",
  "function attestationsOf(address exporter) view returns (uint256[])",
  "function getGrid(uint256 gridId) view returns (Grid)",
  "function nullifierUsed(uint256 nullifier) view returns (bool)",
  "function gridCount() view returns (uint256)",
  "function attestationCount() view returns (uint256)",
  "function oracle() view returns (address)",
  "event RootRegistered(uint256 indexed gridId, uint256 indexed root, uint32 version, uint64 lat0S, uint64 lon0S, uint64 stepS, uint32 cols, uint32 rows, string metadataURI)",
  "event Attested(uint256 indexed id, address indexed exporter, uint256 indexed gridId, uint256 nullifier, uint32 season, bytes32 commodityHash)",
  "error NotOwner()",
  "error NotOracle()",
  "error ZeroAddress()",
  "error InvalidGrid()",
  "error UnknownGrid()",
  "error UnknownRootOrGrid()",
  "error ExporterMismatch()",
  "error InvalidProof()",
  "error NullifierAlreadyUsed()",
  "error SeasonOutOfRange()",
  "error UnknownAttestation()",
]);

/** Explicit gas limit for attest(): a valid first attestation used ~513k on Base Sepolia; a malformed proof would burn the whole limit. */
export const ATTEST_GAS_LIMIT = 750_000n;

export interface Commodity {
  key: string;
  hsCode: string;
  description: string;
}

export const COMMODITIES: Commodity[] = [
  { key: "cocoa", hsCode: "1801", description: "Cocoa beans" },
  { key: "coffee", hsCode: "0901", description: "Coffee" },
  { key: "palm", hsCode: "1511", description: "Palm oil" },
  { key: "rubber", hsCode: "4001", description: "Natural rubber" },
];

/** commodityHash = keccak256("<HS code>:<description>") — same convention as the Foundry tests. */
export const commodityHash = (c: Commodity): `0x${string}` => keccak256(toBytes(`${c.hsCode}:${c.description}`));

export const txUrl = (hash: string) => `${EXPLORER_URL}/tx/${hash}`;
export const addressUrl = (addr: string) => `${EXPLORER_URL}/address/${addr}`;

export const shortHex = (hex: string, n = 6) => (hex.length > 2 * n + 2 ? `${hex.slice(0, n + 2)}…${hex.slice(-n)}` : hex);

const ERROR_HINTS: Record<string, string> = {
  NullifierAlreadyUsed: "This cell has already been attested for this season — a plot can only be sold once per season.",
  ExporterMismatch: "The proof is bound to a different exporter address than the wallet sending the transaction.",
  InvalidProof: "The verifier rejected the proof.",
  UnknownRootOrGrid: "The proof was made against a grid that is not registered (root or parameters differ).",
  SeasonOutOfRange: "Season does not fit in 32 bits.",
};

export interface DecodedError {
  name: string;
  message: string;
}

/** Extracts the custom error name from a viem revert, or a readable fallback. */
export function decodeContractError(e: unknown): DecodedError {
  if (e instanceof BaseError) {
    const reverted = e.walk((err) => err instanceof ContractFunctionRevertedError) as
      | ContractFunctionRevertedError
      | null;
    const name = reverted?.data?.errorName;
    if (name) return { name, message: ERROR_HINTS[name] ?? `Contract reverted with ${name}` };
    const short = e.shortMessage || e.message;
    if (/user rejected|denied/i.test(short)) return { name: "UserRejected", message: "Transaction rejected in the wallet." };
    return { name: "Error", message: short };
  }
  return { name: "Error", message: e instanceof Error ? e.message : String(e) };
}
