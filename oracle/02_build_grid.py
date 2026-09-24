#!/usr/bin/env python3
"""Step 02 - aggregate the rasters into the lat/lon cell grid and label each cell (PRD 5.2 / 5.5).

Per cell (row, col):
  frac_loss     fraction of Hansen pixels with lossyear inside `hansen.loss_years`
  ndvi_<base>   mean NDVI of the baseline year (cloud-free pixels only)
  ndvi_<cur>    mean NDVI of the current year
  dndvi         ndvi_<cur> - ndvi_<base>
  hansen_label  0 (loss) if frac_loss > 0 else 1 (clean)

Cell index convention (must match the circuit): row = floor((latS - lat0S) / stepS),
col = floor((lonS - lon0S) / stepS) with latS = round((lat + 90) * 1e6), lonS = round((lon + 180) * 1e6).
Row 0 is the SOUTHERN edge of the grid.

Outputs: oracle/out/cells.csv and oracle/out/grid.json (fixed-point parameters + provenance).
Usage: .venv/bin/python oracle/02_build_grid.py [--config oracle/config.yaml] [--synthetic]
  --synthetic  build a random grid (~10 % loss cells) without rasters, the PRD fallback when GEE is unavailable.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from regions import add_region_arg, data_dir, load_config, out_dir

HERE = Path(__file__).resolve().parent


FIXED_POINT = 1_000_000


def fixed_point_grid(cfg: dict) -> dict:
    """Grid parameters in the circuit's fixed-point encoding."""
    a = cfg["aoi"]
    return {
        "lat0S": int(round((a["lat0"] + 90) * FIXED_POINT)),
        "lon0S": int(round((a["lon0"] + 180) * FIXED_POINT)),
        "stepS": int(round(a["step_deg"] * FIXED_POINT)),
        "cols": int(a["cols"]),
        "rows": int(a["rows"]),
        "depth": int(cfg["merkle"]["depth"]),
    }


def pixel_cell_index(transform, height: int, width: int, grid: dict) -> tuple[np.ndarray, np.ndarray]:
    """Map every raster pixel (by its centre) to a cell index row*cols+col; `valid` marks pixels inside the grid."""
    px_rows, px_cols = np.meshgrid(np.arange(height), np.arange(width), indexing="ij")
    cx = px_cols + 0.5
    cy = px_rows + 0.5
    lon = transform.c + transform.a * cx + transform.b * cy
    lat = transform.f + transform.d * cx + transform.e * cy

    lat_s = np.rint((lat + 90.0) * FIXED_POINT).astype(np.int64)
    lon_s = np.rint((lon + 180.0) * FIXED_POINT).astype(np.int64)
    row = np.floor_divide(lat_s - grid["lat0S"], grid["stepS"])
    col = np.floor_divide(lon_s - grid["lon0S"], grid["stepS"])

    valid = (row >= 0) & (row < grid["rows"]) & (col >= 0) & (col < grid["cols"])
    idx = np.where(valid, row * grid["cols"] + col, 0)
    return idx, valid


def cell_mean(values: np.ndarray, idx: np.ndarray, valid: np.ndarray, ncells: int) -> tuple[np.ndarray, np.ndarray]:
    """Per-cell mean of finite values; returns (mean with NaN where no data, count)."""
    m = valid & np.isfinite(values)
    total = np.bincount(idx[m], weights=values[m], minlength=ncells)
    count = np.bincount(idx[m], minlength=ncells)
    mean = np.full(ncells, np.nan)
    np.divide(total, count, out=mean, where=count > 0)
    return mean, count


def build_cells(
    hansen: tuple[np.ndarray, object],
    ndvi_base: tuple[np.ndarray, object],
    ndvi_cur: tuple[np.ndarray, object],
    grid: dict,
    loss_years: tuple[int, int],
    years: tuple[int, int],
) -> pd.DataFrame:
    """Pure aggregation step. Each raster is (2-D array, affine transform); rasters may have different grids."""
    ncells = grid["rows"] * grid["cols"]
    lo, hi = loss_years

    ly, t = hansen
    idx, valid = pixel_cell_index(t, *ly.shape, grid)
    loss_px = ((ly >= lo) & (ly <= hi)).astype(float)
    loss_px[~np.isfinite(ly)] = np.nan
    frac_loss, n_px = cell_mean(loss_px, idx, valid, ncells)

    ndvi = {}
    for year, (arr, tr) in zip(years, (ndvi_base, ndvi_cur)):
        i, v = pixel_cell_index(tr, *arr.shape, grid)
        ndvi[year], _ = cell_mean(arr.astype(float), i, v, ncells)

    cell = np.arange(ncells)
    df = pd.DataFrame(
        {
            "row": cell // grid["cols"],
            "col": cell % grid["cols"],
            "frac_loss": frac_loss,
            f"ndvi_{years[0]}": ndvi[years[0]],
            f"ndvi_{years[1]}": ndvi[years[1]],
        }
    )
    df["dndvi"] = df[f"ndvi_{years[1]}"] - df[f"ndvi_{years[0]}"]
    # Conservative: a cell with no Hansen coverage cannot be shown clean.
    df["hansen_label"] = np.where(np.isfinite(df["frac_loss"]) & (df["frac_loss"] == 0), 1, 0).astype(int)
    if (n_px == 0).any():
        print(f"warning: {(n_px == 0).sum()} cells have no Hansen pixels and were labelled loss", file=sys.stderr)
    return df


def synthetic_cells(grid: dict, years: tuple[int, int], seed: int = 42, loss_frac: float = 0.10) -> pd.DataFrame:
    """Random grid with ~loss_frac loss cells; NDVI drops sharply in loss cells. PRD fallback when GEE is unavailable."""
    rng = np.random.default_rng(seed)
    n = grid["rows"] * grid["cols"]
    cell = np.arange(n)
    is_loss = rng.random(n) < loss_frac
    ndvi_base = np.clip(rng.normal(0.72, 0.08, n), -1, 1)
    delta = np.where(is_loss, rng.normal(-0.30, 0.08, n), rng.normal(0.0, 0.04, n))
    ndvi_cur = np.clip(ndvi_base + delta, -1, 1)
    frac_loss = np.where(is_loss, rng.uniform(0.02, 0.6, n), 0.0)
    df = pd.DataFrame(
        {
            "row": cell // grid["cols"],
            "col": cell % grid["cols"],
            "frac_loss": frac_loss,
            f"ndvi_{years[0]}": ndvi_base,
            f"ndvi_{years[1]}": ndvi_cur,
        }
    )
    df["dndvi"] = df[f"ndvi_{years[1]}"] - df[f"ndvi_{years[0]}"]
    df["hansen_label"] = (df["frac_loss"] == 0).astype(int)
    return df


def read_raster(path: Path, honour_nodata: bool = True) -> tuple[np.ndarray, object]:
    """Read band 1 as float. With honour_nodata, nodata pixels become NaN.

    Hansen's `lossyear` must be read with honour_nodata=False: the export tags 0 as nodata, but 0 is the
    legitimate "no loss" value, so masking it would turn almost every cell into missing data.
    """
    import rasterio

    with rasterio.open(path) as src:
        if honour_nodata:
            arr = src.read(1, masked=True).astype(float).filled(np.nan)
        else:
            arr = src.read(1).astype(float)
        return arr, src.transform


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    add_region_arg(ap)
    ap.add_argument("--synthetic", action="store_true", help="skip rasters and generate a random grid")
    args = ap.parse_args()

    cfg = load_config(args.region)
    DATA_DIR = data_dir(args.region)
    OUT_DIR = out_dir(args.region)
    grid = fixed_point_grid(cfg)
    years = (int(cfg["years"]["baseline"]), int(cfg["years"]["current"]))
    loss_years = tuple(int(x) for x in cfg["hansen"]["loss_years"])
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    if args.synthetic:
        df = synthetic_cells(grid, years)
        sources = {"synthetic": True}
    else:
        hansen = read_raster(DATA_DIR / "hansen_lossyear.tif", honour_nodata=False)
        base = read_raster(DATA_DIR / f"ndvi_{years[0]}.tif")
        cur = read_raster(DATA_DIR / f"ndvi_{years[1]}.tif")
        df = build_cells(hansen, base, cur, grid, loss_years, years)
        sources = {
            "synthetic": False,
            "hansen_asset": cfg["hansen"]["asset"],
            "loss_years": list(loss_years),
            "sentinel_collection": cfg["sentinel"]["collection"],
            "scale_m": cfg["sentinel"]["scale_m"],
        }

    df.to_csv(OUT_DIR / "cells.csv", index=False, float_format="%.6f")

    n_loss = int((df["hansen_label"] == 0).sum())
    info = {
        "name": cfg["name"],
        "description": " ".join(str(cfg.get("description", "")).split()),
        "version": int(cfg.get("grid_version", 1)),
        "aoi": cfg["aoi"],
        **grid,
        "years": {"baseline": years[0], "current": years[1]},
        "n_cells": int(len(df)),
        "n_hansen_clean": int(len(df) - n_loss),
        "n_hansen_loss": n_loss,
        "n_ndvi_missing": int(df[f"ndvi_{years[0]}"].isna().sum() + df[f"ndvi_{years[1]}"].isna().sum()),
        "sources": sources,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    (OUT_DIR / "grid.json").write_text(json.dumps(info, indent=2) + "\n")

    print(f"cells: {len(df)}  hansen clean: {info['n_hansen_clean']}  loss: {n_loss} ({100 * n_loss / len(df):.2f} %)")
    print(f"ndvi missing (cells x years): {info['n_ndvi_missing']}")
    print(f"wrote {OUT_DIR / 'cells.csv'} and {OUT_DIR / 'grid.json'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
