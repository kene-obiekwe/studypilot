# AI-Powered Personalised Study Planning and Learning Recommendation System

This workspace contains a starter implementation for this final year project:

- Frontend: Next.js (mobile-first)
- Backend: Django + Django REST Framework
- Database: PostgreSQL
- Auth: JWT
- Core modules: timetable planning, recommendation, progress tracking, reminders

## Project Structure

- `frontend/` - Next.js client (mobile-first UI)
- `backend/` - Django API and core business logic
- `docs/` - implementation roadmap and chapter support notes
- `Resources/` - source documents

## Quick Start

1. Create and activate a Python virtual environment.
2. Install backend dependencies:
   - `pip install -r backend/requirements.txt`
3. Install frontend dependencies:
   - `cd frontend && npm install`
4. Copy env files:
   - `backend/.env.example` -> `backend/.env`
   - `frontend/.env.example` -> `frontend/.env.local`
5. Run backend migrations:
   - `cd backend && python manage.py migrate`
6. Run dev servers:
   - Backend: `python manage.py runserver`
   - Frontend: `npm run dev`

## Current MVP Features

- User registration endpoint
- JWT-ready API configuration
- Study plan generation endpoint (rule-based baseline)
- Learning strategy recommendation endpoint (rule-based baseline)
- Progress logging endpoint
- Mobile-first starter dashboard UI

## Next Priorities

- Add authentication flow in frontend
- Persist planner and recommendation results in PostgreSQL
- Add timetable optimisation based on progress signals
- Add reminder scheduling integration
- Add tests for API services
