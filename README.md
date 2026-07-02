# AI-Powered Personalised Study Planning and Learning Recommendation System

Final Year Project — Bachelor of Science, Computer Science, Pan-Atlantic University.
Author: **Kene Christopher Obiekwe** (22120613021).

StudyPilot AI is a mobile-first web application that helps undergraduate learners
plan study time, receive adaptive learning-strategy recommendations, and track
adherence to their plan through a closed planning–tracking–learning loop. A
trained adherence prediction model feeds back into the study planner so that
each course's allocation adapts to the learner's recent behaviour.

The full dissertation is in
[`Resources/Chapters 1-5 - Final.docx`](Resources/Chapters%201-5%20-%20Final.docx).

## Architecture

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 (React 18, TypeScript, mobile-first) |
| Backend | Django 5 + Django REST Framework, JWT authentication |
| Database | PostgreSQL 16 (provisioned via Docker Compose) |
| ML | scikit-learn Random Forest regressor loaded by the backend inference layer |
| Dev workflow | Docker Compose for the database, Python virtualenv for the backend, Node.js/npm for the frontend |

Two AI components:

1. **Adherence prediction (Task A)** — a supervised Random Forest regressor
   trained on a canonical schema derived from the Open University Learning
   Analytics Dataset. The trained artifact is loaded by the Django backend
   and consumed by the planner's adherence-weighted re-allocation logic.
2. **Learning strategy recommendation (Task B)** — a transparent rule engine
   with a heuristic confidence score. A supervised classifier is reserved as
   future work once in-app strategy-outcome data accumulates.

## Repository structure

```
backend/           Django project (settings + apps for users, planner,
                   recommendations, tracking) and the ML pipeline
  apps/            Feature apps (users, planner, recommendations, tracking)
  config/          Django settings and URL configuration
  ml/              Canonical schema, training scripts, model artifacts
frontend/          Next.js client (routes, components, styles)
  app/             App Router pages including the workspace + progress
                   sub-routes
  components/      Shared React components
  lib/             API client + session helpers
docs/              AI methodology, chapter outline, evaluation report,
                   evaluation kit (SUS questionnaire, participant script,
                   analysis script)
docs/evaluation/   SUS evaluation kit and collected response data
Resources/         Dissertation working files and screenshots used in
                   Chapter 4
docker-compose.yml Docker Compose service for the PostgreSQL database
```

## Quick start

Prerequisites: Python 3.12+, Node.js 20+, Docker Desktop, Git.

1. **Clone the repository**
   ```bash
   git clone https://github.com/kene-obiekwe/cs_fyp_2026.git
   cd cs_fyp_2026
   ```

2. **Set up environment files**
   ```bash
   cp backend/.env.example backend/.env
   cp frontend/.env.example frontend/.env.local
   ```

3. **Start the PostgreSQL container**
   ```bash
   docker-compose up -d db
   ```
   Exposes port `55432` on the host. If that port is not available on your
   machine (for example on Windows where Hyper-V may reserve it), change the
   host port on the `db` service in `docker-compose.yml` and update
   `DB_PORT` in `backend/.env` to match.

4. **Install backend dependencies, apply migrations, and start the API**
   ```bash
   cd backend
   python -m venv .venv && .venv/Scripts/activate    # Windows
   # source .venv/bin/activate                       # macOS / Linux
   pip install -r requirements.txt
   python manage.py migrate
   python manage.py runserver 8000
   ```

5. **In a second terminal, install and start the frontend**
   ```bash
   cd frontend
   npm install
   npm run dev
   ```

6. **Open** `http://localhost:3000` in your browser.

### Seed demo data (optional)

Populate the workspace with five deterministic pilot users so the analytics
dashboard and history views are non-empty during demonstration:

```bash
cd backend
python manage.py seed_pilot_data
```

Sign in as `pilot_consistent` (password `Pilot12345!`) for the richest seeded
data. Full protocol: [`docs/pilot-demo-guide.md`](docs/pilot-demo-guide.md).

## Machine learning pipeline

Reproducible training pipeline documented in
[`backend/ml/README.md`](backend/ml/README.md).

Summary:

- `backend/ml/build_oulad_canonical.py` — adapts OULAD raw CSVs into the
  project canonical schema.
- `backend/ml/train_oulad_models.py` — trains the adherence regression model
  with a time-aware train/validation/test split and hyperparameter search.
- `backend/ml/schema.md` — canonical schema and feature definitions.

Dataset files, canonical build outputs, model artifacts and training reports
are excluded from git (see `.gitignore`) because they are large and
regenerable.

Full evaluation report — including the target-leakage discovery and
resolution — is in [`docs/evaluation-report.md`](docs/evaluation-report.md).

## Evaluation

Two-strand evaluation aligned to the third research objective (Chapter 4
§4.3):

- **Usability (SUS)** — mean **61.82** (Grade C) across eleven undergraduate
  participants, with the onboarding flow identified as the principal area for
  improvement. Kit at [`docs/evaluation/`](docs/evaluation) including the
  questionnaire, in-person participant script, Python analysis script, and
  the collected response data.
- **Adherence model offline metrics** — MAE **0.0291**, RMSE **0.0709**,
  R-squared **0.957** on the held-out test set, approximately an
  order-of-magnitude MAE reduction versus a mean-prediction baseline.

## Environment configuration

Sensitive configuration is loaded from `.env` files. Templates are provided:

- `backend/.env.example` — Django settings + database connection.
- `frontend/.env.example` — public API base URL for the client.

The actual `.env` files are not tracked in git.

## License and attribution

Academic project submitted in partial fulfilment of the requirements for the
BSc Computer Science at Pan-Atlantic University, July 2026.
