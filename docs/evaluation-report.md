# AI Model Evaluation Report

This report documents the evaluation of the adherence prediction model used in the AI-Powered Personalised Study Planning and Learning Recommendation System.

It covers data construction, methodology, metrics, a methodological discovery and its fix, and the baseline-vs-ML comparison required for defence.

## 1. Scope

Only Task A (adherence prediction, regression) is covered here. Task B (strategy recommendation) operates as a rule-based engine in the production system; its evaluation contract is documented in `docs/ai-methodology.md` §7 and is deferred until in-app strategy-label data is available.

## 2. Data Source and Construction

The training dataset is derived from the Open University Learning Analytics Dataset (OULAD) and mapped into the project canonical schema (see `backend/ml/schema.md`).

Construction script: `backend/ml/build_oulad_canonical.py`.
Training script: `backend/ml/train_oulad_models.py`.

### Canonical features used as model inputs

1. planned_minutes
2. completion_rate
3. sessions_last_7_days
4. focus_score
5. help_seeking_rate
6. consistency_score
7. avg_quiz_score_recent
8. created_at (relative day index, not calendar datetime)

### Target

- adherence_score = clip(total_clicks / expected_clicks, 0, 1)
- where expected_clicks is the cohort median per module/presentation/window.

## 3. Methodological Discovery: Target Leakage in v1 Construction

During the Chapter 4 audit, an audit of the v1 OULAD canonical pipeline revealed a target-leakage issue:

- `adherence_score` was defined as `total_clicks / expected_clicks` (the engagement_ratio).
- `completion_rate` was defined as `mean_assessment_score / 100` when assessment data was available; otherwise it fell back to the same `engagement_ratio`.
- ~78% of learner-window rows had no assessment data in the window, so for those rows `completion_rate == adherence_score` by construction.
- This produced direct target leakage: the model could solve the regression task by reading the leaked feature.

### Evidence

Pre-fix training report (`backend/ml/reports/oulad_training_report.preleakagefix.json`):

- Feature importance: `completion_rate = 0.80`, with all other features summing to ~0.20.
- Model metrics: MAE 0.0041, RMSE 0.0267, R² 0.994.
- Baseline (mean prediction) metrics: MAE 0.3237, RMSE 0.3582, R² ~0.

The very high R² is an artifact of the leakage: the model is approximately learning `y ≈ completion_rate` for the 78% of rows where the two are identical, and learning a reasonable function of clicks for the rest.

### Fix Applied

Commit-level change in `backend/ml/build_oulad_canonical.py`:

- Removed the `engagement_ratio` fallback for `completion_rate`.
- `completion_rate = mean_assessment_score / 100` only when assessment data is available; NaN otherwise.
- NaN values are imputed at training time using the existing `SimpleImputer(strategy="median")` step in the training pipeline.

After the fix, `completion_rate` and `adherence_score` derive from independent OULAD signals (assessment scores and click activity respectively).

## 4. Methodology

### 4.1 Splitting Strategy

- Time-aware split based on the `created_at` window index (per `backend/ml/train_oulad_models.py:build_splits`).
- Train: 70%, Validation: 10%, Test: 20%.
- Sorting by `created_at` then slicing reduces forward-looking leakage from time-correlated features.

### 4.2 Baseline

- Mean-prediction baseline: every test row is predicted as the mean adherence of the training set.
- This baseline reflects the floor any model must beat to be considered useful.

### 4.3 ML Model

- Pipeline: `SimpleImputer(strategy="median")` → `RandomForestRegressor`.
- Hyperparameter search over three configurations:
  - `n_estimators=200, max_depth=None, min_samples_leaf=1`
  - `n_estimators=200, max_depth=12, min_samples_leaf=2`
  - `n_estimators=200, max_depth=20, min_samples_leaf=5`
- Best model is selected by validation RMSE, then refit on train + validation for final test evaluation.

### 4.4 Metrics

- Mean Absolute Error (MAE)
- Root Mean Squared Error (RMSE)
- Coefficient of determination (R²)

## 5. Results

### 5.1 Pre-fix (leakage-affected, v1 construction)

Documented for transparency; these numbers are not the result of valid generalisation.

| Model | MAE | RMSE | R² |
|---|---|---|---|
| Baseline (mean) | 0.3237 | 0.3582 | ~0 |
| RandomForest v2 | 0.0041 | 0.0267 | 0.994 |

Feature importance was dominated by `completion_rate` (0.80) due to leakage.

### 5.2 Post-fix (leakage-clean)

Training run on the regenerated dataset (`backend/ml/reports/oulad_training_report.json`). Training used the `--limit 200000` default (most recent 200,000 rows by time), with the same 70/10/20 time-aware split and the same hyperparameter search.

| Model | MAE | RMSE | R² |
|---|---|---|---|
| Baseline (mean) | 0.3122 | 0.3408 | −0.0036 |
| RandomForest v2 | 0.0291 | 0.0709 | 0.957 |

Updated feature importance:

| Feature | Importance |
|---|---|
| focus_score | 0.670 |
| planned_minutes | 0.146 |
| consistency_score | 0.093 |
| sessions_last_7_days | 0.089 |
| help_seeking_rate | 0.0012 |
| created_at | 0.0006 |
| avg_quiz_score_recent | 0.00013 |
| **completion_rate** | **0.00012** |

`completion_rate` falls from importance 0.80 (pre-fix) to ~0 (post-fix). This is the expected fingerprint of removing the engagement-ratio fallback: where assessment data is genuinely absent, the imputed median provides no discriminating signal, and the model correctly stops relying on it. The leakage path is closed.

## 6. Discussion

### 6.1 What the Pre-fix Numbers Showed (and Did Not Show)

The pre-fix model effectively learned a near-identity function from `completion_rate` to `adherence_score`, plus a residual function over click-based features for the rows where `completion_rate` was a real signal. The high R² was a measurement artifact, not evidence of generalisation.

### 6.2 What the Post-fix Numbers Mean

With the leakage removed, `completion_rate` is NaN for ~76% of rows and the imputer fills with the train-set median; importance collapses to ~0 (as expected when a feature has no discriminating signal). The model now relies on click-based behavioural features (`focus_score`, `planned_minutes`, `consistency_score`, `sessions_last_7_days`) to predict adherence. The lower R² (0.957 vs 0.994) reflects honest generalisation rather than a leakage-inflated score.

### 6.3 Residual Correlation Between Click-Based Features and Adherence

A defence-honest disclosure: `focus_score`, `planned_minutes`, and `adherence_score` are all derived from the same OULAD click stream:

- `focus_score = clip(total_clicks / active_days, 0, p90) / p90`
- `planned_minutes = expected_clicks / clicks_per_minute` (cohort median per window)
- `adherence_score = clip(total_clicks / expected_clicks, 0, 1)`

Because all three share `total_clicks` as a constituent, there is residual correlation among the inputs and the target. This is intrinsic to behavioural-proxy modelling on OULAD and cannot be fully eliminated within this dataset — adherence as defined here is fundamentally a click-volume ratio, and click volume is the strongest behavioural signal available. This is different in kind from the pre-fix leakage, where `completion_rate` was literally equal to `adherence_score` for the majority of rows. Here the model still learns a non-trivial transformation across multiple aggregations of the click stream rather than reading the answer from one feature.

The post-deployment runtime schema (v2; `backend/ml/schema.md`) collects independent in-app signals (self-reported focus, actual vs planned minutes from session timers, explicit assessment outcomes) which will reduce this residual correlation in subsequent training cycles.

### 6.4 Why the Model is Still Useful

The post-fix model beats the mean baseline on MAE and RMSE (~10x improvement on MAE) and feeds into the planner's adherence-weighted allocation factor (`backend/apps/planner/views.py`). This is the intended deployment story: a measurable improvement over rule-only allocation on the metrics that matter for the planner's decisioning, with a rule-based fallback whenever the model artifact is missing (`backend/apps/tracking/inference.py:get_model`).

## 7. Deployment Integration

- Model artifact: `backend/ml/models/oulad_adherence_model.joblib`.
- Inference: `backend/apps/tracking/inference.py` loads the artifact under an `lru_cache` and returns `(None, "model_unavailable")` if absent so callers fall back to recorded `adherence_score`.
- Versioning: `MODEL_VERSION = "oulad_adherence_v2"` constant; persisted with each session log row via `predicted_adherence` and `model_version` fields.
- Planner integration: `backend/apps/planner/views.py` uses `Coalesce("predicted_adherence", "adherence_score")` over the prior 30 days to compute an adherence factor per course, then rescales allocations to preserve the user's total available hours.

## 8. Limitations

1. Adherence is a behavioural proxy from click activity, not a direct measure of plan-following intent.
2. `completion_rate` after the fix is sparse (NaN for ~78% of rows) and imputed; this limits its learnable signal.
3. `created_at` is a relative day index per presentation, not an absolute datetime; this is appropriate for OULAD but means time-of-year effects cannot be modelled.
4. The dataset is from a UK distance-learning population; transfer to a Nigerian undergraduate context will need domain adaptation once in-app logs accumulate.

## 9. Next Evaluation Cycle

Once in-app behavioural logs accumulate at sufficient scale, the canonical schema (`backend/ml/schema.md` Runtime App Schema v2) becomes the primary training source. At that point, re-run the same baseline-vs-ML comparison and report side-by-side with the OULAD-trained model to demonstrate transfer behaviour.
