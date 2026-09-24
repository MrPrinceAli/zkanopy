// Client-side grid maths and Poseidon Merkle paths. Mirrors packages/merkle/index.js and the circuit:
//   leaf = Poseidon(row, col, label), node = Poseidon(left, right), zero leaf = Poseidon(0, 0, 0)
//   leafIndex = row * cols + col, pathIndices[i] = bit i of leafIndex (0 = left child)
//
// tree.json ships every leaf; checkpoint.json ships the 2^(depth-L) nodes of level L. A path therefore
// needs only the leaf's 2^L-leaf subtree plus the checkpoint layer (~2 * 2^L hashes for L = 8) instead of
// the whole 65 536-leaf tree, which keeps proof preparation under a second on a phone.

import { poseidon2, poseidon3 } from "poseidon-lite";

export const FIXED_POINT = 1_000_000;

export interface GridParams {
  lat0S: number;
  lon0S: number;
  stepS: number;
  cols: number;
  rows: number;
  depth: number;
}

export interface TreeFile extends GridParams {
  schema: string;
  name: string;
  version: number;
  root: string;
  zeroLeaf: string;
  labels: string; // row-major, '1' = clean, '0' = loss
  leaves: string[]; // decimal strings, index = row * cols + col
}

export interface CheckpointFile {
  schema: string;
  root: string;
  depth: number;
  level: number;
  nodes: string[];
}

export interface MerklePath {
  pathElements: bigint[];
  pathIndices: number[];
}

export const hash2 = (a: bigint, b: bigint): bigint => poseidon2([a, b]);
export const hash3 = (a: bigint, b: bigint, c: bigint): bigint => poseidon3([a, b, c]);

/** Fixed-point encoding used by the circuit: round((deg + offset) * 1e6). */
export const toFixed = (deg: number, offset: number): number => Math.round((deg + offset) * FIXED_POINT);

export interface CellHit {
  latS: number;
  lonS: number;
  row: number;
  col: number;
  index: number;
  inside: boolean;
}

/** The grid fields `cellOf` needs. The on-chain Grid struct has these but no `depth`, so it fits too. */
export type CellGrid = Pick<GridParams, "lat0S" | "lon0S" | "stepS" | "cols" | "rows">;

/** Which cell a WGS84 point falls into. `inside` is false when the point is outside the grid. */
export function cellOf(lat: number, lon: number, g: CellGrid): CellHit {
  const latS = toFixed(lat, 90);
  const lonS = toFixed(lon, 180);
  const row = Math.floor((latS - g.lat0S) / g.stepS);
  const col = Math.floor((lonS - g.lon0S) / g.stepS);
  const inside = row >= 0 && row < g.rows && col >= 0 && col < g.cols;
  return { latS, lonS, row, col, index: inside ? row * g.cols + col : -1, inside };
}

/** Degree bounds of the grid: [[south, west], [north, east]]. */
export function gridBounds(g: GridParams): [[number, number], [number, number]] {
  const south = g.lat0S / FIXED_POINT - 90;
  const west = g.lon0S / FIXED_POINT - 180;
  return [[south, west], [south + (g.rows * g.stepS) / FIXED_POINT, west + (g.cols * g.stepS) / FIXED_POINT]];
}

export const isClean = (tree: TreeFile, index: number): boolean => tree.labels[index] === "1";

/**
 * Nullifier of a cell in a season — `Poseidon(row, col, season)`, the same three inputs and order the
 * circuit uses (deforestation_free.circom step 4). An auditor standing on a plot can recompute this and
 * match it against the nullifier stored in an attestation, which is what `/field` does.
 */
export const nullifierOf = (row: number, col: number, season: number): bigint =>
  hash3(BigInt(row), BigInt(col), BigInt(season));

/** zero[i] = root of an empty subtree of height i. */
export function zeroNodes(zeroLeaf: bigint, depth: number): bigint[] {
  const z = [zeroLeaf];
  for (let i = 1; i <= depth; i++) z[i] = hash2(z[i - 1], z[i - 1]);
  return z;
}

function nextLayer(layer: bigint[], zeroLo: bigint, zeroHi: bigint): bigint[] {
  const next = new Array<bigint>(layer.length / 2);
  for (let j = 0; j < next.length; j++) {
    const l = layer[2 * j];
    const r = layer[2 * j + 1];
    next[j] = l === zeroLo && r === zeroLo ? zeroHi : hash2(l, r);
  }
  return next;
}

/** Root implied by a checkpoint layer; used to verify checkpoint.json against tree.json and the chain. */
export function checkpointRoot(cp: CheckpointFile, zeroLeaf: bigint): bigint {
  const zero = zeroNodes(zeroLeaf, cp.depth);
  let layer = cp.nodes.map(BigInt);
  for (let lvl = cp.level; lvl < cp.depth; lvl++) layer = nextLayer(layer, zero[lvl], zero[lvl + 1]);
  return layer[0];
}

/** Authentication path for `index`, computed from the leaves of its subtree plus the checkpoint layer. */
export function getPath(tree: TreeFile, cp: CheckpointFile, index: number): MerklePath {
  if (cp.depth !== tree.depth) throw new Error("checkpoint depth mismatch");
  if (index < 0 || index >= 1 << tree.depth) throw new Error("leaf index out of range");
  const zero = zeroNodes(BigInt(tree.zeroLeaf), tree.depth);
  const L = cp.level;
  const size = 1 << L;
  const base = (index >> L) << L;

  let layer = new Array<bigint>(size);
  for (let i = 0; i < size; i++) {
    const li = base + i;
    layer[i] = li < tree.leaves.length ? BigInt(tree.leaves[li]) : zero[0];
  }

  const pathElements: bigint[] = [];
  const pathIndices: number[] = [];
  let idx = index - base;
  for (let lvl = 0; lvl < L; lvl++) {
    pathElements.push(layer[idx ^ 1]);
    pathIndices.push(idx & 1);
    layer = nextLayer(layer, zero[lvl], zero[lvl + 1]);
    idx >>= 1;
  }
  if (layer[0] !== BigInt(cp.nodes[index >> L])) throw new Error("subtree does not match checkpoint");

  let upper = cp.nodes.map(BigInt);
  idx = index >> L;
  for (let lvl = L; lvl < tree.depth; lvl++) {
    pathElements.push(upper[idx ^ 1]);
    pathIndices.push(idx & 1);
    upper = nextLayer(upper, zero[lvl], zero[lvl + 1]);
    idx >>= 1;
  }
  return { pathElements, pathIndices };
}

/** Recomputes the root from a leaf and its path (what MerkleTreeChecker does inside the circuit). */
export function computeRoot(leaf: bigint, path: MerklePath): bigint {
  let node = leaf;
  for (let i = 0; i < path.pathElements.length; i++) {
    const sib = path.pathElements[i];
    node = path.pathIndices[i] === 0 ? hash2(node, sib) : hash2(sib, node);
  }
  return node;
}

/** Full tree from leaves (test helper / reference implementation, O(2^depth) hashes). */
export function buildTree(leaves: bigint[], depth: number, zeroLeaf: bigint): { layers: bigint[][]; root: bigint } {
  const zero = zeroNodes(zeroLeaf, depth);
  const size = 1 << depth;
  let layer = new Array<bigint>(size);
  for (let i = 0; i < size; i++) layer[i] = i < leaves.length ? leaves[i] : zero[0];
  const layers = [layer];
  for (let lvl = 0; lvl < depth; lvl++) {
    layer = nextLayer(layer, zero[lvl], zero[lvl + 1]);
    layers.push(layer);
  }
  return { layers, root: layer[0] };
}
