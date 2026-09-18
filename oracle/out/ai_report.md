# AI QC report - gayo-aceh-coffee

Generated 2026-09-18T01:53:43+00:00. Model: RandomForestClassifier (n_estimators=300, min_samples_leaf=2, class_weight=balanced, random_state=42).

## Data

- Cells: 40000 (Hansen clean 37387, loss 2613)
- Features: ndvi_2020, ndvi_2025, dndvi; cells with a missing feature imputed by median: 0
- Split: 80/20 stratified (train 32000, test 8000)

## Held-out metrics (20 % test split)

| Metric | Value |
|---|---|
| Accuracy | 0.8695 |
| F1 (loss class) | 0.2162 |
| F1 (clean class) | 0.9288 |
| F1 macro | 0.5725 |
| Precision (loss) | 0.1780 |
| Recall (loss) | 0.2753 |

Confusion matrix (rows = true, cols = predicted; order loss, clean):

| | pred loss | pred clean |
|---|---|---|
| true loss | 144 | 379 |
| true clean | 665 | 6812 |

## Feature importance

| Feature | Importance |
|---|---|
| ndvi_2020 | 0.3148 |
| ndvi_2025 | 0.3215 |
| dndvi | 0.3637 |

## Disagreement and final labels

- Cells where AI and Hansen disagree: 2266 (see `review_queue.csv`)
  - Hansen clean, AI loss: 1887 -> **blocked** by the conservative rule
  - Hansen loss, AI clean: 379 -> stay loss (Hansen wins)
- Final labels entering the Merkle tree: clean 35500, loss 4500
- Rule: `final_label = 1 iff hansen_label == 1 and ai_label == 1`

The forest is trained on Hansen labels, so held-out metrics measure how well the Sentinel-2 NDVI signal reproduces Hansen; disagreements flag cells worth a human look rather than errors in either source.
