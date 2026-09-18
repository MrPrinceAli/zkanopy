"""Tests for 02_build_grid.py: fixed-point grid maths, pixel->cell mapping, aggregation and labels."""

import numpy as np
import pandas as pd
from rasterio.transform import from_origin

# A small 4 x 5 grid at the same origin as the circuit fixture (4.0 N, 96.0 E), stepS = 900.
GRID = {"lat0S": 94_000_000, "lon0S": 276_000_000, "stepS": 900, "cols": 5, "rows": 4, "depth": 16}
STEP = 0.0009
PX = STEP / 3  # 3 x 3 pixels per cell


def raster_transform(px=PX):
    """North-up raster covering the whole grid exactly."""
    north = 4.0 + GRID["rows"] * STEP
    return from_origin(96.0, north, px, px)


def test_fixed_point_grid_matches_config(build_grid, config):
    g = build_grid.fixed_point_grid(config)
    a = config["aoi"]
    assert g["stepS"] == 900
    assert g["lat0S"] == round((a["lat0"] + 90) * 1e6)
    assert g["lon0S"] == round((a["lon0"] + 180) * 1e6)
    assert g["cols"] * g["rows"] <= 2 ** g["depth"]


def test_pixel_cell_index_corners(build_grid):
    h = GRID["rows"] * 3
    w = GRID["cols"] * 3
    idx, valid = build_grid.pixel_cell_index(raster_transform(), h, w, GRID)
    assert valid.all()
    # raster row 0 is the northern edge -> grid row rows-1; raster col 0 -> grid col 0
    assert idx[0, 0] == (GRID["rows"] - 1) * GRID["cols"] + 0
    assert idx[h - 1, 0] == 0  # south-west pixel -> cell (0, 0)
    assert idx[h - 1, w - 1] == GRID["cols"] - 1
    assert idx[0, w - 1] == GRID["rows"] * GRID["cols"] - 1
    # every cell receives exactly 9 pixels
    counts = np.bincount(idx.ravel(), minlength=GRID["rows"] * GRID["cols"])
    assert (counts == 9).all()


def test_pixels_outside_grid_are_invalid(build_grid):
    # Shift the raster one cell west and one cell south: a 1-cell ring falls outside the grid.
    t = from_origin(96.0 - STEP, 4.0 + GRID["rows"] * STEP - STEP, PX, PX)
    h = GRID["rows"] * 3
    w = GRID["cols"] * 3
    idx, valid = build_grid.pixel_cell_index(t, h, w, GRID)
    assert not valid[:, :3].any()  # western strip outside
    assert not valid[-3:, :].any()  # southern strip outside
    assert valid[:-3, 3:].all()


def test_build_cells_labels_and_means(build_grid):
    h = GRID["rows"] * 3
    w = GRID["cols"] * 3
    t = raster_transform()
    ly = np.zeros((h, w))
    # One 2021 loss pixel inside cell (row 1, col 2) and one 2015 (pre-cut-off) pixel in cell (0, 0).
    r_img = (GRID["rows"] - 1 - 1) * 3 + 1  # grid row 1 -> raster rows 6..8 for rows=4
    ly[r_img, 2 * 3 + 1] = 21
    ly[h - 1, 0] = 15
    base = np.full((h, w), 0.8)
    cur = np.full((h, w), 0.8)
    cur[r_img - 1 : r_img + 2, 6:9] = 0.2  # NDVI collapse in the loss cell
    cur[0, 0] = np.nan  # a cloudy pixel must not poison the mean

    df = build_grid.build_cells((ly, t), (base, t), (cur, t), GRID, (21, 25), (2020, 2025))

    assert list(df.columns) == ["row", "col", "frac_loss", "ndvi_2020", "ndvi_2025", "dndvi", "hansen_label"]
    assert len(df) == GRID["rows"] * GRID["cols"]
    loss = df[(df.row == 1) & (df.col == 2)].iloc[0]
    assert loss.frac_loss == 1 / 9
    assert loss.hansen_label == 0
    assert abs(loss.ndvi_2025 - 0.2) < 1e-9 and abs(loss.dndvi + 0.6) < 1e-9
    pre = df[(df.row == 0) & (df.col == 0)].iloc[0]
    assert pre.frac_loss == 0 and pre.hansen_label == 1  # 2015 loss is before the cut-off
    assert df.hansen_label.sum() == len(df) - 1
    top_left = df[(df.row == GRID["rows"] - 1) & (df.col == 0)].iloc[0]
    assert abs(top_left.ndvi_2025 - 0.8) < 1e-9  # mean over the 8 valid pixels


def test_build_cells_handles_different_raster_grids(build_grid):
    # NDVI at 2 x 2 pixels per cell, Hansen at 3 x 3: aggregation must not depend on a shared pixel grid.
    t3 = raster_transform()
    t2 = raster_transform(STEP / 2)
    ly = np.zeros((GRID["rows"] * 3, GRID["cols"] * 3))
    base = np.full((GRID["rows"] * 2, GRID["cols"] * 2), 0.6)
    cur = np.full((GRID["rows"] * 2, GRID["cols"] * 2), 0.5)
    df = build_grid.build_cells((ly, t3), (base, t2), (cur, t2), GRID, (21, 25), (2020, 2025))
    assert np.allclose(df.ndvi_2020, 0.6) and np.allclose(df.dndvi, -0.1)
    assert (df.hansen_label == 1).all()


def test_read_raster_keeps_hansen_zeros(build_grid, tmp_path):
    """GEE tags lossyear's 0 ("no loss") as nodata; reading Hansen must keep those zeros, NDVI may mask them."""
    import rasterio

    ly = np.zeros((6, 6), dtype=np.uint8)
    ly[2, 3] = 21
    path = tmp_path / "hansen.tif"
    with rasterio.open(path, "w", driver="GTiff", width=6, height=6, count=1, dtype="uint8", nodata=0,
                       crs="EPSG:4326", transform=raster_transform()) as dst:
        dst.write(ly, 1)

    raw, t = build_grid.read_raster(path, honour_nodata=False)
    assert np.isfinite(raw).all() and raw.sum() == 21 and t == raster_transform()

    masked, _ = build_grid.read_raster(path, honour_nodata=True)
    assert np.isnan(masked).sum() == 35 and masked[2, 3] == 21


def test_synthetic_cells(build_grid):
    df = build_grid.synthetic_cells(GRID, (2020, 2025), seed=1, loss_frac=0.25)
    assert len(df) == GRID["rows"] * GRID["cols"]
    assert set(df.hansen_label.unique()) == {0, 1}
    assert ((df.frac_loss > 0) == (df.hansen_label == 0)).all()
    assert df.ndvi_2020.between(-1, 1).all() and df.ndvi_2025.between(-1, 1).all()
    pd.testing.assert_frame_equal(df, build_grid.synthetic_cells(GRID, (2020, 2025), seed=1, loss_frac=0.25))
