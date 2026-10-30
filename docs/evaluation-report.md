# AI Model Evaluation Report

This report documents the evaluation of the adherence model used in the study planner. It has two parts:

1. **Current model: next-week adherence forecast (October 2026).** The model the application loads today.
2. **Historical evaluation: the first version of the model (v1/v2).** The earlier same-week model and its leakage audit, kept for the record and superseded by part 1.

The strategy recommendations are rule-based and not evaluated here; see [The recommendation engine](../README.md#the-recommendation-engine) in the README. A learned recommender would need in-app strategy-outcome data, because OULAD and similar external datasets carry no validated strategy labels.

## Current model: next-week adherence forecast (October 2026)

### Summary

The model forecasts a learner's adherence for the coming week from the weeks before it. On the held-out test presentation (OULAD 2014J, 239,456 rows) it scores:

| | MAE | RMSE | R² |
|---|---:|---:|---:|
| Forecast model | 0.307 | 0.380 | 0.314 |
| 3-week mean | 0.268 | 0.403 | 0.229 |
| Persistence (last week) | 0.277 | 0.462 | −0.014 |
| Train mean | 0.440 | 0.459 | 0.000 |

The model has lower RMSE and higher R² than every baseline. It has a higher MAE than the 3-week mean and persistence. An R² of 0.314 means roughly a third of the variance in next-week adherence is explained; most of it is not. These numbers measure a different target from the earlier report and must not be compared with its figures.

Sources: `backend/ml/reports/oulad_forecast_report.json` (`test_metrics.overall`) and `backend/ml/models/oulad_adherence_forecast.meta.json` (`test_metrics`).

### Why the model was reframed

1. **The old target could be rebuilt from its own inputs.** The earlier model predicted a same-window adherence, `clip(total_clicks / expected_clicks, 0, 1)`, from inputs such as `focus_score` and `planned_minutes` that were built from the same window's click stream (the shared click-stream dependence is described in the historical section, §6.3). A model with access to those inputs can recover the target by arithmetic rather than forecast it. The high scores reported at the time therefore do not measure forecasting ability and are not the current result.
2. **Training and serving did not match.** The application cannot compute OULAD-scale click features. Its per-course active days sit on a lower scale than OULAD's, and its focus score is a self-reported slider rather than click intensity (comments in `backend/ml/build_oulad_canonical.py`). A planner also needs next week's adherence before that week has happened, so a same-week model has nothing to read at the time it is needed.

The replacement predicts week *t* only from weeks before *t*, and only from quantities the application can reproduce from its own session logs.

### Data: the weekly panel

Built by `backend/ml/build_oulad_canonical.py` from `studentVle.csv`, `studentRegistration.csv` and `courses.csv`. Counts below come from `backend/ml/data/oulad/forecast_metadata.json`.

- **Unit.** One row per (student, module, presentation, week) over the registration's enrolled span. Week = `date // 7` counted from week 0 (the presentation start). Clicks with a date before 0 are ignored (688,988 of 10,655,280 `studentVle` rows).
- **Enrolled span.** `end_day = min(module_presentation_length, date_unregistration if present)`. Enrolled weeks are `0 .. end_day // 7 − 1`; a partial final week is dropped. Late registrations (234) also start at week 0. Excluded: 2,678 registrations that unregistered before day 0 and 719 with no full enrolled week. 29,196 of 32,593 registrations are in the panel, giving 898,501 rows; 6,675 of those registrations unregistered mid-presentation.
- **Gap-fill.** An enrolled week with no `studentVle` rows gets `total_clicks = 0` and `active_days = 0`. 328,293 panel rows are gap-filled. Activity falling after a registration's enrolled span (8,175 student-weeks, 157,049 clicks) or belonging to an excluded registration (1,055 student-weeks, 37,948 clicks) is dropped.
- **Target.** `expected_clicks` is the median `total_clicks` over all enrolled students for the same module, presentation and week, zeros included. `adherence = clip(total_clicks / expected_clicks, 0, 1)`, and it is missing when `expected_clicks` is 0 (181,383 rows, in 170 module-presentation-weeks). 717,118 rows have a defined target.
- **Training rows.** A row is used for training or evaluation when `weeks_history >= 2` and adherence is defined.
- **Shape of the target.** Computed from `forecast_panel.csv` over the 659,794 training rows (train, validation and test): 50.8% of targets are exactly 1, 31.5% are exactly 0, and 17.7% lie strictly between. On the test presentation alone the shares are 51.0%, 30.7% and 18.3%. The target is bimodal. These shares are not stored in the JSON reports; they were computed directly from the panel.

### Features

Five features, all computed from weeks before *t* of the same registration (`feature_definitions` in `forecast_metadata.json`):

| Feature | Definition | Importance (share) |
|---|---|---:|
| `adh_lag1` | adherence at *t*−1 (missing if `expected_clicks` was 0) | 1.5% |
| `adh_lag2` | adherence at *t*−2 | 1.3% |
| `adh_mean3` | mean of the available adherence values at *t*−1 to *t*−3 | 95.7% |
| `adh_trend` | `adh_lag1 − adh_lag2` | 0.3% |
| `weeks_history` | number of enrolled weeks before *t* (equals *t*) | 1.1% |

Importances are the Random Forest's impurity-based values from `oulad_forecast_report.json` (`feature_importance`). `adh_mean3` carries almost all of them.

Three further columns are computed with the same prior-weeks-only rule and kept in the panel for reporting, but are **not** model inputs: `active_days_lag1`, `active_days_mean3` and `focus_lag1`. The application's per-course active days are on a lower scale than OULAD's, and its focus score is a self-reported slider rather than click intensity, so neither has an OULAD-comparable scale. The columns of the earlier canonical schema (planned minutes, completion rate, sessions in the last 7 days, help-seeking, consistency, quiz score) are not used.

### Split

The split is by presentation, so no student-week is shared between train, validation and test (`forecast_metadata.json`, `split_counts`):

| Split | Presentations | Training rows | Registrations |
|---|---|---:|---:|
| Train | 2013B, 2013J | 281,557 | 12,018 |
| Validation | 2014B | 138,781 | 6,590 |
| Test | 2014J | 239,456 | 9,299 |

The test presentation is used once, after model selection. The saved model is refit on train plus validation (420,338 rows) with the chosen configuration (`oulad_adherence_forecast.meta.json`, `training_rows`).

### Model and hyperparameter grid

Pipeline: `SimpleImputer(strategy="median")` followed by `RandomForestRegressor` with `n_estimators=100` and `random_state=42`. The grid covers `max_depth` in {8, 12, 16} and `min_samples_leaf` in {20, 50, 100}. The configuration with the lowest validation RMSE among those whose compressed file is under 30 MB is chosen; all nine were eligible. The chosen configuration is `max_depth=8`, `min_samples_leaf=100`.

| max_depth | min_samples_leaf | Validation RMSE | Validation MAE | Validation R² | File size (MB) | Chosen |
|---:|---:|---:|---:|---:|---:|---|
| 8 | 20 | 0.3809 | 0.3047 | 0.3372 | 1.11 |  |
| 8 | 50 | 0.3809 | 0.3048 | 0.3372 | 1.02 |  |
| 8 | 100 | 0.3809 | 0.3048 | 0.3372 | 0.93 | yes |
| 12 | 20 | 0.3815 | 0.3038 | 0.3350 | 4.93 |  |
| 12 | 50 | 0.3815 | 0.3039 | 0.3351 | 3.67 |  |
| 12 | 100 | 0.3814 | 0.3039 | 0.3352 | 2.79 |  |
| 16 | 20 | 0.3828 | 0.3037 | 0.3304 | 10.22 |  |
| 16 | 50 | 0.3825 | 0.3038 | 0.3314 | 6.08 |  |
| 16 | 100 | 0.3824 | 0.3037 | 0.3317 | 3.81 |  |

Validation RMSE varies only between 0.3809 and 0.3828 across the grid, so the choice of configuration matters little; the shallow trees are chosen on a difference in the fifth decimal and give a small file. The refit model's file is 1.04 MB (`model_file_size_mb`). Grid values are from `oulad_forecast_report.json` (`grid`).

### Test results

Each cell is MAE / RMSE / R² on the 2014J test rows. Baselines:

- **Train mean:** a constant, the mean target over train plus validation (0.585).
- **Persistence:** last week's adherence (`adh_lag1`); 11,876 rows with no value are filled with the train mean.
- **3-week mean:** `adh_mean3`; 2,901 rows with no value are filled with the train mean.

**Overall**

| Test 2014J | n | Model | 3-week mean | Persistence | Train mean |
|---|---:|---|---|---|---|
| All rows | 239,456 | 0.307 / 0.380 / 0.314 | 0.268 / 0.403 / 0.229 | 0.277 / 0.462 / −0.014 | 0.440 / 0.459 / 0.000 |

**By module**

| Module | n | Model | 3-week mean | Persistence | Train mean |
|---|---:|---|---|---|---|
| AAA | 10,436 | 0.301 / 0.367 / 0.325 | 0.260 / 0.385 / 0.259 | 0.269 / 0.444 / 0.012 | 0.426 / 0.447 / −0.002 |
| BBB | 40,406 | 0.340 / 0.418 / 0.225 | 0.303 / 0.448 / 0.111 | 0.316 / 0.503 / −0.122 | 0.461 / 0.476 / −0.002 |
| CCC | 51,568 | 0.315 / 0.388 / 0.278 | 0.283 / 0.415 / 0.174 | 0.292 / 0.480 / −0.105 | 0.437 / 0.456 / −0.001 |
| DDD | 41,677 | 0.296 / 0.367 / 0.338 | 0.256 / 0.384 / 0.275 | 0.272 / 0.454 / −0.012 | 0.431 / 0.451 / −0.001 |
| EEE | 28,173 | 0.297 / 0.368 / 0.335 | 0.261 / 0.394 / 0.241 | 0.269 / 0.451 / 0.005 | 0.432 / 0.452 / −0.002 |
| FFF | 54,755 | 0.278 / 0.346 / 0.415 | 0.234 / 0.363 / 0.357 | 0.230 / 0.414 / 0.162 | 0.433 / 0.452 / −0.001 |
| GGG | 12,441 | 0.359 / 0.438 / 0.203 | 0.315 / 0.465 / 0.104 | 0.330 / 0.518 / −0.112 | 0.483 / 0.494 / −0.012 |

**By weeks of history**

| Weeks of history | n | Model | 3-week mean | Persistence | Train mean |
|---|---:|---|---|---|---|
| 2-4 | 27,620 | 0.309 / 0.372 / 0.219 | 0.284 / 0.399 / 0.103 | 0.304 / 0.472 / −0.256 | 0.401 / 0.425 / −0.020 |
| 5-12 | 55,354 | 0.319 / 0.387 / 0.272 | 0.282 / 0.408 / 0.192 | 0.299 / 0.472 / −0.082 | 0.434 / 0.454 / −0.001 |
| 13+ | 156,482 | 0.303 / 0.379 / 0.340 | 0.261 / 0.402 / 0.256 | 0.264 / 0.457 / 0.040 | 0.449 / 0.467 / 0.000 |

Reading the tables:

- RMSE is lower and R² is higher than both the 3-week mean and persistence in every module and every history bucket.
- MAE is higher than both the 3-week mean and persistence in every module and every history bucket.
- R² ranges from 0.203 (module GGG) to 0.415 (module FFF). The two modules with the lowest R², GGG and BBB, are also where the baselines do worst.
- With 2 to 4 weeks of history the model's R² is 0.219 against 0.103 for the 3-week mean; with 13 or more weeks it is 0.340 against 0.256.

Source: `oulad_forecast_report.json` (`test_metrics.overall`, `by_module`, `by_weeks_history`).

### Why acceptance uses RMSE and R², with MAE still reported

Half of the targets are exactly 1 and nearly a third are exactly 0. A predictor that simply repeats the recent value is exactly right for a learner who stays at 0 or 1, which keeps its mean absolute error low, but it makes large errors when a learner switches. RMSE penalises those large errors more heavily than MAE does. The forecast model's output is pulled toward the population mean (see the limitations), which costs MAE on the learners sitting at 0 or 1 and reduces the large misses.

The acceptance comparison is therefore made on RMSE and R². MAE is still reported, and the model does not beat the baselines on it. The training script's own check records this (`gate_check`): `beats_persistence_mae` false, `beats_persistence_rmse` true, `beats_mean3_mae` false, `beats_mean3_rmse` true, `file_under_size_limit` true.

### How the application uses the forecast

Implemented in `backend/apps/tracking/inference.py` and `backend/apps/planner/views.py`; the mapping from application logs to the panel is in `backend/ml/schema.md`.

- Each course's `StudySessionLog` rows are turned into weekly adherence, `Σ actual_minutes / Σ planned_minutes` capped at 1. Week 0 starts on the date of the course's first log, and only complete weeks before the current week are used. Weeks without logs count as zero.
- With fewer than 2 complete weeks the forecast status is `insufficient_history`. The planner then falls back to the observed mean adherence of the last 30 days (the "rule" source), and to a factor of 1.0 when there are no logs ("none").
- The planner maps the forecast to a factor: below 0.5 gives 0.8, below 0.7 gives 0.9, below 0.85 gives 1.0, and 0.85 or above gives 1.1. Allocations are scaled by these factors and then rescaled so the total available hours are unchanged.
- The model file is read from `ADHERENCE_MODEL_PATH`; its feature order, minimum history and scikit-learn version come from the `.meta.json` next to it. If the file is missing, the scikit-learn major.minor version differs, or loading fails, the status is `model_unavailable` and the planner uses the rule fallback.

### Limitations

1. **Application adherence is a proxy for what the model was trained on.** In training, adherence is a learner's clicks relative to the cohort median for that week. In the application it is actual minutes against the learner's own plan. The model has never seen application data, so the two measures are assumed to behave alike.
2. **The forecast is close to the 3-week mean, pulled toward the population mean.** `adh_mean3` accounts for about 96% of the importance (95.7%). A spot-check of the saved model with a constant weekly adherence (run for this report, not part of the JSON reports) gave forecasts of about 0.85 to 0.91 for a constant 1.0, 0.72 to 0.74 for 0.9, 0.66 to 0.67 for 0.8, 0.63 to 0.67 for 0.7 and 0.58 to 0.59 for 0.5, over 2 to 12 weeks of history. In planner terms: only near-perfect histories reach the 1.1 factor; a history around 0.9 gets 1.0; histories between about 0.5 and 0.8 get 0.9; the factor is limited to the range 0.8 to 1.1.
3. **A course you stop logging drifts toward factor 0.8.** Weeks without logs are zero-filled, so after a few empty weeks `adh_mean3` approaches 0. In the same spot-check, a constant 0 history gave forecasts of about 0.07 to 0.23 (about 0.10 or lower from 4 weeks of history), which maps to the 0.8 factor.
4. **Short history falls back to a rule.** Under 2 complete weeks the forecast is not used and the planner uses the 30-day observed mean; with no logs the factor is 1.0.
5. **The model beats the baselines on RMSE and R², not on MAE.** R² is 0.314, so most of the variance in next-week adherence is not explained by past adherence.
6. **One test presentation, one population.** The test set is a single OULAD presentation (2014J) from a UK distance-learning population. Transfer to Nigerian undergraduates is untested until in-app logs accumulate.
7. **The target is bimodal.** About half of the targets are exactly 1, so errors cluster at the ends of the range and MAE and RMSE reward different behaviour.

## Historical evaluation: the first version of the model (v1/v2), superseded

> **Superseded.** Everything under this heading describes the earlier same-week adherence model, which the next-week forecast above replaced in October 2026. Its target could be rebuilt from its own inputs (§6.3 below describes the shared click-stream dependence), so the figures here, including MAE 0.0291, RMSE 0.0709 and R² 0.957, do not measure forecasting ability and must not be cited as the current result. The artifact and paths named below (`oulad_adherence_model.joblib`, `MODEL_VERSION`, `training_dataset.csv`) belong to that model and are no longer used by the application. The scripts named below (`build_oulad_canonical.py`, `train_oulad_models.py`) have since been rewritten for the forecast and no longer behave as described here.

### 1. Scope

Only the adherence prediction (regression) is covered here. The strategy recommendations are rule-based and not evaluated here; see [The recommendation engine](../README.md#the-recommendation-engine) in the README. A learned recommender would need in-app strategy-outcome data, because OULAD and similar external datasets carry no validated strategy labels.

### 2. Data Source and Construction

The training dataset is derived from the Open University Learning Analytics Dataset (OULAD) and mapped into the project canonical schema (see `backend/ml/schema.md`).

Construction script: `backend/ml/build_oulad_canonical.py`.
Training script: `backend/ml/train_oulad_models.py`.

#### Canonical features used as model inputs

1. planned_minutes
2. completion_rate
3. sessions_last_7_days
4. focus_score
5. help_seeking_rate
6. consistency_score
7. avg_quiz_score_recent
8. created_at (relative day index, not calendar datetime)

#### Target

- adherence_score = clip(total_clicks / expected_clicks, 0, 1)
- where expected_clicks is the cohort median per module/presentation/window.

### 3. Methodological Discovery: Target Leakage in v1 Construction

An audit of the v1 OULAD canonical pipeline revealed a target-leakage issue:

- `adherence_score` was defined as `total_clicks / expected_clicks` (the engagement_ratio).
- `completion_rate` was defined as `mean_assessment_score / 100` when assessment data was available; otherwise it fell back to the same `engagement_ratio`.
- ~78% of learner-window rows had no assessment data in the window, so for those rows `completion_rate == adherence_score` by construction.
- This produced direct target leakage: the model could solve the regression task by reading the leaked feature.

#### Evidence

Pre-fix training report (`backend/ml/reports/oulad_training_report.preleakagefix.json`):

- Feature importance: `completion_rate = 0.80`, with all other features summing to ~0.20.
- Model metrics: MAE 0.0041, RMSE 0.0267, R² 0.994.
- Baseline (mean prediction) metrics: MAE 0.3237, RMSE 0.3582, R² ~0.

The very high R² is an artifact of the leakage: the model is approximately learning `y ≈ completion_rate` for the 78% of rows where the two are identical, and learning a reasonable function of clicks for the rest.

#### Fix Applied

Commit-level change in `backend/ml/build_oulad_canonical.py`:

- Removed the `engagement_ratio` fallback for `completion_rate`.
- `completion_rate = mean_assessment_score / 100` only when assessment data is available; NaN otherwise.
- NaN values are imputed at training time using the existing `SimpleImputer(strategy="median")` step in the training pipeline.

After the fix, `completion_rate` and `adherence_score` derive from independent OULAD signals (assessment scores and click activity respectively).

### 4. Methodology

#### 4.1 Splitting Strategy

- Time-aware split based on the `created_at` window index (per `backend/ml/train_oulad_models.py:build_splits`).
- Train: 70%, Validation: 10%, Test: 20%.
- Sorting by `created_at` then slicing reduces forward-looking leakage from time-correlated features.

#### 4.2 Baseline

- Mean-prediction baseline: every test row is predicted as the mean adherence of the training set.
- This baseline reflects the floor any model must beat to be considered useful.

#### 4.3 ML Model

- Pipeline: `SimpleImputer(strategy="median")` → `RandomForestRegressor`.
- Hyperparameter search over three configurations:
  - `n_estimators=200, max_depth=None, min_samples_leaf=1`
  - `n_estimators=200, max_depth=12, min_samples_leaf=2`
  - `n_estimators=200, max_depth=20, min_samples_leaf=5`
- Best model is selected by validation RMSE, then refit on train + validation for final test evaluation.

#### 4.4 Metrics

- Mean Absolute Error (MAE)
- Root Mean Squared Error (RMSE)
- Coefficient of determination (R²)

### 5. Results

#### 5.1 Pre-fix (leakage-affected, v1 construction)

Documented for transparency; these numbers are not the result of valid generalisation.

| Model | MAE | RMSE | R² |
|---|---|---|---|
| Baseline (mean) | 0.3237 | 0.3582 | ~0 |
| RandomForest v2 | 0.0041 | 0.0267 | 0.994 |

Feature importance was dominated by `completion_rate` (0.80) due to leakage.

#### 5.2 Post-fix (leakage-clean)

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

### 6. Discussion

#### 6.1 What the Pre-fix Numbers Showed (and Did Not Show)

The pre-fix model effectively learned a near-identity function from `completion_rate` to `adherence_score`, plus a residual function over click-based features for the rows where `completion_rate` was a real signal. The high R² was a measurement artifact, not evidence of generalisation.

#### 6.2 What the Post-fix Numbers Mean

With the leakage removed, `completion_rate` is NaN for ~76% of rows and the imputer fills with the train-set median; importance collapses to ~0 (as expected when a feature has no discriminating signal). The model now relies on click-based behavioural features (`focus_score`, `planned_minutes`, `consistency_score`, `sessions_last_7_days`) to predict adherence. The lower R² (0.957 vs 0.994) reflects honest generalisation rather than a leakage-inflated score.

#### 6.3 Residual Correlation Between Click-Based Features and Adherence

An honest disclosure: `focus_score`, `planned_minutes`, and `adherence_score` are all derived from the same OULAD click stream:

- `focus_score = clip(total_clicks / active_days, 0, p90) / p90`
- `planned_minutes = expected_clicks / clicks_per_minute` (cohort median per window)
- `adherence_score = clip(total_clicks / expected_clicks, 0, 1)`

Because all three share `total_clicks` as a constituent, there is residual correlation among the inputs and the target. This is intrinsic to behavioural-proxy modelling on OULAD and cannot be fully eliminated within this dataset — adherence as defined here is fundamentally a click-volume ratio, and click volume is the strongest behavioural signal available. This is different in kind from the pre-fix leakage, where `completion_rate` was literally equal to `adherence_score` for the majority of rows. Here the model still learns a non-trivial transformation across multiple aggregations of the click stream rather than reading the answer from one feature.

The post-deployment runtime schema (v2; `backend/ml/schema.md`) collects independent in-app signals (self-reported focus, actual vs planned minutes from session timers, explicit assessment outcomes) which will reduce this residual correlation in subsequent training cycles.

#### 6.4 Why the Model is Still Useful

The post-fix model beats the mean baseline on MAE and RMSE (~10x improvement on MAE) and feeds into the planner's adherence-weighted allocation factor (`backend/apps/planner/views.py`). This is the intended deployment story: a measurable improvement over rule-only allocation on the metrics that matter for the planner's decisioning, with a rule-based fallback whenever the model artifact is missing (`backend/apps/tracking/inference.py:get_model`).

### 7. Deployment Integration

- Model artifact: `backend/ml/models/oulad_adherence_model.joblib`.
- Inference: `backend/apps/tracking/inference.py` loads the artifact under an `lru_cache` and returns `(None, "model_unavailable")` if absent so callers fall back to recorded `adherence_score`.
- Versioning: `MODEL_VERSION = "oulad_adherence_v2"` constant; persisted with each session log row via `predicted_adherence` and `model_version` fields.
- Planner integration: `backend/apps/planner/views.py` uses `Coalesce("predicted_adherence", "adherence_score")` over the prior 30 days to compute an adherence factor per course, then rescales allocations to preserve the user's total available hours.

### 8. Limitations

1. Adherence is a behavioural proxy from click activity, not a direct measure of plan-following intent.
2. `completion_rate` after the fix is sparse (NaN for ~78% of rows) and imputed; this limits its learnable signal.
3. `created_at` is a relative day index per presentation, not an absolute datetime; this is appropriate for OULAD but means time-of-year effects cannot be modelled.
4. The dataset is from a UK distance-learning population; transfer to a Nigerian undergraduate context will need domain adaptation once in-app logs accumulate.

### 9. Next Evaluation Cycle

Once in-app behavioural logs accumulate at sufficient scale, the canonical schema (`backend/ml/schema.md` Runtime App Schema v2) becomes the primary training source. At that point, re-run the same baseline-vs-ML comparison and report side-by-side with the OULAD-trained model to demonstrate transfer behaviour.
