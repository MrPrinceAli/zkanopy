# AI QC report - daklak-vietnam-coffee

Generated 2026-09-24T01:39:25+00:00. Model: RandomForestClassifier (n_estimators=300, min_samples_leaf=2, class_weight=balanced, random_state=42).

## Data

- Cells: 40000 (Hansen clean 37876, loss 2124)
- Features: ndvi_2020, ndvi_2025, dndvi; cells with a missing feature imputed by median: 0
- Split: 80/20 stratified (train 32000, test 8000)

## Held-out metrics (20 % test split)

| Metric | Value |
|---|---|
| Accuracy | 0.8978 |
| F1 (loss class) | 0.2509 |
| F1 (clean class) | 0.9451 |
| F1 macro | 0.5980 |
| Precision (loss) | 0.2054 |
| Recall (loss) | 0.3224 |

Confusion matrix (rows = true, cols = predicted; order loss, clean):

| | pred loss | pred clean |
|---|---|---|
| true loss | 137 | 288 |
| true clean | 530 | 7045 |

## Feature importance

| Feature | Importance |
|---|---|
| ndvi_2020 | 0.3380 |
| ndvi_2025 | 0.2767 |
| dndvi | 0.3853 |

## Disagreement and final labels

- Cells where AI and Hansen disagree: 1873 (see `review_queue.csv`)
  - Hansen clean, AI loss: 1585 -> **blocked** by the conservative rule
  - Hansen loss, AI clean: 288 -> stay loss (Hansen wins)
- Final labels entering the Merkle tree: clean 36291, loss 3709
- Rule: `final_label = 1 iff hansen_label == 1 and ai_label == 1`

The forest is trained on Hansen labels, so held-out metrics measure how well the Sentinel-2 NDVI signal reproduces Hansen; disagreements flag cells worth a human look rather than errors in either source.
