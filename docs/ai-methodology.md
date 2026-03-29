# AI Methodology for Implementation and Defence

## 1. AI Objectives

The system uses AI for two main tasks:

1. Predicting adherence to planned study sessions.
2. Recommending the best study strategy category for each student context.

## 2. Problem Formulation

### Task A: Adherence Prediction (Regression)

- Input: learner profile + course/workload + recent study behavior.
- Output: predicted adherence score in range [0, 1].
- Why: helps optimise schedule intensity and reminder frequency.

### Task B: Strategy Recommendation (Classification)

- Input: learner style, performance trend, focus/consistency signals.
- Output: strategy class (visual, reading, practice, mixed).
- Why: personalises study approach beyond static tips.

## 3. Data Collection Plan

Collect data from system interactions only (with consent):

1. Onboarding/profile:
   - preferred style, available hours, course load, target grades.
2. Planned sessions:
   - date, course, planned duration, plan version.
3. Actual sessions:
   - actual duration, completion ratio, self-reported focus score.
4. Outcomes:
   - quiz score changes, assignment performance trend (when available).

Data storage principles:

1. Use internal user id, not full personal identifiers, in training tables.
2. Keep a timestamp for each record for time-based validation.
3. Keep raw event logs and curated training tables separately.

## 4. Dataset Construction

Create one row per completed study session window with features such as:

1. planned_minutes
2. actual_minutes
3. completion_rate
4. focus_score
5. difficulty_mean
6. deadlines_within_7_days
7. sessions_in_last_7_days
8. style_encoded
9. target: adherence_score or strategy_label

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

## 6. Model Training Approach

Baseline and improved models are both required for a strong defence.

### Baseline

1. Rule-based scheduling and recommendation heuristics.

### ML Candidates

1. Adherence prediction: RandomForestRegressor or GradientBoostingRegressor.
2. Strategy recommendation: RandomForestClassifier.

Training protocol:

1. Train/validation/test split (e.g., 70/15/15).
2. Cross-validation on training data.
3. Hyperparameter search (grid or randomized search).
4. Select model based on validation metrics.

## 7. Testing and Evaluation

### Regression Metrics (Task A)

1. MAE
2. RMSE
3. R2

### Classification Metrics (Task B)

1. Accuracy
2. Precision
3. Recall
4. F1-score
5. Confusion matrix

Required comparison:

1. Baseline rules vs ML model results.
2. Show where ML improves recommendation/adherence outcomes.

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

1. The system started with a rule-based baseline to guarantee functionality.
2. Logged learner behavior data is transformed into supervised datasets.
3. Models are trained/tested with defined metrics and compared with baseline.
4. Only validated models are deployed, with rule fallback for robustness.
5. Continuous monitoring and retraining are built into the lifecycle.
