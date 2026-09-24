// Attested-event queries that survive public RPC limits: ranges are cut into chunks of at most MAX_RANGE
// blocks up front, and a chunk the node still rejects is halved recursively. Callers narrow the range
// with windowAround() whenever they know a timestamp.
//
// Base's public RPC has tightened its eth_getLogs cap over time: 10 000 blocks when this was written,
// 1 000 as of 2026-09-23 ("eth_getLogs is limited to a 1,000 range"). MIN_SPLIT_RANGE must stay well
// below the cap, otherwise the adaptive halving gives up before it reaches an accepted range.
import type { Address, Hex } from "viem";
import { REGISTRY_ABI, type ReadClient } from "./contract";
import { BLOCK_ANCHOR, BLOCK_TIME_S, REGISTRY_ADDRESS, REGISTRY_DEPLOY_BLOCK } from "../config";

export interface AttestedLog {
  id: bigint;
  exporter: Address;
  gridId: bigint;
  nullifier: bigint;
  season: number;
  commodityHash: Hex;
  txHash: Hex;
  blockNumber: bigint;
}

const ATTESTED_EVENT = REGISTRY_ABI.find((e) => e.type === "event" && e.name === "Attested")!;

/** Largest range requested in one call (at the public RPC's current 1 000-block cap). */
export const MAX_RANGE = 1_000n;
/** Smallest range we still split; below this a failure is a real error. */
export const MIN_SPLIT_RANGE = 100n;

export interface LogQuery {
  exporter?: Address;
  id?: bigint;
  fromBlock?: bigint;
  toBlock?: bigint;
}

type GetLogs = (from: bigint, to: bigint) => Promise<AttestedLog[]>;

/** Splits [from, to] into consecutive ranges of at most `size` blocks. */
export function chunkRanges(from: bigint, to: bigint, size = MAX_RANGE): Array<[bigint, bigint]> {
  const out: Array<[bigint, bigint]> = [];
  for (let a = from; a <= to; a += size) {
    const b = a + size - 1n;
    out.push([a, b < to ? b : to]);
  }
  return out;
}

/** Range splitter, exported for tests: calls `fetch` over [from, to], halving on failure. */
export async function fetchRangeAdaptive(fetch: GetLogs, from: bigint, to: bigint): Promise<AttestedLog[]> {
  try {
    return await fetch(from, to);
  } catch (e) {
    if (to - from < MIN_SPLIT_RANGE) throw e;
    const mid = from + (to - from) / 2n;
    const left = await fetchRangeAdaptive(fetch, from, mid);
    const right = await fetchRangeAdaptive(fetch, mid + 1n, to);
    return left.concat(right);
  }
}

/** Block number an attestation with this unix timestamp was most likely mined in. */
export function estimateBlock(timestamp: number): bigint {
  return BigInt(BLOCK_ANCHOR.block) + BigInt(Math.floor((timestamp - BLOCK_ANCHOR.timestamp) / BLOCK_TIME_S));
}

/** A block window that surely contains attestations recorded between the two timestamps. */
export function windowAround(tsMin: number, tsMax: number, margin = 2_500n): { fromBlock: bigint; toBlock: bigint } {
  const deploy = BigInt(REGISTRY_DEPLOY_BLOCK);
  let from = estimateBlock(tsMin) - margin;
  if (from < deploy) from = deploy;
  const to = estimateBlock(tsMax) + margin;
  return { fromBlock: from, toBlock: to < from ? from : to };
}

export async function getAttestedLogs(client: ReadClient, q: LogQuery = {}): Promise<AttestedLog[]> {
  const head = await client.getBlockNumber();
  const from = q.fromBlock ?? BigInt(REGISTRY_DEPLOY_BLOCK);
  const to = q.toBlock !== undefined && q.toBlock < head ? q.toBlock : head;
  if (to < from) return [];
  const args: { exporter?: Address; id?: bigint } = {};
  if (q.exporter) args.exporter = q.exporter;
  if (q.id !== undefined) args.id = q.id;

  const fetch: GetLogs = async (a, b) => {
    const logs = await client.getLogs({ address: REGISTRY_ADDRESS, event: ATTESTED_EVENT, args, fromBlock: a, toBlock: b });
    return logs.map((l) => ({
      id: l.args.id!,
      exporter: l.args.exporter!,
      gridId: l.args.gridId!,
      nullifier: l.args.nullifier!,
      season: Number(l.args.season!),
      commodityHash: l.args.commodityHash!,
      txHash: l.transactionHash,
      blockNumber: l.blockNumber,
    }));
  };
  const out: AttestedLog[] = [];
  for (const [a, b] of chunkRanges(from, to)) out.push(...(await fetchRangeAdaptive(fetch, a, b)));
  return out.sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
}
