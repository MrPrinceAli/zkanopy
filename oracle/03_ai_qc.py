#!/usr/bin/env python3
"""Step 03 - AI quality control of the Hansen labels (PRD 5.5, the project's AI component).

A RandomForestClassifier learns `hansen_label` from the Sentinel-2 signal [ndvi_<base>, ndvi_<cur>, dndvi]
on an 80/20 split and then scores every cell:
  ai_label      1 = clean, 0 = loss (argmax)
  ai_prob       P(clean) from the forest
  disagreement  ai_label != hansen_label  -> written to review_queue.csv for a human
  final_label   1 only if hansen_label == 1 AND ai_label == 1 (conservative; this is what enters the Merkle tree)

Outputs: oracle/out/cells_final.csv, review_queue.csv, ai_report.md, ai_summary.json.
Usage: .venv/bin/python oracle/03_ai_qc.py [--region <slug>]
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, confusion_matrix, f1_score, precision_score, recall_score
from sklearn.model_selection import train_test_split

from regions import add_region_arg, load_config, out_dir

HERE = Path(__file__).resolve().parent

MODEL_PARAMS = {"n_estimators": 300, "min_samples_leaf": 2, "class_weight": "balanced", "n_jobs": -1}


def run_qc(df: pd.DataFrame, features: list[str], seed: int = 42, test_size: float = 0.2) -> tuple[pd.DataFrame, dict]:
    """Pure QC step: returns the scored frame and a report dict. Does not touch the filesystem."""
    out = df.copy()
    X = out[features].astype(float)
    n_missing = int(X.isna().any(axis=1).sum())
    medians = X.median()
    X = X.fillna(medians)
    y = out["hansen_label"].astype(int)

    report: dict = {
        "features": features,
        "n_cells": int(len(out)),
        "n_hansen_loss": int((y == 0).sum()),
        "n_hansen_clean": int((y == 1).sum()),
        "n_feature_missing_imputed": n_missing,
        "imputed_medians": {k: float(v) for k, v in medians.items()},
        "model": {"type": "RandomForestClassifier", **MODEL_PARAMS, "random_state": seed},
        "split": {"test_size": test_size, "stratified": True},
    }

    if y.nunique() < 2:
        # Nothing to learn from a single class; keep Hansen as-is and say so.
        report["status"] = "skipped_single_class"
        out["ai_label"] = y
        out["ai_prob"] = y.astype(float)
    else:
        X_tr, X_te, y_tr, y_te = train_test_split(X, y, test_size=test_size, random_state=seed, stratify=y)
        clf = RandomForestClassifier(random_state=seed, **MODEL_PARAMS)
        clf.fit(X_tr, y_tr)
        pred = clf.predict(X_te)
        cm = confusion_matrix(y_te, pred, labels=[0, 1])
        report["status"] = "ok"
        report["n_train"] = int(len(X_tr))
        report["n_test"] = int(len(X_te))
        report["metrics"] = {
            "accuracy": float(accuracy_score(y_te, pred)),
            "f1_loss": float(f1_score(y_te, pred, pos_label=0, zero_division=0)),
            "f1_clean": float(f1_score(y_te, pred, pos_label=1, zero_division=0)),
            "f1_macro": float(f1_score(y_te, pred, average="macro", zero_division=0)),
            "precision_loss": float(precision_score(y_te, pred, pos_label=0, zero_division=0)),
            "recall_loss": float(recall_score(y_te, pred, pos_label=0, zero_division=0)),
        }
        report["confusion_matrix"] = {"labels": ["loss(0)", "clean(1)"], "rows_true_cols_pred": cm.tolist()}
        report["feature_importance"] = {f: float(v) for f, v in zip(features, clf.feature_importances_)}

        clean_idx = list(clf.classes_).index(1)
        out["ai_prob"] = clf.predict_proba(X)[:, clean_idx]
        out["ai_label"] = (out["ai_prob"] >= 0.5).astype(int)

    out["disagreement"] = (out["ai_label"] != out["hansen_label"]).astype(int)
    out["final_label"] = ((out["hansen_label"] == 1) & (out["ai_label"] == 1)).astype(int)

    report["disagreement"] = {
        "total": int(out["disagreement"].sum()),
        "hansen_clean_ai_loss": int(((out["hansen_label"] == 1) & (out["ai_label"] == 0)).sum()),
        "hansen_loss_ai_clean": int(((out["hansen_label"] == 0) & (out["ai_label"] == 1)).sum()),
    }
    report["final"] = {
        "n_clean": int((out["final_label"] == 1).sum()),
        "n_loss": int((out["final_label"] == 0).sum()),
        "rule": "final_label = 1 iff hansen_label == 1 and ai_label == 1",
    }
    return out, report


def write_report(report: dict, path: Path, grid_name: str) -> None:
    m = report.get("metrics", {})
    lines = [
        f"# AI QC report - {grid_name}",
        "",
        f"Generated {report['generatedAt']}. Model: {report['model']['type']} "
        f"(n_estimators={report['model']['n_estimators']}, min_samples_leaf={report['model']['min_samples_leaf']}, "
        f"class_weight={report['model']['class_weight']}, random_state={report['model']['random_state']}).",
        "",
        "## Data",
        "",
        f"- Cells: {report['n_cells']} (Hansen clean {report['n_hansen_clean']}, loss {report['n_hansen_loss']})",
        f"- Features: {', '.join(report['features'])}; cells with a missing feature imputed by median: "
        f"{report['n_feature_missing_imputed']}",
        f"- Split: {int((1 - report['split']['test_size']) * 100)}/{int(report['split']['test_size'] * 100)} stratified"
        + (f" (train {report['n_train']}, test {report['n_test']})" if "n_train" in report else ""),
        "",
    ]
    if report["status"] == "ok":
        cm = report["confusion_matrix"]["rows_true_cols_pred"]
        lines += [
            "## Held-out metrics (20 % test split)",
            "",
            "| Metric | Value |",
            "|---|---|",
            f"| Accuracy | {m['accuracy']:.4f} |",
            f"| F1 (loss class) | {m['f1_loss']:.4f} |",
            f"| F1 (clean class) | {m['f1_clean']:.4f} |",
            f"| F1 macro | {m['f1_macro']:.4f} |",
            f"| Precision (loss) | {m['precision_loss']:.4f} |",
            f"| Recall (loss) | {m['recall_loss']:.4f} |",
            "",
            "Confusion matrix (rows = true, cols = predicted; order loss, clean):",
            "",
            "| | pred loss | pred clean |",
            "|---|---|---|",
            f"| true loss | {cm[0][0]} | {cm[0][1]} |",
            f"| true clean | {cm[1][0]} | {cm[1][1]} |",
            "",
            "## Feature importance",
            "",
            "| Feature | Importance |",
            "|---|---|",
        ]
        lines += [f"| {f} | {v:.4f} |" for f, v in report["feature_importance"].items()]
    else:
        lines += ["## Model", "", "Skipped: the Hansen labels contain a single class, so there is nothing to learn. "
                  "`ai_label` mirrors `hansen_label`."]
    d = report["disagreement"]
    fin = report["final"]
    lines += [
        "",
        "## Disagreement and final labels",
        "",
        f"- Cells where AI and Hansen disagree: {d['total']} (see `review_queue.csv`)",
        f"  - Hansen clean, AI loss: {d['hansen_clean_ai_loss']} -> **blocked** by the conservative rule",
        f"  - Hansen loss, AI clean: {d['hansen_loss_ai_clean']} -> stay loss (Hansen wins)",
        f"- Final labels entering the Merkle tree: clean {fin['n_clean']}, loss {fin['n_loss']}",
        f"- Rule: `{fin['rule']}`",
        "",
        "The forest is trained on Hansen labels, so held-out metrics measure how well the Sentinel-2 NDVI signal "
        "reproduces Hansen; disagreements flag cells worth a human look rather than errors in either source.",
        "",
    ]
    path.write_text("\n".join(lines))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    add_region_arg(ap)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    cfg = load_config(args.region)
    OUT_DIR = out_dir(args.region)
    years = (int(cfg["years"]["baseline"]), int(cfg["years"]["current"]))
    features = [f"ndvi_{years[0]}", f"ndvi_{years[1]}", "dndvi"]

    df = pd.read_csv(OUT_DIR / "cells.csv")
    out, report = run_qc(df, features, seed=args.seed)
    report["generatedAt"] = datetime.now(timezone.utc).isoformat(timespec="seconds")

    out.to_csv(OUT_DIR / "cells_final.csv", index=False, float_format="%.6f")
    queue = out[out["disagreement"] == 1].sort_values("ai_prob")
    queue.to_csv(OUT_DIR / "review_queue.csv", index=False, float_format="%.6f")
    write_report(report, OUT_DIR / "ai_report.md", cfg["name"])
    (OUT_DIR / "ai_summary.json").write_text(json.dumps(report, indent=2) + "\n")

    if report["status"] == "ok":
        m = report["metrics"]
        print(f"accuracy {m['accuracy']:.4f}  f1_loss {m['f1_loss']:.4f}  f1_macro {m['f1_macro']:.4f}")
    print(f"disagreement {report['disagreement']['total']}  final clean {report['final']['n_clean']}  "
          f"loss {report['final']['n_loss']}")
    print(f"wrote cells_final.csv, review_queue.csv ({len(queue)} rows), ai_report.md, ai_summary.json in {OUT_DIR}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
