// Read-side helpers over the Registry: attestations of an exporter, one attestation, grids, commodity lookup.
import type { Address, Hex } from "viem";
import { COMMODITIES, REGISTRY_ABI, commodityHash, type Commodity, type ReadClient } from "./contract";
import { REGISTRY_ADDRESS } from "../config";
import { getAttestedLogs } from "./logs";

export interface AttestationRecord {
  id: bigint;
  exporter: Address;
  gridId: bigint;
  nullifier: bigint;
  season: number;
  commodityHash: Hex;
  timestamp: number; // unix seconds
  txHash?: Hex;
}

export interface GridRecordOnchain {
  gridId: bigint;
  root: bigint;
  lat0S: bigint;
  lon0S: bigint;
  stepS: bigint;
  cols: number;
  rows: number;
  version: number;
  publishedAt: number;
  metadataURI: string;
}

const HASH_TO_COMMODITY = new Map<string, Commodity>(COMMODITIES.map((c) => [commodityHash(c).toLowerCase(), c]));

/** Reverse lookup of the commodity table; unknown hashes are reported as such (the chain stores only the hash). */
export function commodityFromHash(hash: Hex): Commodity {
  return HASH_TO_COMMODITY.get(hash.toLowerCase()) ?? { key: "unknown", hsCode: "?", description: `unknown (${hash.slice(0, 10)}…)` };
}

export const toHex32 = (x: bigint): Hex => `0x${x.toString(16).padStart(64, "0")}`;

export async function fetchGrid(client: ReadClient, gridId: bigint): Promise<GridRecordOnchain> {
  const g = await client.readContract({ address: REGISTRY_ADDRESS, abi: REGISTRY_ABI, functionName: "getGrid", args: [gridId] });
  return {
    gridId,
    root: g.root,
    lat0S: g.lat0S,
    lon0S: g.lon0S,
    stepS: g.stepS,
    cols: g.cols,
    rows: g.rows,
    version: g.version,
    publishedAt: Number(g.publishedAt),
    metadataURI: g.metadataURI,
  };
}

export async function fetchAttestation(client: ReadClient, id: bigint): Promise<AttestationRecord> {
  const a = await client.readContract({ address: REGISTRY_ADDRESS, abi: REGISTRY_ABI, functionName: "getAttestation", args: [id] });
  return { id: a.id, exporter: a.exporter, gridId: a.gridId, nullifier: a.nullifier, season: a.season, commodityHash: a.commodityHash, timestamp: Number(a.timestamp) };
}

/** Best-effort transaction hash for one attestation (needs event logs; undefined when the RPC refuses). */
export async function fetchTxHash(client: ReadClient, id: bigint): Promise<Hex | undefined> {
  try {
    const logs = await getAttestedLogs(client, { id });
    return logs[0]?.txHash;
  } catch {
    return undefined;
  }
}

/** All attestations of an exporter, with timestamps from the contract and tx hashes from the logs when available. */
export async function fetchAttestationsOf(client: ReadClient, exporter: Address): Promise<AttestationRecord[]> {
  const ids = await client.readContract({ address: REGISTRY_ADDRESS, abi: REGISTRY_ABI, functionName: "attestationsOf", args: [exporter] });
  if (ids.length === 0) return [];

  const structs = await client.multicall({
    contracts: ids.map((id) => ({ address: REGISTRY_ADDRESS, abi: REGISTRY_ABI, functionName: "getAttestation" as const, args: [id] as const })),
    allowFailure: false,
  });

  let txByIdMap = new Map<bigint, Hex>();
  try {
    const logs = await getAttestedLogs(client, { exporter });
    txByIdMap = new Map(logs.map((l) => [l.id, l.txHash]));
  } catch {
    /* table still works without tx links */
  }

  return structs.map((a) => ({
    id: a.id,
    exporter: a.exporter,
    gridId: a.gridId,
    nullifier: a.nullifier,
    season: a.season,
    commodityHash: a.commodityHash,
    timestamp: Number(a.timestamp),
    txHash: txByIdMap.get(a.id),
  }));
}

export async function fetchGridsFor(client: ReadClient, atts: AttestationRecord[]): Promise<Map<bigint, GridRecordOnchain>> {
  const ids = [...new Set(atts.map((a) => a.gridId))];
  const grids = await Promise.all(ids.map((g) => fetchGrid(client, g)));
  return new Map(grids.map((g) => [g.gridId, g]));
}

export const formatTime = (unix: number) => new Date(unix * 1000).toISOString().replace("T", " ").slice(0, 19) + " UTC";
