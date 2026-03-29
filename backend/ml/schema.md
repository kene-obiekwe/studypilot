# Training Dataset Schema

## Core Columns

1. `user_id` (int)
2. `course_name` (str)
3. `difficulty` (int, 1-5)
4. `planned_minutes` (int)
5. `actual_minutes` (int)
6. `focus_score` (float, 0-1)
7. `completion_rate` (float, 0-1)
8. `preferred_style` (visual|reading|practice|mixed)
9. `sessions_last_7_days` (int)
10. `deadlines_within_7_days` (int)
11. `avg_quiz_score_recent` (float, optional)
12. `created_at` (datetime)

## Targets

1. `adherence_score` (float, 0-1):
   - derived as `actual_minutes / planned_minutes`, clipped to 1.
2. `strategy_label` (categorical):
   - recommended strategy category based on observed effectiveness.

## Notes

1. Keep `created_at` for time-based train/test splitting.
2. Remove direct personal identifiers from ML dataset exports.
3. Keep a data dictionary with units and accepted ranges.
