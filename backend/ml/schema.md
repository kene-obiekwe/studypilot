# Training Dataset Schema

This schema is project-semantic first and dataset-neutral.

1. Canonical schema defines what the model should learn for this project.
2. Source adapter schema defines how any external dataset is mapped into canonical columns.
3. External data supports model initialization; it does not redefine project meaning.

## Canonical Project Schema (Used by Model Pipeline)

### Modeling Unit

One row per learner-window (for example learner-week or rolling activity window).

### Feature Availability Levels

1. Required:
   - needed to train adherence prediction reliably.
2. Preferred:
   - improves model quality but can be proxied.
3. Optional:
   - useful if available; may be null for many sources.

### Canonical Columns

1. user_id (int, required)
2. planned_minutes (float, required)
3. actual_minutes (float, required for target construction)
4. completion_rate (float in [0,1], required)
5. sessions_last_7_days (int, required; proxy allowed)
6. focus_score (float in [0,1], preferred; proxy allowed)
7. help_seeking_rate (float in [0,1], preferred; proxy allowed)
8. consistency_score (float in [0,1], preferred; proxy allowed)
9. avg_quiz_score_recent (float, optional)
10. created_at (datetime, optional but recommended)

### Predictor Feature Set (Adherence Model v2)

1. planned_minutes
2. completion_rate
3. sessions_last_7_days
4. focus_score
5. help_seeking_rate
6. consistency_score
7. avg_quiz_score_recent
8. created_at

Notes:
- actual_minutes is used only to compute the adherence_score target and is not used as an input feature.

### Targets

1. adherence_score (float in [0,1], required target)
   - derived as actual_minutes / planned_minutes, clipped to [0,1].
2. strategy_label (categorical, optional target)
   - visual | reading | practice | mixed.
   - if unavailable, keep recommendation module rule-based and do not train a supervised strategy model.

### Optional External Benchmark Target

1. benchmark_label (dataset-specific, optional)
   - allowed only for comparative experiments.
   - never treated as a direct replacement for strategy_label.

## External Source Adapter (Template)

For every external dataset, create a mapping table with the following fields per canonical column:

1. source_field
2. transform_type (direct | derived | proxy | default)
3. transform_rule
4. quality_flag (high | medium | low)
5. missing_rate

### Realistic Mapping Policy

1. Not every canonical feature will exist directly in external datasets.
2. Missing preferred features may be proxied from behavior traces.
3. If required features cannot be computed, the dataset is not suitable for adherence training.
4. Optional fields may remain null if unavailable.

### Minimum External Dataset Requirements (for v1 training)

1. Stable learner identifier (or consistently hashable id)
2. Activity effort signal (duration, count, or equivalent workload proxy)
3. Performance/completion outcome signal
4. Enough event ordering (timestamp or sequence) to construct learner-windows

## Runtime App Schema (v2, Domain Adaptation)

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

1. Report results separately for external-initialized (canonical-v1) and runtime (v2) datasets.
2. Document all proxy assumptions and quality flags for external mappings.
3. Do not claim personalized strategy model training until strategy_label exists at sufficient scale.
4. Keep recommendation module rule-based fallback active while strategy_label training data is limited.
5. Re-evaluate feature availability at each retraining cycle and update adapter documentation.
