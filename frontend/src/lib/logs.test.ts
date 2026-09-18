import { describe, expect, it } from "vitest";
import { chunkRanges, estimateBlock, fetchRangeAdaptive, windowAround, type AttestedLog } from "./logs";
import { BLOCK_ANCHOR, REGISTRY_DEPLOY_BLOCK } from "../config";

describe("chunkRanges / block estimation", () => {
  it("tiles a range into <= 9000-block chunks without gaps", () => {
    const chunks = chunkRanges(100n, 20_000n);
    expect(chunks[0]).toEqual([100n, 9_099n]);
    expect(chunks[chunks.length - 1][1]).toBe(20_000n);
    for (let i = 1; i < chunks.length; i++) expect(chunks[i][0]).toBe(chunks[i - 1][1] + 1n);
    expect(chunkRanges(5n, 5n)).toEqual([[5n, 5n]]);
  });

  it("estimates blocks from timestamps at 2 s per block and clamps the window to the deploy block", () => {
    expect(estimateBlock(BLOCK_ANCHOR.timestamp)).toBe(BigInt(BLOCK_ANCHOR.block));
    expect(estimateBlock(BLOCK_ANCHOR.timestamp + 20)).toBe(BigInt(BLOCK_ANCHOR.block + 10));
    const w = windowAround(BLOCK_ANCHOR.timestamp - 100_000, BLOCK_ANCHOR.timestamp);
    expect(w.fromBlock).toBe(BigInt(REGISTRY_DEPLOY_BLOCK));
    expect(w.toBlock).toBe(BigInt(BLOCK_ANCHOR.block) + 2_500n);
  });
});

const mk = (block: bigint): AttestedLog => ({
  id: block,
  exporter: "0x0000000000000000000000000000000000000001",
  gridId: 1n,
  nullifier: 1n,
  season: 2026,
  commodityHash: "0x00",
  txHash: "0x00",
  blockNumber: block,
});

describe("fetchRangeAdaptive", () => {
  it("returns a single call's result when the node accepts the range", async () => {
    const calls: Array<[bigint, bigint]> = [];
    const out = await fetchRangeAdaptive(async (a, b) => { calls.push([a, b]); return [mk(a), mk(b)]; }, 100n, 200_000n);
    expect(calls).toEqual([[100n, 200_000n]]);
    expect(out.map((l) => l.blockNumber)).toEqual([100n, 200_000n]);
  });

  it("halves the range until the node accepts it and preserves order", async () => {
    const LIMIT = 10_000n;
    const calls: Array<[bigint, bigint]> = [];
    const hits = [5n, 25_000n, 40_001n, 79_999n];
    const out = await fetchRangeAdaptive(
      async (a, b) => {
        calls.push([a, b]);
        if (b - a > LIMIT) throw new Error("block range too large");
        return hits.filter((h) => h >= a && h <= b).map(mk);
      },
      0n,
      80_000n
    );
    expect(out.map((l) => l.blockNumber)).toEqual(hits);
    for (const [a, b] of calls.slice(1)) expect(b >= a).toBe(true);
    const accepted = calls.filter(([a, b]) => b - a <= LIMIT);
    expect(accepted.length).toBeGreaterThan(4);
    // accepted sub-ranges tile [0, 80000] without gaps or overlaps
    const sorted = accepted.sort((x, y) => (x[0] < y[0] ? -1 : 1));
    expect(sorted[0][0]).toBe(0n);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i][0]).toBe(sorted[i - 1][1] + 1n);
    expect(sorted[sorted.length - 1][1]).toBe(80_000n);
  });

  it("gives up on a genuine error once the range is small", async () => {
    await expect(fetchRangeAdaptive(async () => { throw new Error("boom"); }, 0n, 1_500n)).rejects.toThrow("boom");
  });
});
