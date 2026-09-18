# Production `.env` guide -- LMS + meeting platform

> Generated for the Delta LMS <-> Delta Connect integration. Every claim below is cited to the line
> the **code** reads, not to documentation: the docs in both repos are wrong about at least six
> variable names, all listed in section 8.

## 0. Verified live, on the running systems

These were probed directly rather than inferred, so they are facts, not assumptions.

| What | Origin | Evidence |
|---|---|---|
| Meeting SPA (browser is redirected here) | `https://connect.deltainstitutions.com` | serves the Delta Connect app |
| Meeting API (server-to-server) | `https://connect-api.deltainstitutions.com` | `GET /health` -> `{"status":"ok"}` |
| LMS API | `https://api-lms.deltainstitutions.com` | `GET /api/v1/health` -> 200 |
| LMS student app | `https://lms.deltainstitutions.com` | serves the sign-in page |
| LMS admin app | **UNKNOWN** | documented nowhere -- section 7.1 |

**The SPA and the meeting API are on TWO SEPARATE ORIGINS.** Every path on `connect.` returns the
SPA's `index.html` (an SPA catch-all), and the shipped JS bundle references `connect-api.` for its
API calls. So `CLT_PUBLIC_URL` and `CLT_BASE_URL` are **different values**. This was the single
biggest open question and it is now closed.

### Both sides are currently UNCONFIGURED

| Probe | Result | Means |
|---|---|---|
| `GET https://api-lms.deltainstitutions.com/.well-known/jwks.json` | **`{"keys":[]}`** with HTTP **200** | The LMS has **no signing key loaded**. `INTEGRATION_JWT_PRIVATE_KEY` and/or `INTEGRATION_JWT_KID` are unset in production. An empty key set returns 200, so a naive health check reads it as success. |
| `POST https://connect-api.deltainstitutions.com/api/lms/enter` with an invalid code | **503** `LMS integration is not configured on this server` | The meeting side's whole `LMS_*` block is unset. |

So this is a first-time setup on both hosts, not a repair. Nothing needs to be preserved or rotated
around; there are no live values to break. Follow sections 6 -> 7 -> 2 -> 3 -> 4, in that order.

---

# Production `.env` guide — LMS + meeting platform

Paths below are relative to `C:\Users\MSI-PC\Delta\lms` (LMS) and `C:\Users\MSI-PC\Delta\meeting-platform` (meeting). Every claim is cited to the line the **code** reads, not to documentation — the docs in both repos are wrong about at least six variable names, all listed in §8.

**Four of the six origins are settled and filled in below** — verified live against the running
systems rather than read off a doc (section 0). Two are NOT guessed and remain placeholders:
`<LMS_ADMIN_ORIGIN>` and `<LIVEKIT_WS_HOST>`. Settle both in §7 before you type them.

---

## 1. What these two files do to each other

The LMS is the identity authority and the meeting platform is a renderer of what the LMS tells it. When a student clicks Join, the LMS mints a one-time code (`services/classHandoff.service.ts:29`, TTL 120s, hardcoded) and redirects the browser to `<meeting SPA>/lms/enter?c=…` (`controllers/classHandoff.controller.ts:78`). The meeting backend exchanges that code with the LMS over an HMAC call signed with one secret that lives under two different names — `CLT_S2S_SECRET` here, `LMS_S2S_SECRET` there — and the LMS answers with an Ed25519-signed ticket. The meeting app verifies that ticket against a **public** key it fetches from the LMS at `/.well-known/jwks.json`, and then renders the person's `display_name` straight out of the ticket; its entry page has no name field at all (`backend/src/utils/meetingIdentity.ts:4-9`). So the two env files are coupled at exactly five points — one shared secret, one JWKS URL, two string literals (issuer/audience) and two URLs pointing at each other — and everything else in each file is that application's own business. Get the five wrong and the join fails with an error message that names the *other* system; get the rest wrong and one application degrades on its own.

---

## 2. LMS `backend/.env`

Two mechanisms read this file and the difference is the whole safety story:

- **Zod-validated** (`backend/src/config/env.ts:8-106`), parsed once at boot (`env.ts:108`); on failure it prints `Invalid environment variables` and `process.exit(1)` (`env.ts:110-116`). A typo here is **loud**.
- **Everything else** — about 50 names including the *entire* meeting integration, every rate-limit override, the cookie scope and the whole SMTP block — is read raw off `process.env`. A typo here is **silent**: the server boots, `/health` says ok, and the feature is off until a real user acts on it.

**Empty vs deleted is not the same thing.** For zod-validated optional names, `FOO=` is treated as unset (`env.ts:4-6`). For raw `Number(process.env['X'] ?? default)` reads, `X=` gives `Number('') === 0` — see the trap in §8.

### 2a. Core — needed regardless of the meeting feature

**Will not start without these (3):**

| Variable | Required? | Production value | What breaks if wrong |
|---|---|---|---|
| `DATABASE_URL` | **Boot** — `env.ts:14` | `mongodb://<user>:<pass>@localhost:27017/lms?authSource=admin` — **read the live one off the host**, do not compose a new one (§7.6) | Missing/not URL-shaped → `DATABASE_URL must be a valid connection string`, exit 1. Wrong creds → mongoose throws at boot. Wrong *database* is the silent case: healthy server, empty data. **It is not `MONGODB_URI`** (§8) |
| `JWT_ACCESS_SECRET` | **Boot** — `env.ts:17` | 64 hex chars. **If production already has one, keep it** | `<32` chars or absent → exit 1. Changing it signs out every user instantly |
| `JWT_REFRESH_SECRET` | **Boot** — `env.ts:18` | 64 hex chars, **different** from the access secret. Keep the existing one | `<32` or absent → exit 1. Changing it kills all 30-day refresh tokens: a slow, confusing sign-out over the next 15 minutes |

**Must be set or something is quietly wrong:**

| Variable | Required? | Production value | What breaks if wrong |
|---|---|---|---|
| `NODE_ENV` | Has default `development` (`env.ts:10`) — **set it** | `production` (PM2 already sets it at `ecosystem.config.js:76`; set it here too so a manual `bun run` is safe) | Not production → auth limits loosen from 15 to 200/15min (`rateLimit.middleware.ts:8,167`), session cookies lose `Secure` (`authCookies.ts:44`), `DISABLE_RATE_LIMIT` becomes honourable (`rateLimit.middleware.ts:155`). Note: stack traces leak only if it is literally `development` — `error.middleware.ts` reads raw `process.env`, which zod's default never writes back |
| `PORT` | Default 4000 (`env.ts:11`) — **set it** | `4001`. **Not 4000, not 8000** | The listen port is `PORT + NODE_APP_INSTANCE` (`index.ts:234-235`). 4000 belongs to the exam-tracker API on this host (`ecosystem.config.js:4`, `nginx.lms.conf:22-24`) → EADDRINUSE, PM2 crash-loop. Must equal the nginx upstream `server 127.0.0.1:4001` (`nginx.lms.conf:25`) — one setting in two files |
| `NODE_APP_INSTANCE` | **NEVER put this in `.env`** | — | PM2 sets it per fork. Hand-copied from `ecosystem.config.js` it shifts the listen port to `4001+N` while nginx dials 4001 forever (`index.ts:234-235`, `nginx.lms.conf:25`) |
| `ENABLE_CRON` | Feature switch — `index.ts:297-299` | `true` on **exactly one** process. Already set at `ecosystem.config.js:81`; add it here only if you ever start outside PM2 | Unset falls back to "instance 0 only". If no process has it, reminders, reschedule/cancellation notices, digests and the email-retry drain all stop, announced by one warn line (`index.ts:311-315`). Two processes with `true` → every reminder sent twice |
| `BIND_HOST` | Default `127.0.0.1` (`index.ts:241`) | **Omit** | `0.0.0.0` publishes the API directly, bypassing TLS, WAF and edge limits |
| `CLIENT_URL` | Default localhost (`env.ts:23`) | `https://lms.deltainstitutions.com` — no trailing slash | Two failures at once: it is a CORS allow-list entry (`config/cors.ts:5`, exact string match at `cors.ts:16`), **and** every outbound email link is built from it (logo, bookings, dashboard, digests, reminders, impersonation return). Left at the default, students receive mail whose every link points at `localhost:3000`. Not a URL at all → exit 1 |
| `ADMIN_URL` | Default localhost (`env.ts:24`) | `<LMS_ADMIN_ORIGIN>` — **not in this repo anywhere**, see §7.1 | CORS allow-list entry (`cors.ts:6`) and the enrollment-request mail link. A wrong value presents as a broken admin login, not as a config error |
| `BACKEND_PUBLIC_URL` | Default `http://localhost:4000` (`env.ts:41`) | `https://api-lms.deltainstitutions.com` — must be **https** | Registers the payment webhooks at boot (Tamara `index.ts:353`, Tabby `tabby.service.ts`). Non-HTTPS → Tabby registration is skipped with a warn and no payment callback ever arrives. Left at the default, both gateways are told to call localhost and payments silently never confirm |
| `COOKIE_DOMAIN` | Raw read (`authCookies.ts:62`) | **LEAVE EMPTY. Do not set it.** | Empty = host-only cookies, which is the M-21 fix (`authCookies.ts:46-64`). Setting `.deltainstitutions.com` makes both session cookies readable by every subdomain on the apex, and re-enables the bug where one browser holding both cookies hands a student the admin's hidden observer ticket (`classHandoff.controller.ts:21-29`) |
| `LEGACY_COOKIE_DOMAIN` | Raw read (`authCookies.ts:82`) | **Leave unset** — in production it defaults to `.deltainstitutions.com` (`authCookies.ts:83`), which is what you want while old cookies exist | Its job is to evict the old apex-scoped twin on every response that sets a cookie. Set to `''` too early and a browser presents the stale refresh cookie, reuse detection trips, and **all** of that account's sessions are invalidated (`authCookies.ts:66-77`) |
| `PROXY_SHARED_SECRET` | Raw read (`rateLimit.middleware.ts:37`) | 64 hex chars, **the same value in `backend/.env`, `client/.env` and `admin/.env`** | Unset → every visitor shares one rate-limit bucket keyed on the Next proxy, so 15 sign-ins per 15 min is a platform-wide budget (`rateLimit.middleware.ts:39-43`). Set here but not relayed is worse: identical symptom, and the only signal is a once-a-minute log line (`rateLimit.middleware.ts:116-122`). **The backend trims the value (`:37`), the frontends do not (`client route.ts:38`)** — a trailing space in one file is a silent mismatch |
| `RATE_LIMIT_API_MAX` | Default 100/60s (`rateLimit.middleware.ts:209`) — **raise it** | `1000`. See §2b — this governs the meeting handoff | Also caps ordinary API traffic. Non-numeric or ≤0 silently falls back to the default (`envInt`, `:11-14`) |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_PUBLIC_URL` | Feature gate — **all four together** (`services/r2.service.ts:20-26`) | Cloudflare account id, R2 API token pair, and the public bucket URL | The gate is **four** names, not three. Leave any one blank and `isR2Configured()` is false, so every upload silently goes to local disk on the app server (`r2.service.ts:75-76`) — lost on the next redeploy, unshared across PM2 forks. It also suppresses the H-11 boot guard, because `isKycStoragePrivate()` returns true early when R2 is off (`r2.service.ts:212-216`) |
| `R2_BUCKET_NAME` | Default `learnos-media` (`env.ts:47`) — **set it explicitly** | your media bucket | Not part of the gate above. Forget it and uploads address a bucket named `learnos-media`: a wrong-but-working system if it exists, per-upload 404s if it does not. Nothing checks at boot |
| `R2_KYC_BUCKET_NAME` | Raw read (`r2.service.ts:208,214`) | A **separate** bucket with public access disabled; must not equal `R2_BUCKET_NAME` | Unset (or equal) → passport/ID scans land in the public media bucket, readable by anyone who guesses a key. The server does say so on every boot — `R2_KYC_BUCKET_NAME is not set to a separate PRIVATE bucket` (`index.ts:324-326`) — and boots anyway |
| `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` / `EMAIL_FROM` | All four together (`email.service.ts:234-237`, resolved `:252-259`) | provider host, mailbox account, app password, and a From the account may send as | **These four are all-or-nothing**: `resolveMailbox` returns null if any is missing (`email.service.ts:259`) and the app falls back to a console sender with one info line. The platform then sends **no** email at all — no booking confirmations, reminders, reset links or welcome mail — and looks perfectly healthy |
| `SMTP_PORT` / `SMTP_SECURE` | Defaults 587 / derived | `587`, and leave `SMTP_SECURE` blank | Secure is derived from the port when blank: 465 = implicit TLS, anything else STARTTLS (`email.service.ts:261-264`). **Only the exact string `true` means true** — `SMTP_SECURE=1` or `=yes` silently mean INSECURE |
| `SMTP_BACKUP_HOST` / `_PORT` / `_USER` / `_PASS` / `_SECURE` / `SMTP_BACKUP_EMAIL_FROM` | Optional failover (`email.service.ts:238-241`) | a second mailbox, or omit the block entirely | Note the name is `SMTP_BACKUP_EMAIL_FROM`, **not** `SMTP_BACKUP_FROM` and **not** `SMTP_BACKUP_SMTP_HOST` — it is an explicit table, not a prefix rule. Missing any of host/user/pass/from drops the backup with no error, discovered only when the primary hits its quota |
| `TABBY_SECRET_KEY` / `TABBY_PUBLIC_KEY` / `TABBY_MERCHANT_CODE` / `TABBY_WEBHOOK_SECRET` | Optional in zod; `sk_`/`pk_` prefixes **enforced** (`env.ts:68-69`) | live `sk_…` / `pk_…` / merchant code / your webhook secret | Swapped pair → refuses to boot, deliberately (`env.ts:62-67`). `sk_test_` passes the regex and runs production in sandbox with no error. Missing webhook secret, or non-HTTPS `BACKEND_PUBLIC_URL`, means the webhook never registers and paid orders never confirm |
| `TAMARA_BASE_URL` | Default is the **sandbox** (`env.ts:96`) — **you must set this** | `https://api.tamara.co` | Omit it and Tamara runs entirely in sandbox: checkout appears to succeed, no money moves, nothing logs an error |
| `TAMARA_API_KEY` / `TAMARA_NOTIFICATION_TOKEN` / `TAMARA_PUBLIC_KEY` | Three **non-interchangeable** credentials (`env.ts:82-90`) | as issued | Putting the API token where the notification token belongs fails every inbound webhook check silently: orders paid, never confirmed |
| `TAMARA_WEBHOOK_ID` | Optional (`env.ts:94`) | blank on first boot, then paste the id the first registration returns | Tamara has no list endpoint (`env.ts:91-93`), so leaving it blank forever re-registers a webhook on every restart of instance 0 |
| `ABZER_BASE_URL` | Default is already production (`env.ts:79`) | `https://billxpro.com/as/api/v100` | The **example file ships the sandbox value** (§8). Copy it forward and Abzer runs in sandbox silently |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `RAZORPAY_*` | Optional; blank = disabled | live keys, or leave blank | An `sk_test_`/`rzp_test_` key in production takes no real money, with no error. A webhook secret from the wrong endpoint means the customer is charged and the enrollment is never created |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REFRESH_TOKEN` | Raw reads (`googleMeet.service.ts:6-8`) | OAuth2 pair + long-lived refresh token for the calendar owner | Missing or misspelled → automatic Meet link generation is off and external classes are created with no `meetingUrl`. A revoked refresh token fails only at the moment an admin creates a class |
| `GOOGLE_WORKSPACE_DOMAIN` | Default `deltagroups.ae` (`googleMeet.service.ts:163`) | set explicitly if your workspace domain differs | Decides internal vs external instructor; wrong → every instructor treated as external, events on the fallback calendar |
| `GOOGLE_MEET_ACCESS_TYPE` | Raw read (`googleMeet.service.ts:87-94`) | omit (defaults to `OPEN`) | An unrecognised value is **not** an error — it silently becomes `OPEN`. `TRUSTED` puts a lobby back that nobody is watching |
| `WATI_API_URL` / `WATI_API_KEY` | Raw reads (`whatsapp.service.ts:7-8`) | tenant URL + key, or omit both | Absent → silent console fallback; WhatsApp notifications never send |
| `CROSS_ORG_CLASSES` | Raw read, once at module load (`utils/featureFlags.ts:35-36`) | omit unless you are deliberately opening cross-academy classes | Lowercased, only `true` enables. Turning it **off** again after guests have booked leaves them holding seats they are refused at the door |
| `AI_ACADEMY_S2S_SECRET` | Raw read (`routes/integrations.routes.ts:135`) | 64 hex shared with the AI-academy backend, or omit | Unset → `POST /integrations/ai-academy/purchase` returns 503 `INTEGRATION_DISABLED`, so buyers are charged and never provisioned. Nothing about this appears at boot. **Not in `.env.example`** |
| `SENTRY_DSN` | Raw read (`app.ts:23`) | your DSN, or blank | Misspelled → no error reporting, no message |
| `JWT_ENFORCE_AUDIENCE` | Raw read (`utils/jwt.ts:42`) | **leave unset** | Setting `true` before 30 days (one `JWT_REFRESH_EXPIRES_IN`) have passed since the iss/aud deploy rejects every legacy token and logs out the entire platform at once |
| `DISABLE_RATE_LIMIT` / `OTP_DEV_ECHO` | **Never set in production** | — | Both are inert while `NODE_ENV=production` (`rateLimit.middleware.ts:155`; `auth.service.ts:916`), so they are only dangerous in combination with a wrong `NODE_ENV`. Note `OTP_DEV_ECHO` compares against `'1'`, not `'true'` |

**Delete these lines entirely — the code defaults are correct:** `JWT_ACCESS_EXPIRES_IN` (15m), `JWT_REFRESH_EXPIRES_IN` (30d), `BCRYPT_ROUNDS` (12), `R2_VIDEO_URL_TTL` (21600), `PERMISSIONS_MODE` (enforce), `RESET_THROTTLE_MS`, `IMPERSONATION_EXPIRES_IN`, `SETTINGS_CACHE_TTL_MS`, `AI_DAILY_MESSAGE_LIMIT`, `MUX_WEBHOOK_TOLERANCE_SECONDS`, `SMTP_QUOTA_COOLDOWN_MIN`, `EMAIL_OUTBOX*`, `CRITICAL_*`, `DIGEST_HOUR`, `EMAIL_LOG_DIR`, all six other `RATE_LIMIT_*`, `BOOKING_CUTOFF_MINUTES`, `STUDENT_JOIN_GRACE_MINUTES`, `*_CURRENCY`, `UAE_EXCHANGE_RATE` / `INR_EXCHANGE_RATE` (3.67 / 83 — the defaults match the rates already in effect, so nothing reprices on deploy), `OLLAMA_*`, `CHECKOUT_BLOCK_REJECTED`, `SIGNUP_REQUIRE_VERIFICATION`.

**Script-only — pass on a command line, never store in `.env`:** `SEED_ALLOW_WIPE`, `SEED_ADMIN_*`, `MIGRATE_URI`, `EXPORT_DB_URL`, `SNAPSHOT_URI`, `CLONE_*`, `BACKUP_SOURCE_URI`, `VERIFY_EMAIL_TO`, and the super-admin bootstrap set `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD` (min 12 chars) / `SUPERADMIN_NAME` / `SUPERADMIN_RESET_PASSWORD` (exact string `true`; without it, re-running the script will not overwrite an existing password).

### 2b. LMS — meeting integration only

None of these are zod-validated. A typo produces a healthy server that 503s the moment somebody clicks Join.

| Variable | Required? | Production value | What breaks if wrong |
|---|---|---|---|
| `INTEGRATION_JWT_PRIVATE_KEY` | Feature — `utils/integrationKeys.ts:120` | **Base64 of an Ed25519 PKCS#8 PEM, one line.** Raw PEM (real or `\n`-escaped) is also accepted (`integrationKeys.ts:57-65`) — if production already holds a working raw PEM, **leave it alone**; do not re-encode a value that works. **Generate fresh** for production (§6) | Base64 is recommended because Bun's `.env` parser ends the value at the first newline, so a one-line escaped PEM arrives as just `-----BEGIN PRIVATE KEY-----` and OpenSSL rejects it with `BAD_END_LINE` (`integrationKeys.ts:44-53`). A key that fails to load logs **one** error line and the server carries on with the integration disabled (`integrationKeys.ts:111-114`) — every Join returns 503 from a server whose `/health` says ok. A non-Ed25519 key is rejected with `expected an ed25519 key` (`integrationKeys.ts:105-106`) |
| `INTEGRATION_JWT_KID` | Feature — `integrationKeys.ts:121` | any stable label, e.g. `lms-2026-09`. **Change it on every rotation** | **Both** key and kid must be non-empty or `load()` returns null and the whole integration is off (`integrationKeys.ts:101`) — and blanking either logs no error at all, only an info line (`integrationKeys.ts:137`). Reusing a kid for a new key means the meeting app's cached JWKS resolves the OLD key and every join 401s for up to an hour |
| `INTEGRATION_JWT_PRIVATE_KEY_PREVIOUS` / `INTEGRATION_JWT_KID_PREVIOUS` | Rotation only — `integrationKeys.ts:125-126` | blank in steady state | Their only job is that a ticket signed seconds before a swap still verifies (`integrationKeys.ts:151-157`). Rotate without them and anyone mid-join at that instant gets a signature failure. Set one without the other and the previous key is silently dropped (`:101`) — the JWKS then carries one key, which looks exactly like a correct steady state |
| `INTEGRATION_JWT_ISSUER` | Default `lms.deltainstitutions` (`integrationKeys.ts:25`) | set it **explicitly** so both sides are visibly in step | Read once at module load. Changed on one side only → every ticket refused at the meeting end with `This link was not issued by a recognised LMS` (`lms_tickets.py:187-188`), while the LMS believes it handed off fine |
| `INTEGRATION_JWT_AUDIENCE` | Default `clt-connect` (`integrationKeys.ts:26`) | set explicitly | Same shape: `This link was not issued for this service` (`lms_tickets.py:185-186`) |
| `INTEGRATION_TICKET_TTL_SEC` | Default 90 (`services/integrationTicket.service.ts:21`) | **delete the line** | This is a clock-skew margin, not the click-to-arrival budget (that is the hardcoded 120s at `classHandoff.service.ts:29`). Writing `INTEGRATION_TICKET_TTL_SEC=` gives `Number('') === 0` and mints tickets that are born expired |
| `CLT_BASE_URL` | Feature — `services/clt.service.ts:29` | `https://connect-api.deltainstitutions.com` — the address the **LMS server** reaches the meeting API on. §7.2 | Empty (with the secret) → `cltConfigured()` false (`clt.service.ts:35-37`) and room provisioning throws, **non-fatally by design** (`clt.service.ts:21-24`), so a wrong value surfaces much later as "this class has no room" when an instructor arrives |
| `CLT_PUBLIC_URL` | Feature — `controllers/classHandoff.controller.ts:45` | `https://connect.deltainstitutions.com` — the **browser**-facing origin. Omit only if the SPA and API genuinely share one origin (§7.3) | The browser is sent to `${base}/lms/enter?c=…` (`classHandoff.controller.ts:78`), a React route. Point it at the API origin and the student gets a FastAPI 404 from a URL that looks perfectly correct. With **both** this and `CLT_BASE_URL` empty → 503 `The meeting platform address is not configured.` (`classHandoff.controller.ts:47-53`) |
| `CLT_S2S_SECRET` | Feature — three call sites | 64 hex. **If production works today, keep it** — rotating breaks every join until the meeting host changes in the same window | Carries three jobs: outbound room commands (`clt.service.ts:30`), the inbound handoff exchange (`routes/integrations.routes.ts:59`), and inbound CLT webhooks (`routes/webhooks.routes.ts:517`). Empty → 503 `INTEGRATION_DISABLED` on every Join. Mismatched → 401, and the meeting app passes the LMS's own message straight through, so **the student literally sees "Bad signature"** (`lms_handoff.py:105-109`). A mismatch also silently drops recordings and meeting-ended events |
| `CLT_TIMEOUT_MS` | Default 8000 (`clt.service.ts:31`) | **delete the line** | Same `Number('')` trap: blanking it aborts every outbound call instantly |
| `LIVEKIT_MAX_PARTICIPANTS` | Default **50** (`services/liveClass.service.ts:21`) | one number, equal to the meeting side's cap, ≤50 | Higher than the real cap → the LMS sells seats LiveKit refuses at the door. **Blanking it (`=`) sets the cap to 0** and every interactive class is refused with `Interactive rooms hold up to 0 participants.` (`liveClass.service.ts:362-365`) |
| `MEETING_DISPLAY_NAME` | Default = email (`utils/meetingIdentity.ts:35-36`) | leave **blank** for email-as-name (the deliberate current decision), or exactly `name` for LMS profile names | This one LMS variable decides every name on every tile in every room, because the meeting app has no name field. Lowercased comparison, so `Name`/`NAME` work; **anything else — `names`, `true`, unset — silently means email** (no validation, no log). Email is unique and is what attendance reconciles against; the cost is that every participant can read every other participant's address |
| `RATE_LIMIT_API_MAX` | see §2a — **meeting-critical** | `1000` | `POST /api/v1/integrations/handoff/exchange` (`integrations.routes.ts:57`) sits under the global limiter mounted **ahead of authentication** (`routes/index.ts:41`), and the meeting backend sends no cookie and no proxy-secret header (`lms_handoff.py:81-87`), so `clientKey` falls through to `ip:<meeting server>` (`rateLimit.middleware.ts:125-148`). **Every join from every class on the platform shares one 100/minute bucket.** A cohort over ~100 joining on the hour gets 429, and the student sees `Too many requests. Please slow down.` on the meeting page while nothing in the LMS logs looks like an outage |

---

## 3. Meeting platform `backend/.env`

Config is `pydantic-settings` with `env_file=".env"`, `extra="ignore"`, `case_sensitive=False` (`backend/app/core/config.py:5`). Three consequences: the file is loaded **relative to the working directory** (so the process must start with `cwd=backend/`); field `foo_bar` reads env `FOO_BAR`; and **a misspelled variable is silently discarded** — there is no startup error for a typo.

82 settings fields. Exactly **five have no default and the process will not start without them.**

**Will not start without these (5):**

| Variable | Required? | Production value | What breaks if wrong |
|---|---|---|---|
| `LIVEKIT_API_KEY` | **Boot** — `config.py:14` | `APIConnectCLT` (what the shipped yamls expect). An identifier, not a secret | No default → `ValidationError` at import; uvicorn and celery exit immediately. If it differs from `webhook.api_key` in the mounted LiveKit yaml, rooms work but recordings and participant events never fire |
| `LIVEKIT_API_SECRET` | **Boot** — `config.py:15` | ≥32 random hex. **Generate fresh** — the dev value is the literal `devsecret_min_32_chars_local_only_padding` | No default → exits at import. Mismatched with the SFU → room creation fails and the instructor gets 503 `Media server unavailable — please try again.` |
| `DATABASE_URL` | **Boot** — `config.py:19` | `postgresql+asyncpg://meeting:<PGPASSWORD>@127.0.0.1:5432/meetings` (PM2 path) | No default → exits at import. Wrong driver prefix boots but every request fails with a sync-driver-in-async-context error. **Unrelated to the LMS's `DATABASE_URL`, which is MongoDB — never copy a line between the two files** |
| `DATABASE_URL_SYNC` | **Boot** — `config.py:20` | same host/db, `postgresql+psycopg2://…` | No default → exits at import. Alembic and Celery use this one; copying the asyncpg URL here fails only when a migration or a task runs |
| `JWT_SECRET` | **Boot** — `config.py:32` | a fresh 48-byte random string. **Not** `LMS_S2S_SECRET`, **not** the LMS's JWT secrets — this signs only the meeting app's own admin/mentor sessions | No default → exits at import. Changing it later logs out every meeting-app admin at once (HS256, no rotation window). This is also the field that fails first when the process was started from the wrong directory and read no `.env` at all |

**LMS integration — absent from every shipped template (§8), must be typed in by hand:**

| Variable | Required? | Production value | What breaks if wrong |
|---|---|---|---|
| `LMS_JWKS_URL` | Feature + **master switch** — `config.py:49,196` | `https://api-lms.deltainstitutions.com/.well-known/jwks.json` — the **API** origin, and **not** under `/api/v1` (`lms/backend/src/app.ts:164`, registered above the `/api/v1` mount) | Blank → the whole identity plane is off and every join answers 503 `LMS integration is not enabled on this server` (`lms_tickets.py:156-157`). Wrong path or wrong host → the 404 raises at `resp.raise_for_status()` (`lms_tickets.py:110`) and becomes 503 `Could not reach the LMS to verify this link`. A 200 whose body is not `{keys:[…]}` → 502 `LMS JWKS is malformed` (`lms_tickets.py:112-113`) — an error that blames the LMS for a typo in this file |
| `LMS_S2S_SECRET` | Feature + switch — `config.py:61,201` | byte-identical to the LMS's `CLT_S2S_SECRET` | Blank → 503 on room provisioning (`lms_s2s.py`) and 503 `INTEGRATION_DISABLED` on the handoff exchange (`lms_handoff.py:72-74`). Mismatched → 401 both directions; outbound, the LMS's own message is relayed to the student verbatim |
| `LMS_WEBHOOK_URL` | Feature — `config.py:66` — **the single most error-prone value in either file** | exactly `https://api-lms.deltainstitutions.com/api/v1/webhooks/clt` | It does **two** jobs and the comment documents one. (1) Events: blank → recording-ready, meeting-ended and attendance are dropped silently (`config.py:206`, `lms_events.py`). (2) **The handoff exchange URL is derived from it by string surgery** — `rstrip("/")`, strip a trailing `/webhooks/clt`, append `/integrations/handoff/exchange` (`lms_handoff.py:63-67`). There is no separate setting. Blank → the POST goes to a relative path, httpx raises, and the student gets 503 `Could not reach the LMS to open this class` — a network-sounding error for a configuration mistake. A **trailing slash is safe** (stripped at `:63`); a missing `/api/v1`, an appended segment, or a different case in `/webhooks/CLT` all produce a 404 relayed to the student as `This join link is not valid.` |
| `LMS_TICKET_ISSUER` | Default `lms.deltainstitutions` (`config.py:50`) | same literal as the LMS's `INTEGRATION_JWT_ISSUER` — set explicitly on both sides | Passed as `issuer=` (`lms_tickets.py:178`); mismatch → 401 `This link was not issued by a recognised LMS`, with a perfectly valid signature |
| `LMS_TICKET_AUDIENCE` | Default `clt-connect` (`config.py:51`) | same literal as `INTEGRATION_JWT_AUDIENCE` | `audience=` at `lms_tickets.py:179`; mismatch → 401 `This link was not issued for this service` |
| `LMS_TICKET_LEEWAY_SECONDS` | Default 60 (`config.py:57`) | leave it | Applied to `exp` (`lms_tickets.py:180`) and as the Redis jti TTL (`:218`). Together with the LMS's 90s ticket TTL this tolerates **150 seconds** of the meeting host running ahead of the LMS. Past that, every ticket is born expired → 410 `This join link has expired` on joins that are in fact fresh. Raising it to hide a clock problem widens the replay window instead of fixing it |
| `LMS_JWKS_CACHE_SECONDS` | Default 3600 (`config.py:54`) | leave it — **this is your key-rotation overlap window** | An unknown `kid` forces one immediate refetch (`lms_tickets.py:130-138`), so rotation is not blocked by the cache — unless you reuse a kid, in which case every join fails for this long. The cache is a module global per uvicorn worker; there is no flush endpoint, only a restart |
| `LMS_S2S_MAX_SKEW_SECONDS` | Default 300 (`config.py:63`) | leave it | Only loosens the LMS→meeting direction. The LMS's own tolerance is **hardcoded** at 5 minutes (`utils/cltSignature.ts:26`); nothing in a `.env` loosens that one. Both boxes need NTP |
| `LMS_RECORDING_BASE_URL` | Default `http://localhost:8002` (`config.py:69`) | `https://connect-api.deltainstitutions.com` | Builds the playback link handed back to the LMS when a recording is on local disk. Left at the default, LMS admins get a link that works only on the server itself. R2-stored recordings presign themselves and ignore it |

**Meeting platform — its own operation:**

| Variable | Required? | Production value | What breaks if wrong |
|---|---|---|---|
| `LIVEKIT_WS_URL` | Has a default, so it boots — but the feature dies (`config.py:16`) | `wss://<LIVEKIT_WS_HOST>` — **public**, must be `wss://` | This is handed to the **browser** in every join response (`app/api/lms.py`). Left at `ws://localhost:7880` the join returns 200 with a valid token and the video never connects, because the browser dials the student's own machine — and plain `ws://` on an https page is blocked as mixed content anyway. Reads as a client problem |
| `LIVEKIT_HTTP_URL` | Default `http://localhost:7880` (`config.py:17`) | `http://127.0.0.1:7880` on the PM2 path; stays local, never public | Server-side room creation. Unreachable → 503 `Media server unavailable` to the instructor, and students then get "this class has not started yet" |
| `REDIS_URL` | Default is **wrong for production** — `redis://localhost:6380/0` (`config.py:25`) | `redis://127.0.0.1:6379/0` | Port 6380 is the dev compose mapping. Redis is a hard dependency of **joining**, not just of background work: the ticket jti is burned with `SET NX` (`lms_tickets.py:219`). Unreachable → nobody can enter any class, and it gets triaged as a background-jobs problem. Absent from `infra/.env.prod.example` |
| `CORS_ORIGINS` | Default is three localhost origins (`config.py:42`) | `https://connect.deltainstitutions.com` only, comma-separated, scheme+host, **no trailing slash, no path** | Applied with `allow_credentials=True`, so a wildcard is not a legal escape hatch. Only matters when the SPA and API are on different origins (§7.3). The default's comment claiming the LMS portals call this API directly is stale — they do not; the LMS leaves by full page navigation. Adding the LMS origins is harmless and achieves nothing |
| `TRUSTED_PROXY_IPS` | Default empty = trust nobody (`config.py:71-76`) | `127.0.0.1` behind Nginx/Caddy on the same box | Behind a proxy the direct peer is always the proxy, so **every user collapses into one rate-limit bucket** and 10 logins/min throttles the whole site. The paired requirement is on the proxy: nginx must **set** `X-Forwarded-For` to `$remote_addr`, not `$proxy_add_x_forwarded_for` — `rate_limit.py` reads the left-most entry, and an appending proxy lets a caller forge a fresh bucket per request. **The LMS's own nginx block appends (`nginx.lms.conf:44`) — do not copy it for the meeting API** |
| `MAX_PARTICIPANTS_PER_ROOM` | Default 50 (`config.py:177`) | one number, ≤50, equal to the LMS's `LIVEKIT_MAX_PARTICIPANTS` and to `room.max_participants` in the yaml actually mounted | Its **only** effect is the rejection gate on a provisioning request whose capacity exceeds it. It does **not** set the LiveKit room cap — see §8 |
| `MAX_CONCURRENT_ROOMS` | Default 8 (`config.py:172`) | size to the box's CPU | Refuses a new room past the limit; the **instructor** sees 503 `Server at capacity`. A school running nine simultaneous classes hits this with everything else perfect |
| `JWT_EXPIRE_MINUTES` | Default 720 in code (`config.py:35`) | **set `720` explicitly** | The code comment explains it must outlast a full teaching session because there is no refresh endpoint — but the compose file writes `${JWT_EXPIRE_MINUTES:-60}`, so on that path omitting it logs instructors out an hour into a class |
| `SENTRY_ENVIRONMENT` | Default `development` (`config.py:168`) | `production` | Omit it and every production error is tagged development and easy to dismiss |
| `EMAIL_BACKEND` | `""` = auto (`config.py:111,217-221`) | `gmail_api` | Auto resolves to `gmail_api` only when `GMAIL_SENDER` **and** one of `GOOGLE_SA_JSON`/`GOOGLE_SA_FILE` exist; otherwise it silently falls back to SMTP, which many hosts block outbound. Forcing `gmail_api` makes a misconfiguration loud |
| `GMAIL_SENDER` / `GOOGLE_SA_JSON` | Feature (`config.py:114-115,214`) | delegated sender address; service-account key as **single-line** base64 | Line-wrapped base64 is the classic failure — use `-w0`. `GOOGLE_SA_FILE` is a path fallback and is not forwarded by the compose allowlist |
| `SMTP_USER` / `SMTP_PASS` | Leave **empty** in production (`config.py:101-102,210`) | empty | Filling them on a host that blocks outbound SMTP produces slow timeouts on every email |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET` | Feature (`config.py:157-160`) | R2 credentials; keep the bucket **private** | The name is `R2_BUCKET`, **not** `R2_BUCKET_NAME` (that is the LMS's name — §8). And `r2_enabled` checks only account_id + bucket + access_key_id (`config.py:186`): set those three and leave the **secret** blank or stale and the app reports R2 as enabled and fails on every real call. This is the one R2 misconfiguration that does not fail closed |
| `RECORDINGS_DIR` | Default `./recordings`, relative to cwd (`config.py:81`) | an **absolute** path, the same directory the egress container writes into | Mismatch → recordings complete and the API cannot find the file; playback 404s and the archive upload has nothing to send |
| `UPLOADS_DIR` | Default `./uploads` (`config.py:82`) | absolute path | A wrong path silently creates an empty directory and every previously uploaded course image 404s. An unwritable path raises at import and the app does not start |
| `EGRESS_RECORD_WIDTH` / `_HEIGHT` / `_FRAMERATE` / `_BITRATE` | Code defaults are 1920/1080/15/3500 (`config.py:128-131`) | `1280` / `720` / `15` / `2000` | The production template overrides the code defaults on purpose: 720p@15fps is ~1 vCPU per room. Leaving the 1080p code default on the measured hardware starves the SFU and truncates recordings |
| `EGRESS_TEMPLATE_URL` | Default empty (`config.py:149`) | leave empty for LiveKit's built-in layout, or the `/egress` page on the **frontend** host | Must be reachable **from inside the egress container**. Pointing it at the API host, or at a name only the public internet resolves, produces blank recordings discovered after the class |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | Both together (`config.py:90-91,182`) | BotFather token + the negative group id | The name is `TELEGRAM_CHAT_ID`. The root `.env.example` ships `TELEGRAM_CHANNEL_ID`, which nothing reads (§8) |
| `TELEGRAM_DELETE_LOCAL_AFTER_UPLOAD` | Code default `False` (`config.py:93-94`) | decide deliberately | The code comment argues for keeping the local copy ("Telegram is an off-site backup, not the primary store"); both shipped production templates set `true`. Do not inherit this by accident |
| `BACKUP_BOT_TOKEN` / `BACKUP_CHAT_ID` | Both together (`config.py:120-121,225`) | a **separate** bot and a new group | Either blank and the twice-daily Postgres dump never runs, with no error |
| `PG_BACKUPS_DIR` | **Not a settings field** — read raw at `backend/app/tasks/backup.py:20`, default `/backups` | a writable absolute path on the PM2 path | The task does `mkdir(parents=True)` before dumping, so on the PM2 path the root-level `/backups` default raises PermissionError and **no dump is ever produced** — while the backup bot credentials look perfectly configured |
| `LOG_LEVEL` | Default INFO (`config.py:7`) | `INFO` | An invalid name silently falls back to INFO |

**Leave alone (correct defaults):** `JWT_ALGORITHM`, `STUDENT_JWT_EXPIRE_MINUTES`, `DB_POOL_SIZE`/`DB_MAX_OVERFLOW`/`DB_POOL_TIMEOUT`, `EGRESS_RECORDINGS_MOUNT`, `RECORDING_MODE`, `RECORDING_RECONCILE_ENABLED`, `RECORDING_*_MAX_PER_SWEEP`, `RECORDING_UPLOAD_HOURS`, `RECORDING_RETENTION_DAYS`, `R2_ENDPOINT` (derived from the account id — `config.py:190`), `R2_PRESIGN_TTL`, `SMTP_HOST`/`SMTP_PORT`/`SMTP_TIMEOUT`, `EMAIL_*_RETR*`, `TELEGRAM_BOT_API_BASE` (set `http://telegram-bot-api:8081` on the compose path to lift the 50 MB cap), `TELEGRAM_MAX_SINGLE_FILE_MB`, `INSTANT_LINK_RETENTION_DAYS`, `RECORDINGS_REMOTE_*` (empty unless the two-box split is live), `SENTRY_TRACES_SAMPLE_RATE`, `BOOKINGS_PAUSED=false`, `BOOKING_REMINDERS_ENABLED=false` (turning it on while the LMS cron still runs sends every student two reminder emails).

**Do not bother setting — declared and read by nothing in this build:** `DOMAIN` (only a startup log line), `FRONTEND_URL`, `BOOKING_URL`, `STUDENT_FALLBACK_OWNER_EMAIL`, `RECORDING_ACCESS_TTL_DAYS`, `MAX_LOAD_RATIO`, and the entire `MONGODB_*` block that the compose file forwards. Their comments describe behaviour that is not wired up.

**Not an env var, but the room will not provision without it:** a `users` row with `role = 'super_admin'` must exist, or provisioning returns 503 `No owner account exists to attach the room to`. And an existing database needs the `courses.lms_live_class_id` column or every LMS join 500s. Both are checked in §7.7–7.8.

---

## 4. LMS `client/.env` and `admin/.env`

**Nothing here names the meeting platform, and nothing needs to.** Both Join buttons ask the LMS backend and navigate to whatever absolute URL it returns. If a student ever sees `The meeting platform address is not configured.`, that is `CLT_PUBLIC_URL`/`CLT_BASE_URL` missing in **backend/.env**, never a frontend variable.

### The naming asymmetry — this is the trap

Both browsers call the relative path `/api/v1`, so the Next server forwards everything. Each app has **two** forwarders, and the four resolution chains use **different names and different fallback ports**:

| Where | Chain | Default |
|---|---|---|
| `client/next.config.ts:4-6` (rewrite) | `NEXT_PUBLIC_API_URL` → `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:4000` |
| `client/src/app/api/v1/[...path]/route.ts:13` (proxy handler) | `API_URL` → `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:8000` |
| `admin/next.config.ts:6` (rewrite) | `API_URL` only | `http://localhost:8000` |
| `admin/src/app/api/v1/[...path]/route.ts:10` (proxy handler) | `API_URL` → `NEXT_PUBLIC_API_URL` | `http://localhost:8000` |

The client handler never reads `NEXT_PUBLIC_API_URL`; the admin handler never reads `NEXT_PUBLIC_API_BASE_URL`; the admin rewrite reads neither. **Copying one app's `.env` to the other breaks the one you copied into.**

The only safe instruction: **set `API_URL`, `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_API_BASE_URL` to the same value in both apps**, present at build time and at run time. That satisfies all four chains regardless of which forwarder serves a given request.

| Variable | Required? | Production value | What breaks if wrong |
|---|---|---|---|
| `API_URL` (both apps) | Has a default, so the app boots — runtime | `https://api-lms.deltainstitutions.com` — **bare origin, no trailing slash, and absolutely no `/api/v1` suffix** (both proxies append it) | Wrong → every API call is forwarded to a dead port; the handler answers 502 `PROXY_ERROR`. Client reads it per request (restart is enough); **admin reads it at module load** (`route.ts:10`, outside the function) so admin needs a process restart |
| `NEXT_PUBLIC_API_URL` (both) | **Build-time** | same value | Client: first choice for the rewrite and the source for the server-rendered `/courses/by-id/[id]` page, so a wrong value dead-ends ObjectId links while slug links keep working. Admin: only the handler's fallback. It is `NEXT_PUBLIC_`, so it is inlined into the public bundle — if you optimise `API_URL` to a loopback address, keep this one on the public https host |
| `NEXT_PUBLIC_API_BASE_URL` (both) | **Build-time** | same value | Client rewrite fallback **and** the client handler's only fallback. Missing together with `API_URL`, the client rewrite lands on `localhost:4000` — which on the production box is the **exam-tracker API**, so the LMS would serve another product's 404s instead of failing loudly |
| `PROXY_SHARED_SECRET` (both) | Runtime feature | the **same 64 hex** as `backend/.env` | Unset → the relay headers are simply not sent (`client route.ts:38-44`) and all users share one rate-limit bucket. Set-but-mismatched is worse: identical symptom while you believe it is fixed. **The frontends do not trim; the backend does** — a trailing space is a silent mismatch |
| `NEXT_PUBLIC_R2_PUBLIC_URL` (both) | **Build-time** | the R2 public bucket URL | Read **only** to add one entry to `images.remotePatterns` (`client/next.config.ts:10,20-22`; `admin/next.config.ts:9,19-21`). Missing or malformed is swallowed by the try/catch and no R2 host is allowed, so every `next/image` from the bucket returns 400 `hostname is not configured` — thumbnails and avatars broken, rest of the page fine. Deliberately not a wildcard, so it must be the exact bucket host |
| `NEXT_PUBLIC_DEVTOOLS_GUARD` (both) | **Build-time; the default is the dangerous direction** | set to the literal string `off` in both apps unless you positively want the guard | `guardEnabled()` returns false only for exactly `off`, and is otherwise true whenever `NODE_ENV === 'production'` (`client/src/lib/devtoolsGuard.ts:73-79`). Unset = **armed**: when it detects DevTools it closes the window and blanks the document. Your own staff debugging a live admin issue will have the page vanish. `on`, `true`, `yes` and unset are all the same branch |
| `NEXT_PUBLIC_SENTRY_DSN` | Optional, build-time | your DSN or blank | Every `Sentry.init` passes `enabled: !!dsn`, so blank is an explicit no-op. Production sample rate is fixed at 0.2 in code |
| `SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN` | Optional, build-only | leave unset unless uploading source maps | Without them stack traces stay minified. The auth token is a real secret and must never carry a `NEXT_PUBLIC_` prefix. Set `CI=1` on the build command if you use them — otherwise the plugin's output is silenced (`next.config.ts`) and a failed upload is invisible |
| `NEXT_PUBLIC_TABBY_PUBLIC_KEY` / `NEXT_PUBLIC_TABBY_MERCHANT_CODE` (client) | Build-time, both together | live `pk_…` and the live merchant code | Either empty → the Tabby promo renders **nothing at all**, silently. The merchant code must equal the backend's `TABBY_MERCHANT_CODE`, or the on-page messaging advertises one account's terms while checkout is created against another. Never put an `sk_` key here |
| `NEXT_PUBLIC_TAMARA_PUBLIC_KEY` (client) | Build-time | leave blank until the real key exists | The component shape-checks it and renders nothing on a mismatch, so a malformed key is indistinguishable from an empty one. The regex is **lowercase-only** — lowercase the UUID before pasting it |
| `PORT` | client only | `3000` (or whatever nginx proxies to) | **Asymmetry:** `client/package.json:8` is `next start` so `PORT` applies; `admin/package.json:8` is `next start --port 3001` and the hard-coded flag **wins — `PORT` is silently ignored in admin**. To move the admin app you must edit `package.json`, not the `.env` |

**Do not set:** `NODE_ENV` in either frontend `.env` (`next start` sets it; getting it wrong disarms the DevTools guard and quintuples the Sentry trace rate), `NEXT_PUBLIC_RAZORPAY_KEY_ID` (dead — the real key arrives from the backend in the create-order response), `NEXT_PUBLIC_CLIENT_URL` in admin (dead — the live "View as student" button uses the backend's `CLIENT_URL`).

**A `NEXT_PUBLIC_` change takes a rebuild, not a restart.** `client/.next/routes-manifest.json` currently has the rewrite destination frozen as the literal `http://localhost:8000/api/v1/:path*` from the last build. Edit the `.env`, restart with PM2, watch nothing change.

---

## 5. The values that must match

| LMS name | Meeting name | Exact error on mismatch |
|---|---|---|
| `CLT_S2S_SECRET` (`clt.service.ts:30`, `integrations.routes.ts:59`, `webhooks.routes.ts:517`) | `LMS_S2S_SECRET` (`config.py:61`) | Student sees the literal **`Bad signature`** on the meeting entry page — the LMS 401s the exchange and `lms_handoff.py:105-109` relays the LMS's own message. In the other direction, room provisioning gets 401 `Bad LMS signature` and fails **silently** (best-effort), surfacing later as "this class has no room yet" |
| `INTEGRATION_JWT_ISSUER` (`integrationKeys.ts:25`) | `LMS_TICKET_ISSUER` (`config.py:50`) | 401 **`This link was not issued by a recognised LMS`** (`lms_tickets.py:187-188`) |
| `INTEGRATION_JWT_AUDIENCE` (`integrationKeys.ts:26`) | `LMS_TICKET_AUDIENCE` (`config.py:51`) | 401 **`This link was not issued for this service`** (`lms_tickets.py:185-186`) — indistinguishable from an issuer mismatch to the student; separable only in the meeting's logs |
| `INTEGRATION_JWT_PRIVATE_KEY` + `_KID` (public half served at `/.well-known/jwks.json`, `app.ts:164`) | `LMS_JWKS_URL` (`config.py:49`) | Key not loaded → JWKS serves `{"keys":[]}` with **HTTP 200** and every join 401s `This link was signed with an unrecognised key`. Kid reused across a rotation → the same 401 for up to `LMS_JWKS_CACHE_SECONDS` |
| `CLT_PUBLIC_URL` (`classHandoff.controller.ts:45`) | `CORS_ORIGINS` (`config.py:42`) + `VITE_API_BASE` at build | Browser blocks the SPA's `POST /api/lms/enter` before it is sent; presents as a broken login, not a config problem |
| `CLT_BASE_URL` (`clt.service.ts:29`) | the origin the meeting API is actually served on | Provisioning fails **non-fatally**, so nothing shows until an instructor tries to host |
| — | `LMS_WEBHOOK_URL` must be `https://api-lms.deltainstitutions.com/api/v1/webhooks/clt` (LMS mount at `app.ts:104`) | Wrong shape → 404, relayed to the student as `This join link is not valid.`; blank → 503 `Could not reach the LMS to open this class` |
| `LIVEKIT_MAX_PARTICIPANTS` (`liveClass.service.ts:21`) | `MAX_PARTICIPANTS_PER_ROOM` (`config.py:177`) **and** `room.max_participants` in the mounted LiveKit yaml | LMS higher → 400 `A room holds N participants; M was requested`, swallowed as best-effort, class ends up with no room. Both higher than LiveKit's cap → students refused at join time |
| `INTEGRATION_TICKET_TTL_SEC` (90) | `LMS_TICKET_LEEWAY_SECONDS` (60) | Their sum is a 150-second clock-skew budget. Meeting host more than 150s ahead of the LMS → 410 `This join link has expired — open the class again` on every join. Both hosts on NTP |
| `PROXY_SHARED_SECRET` in `backend/.env` | the same in `client/.env` **and** `admin/.env` | No error anywhere — just one shared rate-limit bucket for the whole platform |
| `TABBY_MERCHANT_CODE` (backend) | `NEXT_PUBLIC_TABBY_MERCHANT_CODE` (client) | Promo advertises one merchant's terms, checkout is created against another |
| `R2_PUBLIC_URL` (backend) | `NEXT_PUBLIC_R2_PUBLIC_URL` (both frontends, build-time) | Images 400 from the Next image optimizer |

---

## 6. Generate the secrets

Run in this order. **Every one of these must be generated fresh for production** — the dev values in the working tree have been printed to terminals and should be treated as exposed. The two exceptions are at the bottom.

```bash
# 1. LMS session secrets — two DIFFERENT values (backend/src/config/env.ts:17-18)
openssl rand -hex 32   # → JWT_ACCESS_SECRET
openssl rand -hex 32   # → JWT_REFRESH_SECRET

# 2. The one secret that spans both applications.
#    Paste the SAME output into LMS CLT_S2S_SECRET and meeting LMS_S2S_SECRET.
openssl rand -hex 32

# 3. The Ed25519 ticket signing key. The LMS keeps the private half; the
#    meeting app only ever fetches the public half from the JWKS endpoint.
openssl genpkey -algorithm ed25519 -out lms-ticket-prod.pem
base64 -w0 lms-ticket-prod.pem            # → INTEGRATION_JWT_PRIVATE_KEY (one line)
date +lms-%Y-%m                           # → INTEGRATION_JWT_KID (new label every rotation)
#    On a box without `base64 -w0` (macOS/Windows), the code's own form:
#    bun -e "console.log(require('fs').readFileSync('lms-ticket-prod.pem').toString('base64'))"
shred -u lms-ticket-prod.pem              # after it is safely in the .env

# 4. Rate-limit relay secret — the SAME value into backend/.env,
#    client/.env and admin/.env. No trailing whitespace (the frontends
#    do not trim; backend/src/middleware/rateLimit.middleware.ts:37 does).
openssl rand -hex 32

# 5. Meeting platform's own session secret (meeting backend JWT_SECRET).
#    Unrelated to anything in the LMS.
python3 -c "import secrets; print(secrets.token_urlsafe(48))"

# 6. LiveKit API secret — must be >= 32 chars and identical in the meeting
#    backend/.env and in infra/.env (the SFU's own config).
openssl rand -hex 32

# 7. Postgres password for the meeting database (same value in
#    DATABASE_URL, DATABASE_URL_SYNC and infra/.env POSTGRES_PASSWORD)
openssl rand -hex 24

# 8. Optional: AI-academy integration secret (LMS AI_ACADEMY_S2S_SECRET),
#    shared with the academy-api service.
openssl rand -hex 32

# 9. Optional: Tabby webhook secret (a value you choose)
openssl rand -hex 24

# 10. Super-admin bootstrap password — pass it INLINE, never store it in .env.
#     Minimum 12 characters.
openssl rand -base64 24
```

**Do not regenerate if production already works:** `CLT_S2S_SECRET`/`LMS_S2S_SECRET` (rotating breaks every join until both hosts change in the same window), `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` (signs out the entire user base), the meeting `JWT_SECRET` (logs out every meeting admin), and `INTEGRATION_JWT_PRIVATE_KEY` if a working raw PEM is already in place — re-encoding a value that works is a needless risk, and a botched re-encode takes every Join to a 503 with only one log line.

**Rotating the ticket key without downtime** (the code supports it; the procedure is forced by the meeting side's cache): choose a **new kid**; move the current key/kid into `INTEGRATION_JWT_PRIVATE_KEY_PREVIOUS`/`INTEGRATION_JWT_KID_PREVIOUS` and put the new pair in the active slots; restart the LMS (keys are cached in module state forever, there is no reload path); confirm the JWKS now lists **two** keys; wait one `LMS_JWKS_CACHE_SECONDS` (1h); then blank both `_PREVIOUS` vars and restart again. The meeting side needs no change and no restart — that is the point of publishing a JWKS.

---

## 7. Decide on the host

The repo cannot settle these. Each one is a failed cutover if guessed.

1. **The LMS admin app's production origin** (`ADMIN_URL`). It is documented **nowhere**: `nginx.lms.conf` holds only the API vhost (`:30`), `ecosystem.config.js` defines only `lms-backend`, there is no vercel.json or Dockerfile under `admin/`, and the local `.env` says `localhost:3001`. A wrong value breaks admin CORS and presents as a broken login.
   ```bash
   sudo nginx -T | grep -n server_name
   sudo ls /etc/letsencrypt/live/
   grep -E '^(ADMIN_URL|CLIENT_URL)=' ~/lms/backend/.env
   ```

2. **The meeting platform's real hostnames** (`CLT_BASE_URL`, `CLT_PUBLIC_URL`, `LMS_RECORDING_BASE_URL`, `LIVEKIT_WS_URL`). The templates ship `meet-api.example.com` / `meet.example.com`, which are not a deployment.
   ```bash
   sudo nginx -T | grep -nE 'server_name|root |proxy_pass'
   # or, on the compose path:  docker exec <caddy> cat /etc/caddy/Caddyfile
   ```

3. **Do the meeting SPA and its API share one origin?** This alone decides whether `CLT_PUBLIC_URL` and `CLT_BASE_URL` are one value or two, whether `CORS_ORIGINS` needs a real entry, and whether `VITE_API_BASE` should be the empty string. The shipped Caddyfile splits them across three hostnames.
   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' https://<spa-host>/lms/enter    # 200 = the SPA answers
   curl -s -o /dev/null -w '%{http_code}\n' https://<api-host>/health       # 200 = the API answers
   # And check what the DEPLOYED bundle was built with — VITE_API_BASE is baked in:
   grep -aoh 'https\?://[a-zA-Z0-9.:-]*' /srv/web/assets/*.js | sort -u | head -20
   ```
   If `localhost:7001` appears in that last output, the SPA was built with `VITE_API_BASE` **undefined** and must be rebuilt — the fallback is asymmetric: undefined → `http://localhost:7001`, empty string → same-origin relative URLs (`frontend/src/api/client.js:6-7`).

4. **Which deployment path is live on the meeting box.** The repo ships two mutually exclusive ones needing different files: all-in-Docker (`infra/docker-compose.prod.yml`) versus PM2 + Nginx (`ecosystem.config.js`). On the compose path the container gets an **explicit allowlist**, not `env_file`, and the `LMS_*` names are not in it — so setting them in `infra/.env` does nothing.
   ```bash
   pm2 list; docker ps --format '{{.Names}}\t{{.Image}}'
   # On the compose path, verify what the app actually SEES:
   docker exec <api-container> env | grep -E '^(LMS_|TRUSTED_PROXY_IPS|MAX_PARTICIPANTS_PER_ROOM|REDIS_URL|JWT_EXPIRE_MINUTES)'
   ```

5. **Which ports are free, on both boxes.** Port 4000 on the LMS host already belongs to the exam-tracker API. The meeting stack claims 8002, 5432, 6379, 7880, 7881, 6789/tcp plus 3478, 50000-50199 and 30000-40000/udp — and LiveKit runs `network_mode: host`, so a clash is a hard clash. 6379 and 5432 are the realistic collisions.
   ```bash
   ss -ltnp | grep -E ':(3000|3001|4001|8002|5432|6379|7880|7881|6789)\b'
   ss -lunp | grep -E ':(3478|50000|50199)\b'
   systemctl is-active redis-server postgresql
   grep -n -A6 'upstream lms_backend' /etc/nginx/sites-enabled/*lms*
   nproc; free -h; df -h /     # the meeting guide asks 4 vCPU / 8 GB with recording
   ```

6. **The live MongoDB connection string.** Read it, do not compose it — and take a copy of the whole file before editing:
   ```bash
   cp ~/lms/backend/.env ~/lms/backend/.env.bak.$(date +%F)
   cut -d= -f1 ~/lms/backend/.env          # names only, secrets stay off your screen
   grep -E '^DATABASE_URL=' ~/lms/backend/.env
   ```

7. **Does a `super_admin` row exist in the meeting database?** No env var substitutes for it; without one, room provisioning returns 503 `No owner account exists to attach the room to`.
   ```bash
   psql "$DATABASE_URL_SYNC" -c "select id,email,role from users where role='super_admin' limit 5;"
   # if empty, from backend/ with the venv active:
   python -m scripts.create_admin --email <owner@domain>
   ```

8. **Is the meeting database migrated for the integration?** An older database keeps working until the first query touches `courses.lms_live_class_id`, then every LMS join 500s.
   ```bash
   psql "$DATABASE_URL_SYNC" -c "\d courses" | grep lms_live_class_id
   # if absent, from backend/:  alembic upgrade head
   ```

9. **Can each box reach the other?** The exchange is an outbound POST from the meeting box to the LMS; a firewall rule becomes a student-facing 503 that looks like nothing.
   ```bash
   # From the MEETING host:
   curl -s https://https://api-lms.deltainstitutions.com/.well-known/jwks.json | head -c 400
   #   → must be JSON with a NON-EMPTY "keys" array. {"keys":[]} returns 200 and
   #     means INTEGRATION_JWT_PRIVATE_KEY/KID failed to load on the LMS.
   curl -s -o /dev/null -w '%{http_code}\n' -X POST \
     -H 'content-type: application/json' -d '{"code":"x"}' \
     https://https://api-lms.deltainstitutions.com/api/v1/integrations/handoff/exchange
   #   → expect 401. 404 = wrong base path. 000 = blocked.

   # From the LMS host:
   curl -s -o /dev/null -w '%{http_code}\n' -X POST https://https://connect-api.deltainstitutions.com/api/lms/rooms
   #   → expect 401 (missing signature headers). 503 = LMS_S2S_SECRET is blank there.
   ```

10. **Clock offset.** The binding constraint is 150 seconds, not the 300-second S2S window.
    ```bash
    # on BOTH hosts:
    date -u '+%s.%N'; timedatectl status; chronyc tracking 2>/dev/null
    ```

11. **Is `PROXY_SHARED_SECRET` actually being relayed?** The repo cannot see the frontends' deployment settings. The backend detects this exact case:
    ```bash
    pm2 logs lms-backend --lines 500 | grep -i 'NO request has ever presented it'
    ```
    If that line appears, the frontends are not relaying and every visitor shares one bucket.

12. **Does the production nginx/WAF preserve the raw body and the `X-CLT-*` headers** on `/api/v1/integrations/handoff/exchange` and `/api/v1/webhooks/clt`? The webhook signature is computed over the exact bytes, so a proxy that strips unknown headers or re-serialises JSON presents as `BAD_SIGNATURE` and reads as a wrong secret. Replay one signed request through the proxy and again at the origin and compare.

13. **Which LiveKit yaml is actually mounted**, and what cap it carries (four files exist; `livekit.prod.yaml` says 30, the others 50):
    ```bash
    docker inspect <livekit-container> --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{"\n"}}{{end}}'
    ```

---

## 8. Traps

**Documentation that names variables the code does not read**

- **`MONGODB_URI` does not exist.** `CLAUDE.md`'s env block says `MONGODB_URI=`; the code declares `DATABASE_URL` (`env.ts:14`). Set the documented name and the server exits 1 complaining about a variable the doc never mentioned. `MONGODB_URI` survives only as a legacy fallback in two diagnostic scripts.
- **`JWT_SECRET` does not exist in the LMS.** `CLAUDE.md` and `SERVER.md:151` both list it. The code requires `JWT_ACCESS_SECRET` **and** `JWT_REFRESH_SECRET`, two different values, each ≥32 chars (`env.ts:17-18`). A `.env` built from either doc does not start. (The meeting platform *does* have a `JWT_SECRET` — different application, different job.)
- **`CLAUDE.md`'s ports are wrong for production.** It says `PORT=8000` and `NEXT_PUBLIC_API_BASE_URL=http://localhost:8000`. The zod default is 4000 and PM2 sets 4001. And the admin app reads `API_URL`, not `NEXT_PUBLIC_API_BASE_URL` — setting the documented name leaves the admin proxy on `localhost:8000`.
- **`admin/.env.example:14` tells you to write a value that 404s every request:** `NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1`. Both admin forwarders **append** `/api/v1`, so following the example produces `/api/v1/api/v1/…`. Neither proxy strips it.
- **`admin/.env.example` never mentions `API_URL`** — the only name its rewrite reads. Fill that file faithfully and the rewrite silently keeps `localhost:8000`.
- **`client/.env.example` calls `NEXT_PUBLIC_API_BASE_URL` an "alias".** It is not: the client's route handler reads *only* that name and never `NEXT_PUBLIC_API_URL`.
- **`LIVEKIT_MAX_SEATS` is read by nothing.** An older `CLT_INTEGRATION.md` used that name; the code reads `LIVEKIT_MAX_PARTICIPANTS` (`liveClass.service.ts:21`), so the doc's name silently leaves the cap at 50.
- **`INTEGRATION_JWT_PREVIOUS_*` is read by nothing.** `plan.md:162` uses that order; the code reads `INTEGRATION_JWT_PRIVATE_KEY_PREVIOUS` / `INTEGRATION_JWT_KID_PREVIOUS` (`integrationKeys.ts:125-126`). A rotation done from that doc publishes only the new key and 401s every ticket in flight.
- **`TELEGRAM_CHANNEL_ID`, `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL`, `MONGODB_*` are not meeting-platform variables.** The code reads `TELEGRAM_CHAT_ID` (`config.py:91`), `R2_BUCKET` (`:160`) and `R2_ENDPOINT` (`:162`). Because pydantic is `extra="ignore"`, every wrong name is **silently discarded** — no boot error, no warning, feature quietly off.
- **`meeting-platform/docs/sso-lms-integration.md` is fiction** relative to this code: SAML ACS, OIDC callback, LTI 1.3, a JWKS at `/oauth2/jwks`. None of it exists. The real contract is `LMS_JWKS_URL` / `LMS_S2S_SECRET` / `LMS_WEBHOOK_URL`.
- **`LIVE_CLASS_HANDOFF` is dead.** It appears only in a regression test asserting it no longer exists. Do not carry it forward.

**Templates that are missing whole blocks**

- **The meeting platform's production templates contain ZERO `LMS_*` variables.** `grep -c "LMS_" infra/docker-compose.prod.yml` returns 0; the same for `infra/.env.prod.example` and the root `.env.example`. Copy a template verbatim and you get a meeting server with **all three integration planes switched off** — and since each plane keys off the mere presence of a value (`config.py:194-206`), the only symptom is a 503 saying the integration is "not enabled on this server". This block has to be typed in by hand.
- **On the compose path, putting `LMS_*` in `infra/.env` does nothing.** The api/celery services use an explicit `environment:` allowlist, not `env_file`. The variable is set on the host, absent in the container, and a correct-looking `.env` sits right there. Same for `TRUSTED_PROXY_IPS`, `MAX_PARTICIPANTS_PER_ROOM`, `RECORDING_RETENTION_DAYS`, `GOOGLE_SA_FILE` and `PG_BACKUPS_DIR`.
- **`TRUSTED_PROXY_IPS` and `REDIS_URL` are missing from `infra/.env.prod.example`** — and both defaults are wrong behind a proxy / for production Redis.
- **`backend/.env.example` (LMS) is missing ~30 variables the code reads, and every one of them is outside the zod schema** — so filling production from it produces a healthy-looking server with features quietly off: `SENTRY_DSN`, `COOKIE_DOMAIN`, `LEGACY_COOKIE_DOMAIN`, `ENABLE_CRON`, `BIND_HOST`, all seven `RATE_LIMIT_*`, every `SMTP_BACKUP_*`, the `EMAIL_OUTBOX*` set, `CRITICAL_*`, `DIGEST_HOUR`, `CROSS_ORG_CLASSES`, `AI_ACADEMY_S2S_SECRET`, `JWT_ENFORCE_AUDIENCE`, `PERMISSIONS_MODE`, `R2_KYC_BUCKET_NAME`, `GOOGLE_MEET_ACCESS_TYPE`, `GOOGLE_WORKSPACE_DOMAIN`, `WATI_*`, `BOOKING_CUTOFF_MINUTES`, `STUDENT_JOIN_GRACE_MINUTES`.
- **Neither frontend `.env.example` is in git.** `client/.gitignore:34` and `admin/.gitignore:34` are a bare `.env*` with no `!.env.example` negation, so a fresh clone on the production host has **no template for either app**. Copy both by hand, or `git add -f client/.env.example admin/.env.example`.

**Defaults that look fine and are not**

- **`TAMARA_BASE_URL` defaults to the sandbox** (`env.ts:96`) and the example file ships the sandbox value too. Production is `https://api.tamara.co`. Get it wrong and checkout completes, the customer sees success, and no money moves — with nothing in the logs. `ABZER_BASE_URL`'s code default is correct but the **example file ships the sandbox**.
- **`R2_BUCKET_NAME` defaults to `learnos-media`** — a plausible name that is almost certainly not yours.
- **`REDIS_URL` on the meeting side defaults to port 6380**, the dev compose mapping; production publishes 6379. A PM2 deployer trusting the template inherits 6380 and every join fails at the ticket replay guard, while the app starts normally.
- **`LIVEKIT_WS_URL` defaults to `ws://localhost:7880`** and nothing validates it. The join returns 200 with a valid token; the video pane just never connects, on the student's machine.
- **`SENTRY_ENVIRONMENT` defaults to `development`** on the meeting side.
- **`LEGACY_COOKIE_DOMAIN` unset is not neutral** — in production it falls back to `.deltainstitutions.com` (`authCookies.ts:83`) and actively deletes cookies scoped there on every response that sets one. Correct while old cookies exist, but the behaviour of a blank line is not what a blank line suggests.
- **`COOKIE_DOMAIN` looks like a setting you should fill in and is not.** Empty is the **fix**, not an omission.

**Things that fail silently**

- **An empty JWKS is an HTTP 200.** `{"keys":[]}` is exactly what the LMS serves when the private key or the kid failed to load (`integrationKeys.ts:155-157`), so any health check asserting only the status code passes while the integration is completely dead. Check the **body**.
- **Blanking `INTEGRATION_JWT_PRIVATE_KEY` logs no error.** The guard at `integrationKeys.ts:101` returns before the try block; the only trace is an info line at `:137`. Greping the logs for `integration signing key could not be loaded` finds nothing and you conclude the key loaded.
- **Blanking `INTEGRATION_JWT_PRIVATE_KEY` is also not a clean kill switch.** The handoff is still issued and the browser still travels; the exchange then throws an error the exchange route does not catch, and the student gets a **500 `An unexpected error occurred`**. The clean rollback is to blank `CLT_PUBLIC_URL` **and** `CLT_BASE_URL` (honest 503 at click time), or, on the meeting side, `LMS_JWKS_URL`.
- **`X=` is not the same as deleting the line.** For zod-validated optionals, empty means unset (`env.ts:4-6`). For raw `Number(process.env['X'] ?? d)` reads it means **zero**: `LIVEKIT_MAX_PARTICIPANTS=` refuses every interactive class with "holds up to 0 participants" (`liveClass.service.ts:21,362-365`), `INTEGRATION_TICKET_TTL_SEC=` mints tickets born expired, `CLT_TIMEOUT_MS=` aborts every outbound call instantly. **Delete the line; do not blank it.**
- **The SMTP variables cannot be found by grepping for them.** `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`, `EMAIL_FROM` and all six `SMTP_BACKUP_*` names are read through a key-name lookup table (`email.service.ts:230-241`, resolved at `:252-264`), so `grep -rn "process.env.SMTP_HOST"` returns nothing and an audit based on that grep concludes they are unused. Misspell any of host/user/pass/from and the whole mailbox is dropped with one info line: **the platform sends no email at all and looks entirely healthy.**
- **Booleans compare against the exact string `true`.** `SMTP_SECURE=1`, `=yes`, `=TRUE` all mean **false** (`email.service.ts:262-264`). Same rule for `ENABLE_CRON`, `SIGNUP_REQUIRE_VERIFICATION`, `CHECKOUT_BLOCK_REJECTED`, `JWT_ENFORCE_AUDIENCE`, `DISABLE_RATE_LIMIT`, `SUPERADMIN_RESET_PASSWORD`. `CROSS_ORG_CLASSES` and `MEETING_DISPLAY_NAME` are lowercased first, so those two tolerate capitalisation and nothing else. `OTP_DEV_ECHO` compares against `'1'`.
- **`MEETING_DISPLAY_NAME` has exactly one meaningful value and every typo is silent.** Only `name` (any case) switches to profile names; `names`, `display`, `true` and unset all mean email. No validation, no log line — so a typo leaves every student's email address on screen for the whole class while you believe you turned it off. (If the ticket's name claim is somehow empty, the meeting side renders the literal `Student` — `lms_tickets.py:198`.)
- **`MAX_PARTICIPANTS_PER_ROOM` does not do what its own comment says.** The comment at `config.py:173-176` tells you production must override it "or the LMS will accept classes LiveKit then refuses at join time". But `livekit_rooms.py:23` hardcodes `max_participants=50` as a default argument and every caller passes only the room name, so **the number sent to `CreateRoom` is always 50** and this setting never reaches LiveKit. It only tightens the LMS-side rejection gate. Keep your chosen cap at or below 50; going above it needs a code change.
- **`R2_SECRET_ACCESS_KEY` (meeting side) is not part of the feature's own enabled test.** `r2_enabled` checks account_id + bucket + access_key_id only (`config.py:186`). Set those three with a blank or stale secret and the app reports R2 as enabled and fails on every real call — the one R2 misconfiguration that does not fail closed.
- **On the LMS side, `R2_PUBLIC_URL` blank is not cosmetic.** It is one of four names in `isR2Configured()` (`r2.service.ts:20-26`), so blanking it routes every upload to local disk *and* suppresses the loud H-11 KYC boot error, because `isKycStoragePrivate()` returns true early when R2 is off (`r2.service.ts:212-216`).
- **Several values are parsed once at module load and need a full restart, not a reload:** `BOOKING_CUTOFF_MINUTES`, `STUDENT_JOIN_GRACE_MINUTES`, `CROSS_ORG_CLASSES`, `INTEGRATION_JWT_ISSUER`/`AUDIENCE`, `PROXY_SHARED_SECRET`, every rate-limit max, and the signing keys (cached after first load, cleared only by a test-only reset).
- **`ENABLE_CRON` lives in `ecosystem.config.js:81`, not in `.env`, which makes it easy to lose.** Start the backend outside PM2 and it is absent, and the "only instance 0 runs jobs" fallback applies. The documented real-world failure is exactly this: instance 0 could not bind its port, crash-looped tens of thousands of times while pm2 showed a green row, and every reminder, reschedule notice, digest and email retry stopped for months.
- **`TZ` is set by code, not by `.env`.** `config/timezone.ts` assigns `process.env.TZ = 'Asia/Dubai'` before any `Date` exists. Putting `TZ=` in production is at best a no-op. Every cron schedule, day boundary and email date label is UAE wall clock regardless.
- **`nginx.lms.conf`'s own header comment says it balances "ports 4000..4003"** and `ecosystem.config.js` says "instance 0 → :4000". Both are stale prose: the live upstream is a single `server 127.0.0.1:4001` (`nginx.lms.conf:25`) and the live env is `PORT: 4001` (`ecosystem.config.js:80`). Trust the directives, not the comments above them — and edit both files in one sitting, they are one setting.
- **`cors.ts:7-8` hardcodes `http://localhost:3002` and `:3003` into the production allow-list.** They are preview ports; removing them takes a code change, not a `.env` change.
- **CORS matching is exact string equality** (`cors.ts:16`). A trailing slash on `CLIENT_URL` or `ADMIN_URL` can never match a browser Origin header, which carries none. The inconsistency is the trap: `CLT_BASE_URL` and `CLT_PUBLIC_URL` **are** defensively `rstrip`ped in code (`clt.service.ts:29`, `classHandoff.controller.ts:46`), and so is `LMS_WEBHOOK_URL` on the meeting side (`lms_handoff.py:63`) — so a trailing slash is harmless there and fatal in `CLIENT_URL`.
- **There is no readiness probe for any of this.** `/health` returns ok whether the integration is configured or not. The only real test is a person clicking Join. One cheap negative probe: POST a deliberately malformed ticket to the meeting's `/api/lms/join` and confirm the answer is 400 `Malformed join link` — a 503 "LMS integration is not enabled on this server" means the configuration never loaded.

---

## 9. Corrections applied, and what a reviewer still flagged

This guide was produced by five parallel code sweeps, each checked by an independent adversarial
verifier (33 corrections, 36 omissions folded in), then critiqued for completeness. The critic
confirmed sections 2b, 4, 5 and 8 as complete and correct against the code. It also raised the
following, which are recorded here rather than silently fixed, because some are judgement calls:

- **Three LMS credential blocks are not covered above.** Mux (`MUX_TOKEN_ID`, `MUX_TOKEN_SECRET`,
  `MUX_WEBHOOK_SECRET` -- `env.ts:58-60`), which gates `LiveClass.type = 'internal'`; the Abzer keys
  (`ABZER_ACCESS_KEY`, `ABZER_SECRET_KEY`, `ABZER_WEBHOOK_SECRET`, `ABZER_TEMPLATE_CODE` --
  `env.ts:75-78`); and `GOOGLE_CALENDAR_ID` (`googleMeet.service.ts:169`). None of them affect the
  meeting integration, but a deployer building a full production env needs them.
- **The meeting SPA has its own build env**, a third file this guide does not tabulate:
  `VITE_API_BASE` and `VITE_SENTRY_DSN`. On the compose path these are **CI build args**
  (`infra/docker-compose.prod.yml:108-116`), baked into the bundle -- putting them in an `.env` on
  the box changes nothing.
- **Build-time variables should be step 1, not a footnote.** Every `NEXT_PUBLIC_*` and every `VITE_*`
  is frozen at build. Fill them, then build, then deploy. Filling them after a build serves the
  previous bundle, and the symptom (a production page still calling `localhost:8000`) does not look
  like a config problem.
- **Where the two Next.js apps run is genuinely unsettled.** `ecosystem.config.js` defines only
  `lms-backend`, but both frontends carry a `.vercel` gitignore block and
  `rateLimit.middleware.ts:118-122` tells the operator to set `PROXY_SHARED_SECRET` "in BOTH Vercel
  projects". If they are on Vercel there is no `.env` on the box at all. Settle with
  `pm2 list` and `curl -sI https://lms.deltainstitutions.com | grep -i x-vercel`.
- **A trailing slash on `LMS_WEBHOOK_URL` is harmless**, not fatal -- it is stripped at
  `lms_handoff.py:63`. A missing `/api/v1` or a wrong origin is still fatal.
- **The raw-body concern applies to one endpoint, not two.** Only `/api/v1/webhooks/clt` is
  byte-sensitive (`app.ts:104`, `express.raw`). The handoff exchange signs the *code*, not the body
  (`cltSignature.ts:1-17`), so a proxy that re-serialises JSON cannot break it.
- **`SMTP_BACKUP_EMAIL_FROM` is not mandatory** -- the backup mailbox inherits `EMAIL_FROM`
  (`email.service.ts:255`). The real risk is the reverse: omitting it sends backup mail as the
  primary's From from a different account, which Gmail rejects.
- **`MAX_PARTICIPANTS_PER_ROOM` should be <= whatever the mounted LiveKit yaml says**, not a flat 50.
  `infra/livekit.prod.yaml:39` is 30; the other three configs say 50. Read the one actually mounted.
