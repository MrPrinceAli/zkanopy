"""Region paths shared by the oracle steps (Phase 7).

One region = one file in `oracle/regions/<slug>.yaml` = one grid = one Merkle root. Every step takes
`--region <slug>` and writes under a folder of that name, so running the pipeline for a second AOI
never touches the first one's published data.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
REGIONS_DIR = HERE / "regions"
DEFAULT_REGION = "gayo-aceh"


def region_slugs() -> list[str]:
    """Every region that has a config file, alphabetically."""
    return sorted(p.stem for p in REGIONS_DIR.glob("*.yaml"))


def config_path(slug: str) -> Path:
    p = REGIONS_DIR / f"{slug}.yaml"
    if not p.exists():
        raise SystemExit(f"unknown region {slug!r}; available: {', '.join(region_slugs()) or '(none)'}")
    return p


def load_config(slug_or_path: str | Path) -> dict:
    path = Path(slug_or_path) if Path(slug_or_path).suffix == ".yaml" else config_path(str(slug_or_path))
    with open(path) as f:
        return yaml.safe_load(f)


def data_dir(slug: str) -> Path:
    """Downloaded rasters for one region."""
    return HERE / "data" / slug


def out_dir(slug: str) -> Path:
    """Intermediate CSV/JSON for one region."""
    return HERE / "out" / slug


def frontend_data_dir(slug: str) -> Path:
    """Published files the browser fetches: /data/<slug>/…"""
    return ROOT / "frontend" / "public" / "data" / slug


def add_region_arg(ap: argparse.ArgumentParser) -> None:
    ap.add_argument(
        "--region",
        default=DEFAULT_REGION,
        help=f"region slug, i.e. oracle/regions/<slug>.yaml (default: {DEFAULT_REGION})",
    )
