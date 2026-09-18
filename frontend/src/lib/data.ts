// Loads the published grid data from public/data/ once and keeps it in memory (PRD 5.6: load once, cache).
import type { CheckpointFile, TreeFile } from "./merkle";

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

let cache: Promise<GridData> | null = null;

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export function loadGridData(): Promise<GridData> {
  if (!cache) {
    cache = Promise.all([
      fetchJson<TreeFile>("/data/tree.json"),
      fetchJson<CheckpointFile>("/data/checkpoint.json"),
      fetchJson<GridRecord>("/data/grid.json"),
    ])
      .then(([tree, checkpoint, record]) => {
        if (tree.root !== record.root) throw new Error("tree.json root differs from grid.json");
        if (tree.leaves.length !== tree.rows * tree.cols) throw new Error("tree.json has an unexpected leaf count");
        return { tree, checkpoint, record };
      })
      .catch((e) => {
        cache = null;
        throw e;
      });
  }
  return cache;
}
