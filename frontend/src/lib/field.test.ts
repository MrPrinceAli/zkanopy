// Unit tests for the /field check: recomputing a plot's nullifier and matching it against an attestation.
// The expected value is not derived from any local file — it is the nullifier the *circuit* produced and the
// contract stored for attestation #1 on Base Sepolia, so this pins the page's maths to the real chain.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cellOf, nullifierOf, type CellGrid } from "./merkle";

const readJson = <T>(rel: string): T => JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8")) as T;
const record = readJson<CellGrid & { gridId: number }>("../../public/data/gayo-aceh/grid.json");

// Attestation #1, read from the Registry with `cast call getAttestation(1)`:
// cell (100, 100), season 2026, submitted by scripts/attest.mjs (decision 4.8).
const ATT1 = {
  row: 100,
  col: 100,
  season: 2026,
  nullifier: 10530761722228381958590266336829181983196873348946642283786551992784305249976n,
};

describe("field verification", () => {
  it("recomputes the nullifier the chain stores for attestation #1", () => {
    expect(nullifierOf(ATT1.row, ATT1.col, ATT1.season)).toBe(ATT1.nullifier);
  });

  it("a different cell or a different season does not match", () => {
    expect(nullifierOf(ATT1.row, ATT1.col + 1, ATT1.season)).not.toBe(ATT1.nullifier);
    expect(nullifierOf(ATT1.row + 1, ATT1.col, ATT1.season)).not.toBe(ATT1.nullifier);
    expect(nullifierOf(ATT1.row, ATT1.col, ATT1.season + 1)).not.toBe(ATT1.nullifier);
  });

  it("resolves coordinates inside cell (100, 100) back to that cell and its nullifier", () => {
    // Centre of cell (100, 100) in degrees, from the published grid origin and step.
    const lat = (record.lat0S + (ATT1.row + 0.5) * record.stepS) / 1e6 - 90;
    const lon = (record.lon0S + (ATT1.col + 0.5) * record.stepS) / 1e6 - 180;
    const hit = cellOf(lat, lon, record);
    expect(hit.inside).toBe(true);
    expect([hit.row, hit.col]).toEqual([ATT1.row, ATT1.col]);
    expect(nullifierOf(hit.row, hit.col, ATT1.season)).toBe(ATT1.nullifier);
  });

  it("marks a point outside the published grid as outside", () => {
    const hit = cellOf(0, 0, record);
    expect(hit.inside).toBe(false);
  });
});
