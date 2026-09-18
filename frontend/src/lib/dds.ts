// Due Diligence Statement export (PRD 5.7): one document per (commodity, season) for an operator.
// This is a conceptual mapping onto the EUDR/TRACES DDS fields, not the official format.
import type { Address, Hex } from "viem";
import { commodityFromHash, toHex32, type AttestationRecord, type GridRecordOnchain } from "./registry";

export const DDS_SCHEMA = "zkanopy-dds/v1";
export const DDS_STATEMENT =
  "Plot verified deforestation-free after 2020-12-31 via zero-knowledge proof; coordinates withheld by design.";

export interface DdsDocument {
  schema: typeof DDS_SCHEMA;
  operator: { address: Address; eori: string };
  commodity: { hsCode: string; description: string };
  season: number;
  attestations: Array<{
    id: number;
    chainId: number;
    contract: Address;
    txHash: Hex | null;
    nullifier: Hex;
    grid: { id: number; version: number; root: Hex; metadataURI: string };
    statement: string;
  }>;
  generatedAt: string;
}

export interface DdsOptions {
  chainId: number;
  contract: Address;
  eori?: string;
  now?: Date;
}

/** Groups the attestations by (commodity, season) and builds one DDS per group, in a stable order. */
export function buildDds(
  operator: Address,
  atts: AttestationRecord[],
  grids: Map<bigint, GridRecordOnchain>,
  opts: DdsOptions
): DdsDocument[] {
  const groups = new Map<string, AttestationRecord[]>();
  for (const a of atts) {
    const key = `${a.commodityHash.toLowerCase()}|${a.season}`;
    groups.set(key, [...(groups.get(key) ?? []), a]);
  }
  const generatedAt = (opts.now ?? new Date()).toISOString();

  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([, items]) => {
      const c = commodityFromHash(items[0].commodityHash);
      return {
        schema: DDS_SCHEMA,
        operator: { address: operator, eori: opts.eori ?? "PLACEHOLDER" },
        commodity: { hsCode: c.hsCode, description: c.description },
        season: items[0].season,
        attestations: items
          .slice()
          .sort((x, y) => (x.id < y.id ? -1 : 1))
          .map((a) => {
            const g = grids.get(a.gridId);
            if (!g) throw new Error(`grid ${a.gridId} not loaded`);
            return {
              id: Number(a.id),
              chainId: opts.chainId,
              contract: opts.contract,
              txHash: a.txHash ?? null,
              nullifier: toHex32(a.nullifier),
              grid: { id: Number(a.gridId), version: g.version, root: toHex32(g.root), metadataURI: g.metadataURI },
              statement: DDS_STATEMENT,
            };
          }),
        generatedAt,
      };
    });
}

export const ddsFileName = (d: DdsDocument) =>
  `dds-${d.commodity.hsCode}-${d.season}-${d.operator.address.slice(2, 8).toLowerCase()}.json`;
