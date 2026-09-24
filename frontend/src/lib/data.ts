// Loads a region's published grid data from public/data/<slug>/ once and keeps it in memory
// (PRD 5.6: load once, cache). One entry per region, so switching regions never refetches the first one.
import type { CheckpointFile, TreeFile } from "./merkle";
import { FALLBACK_REGION } from "./regions";

export interface GridRecord {
  chainId: number;
  registry: `0x${string}`;
  gridId: number;
  version: number;
  root: string;
  rootHex: `0x${string}`;
  lat0S: number;
  lon0S: number;
  stepS: number;
  cols: number;
  rows: number;
  metadataURI: string;
  publishedAt: number;
  txHash: `0x${string}`;
  blockNumber: number;
  treeSha256: string;
}

export interface GridData {
  tree: TreeFile;
  checkpoint: CheckpointFile;
  record: GridRecord;
}

const cache = new Map<string, Promise<GridData>>();

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export function loadGridData(slug: string = FALLBACK_REGION): Promise<GridData> {
  const hit = cache.get(slug);
  if (hit) return hit;
  const p = Promise.all([
    fetchJson<TreeFile>(`/data/${slug}/tree.json`),
    fetchJson<CheckpointFile>(`/data/${slug}/checkpoint.json`),
    fetchJson<GridRecord>(`/data/${slug}/grid.json`),
  ])
    .then(([tree, checkpoint, record]) => {
      if (tree.root !== record.root) throw new Error(`${slug}: tree.json root differs from grid.json`);
      if (tree.leaves.length !== tree.rows * tree.cols) throw new Error(`${slug}: tree.json has an unexpected leaf count`);
      return { tree, checkpoint, record };
    })
    .catch((e) => {
      cache.delete(slug);
      throw e;
    });
  cache.set(slug, p);
  return p;
}
