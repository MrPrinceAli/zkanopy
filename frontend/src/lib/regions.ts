// The published regions (Phase 7). One region = one grid = one Merkle root on the Registry.
// `public/data/regions.json` is written by oracle/05_publish_root.js after every publish; the per-region
// files live beside it under /data/<slug>/.
export interface RegionInfo {
  slug: string;
  name: string;
  label: string;
  country: string;
  commodity: string;
  gridId: number;
  version: number;
  cells: number;
  /** [[south, west], [north, east]] in degrees. */
  bounds: [[number, number], [number, number]];
}

export interface RegionsFile {
  schema: string;
  default: string;
  generatedAt: string;
  regions: RegionInfo[];
}

/** Used when regions.json is missing, so a checkout without the manifest still serves the first grid. */
export const FALLBACK_REGION = "gayo-aceh";

let cache: Promise<RegionsFile> | null = null;

export function loadRegions(): Promise<RegionsFile> {
  if (!cache) {
    cache = fetch("/data/regions.json")
      .then((r) => {
        if (!r.ok) throw new Error(`regions.json: HTTP ${r.status}`);
        return r.json() as Promise<RegionsFile>;
      })
      .then((f) => {
        if (!f.regions?.length) throw new Error("regions.json lists no regions");
        return f;
      })
      .catch((e) => {
        cache = null;
        throw e;
      });
  }
  return cache;
}

/** Group regions by country, in the order the manifest lists them, for a two-level picker. */
export function byCountry(regions: RegionInfo[]): Array<[string, RegionInfo[]]> {
  const out = new Map<string, RegionInfo[]>();
  for (const r of regions) {
    const list = out.get(r.country);
    if (list) list.push(r);
    else out.set(r.country, [r]);
  }
  return [...out.entries()];
}
