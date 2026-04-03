# Training Dataset Schema

This schema is project-semantic first.

1. Canonical schema (project meaning) defines what the model should learn for this system.
2. Source adapter schema (ASSISTments) defines how external fields are mapped into canonical columns.

The dataset should support the project objective, not replace it.

## Canonical Project Schema (Used by Model Pipeline)

### Modeling Unit

One row per learner-week (or learner-window) so behavior trends can be modeled.

### Core Columns

1. user_id (int)
2. planned_minutes (float)
3. actual_minutes (float)
4. focus_score (float, 0-1)
5. completion_rate (float, 0-1)
6. help_seeking_rate (float, 0-1)
7. consistency_score (float, 0-1)
8. sessions_last_7_days (int)
9. avg_quiz_score_recent (float, optional)
10. created_at (datetime, optional for external data)

### Targets

1. adherence_score (float, 0-1):
   - derived from actual_minutes / planned_minutes, clipped to 1.
2. strategy_label (categorical, optional in v1):
   - visual | reading | practice | mixed.
   - if unavailable, keep recommendation module rule-based and do not train this target yet.

### Optional Benchmark Target (External Dataset Specific)

1. is_stem (binary, 0/1):
   - external benchmark target from ASSISTments training_label.
   - used for comparative research experiments, not as direct substitute for strategy_label.

## Source Adapter: ASSISTments to Canonical Mapping (v1)

This table defines proxy construction from student_log_*.csv + training_label.csv.

1. user_id <- ITEST_id (direct)
2. planned_minutes <- median(timeTaken) / 60000 (proxy baseline workload)
3. actual_minutes <- sum(timeTaken) / 60000 per window (directly derived)
4. focus_score <- 1 - normalized mean(AveResConf, AveResFrust, AveResOfftask, AveResGaming)
5. completion_rate <- mean(correct)
6. help_seeking_rate <- mean(frIsHelpRequest)
7. consistency_score <- 1 - normalized std(timeTaken)
8. sessions_last_7_days <- count of unique action sessions in rolling window (proxy)
9. avg_quiz_score_recent <- AveCorrect (proxy) or MCAS when available
10. created_at <- window end timestamp derived from endTime (if available)
11. adherence_score <- actual_minutes / planned_minutes
12. is_stem <- training_label.isSTEM (benchmark target)

## Runtime App Schema (v2, Future Domain Adaptation)

These columns are collected from the live system and should become the primary training source over time.

1. user_id
2. course_name
3. difficulty
4. planned_minutes
5. actual_minutes
6. focus_score
7. completion_rate
8. preferred_style
9. sessions_last_7_days
10. deadlines_within_7_days
11. avg_quiz_score_recent
12. created_at
13. adherence_score
14. strategy_label

## Governance and Reporting Rules

1. Report results separately for canonical-v1 (external proxy) and v2 (runtime app) datasets.
2. Do not claim personalized strategy model training until strategy_label exists in v2 at sufficient scale.
3. Keep recommendation module rule-based fallback active while strategy_label training data is limited.
4. Document every proxy variable in Chapter 4 to preserve methodological transparency.
