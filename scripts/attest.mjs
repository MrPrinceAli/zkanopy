#!/usr/bin/env node
// Command-line twin of the /farmer page: prove a cell of the published grid and submit Registry.attest.
// Used to exercise the on-chain flow without a browser wallet and to seed demo attestations.
//
//   node scripts/attest.mjs --row 12 --col 34 [--season 2026] [--commodity cocoa|coffee|palm|rubber]
//                           [--key 0x<private key>] [--dry-run]
//
// Reads PRIVATE_KEY / RPC_URL from .env (override the key with --key), the grid from frontend/public/data/,
// the Registry address from frontend/src/config.ts and the proving artifacts from circuits/build/.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { BaseError, ContractFunctionRevertedError, createPublicClient, createWalletClient, decodeEventLog, http, keccak256, parseAbi, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import * as snarkjs from "snarkjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
require("dotenv").config({ path: path.join(ROOT, ".env"), quiet: true });
const { getPoseidon, makeHasher, buildTree, getPath } = require(path.join(ROOT, "packages", "merkle"));

const COMMODITIES = {
  cocoa: { hsCode: "1801", description: "Cocoa beans" },
  coffee: { hsCode: "0901", description: "Coffee" },
  palm: { hsCode: "1511", description: "Palm oil" },
  rubber: { hsCode: "4001", description: "Natural rubber" },
};

const ABI = parseAbi([
  "function attest(uint256[2] a, uint256[2][2] b, uint256[2] c, uint256[7] pubSignals, uint256 gridId, bytes32 commodityHash) returns (uint256 id)",
  "event Attested(uint256 indexed id, address indexed exporter, uint256 indexed gridId, uint256 nullifier, uint32 season, bytes32 commodityHash)",
  "error UnknownRootOrGrid()",
  "error ExporterMismatch()",
  "error InvalidProof()",
  "error NullifierAlreadyUsed()",
  "error SeasonOutOfRange()",
]);

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : dflt;
}

function revertName(e) {
  if (e instanceof BaseError) {
    const r = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (r?.data?.errorName) return r.data.errorName;
    return e.shortMessage;
  }
  return String(e?.message ?? e);
}

let poseidonTree = null;
async function loadTree(tree) {
  if (!poseidonTree) {
    const hash = makeHasher(await getPoseidon());
    poseidonTree = buildTree(tree.leaves, tree.depth, hash, BigInt(tree.zeroLeaf));
    if (poseidonTree.root.toString() !== tree.root) throw new Error("rebuilt root != tree.json root");
  }
  return poseidonTree;
}

export async function attestCell({ row, col, season = 2026, commodity = "cocoa", privateKey, dryRun = false, log = console.log }) {
  const tree = JSON.parse(fs.readFileSync(path.join(ROOT, "frontend", "public", "data", "tree.json"), "utf8"));
  const grid = JSON.parse(fs.readFileSync(path.join(ROOT, "frontend", "public", "data", "grid.json"), "utf8"));
  const cfg = fs.readFileSync(path.join(ROOT, "frontend", "src", "config.ts"), "utf8");
  const registry = cfg.match(/REGISTRY_ADDRESS\s*=\s*"(0x[0-9a-fA-F]{40})"/)[1];

  const index = row * tree.cols + col;
  if (row < 0 || row >= tree.rows || col < 0 || col >= tree.cols) throw new Error("cell outside the grid");
  const label = tree.labels[index];
  log(`cell (${row}, ${col}) index ${index}: ${label === "1" ? "clean" : "LOSS"}`);
  if (label !== "1") throw new Error("cell is labelled loss; no proof can exist");

  const account = privateKeyToAccount(privateKey);
  const built = await loadTree(tree);
  const { pathElements, pathIndices } = getPath(built, index);
  const input = {
    latS: String(tree.lat0S + row * tree.stepS + Math.floor(tree.stepS / 2)),
    lonS: String(tree.lon0S + col * tree.stepS + Math.floor(tree.stepS / 2)),
    row: String(row),
    col: String(col),
    pathElements: pathElements.map(String),
    pathIndices: pathIndices.map(String),
    root: tree.root,
    season: String(season),
    exporter: BigInt(account.address).toString(),
    lat0S: String(tree.lat0S),
    lon0S: String(tree.lon0S),
    stepS: String(tree.stepS),
  };

  const t0 = Date.now();
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    path.join(ROOT, "circuits", "build", "deforestation_free.wasm"),
    path.join(ROOT, "circuits", "build", "deforestation_free_final.zkey")
  );
  log(`proof in ${Date.now() - t0} ms; nullifier 0x${BigInt(publicSignals[0]).toString(16).padStart(64, "0")}`);

  const [pA, pB, pC, pub] = JSON.parse(`[${await snarkjs.groth16.exportSolidityCallData(proof, publicSignals)}]`);
  const big = (s) => BigInt(s);
  const c = COMMODITIES[commodity];
  const args = [
    [big(pA[0]), big(pA[1])],
    [[big(pB[0][0]), big(pB[0][1])], [big(pB[1][0]), big(pB[1][1])]],
    [big(pC[0]), big(pC[1])],
    pub.map(big),
    BigInt(grid.gridId),
    keccak256(toBytes(`${c.hsCode}:${c.description}`)),
  ];

  const transport = http(process.env.RPC_URL);
  const publicClient = createPublicClient({ chain: baseSepolia, transport });
  try {
    await publicClient.simulateContract({ address: registry, abi: ABI, functionName: "attest", args, account, gas: 600_000n });
  } catch (e) {
    const name = revertName(e);
    log(`simulation reverted: ${name}`);
    return { ok: false, error: name, nullifier: publicSignals[0] };
  }
  if (dryRun) {
    log("simulation OK (dry run, not sent)");
    return { ok: true, dryRun: true, nullifier: publicSignals[0] };
  }

  const wallet = createWalletClient({ account, chain: baseSepolia, transport });
  const hash = await wallet.writeContract({ address: registry, abi: ABI, functionName: "attest", args, gas: 600_000n });
  log(`tx ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  let id = null;
  for (const l of receipt.logs) {
    try {
      const ev = decodeEventLog({ abi: ABI, data: l.data, topics: l.topics });
      if (ev.eventName === "Attested") id = ev.args.id;
    } catch {}
  }
  log(`status ${receipt.status} block ${receipt.blockNumber} gas ${receipt.gasUsed} attestation id ${id}`);
  return { ok: receipt.status === "success", hash, id, nullifier: publicSignals[0], blockNumber: receipt.blockNumber };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const row = Number(arg("row"));
  const col = Number(arg("col"));
  if (!Number.isInteger(row) || !Number.isInteger(col)) {
    console.error("usage: node scripts/attest.mjs --row R --col C [--season Y] [--commodity cocoa] [--key 0x..] [--dry-run]");
    process.exit(2);
  }
  attestCell({
    row,
    col,
    season: Number(arg("season", 2026)),
    commodity: arg("commodity", "cocoa"),
    privateKey: arg("key", process.env.PRIVATE_KEY),
    dryRun: process.argv.includes("--dry-run"),
  }).then((r) => process.exit(r.ok ? 0 : 1), (e) => { console.error(e.message ?? e); process.exit(1); });
}
