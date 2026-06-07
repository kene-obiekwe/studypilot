# AI Methodology for Implementation and Defence

## 1. AI Objectives

The system uses AI for one supervised task and one rule-based task:

1. Predicting adherence to planned study sessions (supervised regression).
2. Recommending a study strategy category for each student context (rule-based engine with heuristic confidence). Supervised strategy classification is deferred until sufficient in-app strategy-label data is collected, because external datasets used for initial training do not carry trustworthy strategy labels.

## 2. Problem Formulation

### Task A: Adherence Prediction (Regression)

- Input: learner profile + course/workload + recent study behavior (planned minutes, completion rate, consistency, focus, etc.).
- Output: predicted adherence score in range [0, 1].
- Why: helps optimise schedule intensity and reminder frequency.

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
   - map source columns into project semantics (workload, effort, completion, consistency, help-seeking).
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

Create one row per learner-window (or session window) after external-to-canonical mapping, with features such as:

1. planned_minutes
2. completion_rate
3. focus_score
4. difficulty_mean
5. deadlines_within_7_days
6. sessions_in_last_7_days
7. style_encoded
8. target: adherence_score or strategy_label (if a valid label is available)

Notes:
- actual_minutes is retained for label construction (adherence = actual_minutes / planned_minutes) but is not used as a predictor feature.

## 5. Data Preprocessing and Features

1. Missing values:
   - numeric -> median
   - categorical -> mode
2. Encoding:
   - one-hot encode style/course category.
3. Scaling:
   - scale continuous features for linear/boosting models.
4. Leakage prevention:
   - split train/test by user and time where possible.
   - avoid using label-defining variables (e.g., actual_minutes) as input features.

## 6. Model Training Approach

Baseline and improved models are both required for a strong defence.

### Baseline

1. Rule-based scheduling for the planner (mean adherence per course).
2. Rule-based strategy engine for recommendations (production module; not just a baseline).

### ML Candidates

1. Adherence prediction (Task A, current scope): RandomForestRegressor or GradientBoostingRegressor.
2. Strategy recommendation (Task B, future work): RandomForestClassifier, trained on in-app strategy outcomes once available.

Training protocol (applies to Task A):

1. Train/validation/test split (e.g., 70/15/15).
2. Cross-validation on training data.
3. Hyperparameter search (grid or randomized search).
4. Select model based on validation metrics.

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

1. Adherence: baseline (mean of training targets) vs ML model on MAE, RMSE, R².
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
2. The adherence model (Task A) is trained on a curated external educational dataset because pilot user-input data is too limited for reliable supervised learning, and evaluated against a mean-prediction baseline using MAE, RMSE, and R².
3. The recommendation module (Task B) is intentionally rule-based with a heuristic confidence score: external datasets do not carry validated strategy labels, so supervised classification would be circular. Supervised classification is deferred to future work once in-app strategy outcomes accumulate at sufficient scale.
4. Only validated models are deployed, with rule fallback for robustness if the model artifact is missing or inference fails.
5. Continuous monitoring is active, and retraining shifts progressively to real in-app data once sufficient scale is reached.
