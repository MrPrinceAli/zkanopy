// Region paths shared by the Node oracle steps (Phase 7). Mirrors oracle/regions.py.
//
// One region = one file in oracle/regions/<slug>.yaml = one grid = one Merkle root. Every step takes
// --region <slug> and reads/writes under a folder of that name, so publishing a second AOI never
// touches the first one's data.

const fs = require("fs");
const path = require("path");

const HERE = __dirname;
const ROOT = path.join(HERE, "..");
const REGIONS_DIR = path.join(HERE, "regions");
const DEFAULT_REGION = "gayo-aceh";

const regionSlugs = () =>
  fs
    .readdirSync(REGIONS_DIR)
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => f.replace(/\.yaml$/, ""))
    .sort();

/** `--region <slug>`, defaulting to the Aceh grid that is already published. */
function regionFromArgv(argv = process.argv) {
  const i = argv.indexOf("--region");
  const slug = i !== -1 && argv[i + 1] ? argv[i + 1] : DEFAULT_REGION;
  if (!fs.existsSync(path.join(REGIONS_DIR, `${slug}.yaml`))) {
    throw new Error(`unknown region '${slug}'; available: ${regionSlugs().join(", ") || "(none)"}`);
  }
  return slug;
}

const configPath = (slug) => path.join(REGIONS_DIR, `${slug}.yaml`);
const outDir = (slug) => path.join(HERE, "out", slug);
const frontendData = (slug) => path.join(ROOT, "frontend", "public", "data", slug);

module.exports = { ROOT, REGIONS_DIR, DEFAULT_REGION, regionSlugs, regionFromArgv, configPath, outDir, frontendData };
