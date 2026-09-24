#!/usr/bin/env node
// Step 05 - publish the grid (Merkle root + parameters) to Registry.registerRoot on Base Sepolia (PRD 5.5).
//
// Reads oracle/out/<region>/root.json, the Registry address from frontend/src/config.ts, PRIVATE_KEY + RPC_URL from .env.
// If a RootRegistered event with the same root already exists the grid id is reused (no duplicate tx)
// unless --force is given. Writes frontend/public/data/<region>/grid.json, oracle/out/<region>/publish.json
// and refreshes frontend/public/data/regions.json, the manifest the app reads to list regions.
//
// Usage: node oracle/05_publish_root.js [--region <slug>] [--force] [--metadata-uri <uri>]

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { createPublicClient, createWalletClient, http, parseAbi, decodeEventLog } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const { baseSepolia } = require("viem/chains");

const { ROOT, regionSlugs, regionFromArgv, configPath, outDir, frontendData, DEFAULT_REGION } = require("./regions");
require("dotenv").config({ path: path.join(ROOT, ".env"), quiet: true });

const REGION = regionFromArgv();
const OUT_DIR = outDir(REGION);
const FRONTEND_DATA = frontendData(REGION);
const CONFIG_TS = path.join(ROOT, "frontend", "src", "config.ts");

const abi = parseAbi([
  "struct Grid { uint256 root; uint64 lat0S; uint64 lon0S; uint64 stepS; uint32 cols; uint32 rows; uint32 version; uint64 publishedAt; string metadataURI; }",
  "function registerRoot(Grid g) returns (uint256 gridId)",
  "function getGrid(uint256 gridId) view returns (Grid)",
  "function gridCount() view returns (uint256)",
  "function oracle() view returns (address)",
  "event RootRegistered(uint256 indexed gridId, uint256 indexed root, uint32 version, uint64 lat0S, uint64 lon0S, uint64 stepS, uint32 cols, uint32 rows, string metadataURI)",
]);

function readFrontendConfig() {
  const src = fs.readFileSync(CONFIG_TS, "utf8");
  const pick = (re, what) => {
    const m = src.match(re);
    if (!m) throw new Error(`cannot find ${what} in frontend/src/config.ts`);
    return m[1];
  };
  return {
    registry: pick(/REGISTRY_ADDRESS\s*=\s*"(0x[0-9a-fA-F]{40})"/, "REGISTRY_ADDRESS"),
    deployBlock: BigInt(pick(/REGISTRY_DEPLOY_BLOCK\s*=\s*(\d+)/, "REGISTRY_DEPLOY_BLOCK")),
    chainId: Number(pick(/CHAIN_ID\s*=\s*(\d+)/, "CHAIN_ID")),
  };
}

async function withRetry(fn, attempts, delayMs) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      console.log(`  read failed (${e.shortMessage || e.message}); retry ${i + 1}/${attempts} in ${delayMs} ms`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

function metadataUriFromArgs(argv) {
  const i = argv.indexOf("--metadata-uri");
  if (i !== -1 && argv[i + 1]) return argv[i + 1];
  const cfg = fs.readFileSync(configPath(REGION), "utf8");
  const m = cfg.match(/^metadata_uri:\s*"?([^"\n#]*)"?/m);
  if (m && m[1].trim()) return m[1].trim();
  const meta = fs.readFileSync(path.join(FRONTEND_DATA, "metadata.json"));
  return "sha256:" + crypto.createHash("sha256").update(meta).digest("hex");
}

/**
 * Has this root already been registered? The original version scanned `RootRegistered` logs from the
 * deploy block, which stopped working once the chain outgrew the public RPC's eth_getLogs range (now
 * 1 000 blocks, ~234 windows and counting). Grids are few and numbered from 1, so asking the contract
 * directly is both cheaper and immune to log-range limits.
 */
async function findGridByRoot(client, registry, root) {
  const count = await client.readContract({ address: registry, abi, functionName: "gridCount" });
  for (let id = count; id >= 1n; id--) {
    const g = await client.readContract({ address: registry, abi, functionName: "getGrid", args: [id] });
    if (g.root === root) return id;
  }
  return null;
}

/** Read a top-level scalar from a region's YAML. The configs only use plain `key: value` at the top level. */
function yamlScalar(text, key) {
  const m = text.match(new RegExp(`^${key}:[ \\t]*(.+)$`, "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : undefined;
}

/**
 * Rewrite frontend/public/data/regions.json from every region that has a published grid.json.
 * This is the only file the app needs to discover regions, so it is refreshed after each publish.
 */
function writeManifest() {
  const regions = [];
  for (const slug of regionSlugs()) {
    const gridPath = path.join(frontendData(slug), "grid.json");
    if (!fs.existsSync(gridPath)) continue; // configured but not published yet
    const g = JSON.parse(fs.readFileSync(gridPath, "utf8"));
    const cfg = fs.readFileSync(configPath(slug), "utf8");
    const south = g.lat0S / 1e6 - 90;
    const west = g.lon0S / 1e6 - 180;
    regions.push({
      slug,
      name: yamlScalar(cfg, "name") || slug,
      label: yamlScalar(cfg, "label") || slug,
      country: yamlScalar(cfg, "country") || "",
      commodity: yamlScalar(cfg, "commodity") || "",
      gridId: g.gridId,
      version: g.version,
      cells: g.rows * g.cols,
      bounds: [
        [south, west],
        [south + (g.rows * g.stepS) / 1e6, west + (g.cols * g.stepS) / 1e6],
      ],
    });
  }
  regions.sort((a, b) => a.country.localeCompare(b.country) || a.label.localeCompare(b.label));
  const manifest = { schema: "zkanopy-regions/v1", default: DEFAULT_REGION, generatedAt: new Date().toISOString(), regions };
  const out = path.join(ROOT, "frontend", "public", "data", "regions.json");
  fs.writeFileSync(out, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`wrote frontend/public/data/regions.json (${regions.length} region${regions.length === 1 ? "" : "s"})`);
}

async function main() {
  const force = process.argv.includes("--force");
  const { PRIVATE_KEY, RPC_URL } = process.env;
  if (!PRIVATE_KEY || !RPC_URL) throw new Error("PRIVATE_KEY and RPC_URL must be set in .env");

  const rootInfo = JSON.parse(fs.readFileSync(path.join(OUT_DIR, "root.json"), "utf8"));
  const { registry, deployBlock, chainId } = readFrontendConfig();
  if (chainId !== baseSepolia.id) throw new Error(`config.ts CHAIN_ID ${chainId} != Base Sepolia ${baseSepolia.id}`);

  const account = privateKeyToAccount(PRIVATE_KEY);
  const transport = http(RPC_URL);
  const publicClient = createPublicClient({ chain: baseSepolia, transport });
  const walletClient = createWalletClient({ account, chain: baseSepolia, transport });

  const oracle = await publicClient.readContract({ address: registry, abi, functionName: "oracle" });
  if (oracle.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error(`wallet ${account.address} is not the Registry oracle (${oracle})`);
  }

  const root = BigInt(rootInfo.root);
  const metadataURI = metadataUriFromArgs(process.argv);
  const grid = {
    root,
    lat0S: BigInt(rootInfo.lat0S),
    lon0S: BigInt(rootInfo.lon0S),
    stepS: BigInt(rootInfo.stepS),
    cols: rootInfo.cols,
    rows: rootInfo.rows,
    version: rootInfo.version,
    publishedAt: 0n,
    metadataURI,
  };
  console.log(`registry ${registry} | oracle ${account.address}`);
  console.log(`root ${rootInfo.rootHex} | ${rootInfo.cols}x${rootInfo.rows} cells | version ${grid.version}`);
  console.log(`metadataURI ${metadataURI}`);

  const existingId = await findGridByRoot(publicClient, registry, root);

  let gridId, txHash, blockNumber;
  if (existingId && !force) {
    gridId = existingId;
    // The tx hash is only recoverable from logs; keep whatever a previous run recorded rather than
    // scanning 234 windows for a link that the grid record already carries.
    const prev = fs.existsSync(path.join(OUT_DIR, "publish.json"))
      ? JSON.parse(fs.readFileSync(path.join(OUT_DIR, "publish.json"), "utf8"))
      : {};
    txHash = prev.txHash;
    blockNumber = prev.blockNumber ? BigInt(prev.blockNumber) : undefined;
    console.log(`root already registered as gridId ${gridId}; reuse (pass --force to register again)`);
  } else {
    const hash = await walletClient.writeContract({ address: registry, abi, functionName: "registerRoot", args: [grid] });
    console.log(`sent registerRoot tx ${hash}, waiting for receipt...`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`registerRoot reverted in tx ${hash}`);
    const log = receipt.logs
      .map((l) => { try { return decodeEventLog({ abi, data: l.data, topics: l.topics }); } catch { return null; } })
      .find((d) => d && d.eventName === "RootRegistered");
    gridId = log.args.gridId;
    txHash = hash;
    blockNumber = receipt.blockNumber;
    console.log(`registered gridId ${gridId} in block ${blockNumber} (gas ${receipt.gasUsed})`);
  }

  // Public RPCs are load-balanced; a node may lag a block or two behind the one that returned the receipt.
  const onchain = await withRetry(
    () => publicClient.readContract({ address: registry, abi, functionName: "getGrid", args: [gridId] }),
    8,
    3000
  );
  if (onchain.root !== root) throw new Error("on-chain root does not match root.json");

  const record = {
    chainId,
    registry,
    gridId: Number(gridId),
    version: onchain.version,
    root: rootInfo.root,
    rootHex: rootInfo.rootHex,
    lat0S: rootInfo.lat0S,
    lon0S: rootInfo.lon0S,
    stepS: rootInfo.stepS,
    cols: rootInfo.cols,
    rows: rootInfo.rows,
    metadataURI: onchain.metadataURI,
    publishedAt: Number(onchain.publishedAt),
    txHash,
    blockNumber: Number(blockNumber),
    treeSha256: rootInfo.treeSha256,
  };
  fs.mkdirSync(FRONTEND_DATA, { recursive: true });
  fs.writeFileSync(path.join(FRONTEND_DATA, "grid.json"), JSON.stringify(record, null, 2) + "\n");
  fs.writeFileSync(path.join(OUT_DIR, "publish.json"), JSON.stringify(record, null, 2) + "\n");
  console.log(`wrote frontend/public/data/${REGION}/grid.json and oracle/out/${REGION}/publish.json (gridId ${record.gridId})`);
  writeManifest();
}

main().then(() => process.exit(0), (e) => { console.error(e.shortMessage || e.message || e); process.exit(1); });
