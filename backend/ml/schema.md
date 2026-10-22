# Training Dataset Schema

This file has four parts:

1. **Forecast Panel Schema (current model).** The weekly panel, feature definitions and the mapping from app logs. This is what the application's adherence model is trained on and served with.
2. **Superseded: Canonical Project Schema (earlier same-week model, v1/v2).** The learner-window schema the earlier model used. `build_oulad_canonical.py` no longer produces it.
3. **External Source Adapter (Template)** and **Runtime App Schema (v2)**, which still apply to adding datasets and to snapshots built from app logs.
4. **Governance and Reporting Rules.**

## Forecast Panel Schema (Current Model)

Written by `build_oulad_canonical.py` to `data/oulad/forecast_panel.csv`, with definitions and counts in `data/oulad/forecast_metadata.json`.

### Modeling Unit

One row per (`id_student`, `code_module`, `code_presentation`, `week`) over the registration's enrolled span. Week = `date // 7`, counted from week 0 (the presentation start). Clicks with a date before 0 are ignored. Enrolled weeks are `0 .. end_day // 7 - 1` (full weeks only), where `end_day = min(module_presentation_length, date_unregistration if present)`. Registrations that unregistered before day 0, or that have no full enrolled week, are excluded. Enrolled weeks with no `studentVle` rows are gap-filled with zero activity.

### Panel Columns

| Column | Meaning |
|---|---|
| `id_student`, `code_module`, `code_presentation` | Registration key. |
| `week` | Week index from 0. |
| `split` | `train` (2013B, 2013J), `validation` (2014B) or `test` (2014J). |
| `gap_filled` | True if the week had no `studentVle` rows. |
| `total_clicks` | Sum of clicks in the week (0 if gap-filled). |
| `active_days` | Days with clicks in the week (0 if gap-filled). |
| `expected_clicks` | Median `total_clicks` over all enrolled students for the same module, presentation and week, zeros included. |
| `adherence` | Target: `clip(total_clicks / expected_clicks, 0, 1)`; missing when `expected_clicks` is 0. |
| `adh_lag1`, `adh_lag2`, `adh_mean3`, `adh_trend`, `weeks_history` | Model features (below). |
| `active_days_lag1`, `active_days_mean3`, `focus_lag1` | Reporting columns, not model inputs (below). |
| `is_training_row` | `weeks_history >= 2` and `adherence` defined. |

### Feature Definitions

All features for week *t* use only weeks before *t* of the same registration.

| Feature | Definition |
|---|---|
| `adh_lag1` | adherence at *t*-1 (missing if `expected_clicks` was 0) |
| `adh_lag2` | adherence at *t*-2 |
| `adh_mean3` | mean of the available adherence values at *t*-1 to *t*-3 |
| `adh_trend` | `adh_lag1 - adh_lag2` |
| `weeks_history` | number of enrolled weeks before *t* (equals *t*) |

Missing values are filled by the pipeline's `SimpleImputer(strategy="median")`.

Reporting columns, computed with the same prior-weeks-only rule but not used by the model, because the app's per-course active days sit on a lower scale than OULAD's and its focus is a self-reported slider rather than click intensity:

| Column | Definition |
|---|---|
| `active_days_lag1` | active days at *t*-1 (0 to 7) |
| `active_days_mean3` | mean of active days at *t*-1 to *t*-3 (available weeks) |
| `focus_lag1` | `clip((clicks_{t-1} / max(active_days_{t-1}, 1)) / P90, 0, 1)`, with P90 = 41.5 clicks per active day (non-test presentations) |

### Target

`adherence` for week *t*. A learner's clicks relative to the cohort median, capped at 1. About half the targets are exactly 1 and nearly a third are exactly 0; see `docs/evaluation-report.md`.

### App-Side Mapping

`apps.tracking.inference` rebuilds the same quantities from a user's `StudySessionLog` rows, one course at a time:

| Panel concept | App equivalent |
|---|---|
| Week 0 | The date of the course's first log (in `settings.TIME_ZONE`). Weeks are 7-day blocks from there. |
| Weeks used | Only complete weeks before the week containing today. The current week is never used. |
| `adherence` | `sum(actual_minutes) / sum(planned_minutes)` over the week's logs, capped to [0, 1]; missing if planned minutes sum to 0. |
| Gap-filled week | A week with no logs: adherence 0, active days 0, focus 0. |
| `adh_lag1`, `adh_lag2`, `adh_mean3`, `adh_trend` | The same formulas applied to the weekly adherence values. |
| `weeks_history` | The number of complete weeks. |
| Minimum history | `min_weeks_history` from the model's meta file (2). Below it the status is `insufficient_history` and no forecast is made. |
| Feature order | `feature_order` from the model's meta file. |

Forecast statuses: `ok`, `insufficient_history`, `model_unavailable`, `prediction_failed`. The planner uses the forecast only for `ok`; otherwise it uses the 30-day observed mean adherence for the course, or no adjustment when there are no logs.

### Known Mismatches Between Training and App

1. App adherence is a proxy. It compares actual time with the learner's own plan, while training adherence is clicks relative to the cohort median for the week.
2. App week 0 is the first log, not the start of a presentation, so a learner who starts logging late has a short history.
3. A course that stops being logged is zero-filled week by week, so its forecast drifts toward the lowest adherence factor. See "Limitations" in `docs/evaluation-report.md`.

## Superseded: Canonical Project Schema (Earlier Same-Week Model, v1/v2)

This part describes the learner-window schema used by the earlier model. The current build script does not produce it, and the application no longer uses a model trained on it. It is kept for the historical evaluation in `docs/evaluation-report.md`.

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
