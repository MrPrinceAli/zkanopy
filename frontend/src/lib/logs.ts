// Attested-event queries that survive public RPC block-range limits: one getLogs call over the whole range,
// recursively halved whenever the node rejects the request.
import type { Address, Hex } from "viem";
import { REGISTRY_ABI, type ReadClient } from "./contract";
import { REGISTRY_ADDRESS, REGISTRY_DEPLOY_BLOCK } from "../config";

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

/** Smallest range we still split; below this a failure is a real error. */
export const MIN_SPLIT_RANGE = 2_000n;

export interface LogQuery {
  exporter?: Address;
  id?: bigint;
  fromBlock?: bigint;
  toBlock?: bigint;
}

type GetLogs = (from: bigint, to: bigint) => Promise<AttestedLog[]>;

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

export async function getAttestedLogs(client: ReadClient, q: LogQuery = {}): Promise<AttestedLog[]> {
  const from = q.fromBlock ?? BigInt(REGISTRY_DEPLOY_BLOCK);
  const to = q.toBlock ?? (await client.getBlockNumber());
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
  const logs = await fetchRangeAdaptive(fetch, from, to);
  return logs.sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
}
