#!/usr/bin/env node
// Seeds demo attestations for the /regulator anomaly monitor (PRD 5.6 /regulator #3):
//   - a "rogue" wallet that fires many attestations back-to-back,
//   - two ordinary exporters with a few claims spaced out,
// using distinct clean cells so every claim is a genuine proof. Keys come from .env
// (ROGUE_PRIVATE_KEY, EXPORTER_A_PRIVATE_KEY, EXPORTER_B_PRIVATE_KEY); wallets must hold a little Base Sepolia ETH.
//
//   node scripts/seed-demo.mjs [--rogue 25] [--legit 2,3] [--legit-delay 20] [--start-row 150]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { attestCell } from "./attest.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
require("dotenv").config({ path: path.join(ROOT, ".env"), quiet: true });

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : dflt;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tree = JSON.parse(fs.readFileSync(path.join(ROOT, "frontend", "public", "data", "tree.json"), "utf8"));

/** Yields clean cells row by row starting at --start-row (far from the cells used by hand in the demo). */
function* cleanCells(startRow) {
  for (let i = startRow * tree.cols; i < tree.labels.length; i++) {
    if (tree.labels[i] === "1") yield { row: Math.floor(i / tree.cols), col: i % tree.cols };
  }
}

async function runWallet(label, privateKey, count, commodity, delayMs, cells) {
  const done = [];
  const t0 = Date.now();
  while (done.length < count) {
    const { value: cell, done: exhausted } = cells.next();
    if (exhausted) throw new Error("ran out of clean cells");
    const r = await attestCell({ ...cell, commodity, privateKey, log: () => {} });
    if (r.ok) {
      done.push({ ...cell, id: Number(r.id), hash: r.hash });
      console.log(`${label} ${done.length}/${count} cell (${cell.row},${cell.col}) -> id ${r.id} ${r.hash.slice(0, 12)}`);
      if (delayMs && done.length < count) await sleep(delayMs);
    } else {
      console.log(`${label} skipped cell (${cell.row},${cell.col}): ${r.error}`);
    }
  }
  console.log(`${label}: ${count} attestations in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  return done;
}

const rogueCount = Number(arg("rogue", 25));
const legitCounts = String(arg("legit", "2,3")).split(",").map(Number);
const legitDelay = Number(arg("legit-delay", 20)) * 1000;
const cells = cleanCells(Number(arg("start-row", 150)));

const wallets = [
  { label: "EXPORTER_A", key: process.env.EXPORTER_A_PRIVATE_KEY, count: legitCounts[0] ?? 2, commodity: "coffee", delay: legitDelay },
  { label: "EXPORTER_B", key: process.env.EXPORTER_B_PRIVATE_KEY, count: legitCounts[1] ?? 3, commodity: "palm", delay: legitDelay },
  { label: "ROGUE", key: process.env.ROGUE_PRIVATE_KEY, count: rogueCount, commodity: "cocoa", delay: 0 },
];
for (const w of wallets) if (!w.key) throw new Error(`${w.label}_PRIVATE_KEY missing in .env`);

const summary = {};
for (const w of wallets) summary[w.label] = await runWallet(w.label, w.key, w.count, w.commodity, w.delay, cells);
fs.mkdirSync(path.join(ROOT, "oracle", "out"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "oracle", "out", "seed_demo.json"), JSON.stringify(summary, null, 2) + "\n");
console.log("wrote oracle/out/seed_demo.json");
process.exit(0);
