# AI Methodology for Implementation and Defence

## 1. AI Objectives

The system uses AI for one supervised task and one rule-based task:

1. Forecasting next-week adherence to planned study sessions (supervised regression).
2. Recommending a study strategy category for each student context (rule-based engine with heuristic confidence). Supervised strategy classification is deferred until sufficient in-app strategy-label data is collected, because external datasets used for initial training do not carry trustworthy strategy labels.

## 2. Problem Formulation

### Task A: Next-Week Adherence Forecast (Regression)

- Input: a course's weekly adherence history from the weeks before the one being predicted: adherence at the last two weeks (`adh_lag1`, `adh_lag2`), the mean of the last three (`adh_mean3`), their difference (`adh_trend`) and the number of weeks of history (`weeks_history`).
- Output: forecast adherence for the coming week, in range [0, 1].
- Target: in training, `clip(total_clicks / expected_clicks, 0, 1)` for the week, where `expected_clicks` is the cohort median for that module, presentation and week. In the app, adherence is actual minutes over planned minutes for the week, capped at 1.
- Why: the planner scales each course's allocation by a factor derived from the forecast, so it needs an estimate of next week, not a restatement of the current one.
- Earlier version: a same-week model with a different feature set and a target that could be rebuilt from its inputs was replaced in October 2026; see `docs/evaluation-report.md`.

### Task B: Strategy Recommendation (Rule-Based with Confidence)

- Input: learner style, focus score, completion rate.
- Output: ranked strategy set drawn from {visual, reading, practice, mixed} variants, with a heuristic confidence value.
- Why: external training datasets do not carry validated strategy labels, so a supervised classifier would be circular. A transparent rule engine preserves explainability and is the recommended posture until in-app strategy outcomes accumulate at sufficient scale (see `backend/ml/schema.md` governance rules).
- Future work: once enough in-app labels exist, a supervised classifier (RandomForest) will be trained, evaluated against the rule engine, and deployed behind the same API with rule fallback.

## 3. Data Collection Plan

Primary training data is collected from external educational interaction datasets (not user-entered pilot data):

1. External learner-event datasets:
   - longitudinal interaction logs, correctness/performance outcomes, and behavior-related features.
2. Canonical feature mapping:
   - map source columns into project semantics. For the adherence forecast this is a weekly panel of click activity and a cohort-relative adherence target (see `backend/ml/schema.md`).
3. Pilot app data:
   - retained only for monitoring and future domain adaptation when enough records are available.
4. Runtime transition:
   - after deployment scale, incrementally retrain with real in-app logs.

Data storage principles:

1. Use internal user id, not full personal identifiers, in training tables.
2. Keep a timestamp for each record for time-based validation.
3. Keep raw event logs and curated training tables separately.
4. Document data-source provenance, licenses, and feature-proxy assumptions.

## 4. Dataset Construction

Task A (adherence forecast): one row per registration and week over the enrolled span, with gap weeks filled with zero activity. Features for week *t* are computed only from weeks before *t*:

1. adh_lag1
2. adh_lag2
3. adh_mean3
4. adh_trend
5. weeks_history
6. target: adherence for week *t*

Task B (strategy recommendation, future work): one row per learner-window, with features such as focus_score, completion_rate, difficulty_mean, deadlines_within_7_days, sessions_in_last_7_days and style_encoded, and a strategy_label once a valid label is available.

Notes:
- Nothing from week *t* itself is used as an input to the Task A forecast.
- In the app, weekly adherence is computed from session logs as actual_minutes / planned_minutes (summed over the week, capped at 1) and enters the model only as the lagged values above.

## 5. Data Preprocessing and Features

1. Missing values:
   - numeric -> median
   - categorical -> mode
2. Encoding:
   - one-hot encode style/course category.
3. Scaling:
   - scale continuous features for linear/boosting models.
4. Leakage prevention:
   - split by presentation, so no student-week is shared between train, validation and test.
   - build features for week *t* only from weeks before *t*.
   - do not use inputs that are derived from the same quantity as the target (the earlier same-week model did, which is why it was replaced).

## 6. Model Training Approach

Baseline and improved models are both required for a strong defence.

### Baseline

1. Rule-based scheduling for the planner (mean adherence per course).
2. Rule-based strategy engine for recommendations (production module; not just a baseline).

### ML Candidates

1. Adherence forecast (Task A, current scope): RandomForestRegressor (implemented).
2. Strategy recommendation (Task B, future work): RandomForestClassifier, trained on in-app strategy outcomes once available.

Training protocol (applies to Task A):

1. Split by presentation: train on 2013B and 2013J, validate on 2014B, test on 2014J.
2. Grid search over `max_depth` {8, 12, 16} and `min_samples_leaf` {20, 50, 100}, restricted to configurations whose saved file is under 30 MB.
3. Select the configuration with the lowest validation RMSE.
4. Refit on train plus validation and evaluate once on the test presentation.

## 7. Testing and Evaluation

### Regression Metrics (Task A)

1. MAE
2. RMSE
3. R2

### Classification Metrics (Task B, future work only)

1. Accuracy
2. Precision
3. Recall
4. F1-score
5. Confusion matrix

These metrics are not reported in the current implementation because the rule engine has no comparator model. They are listed here as the evaluation contract for the deferred supervised classifier.

Required comparison:

1. Adherence: the forecast model against three baselines (the mean of the training targets, last week's adherence, and the mean of the last three weeks) on MAE, RMSE and R². Acceptance is judged on RMSE and R², because the target is bimodal (about half exactly 1, nearly a third exactly 0); MAE is still reported. On the test presentation (2014J) the model scores MAE 0.307, RMSE 0.380, R² 0.314, against 0.268, 0.403 and 0.229 for the 3-week mean and 0.277, 0.462 and −0.014 for last week's adherence. It beats both on RMSE and R² and not on MAE. Details and limitations are in `docs/evaluation-report.md`.
2. Recommendation: rule-engine outputs reviewed qualitatively against expected strategy patterns; quantitative comparison deferred to future work alongside the supervised classifier.

## 8. Deployment in the System

1. Save models as versioned artifacts (joblib).
2. Load model artifacts in backend inference service.
3. Use fallback to rule-based output if model is unavailable.
4. Log every prediction for monitoring.

## 9. Monitoring and Retraining

1. Monitor:
   - prediction error trend
   - class distribution drift
   - recommendation acceptance/completion rate
2. Retrain trigger:
   - monthly schedule or metric threshold drop.
3. Versioning:
   - model version id, training date, dataset snapshot id.

## 10. Ethics and Reliability

1. Obtain informed consent for data use.
2. Minimise sensitive personal data in training sets.
3. Provide transparency: recommendations should include brief reason tags.
4. Allow user override of generated timetables and strategies.

## 11. What to Say in Defence

1. The system started with rule-based modules to guarantee functionality across both AI tasks.
2. The adherence model (Task A) forecasts next-week adherence from prior weeks. It is trained on a curated external educational dataset (OULAD) because pilot user-input data is too limited for reliable supervised learning, and evaluated on a held-out presentation against train-mean, persistence and 3-week-mean baselines using MAE, RMSE, and R². It beats the baselines on RMSE and R², not on MAE, and explains about a third of the variance; the earlier same-week model reported much higher scores because its target could be rebuilt from its inputs, and that is why it was replaced.
3. The recommendation module (Task B) is intentionally rule-based with a heuristic confidence score: external datasets do not carry validated strategy labels, so supervised classification would be circular. Supervised classification is deferred to future work once in-app strategy outcomes accumulate at sufficient scale.
4. Only validated models are deployed, with rule fallback for robustness if the model artifact is missing or inference fails.
5. Continuous monitoring is active, and retraining shifts progressively to real in-app data once sufficient scale is reached.
