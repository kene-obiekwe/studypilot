# AI-Powered Personalised Study Planning and Learning Recommendation System

StudyPilot AI is a mobile-first web application that helps undergraduate learners
plan study time, receive adaptive learning-strategy recommendations, and track
adherence to their plan through a closed planning–tracking–learning loop. A
trained adherence prediction model feeds back into the study planner so that
each course's allocation adapts to the learner's recent behaviour.

## Architecture

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 (React 18, TypeScript, mobile-first) |
| Backend | Django 5 + Django REST Framework, JWT authentication |
| Database | PostgreSQL 16 (provisioned via Docker Compose) |
| ML | scikit-learn Random Forest regressor loaded by the backend inference layer |
| Dev workflow | Docker Compose for the database, Python virtualenv for the backend, Node.js/npm for the frontend |

Two AI components:

1. **Next-week adherence forecast (Task A)** — a supervised Random Forest
   regressor trained on a weekly panel built from the Open University Learning
   Analytics Dataset. It forecasts a course's adherence for the coming week from
   the preceding weeks only. The trained artifact is loaded by the Django
   backend and consumed by the planner's adherence-weighted re-allocation
   logic, which falls back to the observed 30-day mean when a course has fewer
   than two complete weeks of logs.
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
   git clone https://github.com/kene-obiekwe/studypilot.git
   cd studypilot
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
data. That default password is for local development only; with `DEBUG` off the
command refuses to run unless you pass `--allow-production` and set `PILOT_PASSWORD`
to a strong password.

## Dataset (OULAD)

The adherence model is trained on the **Open University Learning Analytics
Dataset (OULAD)**. It is not committed to this repository because it exceeds
GitHub's file size limits and can be freely obtained from the source.

**To obtain the dataset:**

1. Download the seven CSV files from the official OULAD page:
   <https://analyse.kmi.open.ac.uk/open-dataset>
   Licensed under Creative Commons Attribution 4.0 International.
2. Extract the archive into a directory named `Dataset/` at the repository
   root. After extraction the folder should contain:
   ```
   Dataset/
     assessments.csv
     courses.csv
     studentAssessment.csv
     studentInfo.csv
     studentRegistration.csv
     studentVle.csv
     vle.csv
   ```
3. This is the default location expected by
   `backend/ml/build_oulad_canonical.py`. If you place the CSVs elsewhere,
   pass `--input-dir <path>` when running the build script.

## Machine learning pipeline

Reproducible training pipeline documented in
[`backend/ml/README.md`](backend/ml/README.md).

Summary:

- `backend/ml/build_oulad_canonical.py` — builds the OULAD weekly adherence
  panel from the raw CSVs.
- `backend/ml/train_oulad_models.py` — trains the next-week forecast with a
  split by presentation and a hyperparameter search, and evaluates it against
  mean, persistence and 3-week-mean baselines.
- `backend/ml/schema.md` — panel columns, feature definitions and the mapping
  from app logs.

The raw dataset (`Dataset/`), canonical build outputs (`backend/ml/data/`),
model artifacts (`backend/ml/models/`), and training reports
(`backend/ml/reports/`) are excluded from git because they are large and
regenerable from the scripts above.

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
- **Adherence forecast offline metrics** — on the held-out test presentation
  (OULAD 2014J): MAE **0.307**, RMSE **0.380**, R-squared **0.314**. The 3-week
  mean baseline scores 0.268 / 0.403 / 0.229 and last-week persistence scores
  0.277 / 0.462 / −0.014. The forecast has lower RMSE and higher R-squared than
  both, and higher MAE. Limitations are listed in
  [`docs/evaluation-report.md`](docs/evaluation-report.md).

## Environment configuration

Sensitive configuration is loaded from `.env` files. Templates are provided:

- `backend/.env.example` — Django settings + database connection.
- `frontend/.env.example` — public API base URL for the client.

The actual `.env` files are not tracked in git.

## License and attribution

Academic project submitted in partial fulfilment of the requirements for the
BSc Computer Science at Pan-Atlantic University, July 2026.
