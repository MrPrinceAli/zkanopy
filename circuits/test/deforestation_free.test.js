// Witness-level tests for circuits/deforestation_free.circom (PRD Phase 1 DoD):
// clean cell passes, loss cell fails, wrong row fails, plus cell-boundary and Merkle edge cases.
// The last block runs a real Groth16 prove/verify against the artifacts from circuits/build.sh
// and is skipped when they are absent.

const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const wasm_tester = require("circom_tester").wasm;
const snarkjs = require("snarkjs");
const { buildFixture, GRID, CLEAN_CELL, LOSS_CELL, SEASON, EXPORTER } = require("./helpers/fixture");

const CIRCUIT = path.join(__dirname, "..", "deforestation_free.circom");
const INCLUDE = path.join(__dirname, "..", "..", "node_modules");
const BUILD = path.join(__dirname, "..", "build");

// Public signal order the contract and frontend rely on (PRD 5.3, hard rule 12.1).
const PUBLIC_ORDER = ["nullifier", "root", "season", "exporter", "lat0S", "lon0S", "stepS"];

describe("DeforestationFree(16) witness", function () {
  let circuit;
  let fx;

  before(async function () {
    circuit = await wasm_tester(CIRCUIT, { include: [INCLUDE] });
    fx = await buildFixture();
  });

  const cleanInput = (opts) => fx.inputFor(CLEAN_CELL.row, CLEAN_CELL.col, opts);

  async function expectPass(input) {
    const w = await circuit.calculateWitness(input, true);
    await circuit.checkConstraints(w);
    return w;
  }

  async function expectFail(input) {
    await assert.rejects(circuit.calculateWitness(input, true), /Assert Failed/);
  }

  it("clean cell: witness passes and nullifier = Poseidon(row, col, season)", async function () {
    const w = await expectPass(cleanInput());
    assert.equal(w[1], fx.nullifierFor(CLEAN_CELL.row, CLEAN_CELL.col));
  });

  it("public signals are [nullifier, root, season, exporter, lat0S, lon0S, stepS]", async function () {
    const input = cleanInput();
    const w = await expectPass(input);
    const expected = {
      nullifier: fx.nullifierFor(CLEAN_CELL.row, CLEAN_CELL.col),
      root: fx.tree.root,
      season: BigInt(SEASON),
      exporter: EXPORTER,
      lat0S: BigInt(GRID.lat0S),
      lon0S: BigInt(GRID.lon0S),
      stepS: BigInt(GRID.stepS),
    };
    // witness = [1, outputs..., public inputs..., private inputs..., ...]
    assert.deepEqual(w.slice(1, 1 + PUBLIC_ORDER.length), PUBLIC_ORDER.map((k) => expected[k]));
  });

  it("nullifier changes with season", async function () {
    const w = await expectPass(fx.inputFor(CLEAN_CELL.row, CLEAN_CELL.col, {}));
    const w2 = await expectPass({ ...cleanInput(), season: String(SEASON + 1) });
    assert.notEqual(w[1], w2[1]);
    assert.equal(w2[1], fx.nullifierFor(CLEAN_CELL.row, CLEAN_CELL.col, SEASON + 1));
  });

  it("loss cell: no witness (leaf label is 0, circuit hashes 1)", async function () {
    assert.equal(fx.labels[LOSS_CELL.row][LOSS_CELL.col], 0);
    await expectFail(fx.inputFor(LOSS_CELL.row, LOSS_CELL.col));
  });

  it("wrong row: valid path for the neighbouring cell but coordinate outside it", async function () {
    const clean = cleanInput();
    const wrongRow = { ...fx.inputFor(CLEAN_CELL.row + 1, CLEAN_CELL.col), latS: clean.latS };
    assert.equal(fx.labels[CLEAN_CELL.row + 1][CLEAN_CELL.col], 1); // the other cell is itself clean
    await expectFail(wrongRow);
  });

  it("wrong col: same idea on the longitude axis", async function () {
    const clean = cleanInput();
    const wrongCol = { ...fx.inputFor(CLEAN_CELL.row, CLEAN_CELL.col + 1), lonS: clean.lonS };
    assert.equal(fx.labels[CLEAN_CELL.row][CLEAN_CELL.col + 1], 1);
    await expectFail(wrongCol);
  });

  it("cell bounds: lower edge inclusive, upper edge exclusive", async function () {
    await expectPass(cleanInput({ latOffset: 0, lonOffset: 0 }));
    await expectPass(cleanInput({ latOffset: GRID.stepS - 1, lonOffset: GRID.stepS - 1 }));
    await expectFail(cleanInput({ latOffset: GRID.stepS }));
    await expectFail(cleanInput({ lonOffset: GRID.stepS }));
  });

  it("coordinate below the grid origin fails", async function () {
    // row 0, latOffset -1 puts latS one unit below lat0S.
    await expectFail(cleanInput({ latOffset: -1 }));
  });

  it("wrong root fails", async function () {
    const input = cleanInput();
    await expectFail({ ...input, root: (BigInt(input.root) + 1n).toString() });
  });

  it("tampered path element fails", async function () {
    const input = cleanInput();
    const pathElements = [...input.pathElements];
    pathElements[3] = (BigInt(pathElements[3]) + 1n).toString();
    await expectFail({ ...input, pathElements });
  });

  it("non-binary pathIndices fails", async function () {
    const input = cleanInput();
    const pathIndices = [...input.pathIndices];
    pathIndices[0] = "2";
    await expectFail({ ...input, pathIndices });
  });

  it("claiming a clean cell with another clean cell's path fails", async function () {
    // (row 1, col 0) is clean; use its path but the coordinate, row and col of CLEAN_CELL.
    const other = fx.inputFor(CLEAN_CELL.row + 1, CLEAN_CELL.col);
    await expectFail({ ...cleanInput(), pathElements: other.pathElements, pathIndices: other.pathIndices });
  });
});

describe("Groth16 end-to-end (artifacts from circuits/build.sh)", function () {
  const wasm = path.join(BUILD, "deforestation_free.wasm");
  const zkey = path.join(BUILD, "deforestation_free_final.zkey");
  const vkeyPath = path.join(BUILD, "verification_key.json");

  before(function () {
    if (![wasm, zkey, vkeyPath].every(fs.existsSync)) {
      console.log("      (skipped: run `bash circuits/build.sh` first)");
      this.skip();
    }
  });

  it("fullProve + verify OK; publicSignals match the documented order", async function () {
    const fx = await buildFixture();
    const input = fx.inputFor(CLEAN_CELL.row, CLEAN_CELL.col);

    const t0 = Date.now();
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasm, zkey);
    const ms = Date.now() - t0;

    const vkey = JSON.parse(fs.readFileSync(vkeyPath, "utf8"));
    assert.equal(await snarkjs.groth16.verify(vkey, publicSignals, proof), true);
    assert.deepEqual(publicSignals, [
      fx.nullifierFor(CLEAN_CELL.row, CLEAN_CELL.col).toString(),
      input.root,
      input.season,
      input.exporter,
      input.lat0S,
      input.lon0S,
      input.stepS,
    ]);
    assert.ok(ms < 30_000, `proving took ${ms} ms (PRD limit 30 s)`);
    console.log(`      proving time: ${ms} ms`);
  });

  it("verification fails for a mismatched exporter", async function () {
    const fx = await buildFixture();
    const input = fx.inputFor(CLEAN_CELL.row, CLEAN_CELL.col);
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasm, zkey);
    const vkey = JSON.parse(fs.readFileSync(vkeyPath, "utf8"));
    const tampered = [...publicSignals];
    tampered[3] = (BigInt(tampered[3]) + 1n).toString();
    assert.equal(await snarkjs.groth16.verify(vkey, tampered, proof), false);
  });
});
