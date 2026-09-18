// Tests for oracle/04_build_merkle.js: leaf/label layout and consistency with packages/merkle.

const assert = require("node:assert/strict");
const { parseCells, buildFromCells, checkpointFrom } = require("../04_build_merkle");
const { getPoseidon, makeHasher, getPath, computeRoot } = require("../../packages/merkle");

const GRID = { rows: 3, cols: 4, depth: 16 };

describe("04_build_merkle", function () {
  let hash;
  before(async function () {
    hash = makeHasher(await getPoseidon());
  });

  const cellsFor = (labels) => {
    const cells = [];
    labels.forEach((rowLabels, row) => rowLabels.forEach((l, col) => cells.push({ row, col, final_label: l })));
    return cells;
  };

  it("parses the numeric CSV written by 03_ai_qc.py", function () {
    const csv = "row,col,frac_loss,ndvi_2020,ndvi_2025,dndvi,hansen_label,ai_label,ai_prob,disagreement,final_label\n"
      + "0,0,0.000000,0.8,0.8,0.0,1,1,0.99,0,1\n0,1,0.111111,0.8,0.2,-0.6,0,0,0.01,0,0\n";
    assert.deepEqual(parseCells(csv), [
      { row: 0, col: 0, final_label: 1 },
      { row: 0, col: 1, final_label: 0 },
    ]);
    assert.throws(() => parseCells("row,col\n0,0\n"), /missing column final_label/);
  });

  it("builds leaves = Poseidon(row, col, label) in row-major order and a labels string", function () {
    const labels = [
      [1, 1, 0, 1],
      [0, 1, 1, 1],
      [1, 0, 1, 1],
    ];
    const built = buildFromCells(cellsFor(labels), GRID, hash);
    assert.equal(built.labels, "110101111011");
    assert.equal(built.cleanCount, 9);
    assert.equal(built.lossCount, 3);
    assert.equal(built.leaves.length, 12);
    assert.equal(built.leaves[1 * 4 + 2], hash([1, 2, 1]));
    assert.equal(built.leaves[2 * 4 + 1], hash([2, 1, 0]));
    assert.notEqual(built.leaves[2 * 4 + 1], hash([2, 1, 1])); // a loss leaf can never match the circuit's leaf
    assert.equal(built.zeroLeaf, hash([0, 0, 0]));
  });

  it("paths from the built tree verify against the root", function () {
    const built = buildFromCells(cellsFor([[1, 0, 1, 1], [1, 1, 1, 0], [0, 1, 1, 1]]), GRID, hash);
    for (const i of [0, 5, 11]) {
      const { pathElements, pathIndices } = getPath(built.tree, i);
      assert.equal(pathElements.length, 16);
      assert.equal(computeRoot(built.leaves[i], pathElements, pathIndices, hash), built.tree.root);
    }
    // an index beyond the grid is a zero leaf under the same root
    const { pathElements, pathIndices } = getPath(built.tree, 12);
    assert.equal(computeRoot(built.zeroLeaf, pathElements, pathIndices, hash), built.tree.root);
  });

  it("checkpoint layer hashes back up to the root", function () {
    const built = buildFromCells(cellsFor([[1, 0, 1, 1], [1, 1, 1, 0], [0, 1, 1, 1]]), GRID, hash);
    const cp = checkpointFrom(built.tree, 8);
    assert.equal(cp.level, 8);
    assert.equal(cp.nodes.length, 1 << (GRID.depth - 8));
    assert.equal(cp.root, built.tree.root.toString());
    let layer = cp.nodes.map(BigInt);
    for (let lvl = cp.level; lvl < GRID.depth; lvl++) {
      const next = [];
      for (let j = 0; j < layer.length; j += 2) next.push(hash([layer[j], layer[j + 1]]));
      layer = next;
    }
    assert.equal(layer[0], built.tree.root);
  });

  it("rejects incomplete, duplicate or out-of-grid cells", function () {
    const cells = cellsFor([[1, 1, 1, 1], [1, 1, 1, 1], [1, 1, 1, 1]]);
    assert.throws(() => buildFromCells(cells.slice(1), GRID, hash), /1 cells missing/);
    assert.throws(() => buildFromCells([...cells, cells[0]], GRID, hash), /duplicate cell/);
    assert.throws(() => buildFromCells([...cells.slice(1), { row: 3, col: 0, final_label: 1 }], GRID, hash), /out of grid/);
    assert.throws(() => buildFromCells([...cells.slice(1), { row: 0, col: 0, final_label: 2 }], GRID, hash), /bad final_label/);
  });
});
