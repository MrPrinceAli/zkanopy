// Copies the circuit artifacts into public/zk/ (gitignored: the zkey must never be committed, PRD 12.4).
// Source order: ../circuits/build/ (local build) -> ZKEY_URL (hosted copy, for CI/Vercel) -> warn.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, "..", "..", "circuits", "build");
const dst = path.resolve(here, "..", "public", "zk");
fs.mkdirSync(dst, { recursive: true });

const files = [
  { name: "deforestation_free.wasm", url: process.env.WASM_URL },
  { name: "deforestation_free_final.zkey", url: process.env.ZKEY_URL },
];

for (const { name, url } of files) {
  const from = path.join(src, name);
  const to = path.join(dst, name);
  if (fs.existsSync(from)) {
    const same = fs.existsSync(to) && fs.statSync(to).size === fs.statSync(from).size;
    if (!same) fs.copyFileSync(from, to);
    console.log(`zk:sync ${same ? "up to date" : "copied"} ${name} (${(fs.statSync(to).size / 1e6).toFixed(2)} MB)`);
  } else if (fs.existsSync(to)) {
    console.log(`zk:sync keeping existing ${name}`);
  } else if (url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`zk:sync download failed for ${name}: ${res.status}`);
    fs.writeFileSync(to, Buffer.from(await res.arrayBuffer()));
    console.log(`zk:sync downloaded ${name} from ${url}`);
  } else {
    console.warn(`zk:sync WARNING: ${name} not found in circuits/build and no URL given; proving will fail`);
  }
}
