# ML Pipeline (Project)

This folder contains scripts and notes for the AI lifecycle:

1. Build training datasets from captured logs.
2. Train adherence and strategy models.
3. Evaluate model quality against baseline.
4. Export model artifacts for backend inference.

## Planned Files

1. `schema.md`: dataset fields and target definitions.
2. `train_models.py`: reproducible training script.
3. `models/`: exported model artifacts.
4. `reports/`: evaluation results used in Chapter 4 and Chapter 5.

## First Usage

1. Prepare a CSV matching `schema.md`.
2. Run:
   - `python ml/train_models.py --data data/training/study_sessions.csv`
3. Inspect generated metrics and artifacts.

## Build Dataset Snapshot from DB Logs

Use the Django management command to generate a schema-aligned training dataset directly from planner, recommendation, and tracking tables:

1. Run from `backend/`:
   - `python manage.py build_training_dataset`
2. Optional flags:
   - `--snapshot-id 20260331_120000`
   - `--output-dir ml/data/snapshots`
   - `--limit 100`

Generated files per snapshot:

1. `training_dataset.csv` (column order aligned to `schema.md`)
2. `metadata.json` (snapshot version details and source counts)
