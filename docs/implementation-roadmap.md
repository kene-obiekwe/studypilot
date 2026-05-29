# Implementation Roadmap (Chapter 4 Kickoff)

## Requirement Mapping from Chapters 1-3

1. Personalised study planning and timetable generation
2. Adaptive timetable optimisation based on learner behavior
3. Learning strategy recommendations
4. Progress tracking and reflective feedback
5. Reminder/notification support
6. Mobile-first student interface
7. AI lifecycle: data collection, model training, testing, deployment, and retraining

## AI Methodology (Defence-Critical)

1. Define prediction tasks:
	- Task A: Predict study session adherence (supervised regression).
	- Task B: Recommend effective strategy category (rule-based engine with heuristic confidence; supervised classification deferred until in-app strategy-label data is available, because external datasets used for initial training do not carry trustworthy strategy labels).
2. Build dataset pipeline:
	- Collect onboarding/profile signals, course workload, planned sessions, actual sessions, focus scores, completion rates.
	- Store anonymized training rows for model training.
3. Prepare data:
	- Handle missing values, normalize numeric features, encode categorical features.
	- Split by user/time to avoid leakage.
4. Train baseline and improved models:
	- Adherence (Task A): mean-prediction baseline vs Random Forest / Gradient Boosting regressor.
	- Strategy (Task B): rule engine is the production module; supervised classifier is future work.
5. Evaluate and compare:
	- Adherence regression metrics: MAE, RMSE, R² — model vs mean-prediction baseline.
	- Strategy classification metrics (Accuracy, Precision, Recall, F1) listed as the evaluation contract for the deferred supervised classifier; not reported in the current scope.
6. Deploy inference:
	- Export models as versioned artifacts and load in Django service layer.
7. Monitor and retrain:
	- Track drift and performance drop.
	- Retrain on a fixed cadence (e.g., monthly) or threshold trigger.

## Proposed Build Phases

### Phase 1: MVP Foundation (Weeks 1-2)

1. Setup monorepo and environments
2. Implement auth and student profile
3. Implement baseline rule-based planner API
4. Implement recommendation API
5. Build mobile-first dashboard and planning forms
6. Start data logging schema for AI training set creation

### Phase 2: Adaptive Intelligence (Weeks 3-5)

1. Add progress capture and analytics features
2. Implement optimisation loop for schedules (adherence-based adjustment)
3. Build feature engineering pipeline from logged study events
4. Train first adherence model (supervised) and finalise rule engine for strategy recommendation
5. Integrate adherence inference into planner; recommendation service remains rule-based
6. Introduce recommendation confidence scores (heuristic)

### Phase 3: Evaluation and Hardening (Weeks 6-8)

1. Usability and pilot user testing
2. Performance and API reliability checks
3. Metrics collection for Chapter 5 analysis
4. AI model evaluation report (baseline vs ML)
5. Documentation, screenshots, and deployment notes

## MVP Success Criteria

1. Student can input courses, available time, and preferences
2. System returns generated weekly study timetable
3. System returns tailored learning strategy recommendations
4. Student can log session outcomes and view progress summaries
5. System stores usable training data and can run reproducible training/evaluation scripts

## AI Deliverables Checklist

1. Dataset schema document
2. Data preprocessing and feature pipeline
3. Training script and saved model artifacts
4. Evaluation report with metrics and confusion matrix/error analysis
5. Inference integration in backend API
6. Retraining and versioning plan
