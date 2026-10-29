# Deploying StudyPilot

StudyPilot runs on three free services:

| Part | Service | What it hosts |
|---|---|---|
| Database | Neon (free Postgres) | All app data, plus the shared cache used for rate limits |
| Backend | Render (free web service) | The Django API, from the `master` branch |
| Frontend | Vercel (Hobby) | The Next.js site, from the `master` branch |

Do the steps in this order. The Render URL is needed by Vercel, and the Vercel URL is then
needed by Render, so the backend is deployed twice: once to get its URL, once to allow the site's address.

Keep a scratch note open while you go. You will collect three values: the **Neon connection
string**, the **Render URL** and the **Vercel URL**.

---

## 1. Neon: the database

1. Sign in at neon.com and create a project. Name it `studypilot`, keep the default Postgres version.
2. **Region:** pick the one nearest the Render region you will use in step 2. The two should
   match (for example Frankfurt for both, or Ohio for both) so each query is not crossing an ocean.
   Choose the region now; it cannot be changed later.
3. On the project dashboard click **Connect**. Under *Connection string* turn **Connection pooling
   OFF** so the host does not contain `-pooler`. Copy the string. It looks like:

   ```
   postgresql://neondb_owner:PASSWORD@ep-something-123456.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require
   ```

   Keep `sslmode=require` in it. The app also forces SSL in production, so a string without it still works.

**Use the direct (non-pooled) string.** The backend runs one process with four threads, so it
opens at most four connections, well inside Neon's limit, and the pooler adds nothing. Migrations
run on every deploy and behave best on a direct connection. The pooled string goes through a
transaction-mode pooler, which can interfere with some of the commands Django sends.

Neon pauses an idle database after about five minutes and wakes it on the next query, which adds
a second or two. The backend discards dead connections itself, so nothing needs configuring.

## 2. Render: the backend

1. Sign in at render.com with GitHub and grant it access to this repository.
2. Click **New → Blueprint**, pick this repository and the `master` branch. Render reads
   `render.yaml` and shows one web service, `studypilot-api`, on the **Free** plan. Choose the
   region that matches your Neon project when asked.
3. Render asks for a value for each variable marked as a secret. Fill them in like this:

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | The Neon string from step 1 |
   | `ALLOWED_HOSTS` | Leave blank for now. Render's own `*.onrender.com` name is added automatically |
   | `CORS_ALLOWED_ORIGINS` | Leave blank for now (filled in at step 4) |
   | `CSRF_TRUSTED_ORIGINS` | Leave blank for now (filled in at step 4) |
   | `ANTHROPIC_API_KEY` | Leave blank unless you want AI-written plans (see the notes below) |
   | `EMAIL_*`, `DEFAULT_FROM_EMAIL` | Leave blank for now (see the notes below) |

   `SECRET_KEY` is generated for you. `DEBUG` is already `False`.
4. Click **Apply**. The first deploy installs the packages, collects static files, runs the
   database migrations and creates the cache table, then starts the server. It takes several
   minutes. If a migration fails, the build fails and nothing new goes live, so read the build log.
5. When the dashboard shows **Live**, copy the service URL (for example
   `https://studypilot-api.onrender.com`) into your note.
6. Open `https://<your-render-url>/api/health/` in a browser. You should see `{"status": "ok"}`.

**Cold starts.** On the free plan the service sleeps after 15 minutes without traffic. The next
request wakes it, which takes about a minute, and the site looks broken or shows its "can't reach
the server" message until the backend is up. Open the health URL a minute before showing the app
to anyone. Sleeping time does not count against the 750 free hours each month, and one service left
awake all month uses about 744, so a pinger (UptimeRobot, for example) hitting the health URL
every 10 minutes would also keep it awake.

## 3. Vercel: the frontend

1. Sign in at vercel.com with GitHub and click **Add New → Project**. Import this repository.
2. Set **Root Directory** to `frontend`. Vercel detects Next.js by itself.
3. Under *Settings → General*, set **Node.js Version** to **24.x**. (The project also declares
   this in `package.json`.)
4. Add two environment variables (Production):

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_API_BASE_URL` | `https://<your-render-url>/api` (with `/api`, no trailing slash) |
   | `NEXT_PUBLIC_SITE_URL` | The site's own address, `https://<project>.vercel.app` |

   The site sets the API address while it builds, and **the build stops with an error if
   `NEXT_PUBLIC_API_BASE_URL` is missing**, so it cannot ship pointing at localhost. The site address
   is only used for link previews. Vercel shows the final address once the project exists, so if
   you do not know it yet, deploy once, copy the address and add the variable afterwards.
5. Click **Deploy**. Whenever either variable changes, **redeploy** (Deployments → the latest one →
   Redeploy): the values are baked in at build time and do not change on a running site.
6. Copy the site's address (for example `https://studypilot.vercel.app`) into your note. If you
   add a custom domain later, use that instead everywhere below.

## 4. Render again: allow the site

In Render, open the service → **Environment** and set:

| Variable | Value |
|---|---|
| `CORS_ALLOWED_ORIGINS` | `https://<project>.vercel.app` |
| `CSRF_TRUSTED_ORIGINS` | `https://<project>.vercel.app` |
| `ALLOWED_HOSTS` | Only needed for a custom API domain (comma-separated); otherwise leave blank |

Use the scheme (`https://`) and no trailing slash or path. Separate several origins with commas. Save; Render redeploys. Then open the Vercel site, register or sign in, and
check that the dashboard loads.

If the browser console shows a CORS error, the origin in `CORS_ALLOWED_ORIGINS` does not match the
address in the address bar exactly. Preview URLs on Vercel (`...-git-branch-....vercel.app`) are
different origins and are not allowed unless you add them.

Because the services deploy from `master`, changes reach them once a pull request is merged there.

## 5. Notes

**Email.** Sign-up and password reset send a code by email. Render's free plan blocks outgoing
SMTP on ports 25, 465 and 587, so the default setup cannot send mail. Until email is set up, new
sign-ups cannot get their verification code. The fix is to send through a provider's HTTP API, or
through an SMTP port other than those three (for example 2525, which several providers offer). It
is configured with the `EMAIL_*` variables in `render.yaml`. Accounts created by the seeding
command below are already verified, so they sign in without any email.

**AI plans (optional).** Set `ANTHROPIC_API_KEY` on Render to turn on AI-written weekly plans and
course-trait suggestions. Without it the app serves its rules-based plans and keyword-based
suggestions and everything else works. `AI_PLAN_DAILY_LIMIT` (default 20) caps the calls per user
per day, and the count is kept in the database, so it survives restarts.

**Demo account.** Render's free plan has no shell, so create the demo data from your own computer,
pointed at the Neon database. From `backend/` in PowerShell, with the virtualenv active (use a strong password of your own;
it is used for all five accounts, `pilot_consistent` and four others):

```powershell
$env:DEBUG = "False"
$env:SECRET_KEY = "any-long-random-value-here"
$env:DATABASE_URL = "<the Neon connection string>"
$env:PILOT_PASSWORD = "<a strong password>"
python manage.py seed_pilot_data --allow-production
```

Close the window afterwards so the database address and password do not stay in your shell.

**Free-plan limits.** The backend has 512 MB of memory, so it runs one worker process with four
threads. If the cold start becomes a problem, change the plan in `render.yaml` from `free` to
`starter` (a paid, always-on instance with more CPU) and push to `master`.

**Rate limits and logs.** Sign-in is limited to 10 attempts a minute per client and email requests
to 5 an hour (`AUTH_THROTTLE_RATE`, `EMAIL_THROTTLE_RATE`). Server logs are in the Render dashboard
under *Logs*; `LOG_LEVEL` sets how much they say.
