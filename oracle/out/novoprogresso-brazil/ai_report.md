# AI QC report - novoprogresso-brazil-soy

Generated 2026-09-24T01:39:28+00:00. Model: RandomForestClassifier (n_estimators=300, min_samples_leaf=2, class_weight=balanced, random_state=42).

## Data

- Cells: 40000 (Hansen clean 32436, loss 7564)
- Features: ndvi_2020, ndvi_2025, dndvi; cells with a missing feature imputed by median: 0
- Split: 80/20 stratified (train 32000, test 8000)

## Held-out metrics (20 % test split)

| Metric | Value |
|---|---|
| Accuracy | 0.8036 |
| F1 (loss class) | 0.5685 |
| F1 (clean class) | 0.8729 |
| F1 macro | 0.7207 |
| Precision (loss) | 0.4864 |
| Recall (loss) | 0.6841 |

Confusion matrix (rows = true, cols = predicted; order loss, clean):

| | pred loss | pred clean |
|---|---|---|
| true loss | 1035 | 478 |
| true clean | 1093 | 5394 |

## Feature importance

| Feature | Importance |
|---|---|
| ndvi_2020 | 0.3736 |
| ndvi_2025 | 0.3106 |
| dndvi | 0.3158 |

## Disagreement and final labels

- Cells where AI and Hansen disagree: 3841 (see `review_queue.csv`)
  - Hansen clean, AI loss: 3363 -> **blocked** by the conservative rule
  - Hansen loss, AI clean: 478 -> stay loss (Hansen wins)
- Final labels entering the Merkle tree: clean 29073, loss 10927
- Rule: `final_label = 1 iff hansen_label == 1 and ai_label == 1`

The forest is trained on Hansen labels, so held-out metrics measure how well the Sentinel-2 NDVI signal reproduces Hansen; disagreements flag cells worth a human look rather than errors in either source.
