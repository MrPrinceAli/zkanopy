#!/usr/bin/env node
// Step 04 - build the Poseidon Merkle tree from cells_final.csv (PRD 5.5).
//
//   leaf[row*cols+col] = Poseidon(row, col, final_label); empty leaves = Poseidon(0, 0, 0)
//
// Outputs:
//   frontend/public/data/tree.json        { depth, cols, rows, lat0S, lon0S, stepS, root, zeroLeaf, labels, leaves }
//   frontend/public/data/checkpoint.json  one tree layer (level 8) so the client can build paths cheaply
//   frontend/public/data/metadata.json    provenance: datasets, AI metrics, sha256(tree.json) -> referenced on-chain
//   oracle/out/root.json                  root + grid parameters + hashes, consumed by 05_publish_root.js
//
// Usage: node oracle/04_build_merkle.js [--checkpoint-only]
//   --checkpoint-only  rebuild only checkpoint.json from the published tree.json (tree.json / metadata.json untouched,
//                      so the on-chain metadataURI hash stays valid)

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { getPoseidon, makeHasher, buildTree } = require("../packages/merkle");

const ROOT = path.join(__dirname, "..");
const OUT_DIR = path.join(__dirname, "out");
const FRONTEND_DATA = path.join(ROOT, "frontend", "public", "data");

/** Minimal CSV reader for the unquoted numeric CSVs produced by the Python steps. */
function parseCells(csvText) {
  const lines = csvText.trim().split(/\r?\n/);
  const header = lines[0].split(",");
  const need = ["row", "col", "final_label"];
  for (const k of need) if (!header.includes(k)) throw new Error(`cells_final.csv is missing column ${k}`);
  const ix = Object.fromEntries(need.map((k) => [k, header.indexOf(k)]));
  return lines.slice(1).map((line) => {
    const f = line.split(",");
    return { row: Number(f[ix.row]), col: Number(f[ix.col]), final_label: Number(f[ix.final_label]) };
  });
}

/** Leaves, labels string and tree for a labelled cell list. */
function buildFromCells(cells, grid, hash) {
  const { rows, cols, depth } = grid;
  const n = rows * cols;
  const labels = new Array(n).fill(null);
  const leaves = new Array(n);
  for (const c of cells) {
    if (c.row < 0 || c.row >= rows || c.col < 0 || c.col >= cols) throw new Error(`cell out of grid: ${c.row},${c.col}`);
    if (c.final_label !== 0 && c.final_label !== 1) throw new Error(`bad final_label for ${c.row},${c.col}`);
    const i = c.row * cols + c.col;
    if (labels[i] !== null) throw new Error(`duplicate cell ${c.row},${c.col}`);
    labels[i] = c.final_label;
    leaves[i] = hash([c.row, c.col, c.final_label]);
  }
  const missing = labels.filter((l) => l === null).length;
  if (missing) throw new Error(`${missing} cells missing from cells_final.csv`);

  const zeroLeaf = hash([0, 0, 0]);
  const tree = buildTree(leaves, depth, hash, zeroLeaf);
  const cleanCount = labels.filter((l) => l === 1).length;
  return { tree, leaves, zeroLeaf, labels: labels.join(""), cleanCount, lossCount: n - cleanCount };
}

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const toHex32 = (x) => "0x" + BigInt(x).toString(16).padStart(64, "0");

// Level of the tree shipped as checkpoint.json: 2^(depth-L) nodes. With L = 8 the client hashes
// 2^8 leaves + 2^8 checkpoint nodes (~500 Poseidon calls) per path instead of the whole tree.
const CHECKPOINT_LEVEL = 8;

/** checkpoint.json content: one full layer of the tree, verifiable against the root by hashing upwards. */
function checkpointFrom(tree, level = CHECKPOINT_LEVEL) {
  return {
    schema: "zkanopy-checkpoint/v1",
    root: tree.root.toString(),
    depth: tree.depth,
    level,
    nodes: tree.layers[level].map(String),
  };
}

/** labels.json: the 40 KB label string + grid parameters, for pages that only need to draw the grid. */
function labelsFrom(treeJson) {
  const { name, version, rows, cols, lat0S, lon0S, stepS, labels } = treeJson;
  return { schema: "zkanopy-labels/v1", name, version, rows, cols, lat0S, lon0S, stepS, labels };
}

/** --checkpoint-only: derive checkpoint.json (and labels.json) from the published tree.json without touching it. */
async function checkpointOnly() {
  const treeJson = JSON.parse(fs.readFileSync(path.join(FRONTEND_DATA, "tree.json"), "utf8"));
  const hash = makeHasher(await getPoseidon());
  const tree = buildTree(treeJson.leaves, treeJson.depth, hash, BigInt(treeJson.zeroLeaf));
  if (tree.root.toString() !== treeJson.root) throw new Error("rebuilt root does not match tree.json");
  const cp = checkpointFrom(tree);
  fs.writeFileSync(path.join(FRONTEND_DATA, "checkpoint.json"), JSON.stringify(cp) + "\n");
  fs.writeFileSync(path.join(FRONTEND_DATA, "labels.json"), JSON.stringify(labelsFrom(treeJson)) + "\n");
  console.log(`wrote frontend/public/data/checkpoint.json (level ${cp.level}, ${cp.nodes.length} nodes) and labels.json for root ${cp.root}`);
}

async function main() {
  if (process.argv.includes("--checkpoint-only")) return checkpointOnly();
  const grid = JSON.parse(fs.readFileSync(path.join(OUT_DIR, "grid.json"), "utf8"));
  const cells = parseCells(fs.readFileSync(path.join(OUT_DIR, "cells_final.csv"), "utf8"));
  const aiPath = path.join(OUT_DIR, "ai_summary.json");
  const ai = fs.existsSync(aiPath) ? JSON.parse(fs.readFileSync(aiPath, "utf8")) : null;

  const hash = makeHasher(await getPoseidon());
  const t0 = Date.now();
  const built = buildFromCells(cells, grid, hash);
  const generatedAt = new Date().toISOString();

  const treeJson = {
    schema: "zkanopy-tree/v1",
    name: grid.name,
    version: grid.version,
    generatedAt,
    depth: grid.depth,
    cols: grid.cols,
    rows: grid.rows,
    lat0S: grid.lat0S,
    lon0S: grid.lon0S,
    stepS: grid.stepS,
    root: built.tree.root.toString(),
    zeroLeaf: built.zeroLeaf.toString(),
    labels: built.labels, // row-major, '1' = clean, '0' = loss
    leaves: built.leaves.map(String), // index = row*cols + col; leaves beyond rows*cols are zeroLeaf
  };
  fs.mkdirSync(FRONTEND_DATA, { recursive: true });
  const treeBuf = Buffer.from(JSON.stringify(treeJson));
  fs.writeFileSync(path.join(FRONTEND_DATA, "tree.json"), treeBuf);
  const treeSha = sha256(treeBuf);
  fs.writeFileSync(path.join(FRONTEND_DATA, "checkpoint.json"), JSON.stringify(checkpointFrom(built.tree)) + "\n");
  fs.writeFileSync(path.join(FRONTEND_DATA, "labels.json"), JSON.stringify(labelsFrom(treeJson)) + "\n");

  const metadata = {
    schema: "zkanopy-grid-metadata/v1",
    name: grid.name,
    description: grid.description,
    version: grid.version,
    generatedAt,
    aoi: grid.aoi,
    grid: { lat0S: grid.lat0S, lon0S: grid.lon0S, stepS: grid.stepS, cols: grid.cols, rows: grid.rows, depth: grid.depth },
    sources: { ...grid.sources, years: grid.years },
    labeling: {
      hansen: "hansen_label = 0 if any pixel in the cell has lossyear within sources.loss_years, else 1",
      ai: ai ? { model: ai.model, features: ai.features, metrics: ai.metrics ?? null, disagreement: ai.disagreement } : null,
      final: "final_label = 1 iff hansen_label == 1 and ai_label == 1",
      leaf: "Poseidon(row, col, final_label); zero leaf Poseidon(0, 0, 0)",
    },
    tree: {
      file: "data/tree.json",
      sha256: treeSha,
      root: treeJson.root,
      rootHex: toHex32(treeJson.root),
      cells: grid.rows * grid.cols,
      clean: built.cleanCount,
      loss: built.lossCount,
    },
  };
  const metaBuf = Buffer.from(JSON.stringify(metadata, null, 2) + "\n");
  fs.writeFileSync(path.join(FRONTEND_DATA, "metadata.json"), metaBuf);

  const rootJson = {
    ...metadata.grid,
    name: grid.name,
    version: grid.version,
    root: treeJson.root,
    rootHex: metadata.tree.rootHex,
    clean: built.cleanCount,
    loss: built.lossCount,
    treeSha256: treeSha,
    metadataSha256: sha256(metaBuf),
    generatedAt,
  };
  fs.writeFileSync(path.join(OUT_DIR, "root.json"), JSON.stringify(rootJson, null, 2) + "\n");

  console.log(`cells ${grid.rows * grid.cols}: clean ${built.cleanCount}, loss ${built.lossCount}`);
  console.log(`root ${treeJson.root}`);
  console.log(`tree.json ${(treeBuf.length / 1e6).toFixed(2)} MB, sha256 ${treeSha}`);
  console.log(`built in ${((Date.now() - t0) / 1000).toFixed(1)} s -> frontend/public/data/{tree,checkpoint,metadata}.json, oracle/out/root.json`);
}

module.exports = { parseCells, buildFromCells, checkpointFrom, CHECKPOINT_LEVEL };

if (require.main === module) {
  main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
}
