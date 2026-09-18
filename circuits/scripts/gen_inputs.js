// Writes example circuit inputs to circuits/test/inputs/ (decimal strings, ready for
// generate_witness.js / snarkjs). build.sh uses clean.json for its witness sanity check.

const fs = require("fs");
const path = require("path");
const { buildFixture, CLEAN_CELL, LOSS_CELL } = require("../test/helpers/fixture");

async function main() {
  const fx = await buildFixture();
  const dir = path.join(__dirname, "..", "test", "inputs");
  fs.mkdirSync(dir, { recursive: true });

  const clean = fx.inputFor(CLEAN_CELL.row, CLEAN_CELL.col);
  const loss = fx.inputFor(LOSS_CELL.row, LOSS_CELL.col);
  // Valid path for the cell one row up, but the coordinate still lies in CLEAN_CELL's row.
  const wrongRow = { ...fx.inputFor(CLEAN_CELL.row + 1, CLEAN_CELL.col), latS: clean.latS };

  for (const [name, input] of [
    ["clean.json", clean],
    ["loss.json", loss],
    ["wrong_row.json", wrongRow],
  ]) {
    fs.writeFileSync(path.join(dir, name), JSON.stringify(input, null, 2) + "\n");
    console.log(`wrote test/inputs/${name}`);
  }
  console.log(`root: ${fx.tree.root.toString()}`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
