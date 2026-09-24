// Integration test: every published tree (frontend/public/data/<region>/tree.json) and the Phase 1 circuit
// agree. Rebuilds each tree from its leaves, checks the root against tree.json / grid.json, then produces
// and verifies a real Groth16 proof for a clean cell. Skipped when data or build artifacts are absent.

const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const snarkjs = require("snarkjs");
const { getPoseidon, makeHasher, buildTree, getPath } = require("../../packages/merkle");

const ROOT = path.join(__dirname, "..", "..");
const DATA = path.join(ROOT, "frontend", "public", "data");
const WASM = path.join(ROOT, "circuits", "build", "deforestation_free.wasm");
const ZKEY = path.join(ROOT, "circuits", "build", "deforestation_free_final.zkey");
const VKEY = path.join(ROOT, "circuits", "build", "verification_key.json");

/** Every region that has a published tree, from the manifest when present. */
function publishedRegions() {
  const manifest = path.join(DATA, "regions.json");
  const slugs = fs.existsSync(manifest)
    ? JSON.parse(fs.readFileSync(manifest, "utf8")).regions.map((r) => r.slug)
    : fs.existsSync(DATA)
      ? fs.readdirSync(DATA, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
      : [];
  return slugs.filter((slug) => fs.existsSync(path.join(DATA, slug, "tree.json")));
}

for (const REGION of publishedRegions()) describe(`published tree.json x circuit — ${REGION}`, function () {
  const TREE = path.join(DATA, REGION, "tree.json");
  const GRID = path.join(DATA, REGION, "grid.json");
  let tree, hash, built;

  before(async function () {
    if (![WASM, ZKEY, VKEY].every(fs.existsSync)) {
      console.log("      (skipped: needs circuits/build.sh artifacts)");
      this.skip();
    }
    tree = JSON.parse(fs.readFileSync(TREE, "utf8"));
    hash = makeHasher(await getPoseidon());
    built = buildTree(tree.leaves, tree.depth, hash, BigInt(tree.zeroLeaf));
  });

  it("root recomputed from leaves matches tree.json (and grid.json when published)", function () {
    assert.equal(built.root.toString(), tree.root);
    assert.equal(tree.leaves.length, tree.rows * tree.cols);
    assert.equal(tree.labels.length, tree.rows * tree.cols);
    assert.equal(BigInt(tree.zeroLeaf), hash([0, 0, 0]));
    if (fs.existsSync(GRID)) {
      const grid = JSON.parse(fs.readFileSync(GRID, "utf8"));
      assert.equal(grid.root, tree.root);
      for (const k of ["lat0S", "lon0S", "stepS", "cols", "rows"]) assert.equal(grid[k], tree[k]);
    }
  });

  it("leaves encode the labels: Poseidon(row, col, label)", function () {
    const idx = [0, 12345, tree.leaves.length - 1];
    for (const i of idx) {
      const row = Math.floor(i / tree.cols);
      const col = i % tree.cols;
      assert.equal(BigInt(tree.leaves[i]), hash([row, col, Number(tree.labels[i])]));
    }
  });

  it("a clean cell proves and verifies; a loss cell cannot produce a witness", async function () {
    const clean = tree.labels.indexOf("1");
    const loss = tree.labels.indexOf("0");
    assert.ok(clean >= 0 && loss >= 0, "grid should contain both labels");

    const inputFor = (i) => {
      const row = Math.floor(i / tree.cols);
      const col = i % tree.cols;
      const { pathElements, pathIndices } = getPath(built, i);
      return {
        latS: String(tree.lat0S + row * tree.stepS + Math.floor(tree.stepS / 2)),
        lonS: String(tree.lon0S + col * tree.stepS + Math.floor(tree.stepS / 2)),
        row: String(row),
        col: String(col),
        pathElements: pathElements.map(String),
        pathIndices: pathIndices.map(String),
        root: tree.root,
        season: "2026",
        exporter: BigInt("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266").toString(),
        lat0S: String(tree.lat0S),
        lon0S: String(tree.lon0S),
        stepS: String(tree.stepS),
      };
    };

    const t0 = Date.now();
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(inputFor(clean), WASM, ZKEY);
    const vkey = JSON.parse(fs.readFileSync(VKEY, "utf8"));
    assert.equal(await snarkjs.groth16.verify(vkey, publicSignals, proof), true);
    assert.equal(publicSignals[1], tree.root);
    assert.deepEqual(publicSignals.slice(4), [String(tree.lat0S), String(tree.lon0S), String(tree.stepS)]);
    console.log(`      clean cell #${clean} proved in ${Date.now() - t0} ms`);

    await assert.rejects(snarkjs.groth16.fullProve(inputFor(loss), WASM, ZKEY), /Assert Failed/);
  });
});
