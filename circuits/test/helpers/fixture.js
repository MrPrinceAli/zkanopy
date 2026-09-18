// Synthetic grid + Merkle tree used by the witness tests, scripts/gen_inputs.js and
// scripts/make_fixture.js, so every consumer sees exactly the same root and paths.
//
// Grid: 4 x 4 cells, origin 4.0N 96.0E (Aceh-ish), cell 900 fixed-point units (~100 m).
// Tree depth is the production value (16) so the tests exercise the real circuit.

const path = require("path");
const { getPoseidon, makeHasher, buildTree, getPath } = require(path.join(
  __dirname,
  "..",
  "..",
  "..",
  "packages",
  "merkle"
));

const GRID = {
  depth: 16,
  cols: 4,
  rows: 4,
  lat0S: 94_000_000, // (4.0 + 90) * 1e6
  lon0S: 276_000_000, // (96.0 + 180) * 1e6
  stepS: 900,
};

// LABELS[row][col]: 1 = clean, 0 = loss.
const LABELS = [
  [1, 1, 0, 1],
  [1, 0, 1, 1],
  [1, 1, 1, 0],
  [0, 1, 1, 1],
];

const CLEAN_CELL = { row: 0, col: 0 };
const LOSS_CELL = { row: 0, col: 2 };
const SEASON = 2026;
// Foundry/anvil default account #0, handy for the Phase 2 contract tests.
const EXPORTER_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const EXPORTER = BigInt(EXPORTER_ADDRESS);

async function buildFixture() {
  const poseidon = await getPoseidon();
  const hash = makeHasher(poseidon);
  const zeroLeaf = hash([0, 0, 0]);

  const leaves = new Array(GRID.rows * GRID.cols);
  for (let r = 0; r < GRID.rows; r++) {
    for (let c = 0; c < GRID.cols; c++) {
      leaves[r * GRID.cols + c] = hash([r, c, LABELS[r][c]]);
    }
  }
  const tree = buildTree(leaves, GRID.depth, hash, zeroLeaf);

  /**
   * Full circuit input for cell (row, col). Offsets place the coordinate inside the cell
   * (default: centre); pass explicit offsets to probe the boundaries.
   * All values are decimal strings so the object can be written to JSON as-is.
   */
  function inputFor(row, col, opts = {}) {
    const latOffset = opts.latOffset ?? Math.floor(GRID.stepS / 2);
    const lonOffset = opts.lonOffset ?? Math.floor(GRID.stepS / 2);
    const { pathElements, pathIndices } = getPath(tree, row * GRID.cols + col);
    return {
      latS: String(GRID.lat0S + row * GRID.stepS + latOffset),
      lonS: String(GRID.lon0S + col * GRID.stepS + lonOffset),
      row: String(row),
      col: String(col),
      pathElements: pathElements.map(String),
      pathIndices: pathIndices.map(String),
      root: tree.root.toString(),
      season: String(SEASON),
      exporter: EXPORTER.toString(),
      lat0S: String(GRID.lat0S),
      lon0S: String(GRID.lon0S),
      stepS: String(GRID.stepS),
    };
  }

  const nullifierFor = (row, col, season = SEASON) => hash([row, col, season]);

  return { grid: GRID, labels: LABELS, tree, hash, zeroLeaf, inputFor, nullifierFor };
}

module.exports = { GRID, LABELS, CLEAN_CELL, LOSS_CELL, SEASON, EXPORTER, EXPORTER_ADDRESS, buildFixture };
