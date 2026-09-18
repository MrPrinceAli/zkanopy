// Browser-side Groth16 proving with snarkjs. The private inputs (coordinates, cell, Merkle path) never
// leave this module; only the public signals are returned alongside the proof.
// snarkjs is imported lazily so the ~1 MB prover only loads when a proof is actually requested.
import type { Groth16Proof } from "snarkjs";
import type { MerklePath } from "./merkle";

export const WASM_URL = "/zk/deforestation_free.wasm";
export const ZKEY_URL = "/zk/deforestation_free_final.zkey";

/** Public signal order, frozen since Phase 1 (PRD 5.3). */
export const PUBLIC_SIGNALS = ["nullifier", "root", "season", "exporter", "lat0S", "lon0S", "stepS"] as const;

export interface ProveArgs {
  latS: number;
  lonS: number;
  row: number;
  col: number;
  path: MerklePath;
  root: string;
  season: number;
  exporter: `0x${string}`;
  lat0S: number;
  lon0S: number;
  stepS: number;
}

export interface AttestCalldata {
  a: readonly [bigint, bigint];
  b: readonly [readonly [bigint, bigint], readonly [bigint, bigint]];
  c: readonly [bigint, bigint];
  pubSignals: readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint];
}

export interface ProofResult {
  proof: Groth16Proof;
  publicSignals: string[];
  nullifier: `0x${string}`;
  calldata: AttestCalldata;
  ms: number;
}

const toHex32 = (dec: string): `0x${string}` => `0x${BigInt(dec).toString(16).padStart(64, "0")}`;

export async function generateProof(args: ProveArgs): Promise<ProofResult> {
  const input = {
    latS: String(args.latS),
    lonS: String(args.lonS),
    row: String(args.row),
    col: String(args.col),
    pathElements: args.path.pathElements.map(String),
    pathIndices: args.path.pathIndices.map(String),
    root: args.root,
    season: String(args.season),
    exporter: BigInt(args.exporter).toString(),
    lat0S: String(args.lat0S),
    lon0S: String(args.lon0S),
    stepS: String(args.stepS),
  };

  const { groth16 } = await import("snarkjs");
  const t0 = performance.now();
  const { proof, publicSignals } = await groth16.fullProve(input, WASM_URL, ZKEY_URL);
  const ms = Math.round(performance.now() - t0);

  // snarkjs returns "pA,pB,pC,pubSignals" as comma-separated JSON arrays of hex strings.
  const [pA, pB, pC, pub] = JSON.parse(`[${await groth16.exportSolidityCallData(proof, publicSignals)}]`) as [
    string[],
    string[][],
    string[],
    string[],
  ];
  const big = (s: string) => BigInt(s);
  const calldata: AttestCalldata = {
    a: [big(pA[0]), big(pA[1])],
    b: [
      [big(pB[0][0]), big(pB[0][1])],
      [big(pB[1][0]), big(pB[1][1])],
    ],
    c: [big(pC[0]), big(pC[1])],
    pubSignals: pub.map(big) as unknown as AttestCalldata["pubSignals"],
  };

  return { proof, publicSignals, nullifier: toHex32(publicSignals[0]), calldata, ms };
}

/** proof.json content the farmer can hand to an exporter (public signals only, no coordinates). */
export function proofFileContents(r: ProofResult, extra: Record<string, unknown>): string {
  return JSON.stringify(
    {
      schema: "zkanopy-proof/v1",
      ...extra,
      publicSignalOrder: PUBLIC_SIGNALS,
      publicSignals: r.publicSignals,
      nullifier: r.nullifier,
      proof: r.proof,
      provingTimeMs: r.ms,
    },
    null,
    2
  );
}
