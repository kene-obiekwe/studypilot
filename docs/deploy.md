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
2. **Region:** the backend runs in Render's Oregon region (`region: oregon` in `render.yaml`), so
   create the Neon project in **AWS US West 2 (Oregon)**. Keeping the two together means each query
   is not crossing an ocean. The region cannot be changed after the project is created.
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
   `render.yaml` and shows one web service, `studypilot-api`, on the **Free** plan in the Oregon
   region.
3. Render asks for a value for each variable marked as a secret. Only one needs a value now:

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | The Neon string from step 1 |

   **Render does not create a secret variable that you leave blank here.** The others
   (`ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS`, `CSRF_TRUSTED_ORIGINS`, `ANTHROPIC_API_KEY`, the
   `EMAIL_*` variables and `DEFAULT_FROM_EMAIL`) simply will not exist yet. That is fine for the
   first deploy: Render's own `*.onrender.com` name is added to the allowed hosts automatically.
   Add each one later from the service's **Environment** page with **Add variable** (step 4 and the
   notes below say which and when).

   `SECRET_KEY` is generated for you. `DEBUG` is already `False`.
4. Click **Apply**. The first deploy installs the packages, collects static files, runs the
   database migrations and housekeeping, creates the cache table, then starts the server. It takes several
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

In Render, open the service → **Environment** and use **Add variable** for each of these (they do
not exist yet, see step 2):

| Variable | Value |
|---|---|
| `CORS_ALLOWED_ORIGINS` | `https://<project>.vercel.app` |
| `CSRF_TRUSTED_ORIGINS` | `https://<project>.vercel.app` |
| `ALLOWED_HOSTS` | Only needed for a custom API domain (comma-separated); otherwise do not add it |

Use the scheme (`https://`) and no trailing slash or path. Separate several origins with commas.
Save; Render redeploys. Then open the Vercel site, register or sign in, and check that the
dashboard loads. (Angle brackets in this guide, like `<project>`, only mark a value to replace;
never type them.)

If the browser console shows a CORS error, the origin in `CORS_ALLOWED_ORIGINS` does not match the
address in the address bar exactly. Preview URLs on Vercel (`...-git-branch-....vercel.app`) are
different origins and are not allowed unless you add them.

Because the services deploy from `master`, changes reach them once a pull request is merged there.

## 5. Notes

**Email.** Sign-up and password reset send a code by email, so the backend needs a mail server.
Render's free plan blocks outgoing SMTP on ports 25, 465 and 587, so use a provider that offers
another port. This setup uses Brevo's free plan over port 2525.

1. Create a Brevo account. Under **Senders, domains & dedicated IPs → Senders**, add the address
   the emails should come from and verify it by clicking the link Brevo emails to it.
2. Open **SMTP & API → SMTP**. Note the server (`smtp-relay.brevo.com`) and the **login**, which
   ends in `@smtp-brevo.com`. This is not your account email.
3. Click **Generate a new SMTP key**, choose a *Standard* key, and copy the key **in full** from
   the pop-up. It is shown once. All keys start with the same long prefix and the list afterwards
   only shows the last few characters, so a partly copied key looks right but fails.
4. Leave Brevo's **IP blocking** off. Render's free plan has no fixed outgoing address, so a block
   list would reject your own server.
5. In Render, **Environment → Add variable**:

   | Variable | Value |
   |---|---|
   | `EMAIL_HOST` | `smtp-relay.brevo.com` |
   | `EMAIL_PORT` | `2525` (587 is blocked on Render's free plan) |
   | `EMAIL_HOST_USER` | The `...@smtp-brevo.com` login from step 2 |
   | `EMAIL_HOST_PASSWORD` | The full SMTP key from step 3 |
   | `DEFAULT_FROM_EMAIL` | `StudyPilot <your-verified-sender@example.com>`, using the address verified in step 1 |

   `EMAIL_USE_TLS` is already on by default, which Brevo needs. `EMAIL_TIMEOUT` is set to 10
   seconds in `render.yaml`, so a mail server that does not answer cannot hold a request open for
   the full minute. Save and let Render redeploy.

   Codes are sent from a background thread right after the request is answered, so a slow mail
   server never delays a response and a known address answers as fast as an unknown one. The cost: if
   the server restarts in the instant between the answer and the send, that email is lost and the
   person asks for another code.

What recipients see: Brevo rewrites the From address to one on its own sending domain
(`brevosend.com`), because the free plan sends from a shared domain. Gmail delivers these to the
inbox. Microsoft 365 and Outlook often file them under **Junk**, which is why the verification
and password-reset pages tell people to check their spam folder.

If emails do not arrive: open the service's **Logs** in Render and search for `Could not send`.
The last line of the traceback says why. `535` means the login or key is wrong (check for a
half-copied key, or the account email used instead of the `@smtp-brevo.com` login). A timeout means
the port or host is wrong or blocked. A send failure is logged, never shown to the person signing
up, so the logs are the only place it appears.

Accounts created by the seeding command below are already verified, so they sign in without any
email.

**AI plans (optional).** Set `ANTHROPIC_API_KEY` on Render to turn on AI-written weekly plans and
course-trait suggestions. Without it the app serves its rules-based plans and keyword-based
suggestions and everything else works. `AI_PLAN_DAILY_LIMIT` (default 20) caps the calls per user
per day, and the count is kept in the database, so it survives restarts. At the default model's
published price (October 2026) a weekly plan costs about $0.0007 and a trait suggestion about
$0.0001. When the model's answer fails the plan's checks, the app serves the rules-based plan and
logs a line such as `AI plan unavailable, serving the rules-based result (number_missing; 2100
input, 800 output tokens)`. Rejected answers are not cached, so the next request makes a new call.
Searching Render's logs for `AI plan unavailable` shows how often this happens and what it costs.

**Demo account.** Render's free plan has no shell, so create the demo data from your own computer,
pointed at the Neon database. From `backend/` in PowerShell, with the virtualenv active. Use a
strong password of your own; it is used for all five accounts (`pilot_consistent` and four others).
Replace the example values below with your own, quotes included, and type no angle brackets:

```powershell
$env:DEBUG = "False"
$env:SECRET_KEY = "any-long-random-value-here-0123456789"
$env:DATABASE_URL = "postgresql://neondb_owner:PASSWORD@ep-something-123456.us-west-2.aws.neon.tech/neondb?sslmode=require"
$env:PILOT_PASSWORD = "Choose-A-Strong-Password-4471"
python manage.py seed_pilot_data --allow-production
```

The angle brackets that appear elsewhere in this guide (such as `<project>`) are placeholders only.

Close the window afterwards so the database address and password do not stay in your shell.

**Free-plan limits.** The backend has 512 MB of memory, so it runs one worker process with four
threads. If the cold start becomes a problem, change the plan in `render.yaml` from `free` to
`starter` (a paid, always-on instance with more CPU) and push to `master`.

**Rate limits and logs.** Sign-in is limited to 10 attempts a minute per client and email requests
to 5 an hour (`AUTH_THROTTLE_RATE`, `EMAIL_THROTTLE_RATE`). Server logs are in the Render dashboard
under *Logs*; `LOG_LEVEL` sets how much they say.

**Sessions and signing out.** Sign out revokes the refresh token on the server, and so do a password
change and a password reset (every refresh token the account has). Another device then fails its
next refresh and is sent to the sign-in page. Two limits: access tokens are not checked against the
revoked list, so a revoked device keeps working until its access token expires (30 minutes,
`JWT_ACCESS_MINUTES`); and tokens issued before the revoked-token tables existed are not in them, so
a password change does not reach those. They expire on their own within the refresh lifetime (1 day,
`JWT_REFRESH_DAYS`). Changing the email does not sign other devices out, because it already needs the
password. The build runs `flushexpiredtokens` to keep the table small.

**Unverified accounts.** An account that never verified its email is deleted 7 days after it was
created (`UNVERIFIED_ACCOUNT_TTL` in `apps/users/verification.py`). The build runs
`python manage.py purge_unverified_accounts` on every deploy, and registering also removes an
expired unverified account that holds the same username or email. Verified accounts, staff and
superusers are never deleted. To see what would go, run it from `backend/` with `--dry-run`.

**Duplicate usernames and emails.** The database refuses two accounts whose usernames, or emails,
differ only by letter case. The migration that adds this fails the build if such a pair already
exists, and the old version keeps serving. Before deploying it, from `backend/` with `DATABASE_URL`
set to the Neon string (see **Demo account** above for how), run:

```bash
python manage.py list_case_duplicate_usernames
```

For each pair it lists, sign in as the account you don't want and delete it from the Account page
(or rename it there), then deploy.

## 6. Check the client address behind Render's proxy

The sign-in and email limits count requests per client address. Behind Render's proxy the app only
learns that address from the `X-Forwarded-For` header, so unless it is told how many proxies sit in
front of it, a caller can send a made-up header and dodge the limits. `NUM_PROXIES` tells it. It is
deliberately not set in `render.yaml`: too high a value lets the spoofing through, too low a value
makes every user share the proxy's address and one bucket. Test before you keep it. Commands are for
Git Bash.

1. In Render, **Environment → Add variable**: `NUM_PROXIES` = `1`. Save and wait until the deploy is
   **Live**.
2. **(a) Spoofing no longer helps.** From your PC, send 11 wrong-password sign-ins within a minute,
   each with a different made-up `X-Forwarded-For`. Use your own API address:

   ```bash
   API=https://studypilot-api.onrender.com
   for i in $(seq 1 11); do
     curl -s -o /dev/null -w "$i: %{http_code}\n" -X POST "$API/api/auth/token/" \
       -H "Content-Type: application/json" -H "X-Forwarded-For: 203.0.113.$i" \
       -d '{"identifier":"nobody","password":"wrong-password-1"}'
   done
   ```

   The first ten print `401` and the 11th must print `429`. If you got `401` all eleven times, wait
   a minute before repeating anything.
3. **(b) Other people are not blocked.** Straight after, open the live site on a phone using mobile
   data (not your Wi-Fi) and sign in with a real account. It must work. This shows the limit is
   keyed on each caller and not on a shared proxy address.
4. If (a) fails, the value is too high: set `NUM_PROXIES` back to blank or remove it. If (b) fails,
   set it to `2`, wait for the deploy, and repeat (a) and (b). If neither value passes both,
   remove the variable and tell the Overseer.

## 7. Error tracking (Sentry)

Sentry's free plan shows errors from the live site: the error, where in the code it happened and how
often. It is optional. With no DSN set, nothing is sent and nothing changes.

**1. Create the account and two projects.** Sign up at sentry.io (free Developer plan) and create one
project for each half, so each gets its own DSN and its own list of issues:

| Project | Platform to pick | Its DSN goes to |
|---|---|---|
| `studypilot-api` | Django | Render, as `SENTRY_DSN` |
| `studypilot-web` | Browser JavaScript | Vercel, as `NEXT_PUBLIC_SENTRY_DSN` |

(One shared project also works, but backend and browser errors then mix in one list.) The DSN is on
each project's **Settings → Client Keys (DSN)** page. A DSN is not a password: it only lets someone
send events to your project, and the browser one is visible in the site's code anyway. Still, keep
both out of git; paste them only into the places below. In each project's **Settings → Security &
Privacy**, turn on **Prevent Storing of IP Addresses**.

**2. Render (backend).** In the service's **Environment** page use **Add variable**: `SENTRY_DSN` =
the `studypilot-api` DSN. Render does not create a blank secret variable from `render.yaml`
(see step 2), so it will not exist until you add it. `SENTRY_ENVIRONMENT` is already `production` in
`render.yaml`, and Render supplies the commit hash that Sentry shows as the release. Save; Render
redeploys.

**3. Vercel (frontend).** Under **Settings → Environment Variables** add `NEXT_PUBLIC_SENTRY_DSN` = the
`studypilot-web` DSN, for **Production** and **Preview**. Because Preview builds are production builds,
they would also be labelled `production`; to tell them apart, add `NEXT_PUBLIC_SENTRY_ENVIRONMENT` =
`preview` for Preview only. Then **redeploy**: the value is baked in at build time.

**4. Check that it works.** Both checks send a test event; look for it under **Issues** in the
matching project.

- *Backend.* From `backend/` on your own computer, in PowerShell with the virtualenv active (Render has
  no shell). The command prints whether the DSN was set, never the DSN itself, and labels the event
  with the environment `local-check`:

  ```powershell
  $env:SENTRY_DSN = "paste-the-studypilot-api-DSN-here"
  python manage.py sentry_check
  ```

  Close the window afterwards so the value does not stay in your shell.
- *Frontend.* Put `NEXT_PUBLIC_SENTRY_DSN=` followed by the `studypilot-web` DSN in
  `frontend/.env.local` (never commit that file), run `npm run dev`, open
  `http://localhost:3000/styleguide` and press **Send a test error**. The error page appears and the
  event arrives with environment `development`. **Try again** brings the page back.

**What is reported.** The backend reports unhandled server errors (500s) and anything logged at
`ERROR`; warnings, such as an AI plan falling back to the rules-based one, stay in Render's logs. The
browser reports uncaught errors and the ones that reach an error page. Some visitors' ad blockers stop
the browser's reports, so the browser list may undercount. Browser stack traces show the built
(minified) code, because no source maps are uploaded.

**What is never sent.** Only the error and its stack are sent. Never sent: request bodies (so no
passwords or email codes), cookies, `Authorization` headers, user email, username or ID, IP addresses
(Sentry is also told not to store them), query strings and fragments in addresses (so no codes or
tokens from links), local variables, performance traces, profiles and session replays. The code
removes the sensitive fields again just before sending, as a second layer.
