#!/usr/bin/env python3
"""Step 01 - export the AOI rasters from Google Earth Engine to oracle/data/ (PRD 5.5).

Outputs (GeoTIFF, EPSG:4326, `sentinel.scale_m` metres):
  hansen_lossyear.tif    Hansen GFC `lossyear` band (0 = no loss, N = loss in year 2000+N)
  ndvi_<baseline>.tif    Sentinel-2 SR annual median NDVI, cloud/shadow masked (SCL + QA60)
  ndvi_<current>.tif

Prerequisites: `earthengine authenticate` once and GEE_PROJECT in .env (see README).
Usage: .venv/bin/python oracle/01_export_gee.py [--config oracle/config.yaml] [--force]
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

import ee
import requests
import yaml
from dotenv import load_dotenv

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
DATA_DIR = HERE / "data"


def load_config(path: Path) -> dict:
    with open(path) as f:
        return yaml.safe_load(f)


def aoi_bbox(cfg: dict) -> list[float]:
    """[west, south, east, north] in degrees, derived from the grid origin and size."""
    a = cfg["aoi"]
    return [a["lon0"], a["lat0"], a["lon0"] + a["cols"] * a["step_deg"], a["lat0"] + a["rows"] * a["step_deg"]]


def mask_s2(img: ee.Image) -> ee.Image:
    """Mask clouds, cirrus, shadows, snow and defective pixels using the SCL and QA60 bands."""
    scl = img.select("SCL")
    qa = img.select("QA60")
    bad_scl = scl.eq(1).Or(scl.eq(3)).Or(scl.gte(8).And(scl.lte(11)))
    bad_qa = qa.bitwiseAnd(1 << 10).neq(0).Or(qa.bitwiseAnd(1 << 11).neq(0))
    return img.updateMask(bad_scl.Not()).updateMask(bad_qa.Not())


def ndvi_median(cfg: dict, region: ee.Geometry, year: int) -> tuple[ee.Image, ee.Number]:
    s2 = cfg["sentinel"]
    col = (
        ee.ImageCollection(s2["collection"])
        .filterBounds(region)
        .filterDate(f"{year}-01-01", f"{year + 1}-01-01")
        .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", s2.get("max_cloud_pct", 80)))
        .map(mask_s2)
    )
    ndvi = col.map(lambda i: i.normalizedDifference(["B8", "B4"]).rename("ndvi")).median()
    return ndvi.clip(region), col.size()


def download(image: ee.Image, region: ee.Geometry, scale: int, out: Path) -> int:
    url = image.getDownloadURL({"region": region, "scale": scale, "crs": "EPSG:4326", "format": "GEO_TIFF"})
    r = requests.get(url, timeout=900)
    r.raise_for_status()
    out.write_bytes(r.content)
    return len(r.content)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", type=Path, default=HERE / "config.yaml")
    ap.add_argument("--force", action="store_true", help="re-download rasters that already exist")
    args = ap.parse_args()

    load_dotenv(ROOT / ".env")
    project = os.environ.get("GEE_PROJECT")
    if not project:
        print("error: GEE_PROJECT is not set in .env", file=sys.stderr)
        return 1

    cfg = load_config(args.config)
    ee.Initialize(project=project)
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    bbox = aoi_bbox(cfg)
    region = ee.Geometry.Rectangle(bbox, "EPSG:4326", False)
    scale = cfg["sentinel"]["scale_m"]
    print(f"AOI {cfg['name']}: bbox W{bbox[0]} S{bbox[1]} E{bbox[2]} N{bbox[3]} @ {scale} m")

    jobs: list[tuple[str, ee.Image, ee.Number | None]] = [
        ("hansen_lossyear.tif", ee.Image(cfg["hansen"]["asset"]).select("lossyear").clip(region), None),
    ]
    for key in ("baseline", "current"):
        year = cfg["years"][key]
        img, n = ndvi_median(cfg, region, year)
        jobs.append((f"ndvi_{year}.tif", img, n))

    for name, img, n_scenes in jobs:
        out = DATA_DIR / name
        if out.exists() and not args.force:
            print(f"skip   {name} (exists, use --force to re-download)")
            continue
        t0 = time.time()
        extra = f", {n_scenes.getInfo()} scenes after cloud filter" if n_scenes is not None else ""
        size = download(img, region, scale, out)
        print(f"wrote  {name} ({size / 1e6:.2f} MB{extra}) in {time.time() - t0:.0f}s")

    return 0


if __name__ == "__main__":
    sys.exit(main())
