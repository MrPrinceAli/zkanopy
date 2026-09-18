import { describe, expect, it } from "vitest";
import { buildDds, ddsFileName, DDS_STATEMENT } from "./dds";
import { commodityFromHash, type AttestationRecord, type GridRecordOnchain } from "./registry";
import { COMMODITIES, commodityHash } from "./contract";

const OPERATOR = "0x9584D49c674F685D6CD3463D9beBCfF3d8b68923" as const;
const CONTRACT = "0xd5569a4557E4CaE10464Ff868f6A3594014D852f" as const;
const cocoa = commodityHash(COMMODITIES[0]);
const coffee = commodityHash(COMMODITIES[1]);

const grid: GridRecordOnchain = {
  gridId: 1n,
  root: 0x09f5n,
  lat0S: 94_550_000n,
  lon0S: 276_750_000n,
  stepS: 900n,
  cols: 200,
  rows: 200,
  version: 1,
  publishedAt: 1_789_696_458,
  metadataURI: "sha256:abc",
};
const grids = new Map([[1n, grid]]);

const att = (id: number, ch: `0x${string}`, season = 2026, txHash?: `0x${string}`): AttestationRecord => ({
  id: BigInt(id),
  exporter: OPERATOR,
  gridId: 1n,
  nullifier: BigInt(1000 + id),
  season,
  commodityHash: ch,
  timestamp: 1_789_700_000 + id,
  txHash,
});

describe("buildDds", () => {
  it("follows the PRD 5.7 schema", () => {
    const [d] = buildDds(OPERATOR, [att(2, cocoa, 2026, "0xaa"), att(1, cocoa)], grids, {
      chainId: 84532,
      contract: CONTRACT,
      now: new Date("2026-10-20T10:00:00Z"),
    });
    expect(d).toEqual({
      schema: "zkanopy-dds/v1",
      operator: { address: OPERATOR, eori: "PLACEHOLDER" },
      commodity: { hsCode: "1801", description: "Cocoa beans" },
      season: 2026,
      attestations: [
        {
          id: 1,
          chainId: 84532,
          contract: CONTRACT,
          txHash: null,
          nullifier: "0x" + (1001).toString(16).padStart(64, "0"),
          grid: { id: 1, version: 1, root: "0x" + "09f5".padStart(64, "0"), metadataURI: "sha256:abc" },
          statement: DDS_STATEMENT,
        },
        {
          id: 2,
          chainId: 84532,
          contract: CONTRACT,
          txHash: "0xaa",
          nullifier: "0x" + (1002).toString(16).padStart(64, "0"),
          grid: { id: 1, version: 1, root: "0x" + "09f5".padStart(64, "0"), metadataURI: "sha256:abc" },
          statement: DDS_STATEMENT,
        },
      ],
      generatedAt: "2026-10-20T10:00:00.000Z",
    });
    expect(ddsFileName(d)).toBe("dds-1801-2026-9584d4.json");
  });

  it("splits mixed selections into one document per commodity and season", () => {
    const docs = buildDds(OPERATOR, [att(1, cocoa), att(2, coffee), att(3, cocoa, 2027), att(4, cocoa)], grids, {
      chainId: 84532,
      contract: CONTRACT,
    });
    expect(docs).toHaveLength(3);
    const summary = docs.map((d) => `${d.commodity.hsCode}/${d.season}:${d.attestations.map((a) => a.id).join(",")}`);
    expect(summary.sort()).toEqual(["0901/2026:2", "1801/2026:1,4", "1801/2027:3"]);
  });

  it("names unknown commodity hashes instead of guessing", () => {
    const c = commodityFromHash("0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef");
    expect(c.hsCode).toBe("?");
    expect(c.description).toMatch(/^unknown \(0x12345678/);
    expect(commodityFromHash(coffee)).toMatchObject({ hsCode: "0901", description: "Coffee" });
  });
});
