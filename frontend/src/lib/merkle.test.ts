// Unit tests for the client-side Merkle/grid helpers. They also pin poseidon-lite to circomlib's Poseidon by
// recomputing the published root from the real checkpoint.json / tree.json produced by circomlibjs.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildTree,
  cellOf,
  checkpointRoot,
  computeRoot,
  getPath,
  gridBounds,
  hash3,
  toFixed,
  type CheckpointFile,
  type TreeFile,
} from "./merkle";

const readJson = <T>(rel: string): T => JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8")) as T;
const tree = readJson<TreeFile>("../../public/data/gayo-aceh/tree.json");
const checkpoint = readJson<CheckpointFile>("../../public/data/gayo-aceh/checkpoint.json");

describe("poseidon-lite matches the circomlibjs-built data", () => {
  it("zero leaf = Poseidon(0,0,0) and leaves = Poseidon(row, col, label)", () => {
    expect(hash3(0n, 0n, 0n).toString()).toBe(tree.zeroLeaf);
    for (const i of [0, 777, 20_000, tree.leaves.length - 1]) {
      const row = Math.floor(i / tree.cols);
      const col = i % tree.cols;
      expect(hash3(BigInt(row), BigInt(col), BigInt(tree.labels[i])).toString()).toBe(tree.leaves[i]);
    }
  });

  it("checkpoint layer hashes up to the published root", () => {
    expect(checkpoint.root).toBe(tree.root);
    expect(checkpoint.nodes.length).toBe(1 << (tree.depth - checkpoint.level));
    expect(checkpointRoot(checkpoint, BigInt(tree.zeroLeaf)).toString()).toBe(tree.root);
  });

  it("paths from the real tree verify against the root", () => {
    const clean = tree.labels.indexOf("1");
    const last = tree.leaves.length - 1;
    const beyond = tree.leaves.length + 5; // zero leaf region
    for (const i of [clean, 12_345, last]) {
      const path = getPath(tree, checkpoint, i);
      expect(path.pathElements).toHaveLength(tree.depth);
      expect(computeRoot(BigInt(tree.leaves[i]), path).toString()).toBe(tree.root);
    }
    expect(computeRoot(BigInt(tree.zeroLeaf), getPath(tree, checkpoint, beyond)).toString()).toBe(tree.root);
  });
});

describe("getPath with a checkpoint equals the full-tree path", () => {
  it("small random tree, every leaf", () => {
    const depth = 6;
    const level = 2;
    const zeroLeaf = hash3(0n, 0n, 0n);
    const n = 41; // partially filled: exercises the zero-leaf padding
    const leaves = Array.from({ length: n }, (_, i) => hash3(BigInt(i % 5), BigInt(Math.floor(i / 5)), BigInt(i % 2)));
    const full = buildTree(leaves, depth, zeroLeaf);
    const smallTree: TreeFile = {
      schema: "test",
      name: "t",
      version: 1,
      depth,
      cols: 5,
      rows: 9,
      lat0S: 0,
      lon0S: 0,
      stepS: 1,
      root: full.root.toString(),
      zeroLeaf: zeroLeaf.toString(),
      labels: leaves.map((_, i) => String(i % 2)).join(""),
      leaves: leaves.map(String),
    };
    const cp: CheckpointFile = { schema: "test", root: full.root.toString(), depth, level, nodes: full.layers[level].map(String) };

    for (let i = 0; i < 1 << depth; i++) {
      const path = getPath(smallTree, cp, i);
      // reference path straight from the full layers
      let idx = i;
      for (let lvl = 0; lvl < depth; lvl++) {
        expect(path.pathElements[lvl]).toBe(full.layers[lvl][idx ^ 1]);
        expect(path.pathIndices[lvl]).toBe(idx & 1);
        idx >>= 1;
      }
      const leaf = i < n ? leaves[i] : zeroLeaf;
      expect(computeRoot(leaf, path)).toBe(full.root);
    }
  });
});

describe("grid maths", () => {
  const g = { lat0S: 94_550_000, lon0S: 276_750_000, stepS: 900, cols: 200, rows: 200, depth: 16 };

  it("fixed point encoding", () => {
    expect(toFixed(4.55, 90)).toBe(94_550_000);
    expect(toFixed(96.75, 180)).toBe(276_750_000);
    expect(toFixed(-3.123456, 90)).toBe(86_876_544);
  });

  it("origin, interior, edges and outside", () => {
    expect(cellOf(4.55, 96.75, g)).toMatchObject({ row: 0, col: 0, index: 0, inside: true });
    expect(cellOf(4.55 + 0.0009 * 10 + 0.0004, 96.75 + 0.0009 * 3 + 0.0001, g)).toMatchObject({ row: 10, col: 3, inside: true });
    // exactly on the upper edge of cell 0 belongs to cell 1 (upper bound is exclusive)
    expect(cellOf(4.55 + 0.0009, 96.75, g)).toMatchObject({ row: 1, col: 0 });
    expect(cellOf(4.5499, 96.75, g).inside).toBe(false);
    expect(cellOf(4.55 + 0.18, 96.75, g).inside).toBe(false); // north edge is exclusive
    expect(cellOf(4.6, 96.93, g).inside).toBe(false); // east edge is exclusive
  });

  it("bounds reproduce the AOI", () => {
    const [[s, w], [n, e]] = gridBounds(g);
    expect(s).toBeCloseTo(4.55, 9);
    expect(w).toBeCloseTo(96.75, 9);
    expect(n).toBeCloseTo(4.73, 9);
    expect(e).toBeCloseTo(96.93, 9);
  });
});
