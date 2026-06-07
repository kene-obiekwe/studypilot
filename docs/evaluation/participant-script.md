# Participant Briefing and Task Script

This document is the protocol used during the in-person SUS evaluation. Read the briefing aloud to every participant before they start, walk them through the task scenario in the same order, and hand the device over only for the listed steps. Keeping the protocol identical across participants is what makes their SUS scores comparable.

## Preparation checklist (do once before sessions start)

1. Backend dependencies installed and migrations applied.
2. Pilot data seeded with `python manage.py seed_pilot_data` so the side navigation and the progress dashboard are non-empty for the demonstration that precedes the participant's own use.
3. Docker Postgres, Django backend, and Next.js frontend all running locally.
4. Browser open at `http://localhost:3000`, signed out.
5. A second device (phone or tablet) ready with the Google Form open at the questionnaire URL.

## Per-participant resets (do between every session)

1. Sign out of the workspace in the browser.
2. Run `python manage.py shell -c "from django.contrib.auth.models import User; User.objects.filter(username__startswith='eval_').delete()"` to remove the previous participant's account.
3. Clear the browser session storage so the previous JWT does not linger.
4. Confirm the landing page loads cleanly.

## Briefing script (read aloud)

> Thank you for agreeing to take part. You will spend about ten minutes using a web application called StudyPilot AI. It is the system I built for my final year project. It helps students plan study sessions, receive learning strategy suggestions, and track how well they follow their plans.
>
> I am not testing you. I am testing the system. There are no right or wrong answers, and you cannot break anything. If you get stuck I will still ask you to try once more before I step in, because that is the most useful information for me. After you finish using the system you will complete a short questionnaire on this phone. The questionnaire is anonymous. Do you have any questions before we begin?

Pause for questions. Once the participant is ready, proceed to the task scenario.

## Task scenario (six steps; read each step aloud before the participant attempts it)

Each step is phrased as something the participant has to accomplish, not as a click-by-click instruction. This is deliberate — SUS measures perceived usability, which depends on the participant finding their own way.

### Step 1 — Create an account

> Imagine you are using this system for the first time. Create an account with the username `eval_<your initials>`, any email address you like, and a password you can remember for the next ten minutes. Then sign in.

Watch for: how easily the participant finds the registration form, whether the password requirement (eight characters) trips them up, whether the workspace appears automatically after login.

### Step 2 — Build a weekly study plan

> You are planning a study week with twelve total hours available across two courses. Add two courses with names and difficulty ratings of your choice, then generate the plan.

Watch for: whether the participant understands the difficulty field, whether they discover the Add course button, whether the resulting allocation cards are interpretable.

### Step 3 — Get a strategy recommendation

> Pretend that during a recent study session your focus was about average and you completed roughly half of what you planned. Use the recommendation page to get a strategy suggestion for a visual learner.

Watch for: whether the participant chooses the right learning style, whether the confidence pill and strategy list are noticed.

### Step 4 — Forecast adherence for a planned session

> You are about to start a study session of ninety minutes. Use the predictor on the Progress page to forecast how well you are likely to follow through. Use the same focus and completion values as before.

Watch for: whether the participant locates the Progress tab and the Predictor sub-tab, whether they read the resulting forecast card.

### Step 5 — Log a completed study session

> You have just finished a study session of ninety planned minutes but you only studied for sixty. Log the session with a focus score and a completion rate of your choice. Then check what the system tells you about it.

Watch for: whether the participant finds the Log Session sub-tab, whether the resulting tiles (adherence, predicted adherence, focus signal, completion signal) are noticed.

### Step 6 — Review your history

> Finally, take a look at the History sub-tab to see what the system has recorded for you so far.

Watch for: whether the participant understands the pagination and the three sections.

## Wrap-up and questionnaire handoff

When the participant finishes Step 6:

> That is the end of the tasks. Please answer the short questionnaire on this phone. There are twelve short questions and it should take about three minutes. Your responses are anonymous.

Hand over the questionnaire device. Stay close enough to answer process questions (for example, what a Linear scale means) but do not comment on individual items. When the participant submits, thank them for their time and reset the state for the next session.

## Researcher observations (keep a private notebook)

For each participant note:

1. Any step where the participant hesitated for more than ten seconds.
2. Any moment where they asked for help (and what you said in response).
3. Any spontaneous comments about the system, positive or negative.

These observations are not used in the SUS calculation but support the qualitative discussion in §4.3.4 of the dissertation.
