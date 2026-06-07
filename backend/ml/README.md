# ML Pipeline

This folder contains the scripts, schemas, and reports for the AI lifecycle of the study planner:

1. Map an external educational dataset (OULAD) into the project canonical schema.
2. Train and evaluate the adherence prediction model (Task A, regression).
3. Export the model artifact for backend inference via `apps.tracking.inference`.
4. Capture future runtime training snapshots from app logs as in-app data accumulates.

Task B (strategy recommendation) operates as a rule-based engine in `apps.recommendations.services`; supervised classification is deferred until in-app strategy-label data is available. See `docs/ai-methodology.md` §1 and `schema.md` §Governance for the full rationale.

## Files

| File | Purpose |
|---|---|
| `schema.md` | Canonical training schema, predictor feature set, target definitions, governance rules. |
| `build_oulad_canonical.py` | Adapter: maps OULAD CSVs into the canonical training dataset. |
| `train_oulad_models.py` | Trains the adherence regression model with time-aware splits, hyperparameter search, baseline comparison, and report/plot output. |
| `data/oulad/` | Generated canonical OULAD training dataset and metadata. (gitignored) |
| `data/snapshots/` | Runtime training snapshots built from app logs via the management command below. (gitignored) |
| `models/` | Exported model artifacts loaded by `apps.tracking.inference`. (gitignored) |
| `reports/` | Training reports (JSON) and evaluation plots. (gitignored) |

The evaluation narrative for the current model is in `docs/evaluation-report.md`.

## Train the Adherence Model on OULAD

Prerequisites: the OULAD CSV bundle is available locally (not committed; see the project README for source). Default path is `Dataset/` at the repo root.

From the repo root:

1. Build the canonical dataset:
   - `python backend/ml/build_oulad_canonical.py --input-dir Dataset --output-dir backend/ml/data/oulad`
2. Train the adherence model:
   - `python backend/ml/train_oulad_models.py --data backend/ml/data/oulad/training_dataset.csv --output-dir backend/ml/models --report-dir backend/ml/reports`

Useful flags on the training script:

- `--limit N` — train on the most recent N rows by time (default 200000; pass 0 for the full dataset).
- `--split {time,random}` — split strategy (default `time`).
- `--test-size`, `--val-size` — split proportions (default 0.2 and 0.1).
- `--n-estimators` — RandomForest tree count for the hyperparameter search.

The trained model is consumed at runtime by `apps.tracking.inference.get_model`, which falls back to `(None, "model_unavailable")` if the artifact is missing.

## Build Runtime Training Snapshot from App Logs

Once in-app data accumulates, the Django management command captures a schema-aligned snapshot directly from planner, recommendation, and tracking tables (runtime app schema v2 per `schema.md`):

1. From `backend/`:
   - `python manage.py build_training_dataset`
2. Optional flags:
   - `--snapshot-id 20260601_120000`
   - `--output-dir ml/data/snapshots`
   - `--limit 100`

Generated files per snapshot:

1. `training_dataset.csv` (column order aligned to `schema.md`)
2. `metadata.json` (snapshot version details and source counts)

Runtime snapshots are intended for domain adaptation: retrain on real in-app behaviour once volume is sufficient, then re-evaluate against the OULAD-trained baseline as documented in `docs/evaluation-report.md` §9.
