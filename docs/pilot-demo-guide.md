# Pilot Demo Guide

This guide explains how to populate the system with deterministic pilot data and what to capture for Chapter 4 §4.5 (UI implementation) and §4.6 (testing and validation).

The seeded data is **synthetic system-validation data**, not real pilot user feedback. Real pilot feedback collection remains future work and should be conducted separately if needed.

## 1. Setup

Prerequisites:

- Backend dependencies installed (`pip install -r backend/requirements.txt`).
- Migrations applied (`python backend/manage.py migrate`).
- Trained adherence model artifact present at `backend/ml/models/oulad_adherence_model.joblib` (otherwise predicted_adherence falls back to `model_unavailable`, which is acceptable for the UI screenshots but the predictor card will show no forecast).

## 2. Seed the Pilot Data

From `backend/`:

```bash
python manage.py seed_pilot_data
```

Re-running is safe: prior pilot plans, recommendations, and sessions are cleared and reseeded deterministically. Add `--reset` to also delete the pilot user accounts before reseeding:

```bash
python manage.py seed_pilot_data --reset
```

The command seeds five pilot users with distinct behaviour profiles:

| Username | Profile | Preferred Style | Adherence Mean |
|---|---|---|---|
| `pilot_consistent` | Consistent high adherer | visual | 0.92 |
| `pilot_struggling` | Struggling learner | mixed | 0.45 |
| `pilot_improving` | Improving practice-oriented | practice | 0.70 |
| `pilot_declining` | Declining reading-oriented | reading | 0.60 |
| `pilot_average` | Average mixed learner | mixed | 0.75 |

All accounts share password: **`Pilot12345!`**

Each user has:

- 3 courses drawn from a fixed catalogue (CSC 401, MTH 401, STA 401, PHY 301, ENG 401).
- 1 study plan backdated to the middle of the 28-day seed window.
- 3 recommendation events spread across the window.
- 14–20 session logs spread across the window with realistic adherence noise around the profile mean.

## 3. Run the Stack

From the repo root:

```bash
# Terminal 1 — backend
cd backend && python manage.py runserver

# Terminal 2 — frontend
cd frontend && npm run dev
```

Open <http://localhost:3000>.

## 4. Screenshot Checklist (Chapter 4 §4.5)

Capture each at a typical mobile viewport (375×812) and a desktop viewport (1280×800). Pilot user shown in parentheses is the recommended account for the most illustrative screenshot.

1. **Landing page** (`/`) — public marketing layout.
2. **Auth page** (`/auth`) — fields visible, no active session.
3. **Auth page (post-login)** — session state showing "Authenticated" (`pilot_consistent`).
4. **Overview / workspace home** (`/overview`) — quick-start cards and learner benefits (`pilot_consistent`).
5. **Planner form** (`/planner`) — three courses pre-populated from the seeded course list (`pilot_consistent`).
6. **Planner result** — submitted form showing allocations with adherence-factor pills (`pilot_consistent`, who has high adherence so factors should be ≥1.0; contrast with `pilot_struggling`).
7. **Recommendations input** (`/recommendations`) — pre-filled focus/completion/preferred-style (`pilot_improving`).
8. **Recommendations result** — strategy list and confidence pill (`pilot_improving`).
9. **Progress dashboard top tiles** (`/progress`) — Planner Histories / Recommendation Events / Tracked Sessions counts (`pilot_average`).
10. **Progress dashboard analytics tiles** — Average Adherence, AI Forecast, Focus/Completion, Time Coverage (`pilot_consistent` for high numbers; `pilot_struggling` for the contrast).
11. **Progress training-dataset snapshot tile** — rows count, weekly intensity, difficulty mix (`pilot_consistent`).
12. **Progress latest plan and recommendation cards** (`pilot_consistent`).
13. **Adherence predictor card** — fresh forecast with `predicted_adherence` and model version visible.
14. **Session log form + result tiles** — post-submission strip with Adherence, Predicted Adherence, Focus Signal, Completion Signal (any pilot).
15. **Paginated history sections** — "All Planner Plans", "All Recommendation Events", "All Session Logs" with pager controls visible (`pilot_consistent` has the highest session count).

## 5. End-to-End Validation Flow (Chapter 4 §4.6)

For each pilot, walk through this scripted flow once:

1. Log in.
2. Visit Planner → input courses already match seeded courses → submit. Verify allocations render and `adherence_factor` pills reflect the user's profile.
3. Visit Recommendations → submit with seeded defaults → verify strategy list returned and confidence between 0 and 1.
4. Visit Progress → verify the four analytics tiles are populated, the predictor card returns a numeric forecast, and the paginated history sections all show rows.

Capture any unexpected behaviour for §4.6 discussion.

## 6. Reset Between Demos

Re-running `python manage.py seed_pilot_data` between demos restores the deterministic state. The seeder uses a fixed RNG seed (`20260529`) so the same numbers appear each time, which is useful for screenshots that need to match across recaptures.

## 7. What This Demo Cannot Show

- **Real pilot feedback**: profiles are synthetic. Statements about user satisfaction must come from a separate qualitative study.
- **Long-term adherence trends**: the seed window is 28 days. Anything longer requires extending the seeder window or running the system over time.
- **Strategy classifier comparison**: Task B is rule-based; there is no supervised classifier to contrast. See `docs/ai-methodology.md` §1 and `docs/evaluation-report.md` §1.
