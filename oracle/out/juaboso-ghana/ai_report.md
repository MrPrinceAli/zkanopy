# AI QC report - juaboso-ghana-cocoa

Generated 2026-09-23T11:33:18+00:00. Model: RandomForestClassifier (n_estimators=300, min_samples_leaf=2, class_weight=balanced, random_state=42).

## Data

- Cells: 40000 (Hansen clean 36285, loss 3715)
- Features: ndvi_2020, ndvi_2025, dndvi; cells with a missing feature imputed by median: 0
- Split: 80/20 stratified (train 32000, test 8000)

## Held-out metrics (20 % test split)

| Metric | Value |
|---|---|
| Accuracy | 0.8303 |
| F1 (loss class) | 0.2150 |
| F1 (clean class) | 0.9048 |
| F1 macro | 0.5599 |
| Precision (loss) | 0.1884 |
| Recall (loss) | 0.2503 |

Confusion matrix (rows = true, cols = predicted; order loss, clean):

| | pred loss | pred clean |
|---|---|---|
| true loss | 186 | 557 |
| true clean | 801 | 6456 |

## Feature importance

| Feature | Importance |
|---|---|
| ndvi_2020 | 0.3010 |
| ndvi_2025 | 0.3564 |
| dndvi | 0.3425 |

## Disagreement and final labels

- Cells where AI and Hansen disagree: 2699 (see `review_queue.csv`)
  - Hansen clean, AI loss: 2142 -> **blocked** by the conservative rule
  - Hansen loss, AI clean: 557 -> stay loss (Hansen wins)
- Final labels entering the Merkle tree: clean 34143, loss 5857
- Rule: `final_label = 1 iff hansen_label == 1 and ai_label == 1`

The forest is trained on Hansen labels, so held-out metrics measure how well the Sentinel-2 NDVI signal reproduces Hansen; disagreements flag cells worth a human look rather than errors in either source.
