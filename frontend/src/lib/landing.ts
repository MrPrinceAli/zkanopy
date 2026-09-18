// Data the landing page shows: the label grid, grid metadata (AI metrics), and live chain figures.
import type { Address, Hex } from "viem";
import { REGISTRY_ABI, type ReadClient } from "./contract";
import { REGISTRY_ADDRESS } from "../config";
import { getAttestedLogs, windowAround } from "./logs";

export interface LabelsFile {
  schema: string;
  name: string;
  version: number;
  rows: number;
  cols: number;
  lat0S: number;
  lon0S: number;
  stepS: number;
  labels: string;
}

export interface GridMetadata {
  name: string;
  version: number;
  generatedAt: string;
  tree: { root: string; rootHex: string; cells: number; clean: number; loss: number; sha256: string };
  labeling: {
    ai: {
      metrics: { accuracy: number; f1_loss: number; f1_clean: number; f1_macro: number; precision_loss: number; recall_loss: number } | null;
      disagreement: { total: number; hansen_clean_ai_loss: number; hansen_loss_ai_clean: number };
    } | null;
  };
}

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return (await r.json()) as T;
}

export const loadLabels = () => fetchJson<LabelsFile>("/data/labels.json");
export const loadMetadata = () => fetchJson<GridMetadata>("/data/metadata.json");

export interface FeedItem {
  id: bigint;
  exporter: Address;
  season: number;
  commodityHash: Hex;
  timestamp: number | null;
  txHash?: Hex;
}

export interface ChainStats {
  attestations: number;
  latest: FeedItem[];
}

/** Total attestation count plus the most recent ones: ids from the counter, data from the contract,
 *  tx hashes from one narrow log window (best effort). */
export async function loadChainStats(client: ReadClient, latestN = 6): Promise<ChainStats> {
  const count = Number(
    await client.readContract({ address: REGISTRY_ADDRESS, abi: REGISTRY_ABI, functionName: "attestationCount" })
  );
  const ids = Array.from({ length: Math.min(latestN, count) }, (_, i) => BigInt(count - i));
  if (ids.length === 0) return { attestations: count, latest: [] };

  const structs = await client.multicall({
    contracts: ids.map((id) => ({ address: REGISTRY_ADDRESS, abi: REGISTRY_ABI, functionName: "getAttestation" as const, args: [id] as const })),
    allowFailure: false,
  });
  const latest: FeedItem[] = structs.map((a) => ({
    id: a.id,
    exporter: a.exporter,
    season: a.season,
    commodityHash: a.commodityHash,
    timestamp: Number(a.timestamp),
  }));
  try {
    const ts = latest.map((a) => a.timestamp as number);
    const logs = await getAttestedLogs(client, windowAround(Math.min(...ts), Math.max(...ts)));
    const byId = new Map(logs.map((l) => [l.id, l.txHash]));
    for (const a of latest) a.txHash = byId.get(a.id);
  } catch {
    /* links are optional */
  }
  return { attestations: count, latest };
}

type TimeKey = "time.s" | "time.m" | "time.h" | "time.d";

/** Relative time through the translator: t("time.m", { n }). */
export function relativeTime(unix: number | null, t: (k: TimeKey, vars: { n: number }) => string, now = Date.now()): string {
  if (unix === null) return "";
  const s = Math.max(0, Math.round(now / 1000 - unix));
  if (s < 60) return t("time.s", { n: s });
  if (s < 3600) return t("time.m", { n: Math.round(s / 60) });
  if (s < 86400) return t("time.h", { n: Math.round(s / 3600) });
  return t("time.d", { n: Math.round(s / 86400) });
}

/** 40000 -> "40 000" (thin spaces, no locale surprises). */
export const fmt = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
