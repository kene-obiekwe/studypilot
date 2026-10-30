# ML Pipeline

This folder contains the scripts, schema notes, tests and (git-ignored) outputs for the AI lifecycle of the study planner:

1. Build a weekly adherence panel from the Open University Learning Analytics Dataset (OULAD).
2. Train and evaluate the next-week adherence forecast (regression).
3. Export the model for backend inference via `apps.tracking.inference`.
4. Capture runtime training snapshots from app logs as in-app data accumulates.

The model forecasts a learner's adherence for the coming week from the weeks before it. The planner uses the forecast to scale each course's allocation. The strategy recommender is separate and rule-based, not a trained model: rule-based diagnostics over a course's traits, session logs and forecast feed strategy selection in `apps/recommendations/engine/`, with an optional AI write-up on top. See [The recommendation engine](../../README.md#the-recommendation-engine) in the root README and `schema.md` §Governance and Reporting Rules.

The evaluation of the current model, including its limitations, is in `docs/evaluation-report.md`. The earlier same-week model is documented there under the historical heading and is no longer used.

## Files

| File | Purpose |
|---|---|
| `schema.md` | Forecast panel columns, feature definitions, the mapping from app logs to the panel, and the earlier canonical schema (superseded). |
| `build_oulad_canonical.py` | Builds the OULAD weekly panel and its metadata. |
| `train_oulad_models.py` | Selects a Random Forest on validation RMSE, refits it on train + validation, evaluates once on the test presentation against three baselines, and writes the model, meta file, report and plots. |
| `tests/test_forecast_features.py` | Leakage and span checks for the panel builder. |
| `data/oulad/` | Generated panel and metadata. (gitignored) |
| `data/snapshots/` | Runtime training snapshots built from app logs. (gitignored) |
| `models/` | Exported model and meta file loaded by `apps.tracking.inference`. (gitignored) |
| `reports/` | Training report (JSON) and plots. (gitignored) |

## Build the panel and train the model

Prerequisites: the OULAD CSV bundle is available locally (not committed; see the project README for the source). The default location is `Dataset/` at the repo root. The training script also imports `matplotlib`, which is listed in `backend/requirements-ml.txt` but deliberately left out of the runtime `backend/requirements.txt`; install the training dependencies first with `pip install -r backend/requirements-ml.txt`.

From the repo root:

1. Build the weekly panel:
   - `python backend/ml/build_oulad_canonical.py --input-dir Dataset --output-dir backend/ml/data/oulad`
2. Train, evaluate and export the model:
   - `python backend/ml/train_oulad_models.py`

The training script's defaults point at the files the build step writes. Flags on `train_oulad_models.py`:

- `--panel` — path to `forecast_panel.csv`.
- `--panel-metadata` — path to `forecast_metadata.json`.
- `--model-dir`, `--report-dir` — where the model and report are written.
- `--size-limit-mb` — only configs whose compressed file is under this size are eligible (default 30).
- `--max-train-rows` — subsample the training rows with a fixed seed if greater than 0 (default 0, use all rows).

Flags on `build_oulad_canonical.py`: `--input-dir`, `--output-dir`, `--chunksize`.

### Output files

| File | Written by | Contents |
|---|---|---|
| `data/oulad/forecast_panel.csv` | build | One row per student, module, presentation and week. |
| `data/oulad/forecast_metadata.json` | build | Span rules, target and feature definitions, counts, splits. |
| `models/oulad_adherence_forecast.joblib` | train | The fitted pipeline (SimpleImputer, then RandomForestRegressor). |
| `models/oulad_adherence_forecast.meta.json` | train | Feature order, minimum history, library versions, parameters, test metrics. |
| `reports/oulad_forecast_report.json` | train | Counts, hyperparameter grid, test metrics overall, by module and by history bucket, feature importance, gate check. |
| `reports/oulad_forecast_plots/` | train | `predicted_vs_true.png`, `residuals_hist.png`, `model_vs_baselines.png`, `feature_importance.png`. |

Other files that may be present in `data/oulad/`, `models/` and `reports/` (for example `training_dataset.csv`, `oulad_adherence_model.joblib`, `oulad_training_report*.json`, `oulad_plots/`) belong to the earlier same-week model and are not used.

## Run the tests

The ML tests are discovered by the Django test runner, so one command runs everything. From `backend/`:

- `DB_ENGINE=sqlite python manage.py test` — runs the app tests and `ml/tests` together. Setting `DB_ENGINE=sqlite` avoids needing PostgreSQL if `backend/.env` selects it.
- `python -m unittest discover -s ml/tests` — runs only the ML tests.

## What the app loads

`apps.tracking.inference.get_model` reads the model from the `ADHERENCE_MODEL_PATH` environment variable. The default is `ml/models/oulad_adherence_forecast.joblib`, resolved against `backend/`. It then reads the meta file next to it (same name with `.meta.json`) and uses:

- `feature_order` — the columns passed to the model, in order. Each name must be one the app can compute (`adh_lag1`, `adh_lag2`, `adh_mean3`, `adh_trend`, `weeks_history`); otherwise the model is not loaded.
- `min_weeks_history` — complete weeks of history required before a forecast is made (2).
- `sklearn_version` — the major.minor version must match the installed scikit-learn, otherwise the model is not loaded.
- `model_name` and `created_at` — combined into the model version stored with each session log.

If the model cannot be loaded, forecasts have status `model_unavailable` and the planner falls back to the observed 30-day mean adherence, or to a factor of 1.0 when there are no logs. After retraining, restart the backend: the model is loaded once per process.

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

Runtime snapshots are intended for domain adaptation: retrain on real in-app behaviour once volume is sufficient, then re-evaluate against the OULAD-trained model as described under "Next Evaluation Cycle" in the historical part of `docs/evaluation-report.md`.
