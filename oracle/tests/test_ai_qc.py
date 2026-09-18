"""Tests for 03_ai_qc.py: the conservative final-label rule, disagreement bookkeeping and report contents."""

import numpy as np
import pandas as pd

FEATURES = ["ndvi_2020", "ndvi_2025", "dndvi"]
GRID = {"lat0S": 94_000_000, "lon0S": 276_000_000, "stepS": 900, "cols": 40, "rows": 25, "depth": 16}


def test_run_qc_on_synthetic_grid(build_grid, ai_qc):
    df = build_grid.synthetic_cells(GRID, (2020, 2025), seed=7, loss_frac=0.15)
    out, report = ai_qc.run_qc(df, FEATURES, seed=7)

    assert report["status"] == "ok"
    assert set(report["metrics"]) >= {"accuracy", "f1_loss", "f1_macro", "precision_loss", "recall_loss"}
    assert report["metrics"]["accuracy"] > 0.9  # the synthetic NDVI collapse is easy to learn
    assert abs(sum(report["feature_importance"].values()) - 1) < 1e-6
    assert report["n_train"] + report["n_test"] == len(df)

    assert out.ai_prob.between(0, 1).all()
    assert set(out.ai_label.unique()) <= {0, 1}
    # Conservative rule: clean only when both agree.
    expected = ((out.hansen_label == 1) & (out.ai_label == 1)).astype(int)
    assert (out.final_label == expected).all()
    assert (out.disagreement == (out.ai_label != out.hansen_label).astype(int)).all()
    assert (out.final_label <= out.hansen_label).all()  # AI can only remove clean cells, never add
    d = report["disagreement"]
    assert d["total"] == d["hansen_clean_ai_loss"] + d["hansen_loss_ai_clean"] == out.disagreement.sum()
    assert report["final"]["n_clean"] + report["final"]["n_loss"] == len(df)


def test_missing_features_are_imputed(build_grid, ai_qc):
    df = build_grid.synthetic_cells(GRID, (2020, 2025), seed=3, loss_frac=0.2)
    df.loc[df.index[:10], "ndvi_2025"] = np.nan
    df.loc[df.index[:10], "dndvi"] = np.nan
    out, report = ai_qc.run_qc(df, FEATURES, seed=3)
    assert report["n_feature_missing_imputed"] == 10
    assert out.ai_prob.notna().all()


def test_single_class_is_skipped(ai_qc):
    df = pd.DataFrame(
        {"row": range(50), "col": 0, "ndvi_2020": 0.7, "ndvi_2025": 0.7, "dndvi": 0.0, "hansen_label": 1}
    )
    out, report = ai_qc.run_qc(df, FEATURES)
    assert report["status"] == "skipped_single_class"
    assert (out.ai_label == 1).all() and (out.final_label == 1).all() and out.disagreement.sum() == 0


def test_report_markdown(build_grid, ai_qc, tmp_path):
    df = build_grid.synthetic_cells(GRID, (2020, 2025), seed=11)
    _, report = ai_qc.run_qc(df, FEATURES, seed=11)
    report["generatedAt"] = "2026-09-18T00:00:00+00:00"
    path = tmp_path / "ai_report.md"
    ai_qc.write_report(report, path, "unit-test-grid")
    text = path.read_text()
    for needle in ("# AI QC report", "Accuracy", "F1 (loss class)", "Feature importance", "review_queue.csv",
                   "final_label = 1 iff hansen_label == 1 and ai_label == 1"):
        assert needle in text
