# LMS ↔ CLT Connect — Build Plan & Progress

> **Other workstreams** — this file covers the CLT Connect build only.
> For the payment gateways (Tabby, Tamara), the mail-backlog fix and the
> cross-academy instructor work, see [`docs/work-status.md`](docs/work-status.md):
> what is done, what is blocked and on whom, and the next actions.

**Working plan.** Derived from `LMS_CLT_INTEGRATION_PLAN.md` (the design), this file
tracks what is actually built. Update the status boxes as work lands.

**Goal:** replace "In-App Stream" (Mux) with LiveKit rooms hosted by CLT Connect, so
instructors host from the LMS admin panel and booked students join with their LMS
identity — read from the LMS, never from CLT's database.

---

## 0. Decisions

The design offers defaults for A1–A3; those are taken unless overridden here.

| # | Decision | Taken | Status |
|---|---|---|---|
| A1 | Native LiveKit embed in Next.js (not an iframe) — keeps `WatermarkOverlay` on live video | ❌ **superseded** | **REOPENED — the redirect design leaves live classes unwatermarked. See §8.12** |
| A2 | Cap LiveKit classes at **50** participants, ≤8 concurrent rooms | ✅ option (1) from §9 | settled |
| A3 | Mux stays; LiveKit is a **new `provider`**, non-destructive | ✅ default | settled |
| D3 | Who holds the **production** Ed25519 private key | ⏳ | **open — ops decision** |
| D4 | Do recordings appear in the LMS library, or stay in CLT's Recordings tab | ⏳ | **open — needed by Phase 5 only** |
| D5 | Display name on a tile: **email** or LMS profile name | ✅ email (`MEETING_DISPLAY_NAME` unset) | settled — publishes addresses to the room on purpose, §8.3 |

D3 and D4 do not block Phases 1–4. A dev keypair is generated locally; production
key custody is a deployment decision.

---

## 1. Phase status

| Phase | Scope | LMS | CLT | Ships |
|---|---|---|---|---|
| **1** | Keypair, JWKS, ticket mint/verify, replay cache | ✅ **done** | ✅ **done** | nothing user-visible |
| **2** | S2S room provisioning, `provider` field, admin modal | ✅ **done** | ✅ **done** | rooms created |
| **3** | `/host-ticket` + instructor joins from admin | ✅ **done** | ✅ **done** | **instructor can host** |
| **4** | `/join-ticket` + entitlement + student watch page | ✅ **done** | ✅ **done** | **students can join** |
| **5** | Event webhooks: recording, attendance | ✅ **done** | ✅ **done** | attendance + recordings |
| **6** | Redirect handoff — one-time code, no name prompt | ✅ **done** | ✅ **done** | **promptless join** |
| **7** | One identity rule; production runbook | ✅ **done** | — n/a | **email on every tile** |

Legend: ⬜ not started · 🟡 in progress · ✅ done

---

## 2. Phase 1 — identity foundation

### LMS

- [x] `utils/integrationKeys.ts` — Ed25519 load, active + previous key, JWKS build
- [x] `services/integrationTicket.service.ts` — mint, 90s TTL, random `jti`, derived room name
- [x] `GET /.well-known/jwks.json` — outside `/api/v1`, cacheable, unauthenticated
- [x] Generate a dev keypair and wire `INTEGRATION_JWT_*` into `.env` (kid `lms-2026-08`)
- [x] Verify JWKS publishes the public key — live and serving
- [x] Test suite `integration.suite.ts` — **31 assertions, all passing**
- [x] Two defects fixed along the way (see log)

> The first three items were already present at session start. The endpoint answered
> `{"keys":[]}` until a key existed — failing safe rather than signing with a
> placeholder — and now serves the real public key.

### CLT — done

- [x] C1 CORS widened to `:3000` / `:3001` (default **and** `.env`)
- [x] C2 `services/lms_tickets.py` — JWKS fetch + cache, EdDSA verify, iss/aud/exp, alg pinned
- [x] C3 `jti` replay cache (Redis `SET NX EX`)
- [x] C5 `POST /api/lms/rooms` — idempotent by `liveClassId`
- [x] C6 `POST /api/lms/rooms/{room}/end` — idempotent
- [x] C7 `Course.lms_live_class_id` — unique + indexed
- [x] `services/lms_s2s.py` — HMAC verify, skew window, `compare_digest`
- [x] `tests/test_lms_integration.py` — **14 assertions**; full CLT suite 31 green

---

## 2b. Phase 2 — provider, capacity, room provisioning

### LMS
- [x] `LiveClass.provider` (`'mux' | 'livekit'`, default `'mux'`) + `cltRoomName` / `cltCourseId` / `cltMeetingId`
- [x] Sparse index on `cltRoomName` — CLT webhooks arrive holding only the room name
- [x] `services/clt.service.ts` — HMAC-signed S2S client, `ensureRoom` / `endRoom` / `tryEnsureRoom`
- [x] Capacity rule: `sessionCapacity ≤ 50` when `provider === 'livekit'`, refused at creation
- [x] Room provisioned after insert (the name derives from the class id), best-effort
- [x] `provider` accepted through the zod schema and controller
- [x] Admin modal: Broadcast / Interactive room picker + inline seat warning
- [x] `CLT_BASE_URL`, `CLT_S2S_SECRET`, `CLT_TIMEOUT_MS`, `LIVEKIT_MAX_PARTICIPANTS` in `.env`
- [x] `integration2.suite.ts` — **28 assertions, all passing**

### CLT — done
- [x] C5 `POST /api/lms/rooms` (idempotent) · C7 `Course.lms_live_class_id`

---

## 2c. Phase 3 — host tickets and the entitlement core

### LMS
- [x] `services/liveClassJoin.service.ts` — `mintHostTicket`, `mintStudentTicket`, `assertStudentMayJoin`
- [x] `POST /api/v1/live-classes/:id/host-ticket` — assigned instructor or admin
- [x] Lazy room provisioning repairs a failed Phase-2 attempt on first host
- [x] Entitlement: booking · enrolment · `blockedLessons` (section ids) · org · time window (425 + `retryAfter`)
- [x] `integration3.suite.ts` — **32 assertions**
- [x] Admin studio page: LiveKit embed (`components/live-classes/LiveKitStudio.tsx`), branched on `provider`

### CLT
- [x] C4 `POST /api/lms/join` — verify + consume ticket → LiveKit token
- [x] C8 `Participant.student_mongo_id` / `student_email` populated from the ticket
- [x] Role mapping onto the four existing token helpers; student activity logged

---

## 2d. Phase 4 — the student join

### LMS
- [x] `POST /api/v1/live-classes/:id/join-ticket` — every §7 rule, reading enrolment state fresh
- [x] `425` + `Retry-After` for "early", distinct from a `403` refusal
- [x] `watchAccess` now reports `provider`, so the client knows which engine to render
- [x] `components/live-classes/LiveKitRoomView.tsx` — join, countdown-and-retry, room
- [x] Watch page branches on `provider`, **inside `WatermarkedFrame`**
- [x] `integration4.suite.ts` — **21 assertions** over real HTTP

### CLT
- [x] Student path already handled by `/api/lms/join`: `Participant` row,
      `student_admitted_token` / `student_lobby_token` per `bypassLobby`, activity logged

---

## 2e. Phase 5 — events flowing back

### LMS
- [x] `ClassBooking.attendedAt` / `attendanceSource` — attendance is NOT a status change
- [x] `services/cltWebhook.service.ts` — `recording.ready`, `meeting.ended`, `participant.joined`
- [x] `POST /api/v1/webhooks/clt` — HMAC + freshness window, on `express.raw()`
- [x] Every handler idempotent; unknown event types ACKed so CLT stops retrying
- [x] `integration5.suite.ts` — **21 assertions**

### CLT
- [x] C9 `services/lms_events.py` — signed outbound events, best-effort, never raises
- [x] `lms_webhook_url` + `lms_events_enabled`
- [x] C10 **Mongo scaffolding removed** — `mongodb_*` settings, `mongodb_enabled`, and the
      unused `motor` dependency. CLT now has no path to the LMS database at all
- [x] 5 new tests; CLT suite **36 green**

---

## 3. Environment

### LMS `backend/.env`
```
INTEGRATION_JWT_PRIVATE_KEY   base64 of an Ed25519 PKCS#8 PEM  — see docs/CLT_INTEGRATION.md §8
INTEGRATION_JWT_KID           e.g. lms-2026-08
INTEGRATION_JWT_ISSUER        lms.deltainstitutions  (default in code)
INTEGRATION_JWT_AUDIENCE      clt-connect            (default in code)
INTEGRATION_TICKET_TTL_SEC    90                     (default in code)
CLT_BASE_URL                  http://localhost:8002  — Phase 2
CLT_S2S_SECRET                32 random bytes        — Phase 2
```

Rotation uses `INTEGRATION_JWT_PREVIOUS_*`: publish the new key alongside the old,
wait one CLT cache TTL, then drop the old.

> **This list is the Phase 1–2 subset and is no longer complete.** The full set of
> thirteen LMS variables and ten meeting-side variables, with production values and
> the traps in each, is **§8.5 and §8.6**. `backend/.env.example` now carries the LMS
> block inline — it previously carried none of it.

### CLT `backend/.env`
```
LMS_JWKS_URL          http://localhost:8000/.well-known/jwks.json
LMS_S2S_SECRET        <same 32 bytes as CLT_S2S_SECRET>
LMS_TICKET_ISSUER     lms.deltainstitutions
LMS_TICKET_AUDIENCE   clt-connect
CORS_ORIGINS          http://localhost:5173,http://localhost:3000,http://localhost:3001
```

---

## 4. What CLT Connect needs — the other repo

`C:\Users\MSI-PC\Delta\meeting-platform`. **None of this is built.** The LMS side can
be completed and tested first; CLT work is what turns it into a working join.

| # | Change | File | Phase |
|---|---|---|---|
| C1 | **CORS** — currently allows only `:5173`; add `:3000` and `:3001` or every browser call fails, and the symptom looks like a broken login | `app/core/config.py` | 1 |
| C2 | **Ticket verifier** — fetch LMS JWKS, cache 1h, refetch on unknown `kid`, verify EdDSA + `iss` + `aud` + `exp` | new `app/services/lms_tickets.py` | 1 |
| C3 | **Replay cache** — record `jti` in Redis with TTL = ticket TTL; second use → 409. Redis is already there for Celery | same | 1 |
| C4 | `POST /api/lms/join` — ticket in body → `JoinResponse` `{token, ws_url, room_name, participant_id, auto_admitted}` | new `app/api/lms.py` | 3 |
| C5 | `POST /api/lms/rooms` — HMAC S2S, create/ensure Course + room for a LiveClass, idempotent | same | 2 |
| C6 | `POST /api/lms/rooms/{room}/end` — HMAC S2S | same | 3 |
| C7 | `Course.lms_live_class_id` — indexed, unique | `app/db/models/course.py` | 2 |
| C8 | **Populate** `Participant.student_mongo_id` / `student_email` from the verified ticket — columns already exist | `app/api/lms.py` | 3 |
| C9 | Outbound webhooks to LMS (recording ready, meeting ended) signed with the shared secret | `app/services/` | 5 |
| C10 | Remove the unused `mongodb_uri` / `motor` scaffolding — CLT must never read Mongo | `app/core/config.py` | 5 |

**Nothing else in CLT changes.** The four LiveKit token helpers in
`app/services/livekit_tokens.py` already cover every role in the mapping; the grant
shapes stay as they are.

---

## 5. Capacity — resolved

LMS `sessionCapacity` allows up to 500; CLT caps 50/room and 8 concurrent rooms.
Taking option (1): **validate `sessionCapacity ≤ LIVEKIT_MAX_PARTICIPANTS`** when
`provider === 'livekit'`, surfaced in the admin modal. Mux classes are unaffected.

**Set to 30**, matching `room.max_participants` in `infra/livekit.prod.yaml` — the
plan's assumed 50 was the dev/native value. Three places must agree and now do:
LMS `.env`, CLT `.env` (`MAX_PARTICIPANTS_PER_ROOM`), and the admin form hint.
Broadcast mode (option 2) is the next step if lecture-size sessions are needed.

---

## 6. Test plan

Per-phase suites in `backend/src/tests/`, matching the existing pattern.

Phase 1 — `integration.suite.ts` — **31 passed, 0 failed**:
- [x] a minted ticket verifies against the published JWKS
- [x] tampered signature → rejected
- [x] a payload edited to claim `instructor` + `roomAdmin` → rejected
- [x] expired ticket → rejected
- [x] wrong `aud` / wrong `iss` → rejected
- [x] a ticket signed by a foreign key wearing our `kid` → rejected
- [x] rotation: a ticket signed by the previous key still verifies while both are published
- [x] no keypair configured → mint throws `IntegrationDisabledError`, JWKS is empty
- [x] `jti` unique across 200 mints
- [x] room name is derived from the class id, never client-supplied
- [x] the JWKS never leaks the private `d` parameter

Later phases add: student without booking → 403 · blocked section → 403 · outside
window → 425 · instructor not assigned → 403 · cross-org → 403 · replay → 409 ·
capacity exceeded → 503. Plus one end-to-end: create class → host joins → student
joins → recording lands in LMS.

---

## 7. Progress log

| Date | Phase | What landed |
|---|---|---|
| 2026-08-28 | 1 | Plan written. Found keys/ticket/JWKS already present; keypair + tests outstanding. |
| 2026-08-28 | 1 | **Phase 1 complete.** Ed25519 keypair generated (`kid=lms-2026-08`), JWKS serving, 31-assertion suite green. Docs at `docs/CLT_INTEGRATION.md`. |
| 2026-08-28 | 1 | Fixed: `integrationKeys.ts` used jose's `importPKCS8`/`exportJWK`, which fail for Ed25519 under Bun (browser build can't read the OID; `exportJWK` rejects Node KeyObjects). Now uses `node:crypto` and builds the JWK from raw SPKI bytes. |
| 2026-08-28 | 1 | Fixed: a backslash-n escaped PEM in `.env` silently truncated to the `-----BEGIN` line under Bun's parser, giving `BAD_END_LINE`. The key is now stored base64; raw PEM still accepted. |
| 2026-08-28 | 2 | **Phase 2 complete.** `provider` discriminator, HMAC S2S client, ≤50 capacity rule, admin engine picker. 28 new assertions; full backend 1,374. |
| 2026-08-28 | 1–2 | **CLT side complete.** Ticket verifier, replay cache, S2S auth, `/api/lms/rooms` + `/end`, CORS, `Course.lms_live_class_id`. 14 new tests; CLT suite 31 green. A real LMS-minted ticket verifies through the CLT service against the live JWKS, and a replay is refused 409. |
| 2026-08-28 | 3 | **Phase 3 backend complete, both sides.** `/host-ticket` (LMS) + `/api/lms/join` (CLT). 32 new LMS assertions; LMS backend 1,406. Remaining: the admin studio LiveKit embed. |
| 2026-08-28 | 3 | **Phase 3 complete.** Admin studio LiveKit embed; capacity set to **30** across LMS `.env`, CLT `.env` and the admin hint. LMS 1,403 assertions, CLT 31. |
| 2026-08-28 | 4 | **Phase 4 complete.** `/join-ticket`, student watch page on LiveKit inside the watermark frame. LMS 1,424 assertions, CLT 31. Only Phase 5 (events) remains. |
| 2026-08-28 | 5 | **Phase 5 complete — all five phases done.** Recording, attendance and end-of-class events flow back signed; CLT's Mongo scaffolding deleted. LMS 1,445 assertions, CLT 36. |
| 2026-09-19 | 7 | **One identity rule.** `meetingIdentity.ts` + `MEETING_DISPLAY_NAME` switch; all three ticket routes moved onto it. Default is the full email for students and instructors alike. |
| 2026-09-19 | 7 | **Found and fixed: the helper was dark in production.** Both Join buttons redirect through `classHandoff.service.ts`, which built its own name (`user.name ?? 'Participant'`) and never called the helper. The suite tested the rule, not the path in force. Suite now drives `issueHandoff` → `exchangeHandoff` → decoded ticket; 24 assertions, and 4 of them fail against the old line. |
| 2026-09-19 | 7 | `.env.example` gained the whole integration block (it had **zero** `CLT_*`/`INTEGRATION_*` keys, so a production env built from it was missing every variable the feature needs). Removed three orphaned PEM fragment lines from `backend/.env`; verified the key still loads and the JWKS still publishes. |
| 2026-09-19 | 7 | Doc fixes: `SERVER.md` named the **student** host as the API upstream (a JWKS URL derived from it returns the Next.js app's HTML); `docs/CLT_INTEGRATION.md` called the seat cap `LIVEKIT_MAX_SEATS`, a name read by nothing. `about.md` repository URL updated to the current remote. |
| 2026-09-19 | 7 | **Production runbook written — §8.** Credentials for both sides, cutover order, smoke test, rollback, and six things that must be confirmed on the host rather than guessed. |
| 2026-08-28 | — | Found: python-jose has **no EdDSA support**, so the verifier uses PyJWT (already installed). Found: `infra/livekit.prod.yaml` caps a room at **30**, not the 50 the plan assumed — added `max_participants_per_room` so production can be set correctly. |

---

## 8. Wiring the meeting application in production

**Read this first: there was exactly one line of new behaviour to write, and it is
written.** Everything else below is configuration, a data migration on existing
classes, and a deploy. The join flow — click, one-time code, cross-origin redirect,
server-to-server exchange, signed ticket, promptless entry — was already built and
tested end to end against localhost.

**The meeting application is not modified at any point, and does not need to be.**

### 8.1 What was asked for, and where it stands

| # | Requirement | Status |
|---|---|---|
| 1 | Student's display name is their LMS email | ✅ **fixed this phase** |
| 2 | Instructor's display name is their LMS email | ✅ **fixed this phase** |
| 5 | The class's assigned instructor joins directly as **host** | ✅ already built |
| 6 | The booked student joins from the client as a participant | ✅ already built |
| 7 | Join redirects straight in — **no name prompt** | ✅ already built, no meeting-side change |
| 10 | Production setup guide | ✅ §8.4 – §8.10 below |
| 11 | Credentials to fill in `.env` | ✅ §8.5 and §8.6 |

Requirements 5, 6 and 7 needed nothing. The meeting app reads the name out of the
LMS ticket (`app/api/lms.py:362`, `display_name=ticket.name`) and its entry page
`LmsEnter.jsx` has **no name field at all** — the only `input` on it is a file picker
for a background image. Promptless entry is the existing design, not a new feature.

### 8.2 The join, step by step

It is a **browser redirect**, not an embed. The LMS ships no LiveKit client code on
this path: both portals POST to their own backend, get a URL back, and navigate to
the meeting app's origin.

| # | Step | Where |
|---|---|---|
| 1 | Student clicks Join | `client/.../ClassEntryPanel.tsx:40` |
| 2 | Instructor clicks Join | `admin/.../ClassEntryPanel.tsx:46` |
| 3 | `POST /api/v1/live-classes/:id/handoff` (cookie `lms_at`) | `liveClasses.routes.ts` |
| 4 | `POST /api/v1/admin/live-classes/:id/handoff` (cookie `lms_admin_at`) | `admin.routes.ts` |
| 5 | One-time code: 32 random bytes, **sha256 only** in Mongo, 120s TTL | `classHandoff.service.ts:24-55` |
| 6 | Browser redirected to `CLT_PUBLIC_URL/lms/enter?c=...` | `classHandoff.controller.ts` |
| 7 | Meeting SPA auto-redeems on mount, no name field | meeting `LmsEnter.jsx` — unmodified |
| 8 | Meeting backend calls the LMS exchange, HMAC-SHA256 signed | meeting `lms_handoff.py` — unmodified |
| 9 | Code burned atomically, user re-read, **authorised now** | `classHandoff.service.ts:85-135` |
| 10 | Ed25519 ticket minted: name, email, role, room, grants, 90s | `integrationTicket.service.ts` |
| 11 | Meeting verifies via JWKS, burns `jti` in Redis, sets the tile name | meeting `lms.py:362` — unmodified |

**Do not merge the two handoff routes into one.** They are mounted on separate
routers so each reads only its own cookie. They were one route behind a combined
guard, which preferred the admin cookie and could hand a student an admin's
hidden-observer ticket. In production the two portals may share an apex domain via
`COOKIE_DOMAIN`, so one browser legitimately holds both cookies — which is exactly
the condition that bug needs.

**Authorisation runs at exchange time, not issue time.** That is deliberate: a class
cancelled, a booking withdrawn or an account disabled in the seconds between the
click and the arrival is honoured rather than raced. The consequence is that **the
LMS must be reachable at the moment of every single join.** An LMS outage, or a route
failure between the two hosts, locks everyone out of rooms LiveKit is happily
serving.

### 8.3 The identity rule, and the one line that was wrong

> **The rule:** one function decides what every person is called in every room.
> Nothing else is allowed an opinion.

`backend/src/utils/meetingIdentity.ts` is that function. It was written and wired
into the three direct-ticket routes — and **the path both Join buttons actually use
was not one of them.** `classHandoff.service.ts` built its own name:

```ts
name: user.name ?? 'Participant',      // before — its own rule, decided locally
name: meetingDisplayName({ name: user.name, email: user.email }, 'Participant'),
```

A unit suite around a rule proves the rule. It does not prove the rule is the one in
force. The helper was green in its own suite and dark in production. The suite now
drives the real service end to end — issue a code, exchange it, decode the ticket,
assert the name on the tile — and it fails 4 assertions against the old line.

**Resolving the contradiction in the brief.** Requirements 1 and 2 say the display
name *is* the email address. Requirement 6 says the student joins "with their LMS
name". Those are different things and you cannot have both.

**Taken: email, `MEETING_DISPLAY_NAME` left unset.** Display names are neither unique
nor verified — two students called "Basil M" are indistinguishable on a tile, and a
student can edit their own profile name. The email is the account identifier that
attendance and support reconcile against.

**The cost, stated on purpose.** LiveKit **broadcasts** the participant name to
everyone in the room. The meeting side deliberately keeps the ticket's `email` claim
*out* of token metadata for that reason and stores it server-side for attendance
instead. Putting the email in `name` overrides that decision: every student will be
able to read the instructor's address and each other's. The meeting app will accept
it without complaint. **This is a product call, not a technical one** — and it is
reversible without a code change:

```
MEETING_DISPLAY_NAME=name    # profile names, email as fallback
# unset                      # email, profile name as fallback   <- current
```

Read once at startup; a change needs a restart. Attendance is unaffected either way —
it reads the separate `email` claim.

### 8.4 Before you touch production

Four things that are **not** configuration and will each stop a cutover dead.

1. **Every existing class will refuse to join.** `provider` defaults to `'mux'`
   (`schema.ts:1007`) and `assertJoinable` throws `NOT_A_LIVEKIT_CLASS` for anything
   else. **Every class in production today is `'mux'`.** Without the data step in
   §8.7 the first test fails for a reason that has nothing to do with the env.
2. **The meeting platform needs a `super_admin` row in its own Postgres.** Room
   provisioning and instructor start both require one (`lms.py:117-122`, `:311-320`).
   Nothing in the deployment templates seeds it. On a fresh database a perfectly
   correct configuration still fails with *"No owner account exists to attach the
   room to"*.
3. **Redis is a hard dependency of joining**, not just of background work — the `jti`
   replay guard is a Redis `SET NX`. A Redis outage locks every student out of class
   and will be triaged as a background-jobs problem.
4. **Clocks must be right on both hosts.** The S2S signature allows 5 minutes of skew
   and the ticket verifier allows 60 seconds. Drift produces intermittent failures
   that resist diagnosis. Verify NTP on both.

> **The full, verified credential reference is [`docs/PRODUCTION_ENV.md`](docs/PRODUCTION_ENV.md).**
> It covers every variable in both applications and both LMS frontends, each cited to the line
> the CODE reads, with the production origins verified live. §8.5 and §8.6 below are the
> integration subset. Two facts from that verification belong here:
>
> - The meeting SPA (`https://connect.deltainstitutions.com`) and the meeting API
>   (`https://connect-api.deltainstitutions.com`) are on **two separate origins**, so
>   `CLT_PUBLIC_URL` and `CLT_BASE_URL` are different values. §8.10 item 2 is now closed.
> - **Neither side is configured today.** The LMS JWKS serves `{"keys":[]}` with HTTP 200, and
>   the meeting API answers 503 `LMS integration is not configured on this server`.

### 8.5 Credentials — LMS `backend/.env`

Thirteen variables. **None are validated at boot**, so a typo produces a server that
starts healthy and fails only when somebody clicks Join. `backend/.env.example` now
carries this whole block with these notes inline — it previously had none of them.

| Variable | Value | Notes |
|---|---|---|
| `INTEGRATION_JWT_PRIVATE_KEY` | base64 of an Ed25519 PKCS#8 PEM | **Generate fresh for production.** Not raw PEM — see below. |
| `INTEGRATION_JWT_KID` | e.g. `lms-2026-01` | Any stable string; date-stamping documents rotations. |
| `INTEGRATION_JWT_ISSUER` | `lms.deltainstitutions` | Must equal the meeting app's `LMS_TICKET_ISSUER`. |
| `INTEGRATION_JWT_AUDIENCE` | `clt-connect` | Must equal `LMS_TICKET_AUDIENCE`. |
| `INTEGRATION_TICKET_TTL_SEC` | `90` | Covers one redirect, not a class. |
| `INTEGRATION_JWT_PRIVATE_KEY_PREVIOUS` | blank | Rotation only. |
| `INTEGRATION_JWT_KID_PREVIOUS` | blank | Rotation only. |
| `CLT_BASE_URL` | meeting **API** origin | Server-to-server. Never sent to a browser. |
| `CLT_PUBLIC_URL` | meeting **SPA** origin | Where the student's **browser** is sent. |
| `CLT_S2S_SECRET` | 32 random bytes, hex | Must equal `LMS_S2S_SECRET` byte for byte. |
| `CLT_TIMEOUT_MS` | `8000` | |
| `LIVEKIT_MAX_PARTICIPANTS` | `50` | The doc used to call this `LIVEKIT_MAX_SEATS`; that name is read by nothing. Fixed. |
| `MEETING_DISPLAY_NAME` | **blank** | Blank = email. `name` = LMS profile name. See §8.3. |

`CLT_BASE_URL` and `CLT_PUBLIC_URL` are the same value **only if** the SPA and its
API are served from one origin. Confirm against the real deployment — §8.10.

Generating the key:

```bash
openssl genpkey -algorithm ed25519 -out lms-prod.pem && base64 -w0 lms-prod.pem
```

A PEM is multi-line and `.env` is line-based: Bun ends the value at the first newline
and OpenSSL then rejects it with a misleading `BAD_END_LINE`. **Base64 is the
supported form.**

### 8.6 Credentials — meeting platform `backend/.env`

**`infra/.env.prod.example` contains no `LMS_*` variables at all** — the template
predates the integration. Copying it verbatim gives a meeting server with the whole
integration silently switched off, because each plane keys off the presence of a
value (`config.py:193-206`). This block must be added by hand.

| Variable | Value | Notes |
|---|---|---|
| `LMS_JWKS_URL` | `https://api-lms.deltainstitutions.com/.well-known/jwks.json` | The **API** host. Not `lms.` — that is the student app and returns HTML. |
| `LMS_TICKET_ISSUER` | `lms.deltainstitutions` | Must match the LMS exactly. |
| `LMS_TICKET_AUDIENCE` | `clt-connect` | Must match the LMS exactly. |
| `LMS_JWKS_CACHE_SECONDS` | `3600` | This is the rotation overlap window. |
| `LMS_TICKET_LEEWAY_SECONDS` | `60` | Clock tolerance. |
| `LMS_S2S_SECRET` | same hex as `CLT_S2S_SECRET` | |
| `LMS_S2S_MAX_SKEW_SECONDS` | `300` | |
| `LMS_WEBHOOK_URL` | `https://api-lms.deltainstitutions.com/api/v1/webhooks/clt` | **See the warning below.** |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | fresh values | The dev secret is the literal string `devsecret_min_32_chars_local_only_padding`. **Rotate.** |
| `MAX_PARTICIPANTS_PER_ROOM` | `50` | Must not exceed `room.max_participants` in the LiveKit yaml. |

> **`LMS_WEBHOOK_URL` does double duty, and it is the setting most likely to be got
> wrong.** There is no setting for the handoff exchange endpoint: the meeting app
> **derives** it by stripping `/webhooks/clt` and appending
> `/integrations/handoff/exchange` (`lms_handoff.py:55-67`). A trailing slash, a
> missing `/api/v1`, or the web origin instead of the API origin all produce the same
> misleading 503 — *"Could not reach the LMS to open this class"* — which names the
> wrong cause. This is a meeting-side observation only; no change is proposed.

**Secrets that must be rotated, not carried over:** `LMS_S2S_SECRET`, `JWT_SECRET`,
`LIVEKIT_API_SECRET`, and the LMS `INTEGRATION_JWT_PRIVATE_KEY`. The dev signing key
has sat in a working tree and its material was printed to a terminal during this
investigation — **treat it as exposed.** The R2 credentials in `backend/.env` are
outside this integration's scope but should be treated the same way.

### 8.7 Cutover, in order

1. **Deploy the LMS backend** with the identity fix. Nothing before this point makes
   any user-visible difference.
2. **Fill both `.env` files** from §8.5 and §8.6. Restart both.
3. **Confirm the JWKS is reachable from the meeting host** —
   `curl https://api-lms.deltainstitutions.com/.well-known/jwks.json` must return one
   key. `{"keys":[]}` comes back **200** and looks like success to a naive check; it
   means the private key did not load.
4. **Seed the meeting platform's `super_admin`** (§8.4 item 2).
5. **Set `provider` to `livekit` on the classes you intend to run there.** Nothing
   else in the cutover matters until this is done.
6. **Raise `RATE_LIMIT_API_MAX`.** The exchange is unauthenticated and arrives from
   the meeting server's single IP, so a whole cohort's joins land in **one bucket**
   against a default of 100/minute — the limiter is mounted ahead of authentication
   and cannot see a user. A 50-seat class fits with **no margin for retries**, and
   the 429 reaches the student as *"This join link is not valid."*
7. **Smoke test on a real scheduled class** — §8.8. Nothing else will reveal a
   misconfiguration.
8. **Test one class at the intended size before go-live** (§8.10, item 3).

### 8.8 Smoke test

There is no readiness check for any of this. `/health` returns ok regardless, so the
only real probe is a person clicking Join.

1. An instructor clicks Join in the admin panel → lands in the room **as host, with
   no name prompt**, tile reads their **email address**.
2. A booked student clicks Join in the client → lands in the **same room**, no
   prompt, tile reads **their** email address.
3. The instructor can mute/remove; the student cannot.
4. Attendance reaches the LMS after the class ends.

A quick negative probe on the meeting API: send a deliberately malformed ticket and
confirm the answer is **400 "Malformed join link"**, not 503 *"LMS integration is not
enabled on this server"*. A 503 means the configuration did not load.

**Two support answers to have ready on day one.** The meeting URL is **not shareable
and not resumable across tabs** — the session lives in `sessionStorage`, so
`/meeting/<room>` opened in a new tab, another browser or another device falls
through to an authenticated endpoint that LMS-only participants cannot use and shows
*"Not authenticated. Log in first."* That is correct security behaviour, not a bug,
and the one-line answer is: go back to the LMS and click Join again. Second, the
**120-second handoff TTL** is the real budget between the click and the meeting SPA's
exchange call. A cold CDN, a large bundle, a captive portal or a corporate
link-scanner that pre-fetches the redirect will burn it, and the student sees *"This
link has expired"* — pointing at the LMS when the cause is frontend load time.

### 8.9 Rollback

The switch is clean: **blank `INTEGRATION_JWT_PRIVATE_KEY`** on the LMS, or
`LMS_JWKS_URL` on the meeting side, and the feature reports itself unconfigured and
returns an honest 503. Restart to apply. Setting `provider` back to `'mux'` on a
class returns that class to the old path.

What has **not** been decided and should be, before go-live: what students are told
during that 503, and what the fallback is for a class already in progress when it
happens.

### 8.10 Not verified — confirm on the host, do not guess

1. **Does the production nginx/WAF preserve the `X-CLT-*` headers and the raw POST
   body** on `/api/v1/integrations/handoff/exchange`? Some WAFs strip unknown headers
   or re-serialise JSON, and either presents as `BAD_SIGNATURE`.
2. **Is the meeting SPA served from the same origin as its FastAPI backend?** That is
   what decides whether `CLT_PUBLIC_URL` and `CLT_BASE_URL` are one value. A redirect
   can succeed perfectly and the join still fail if the SPA at that origin points its
   own API calls at a dev backend.
3. **The per-room cap is unresolved across the configs.** `MAX_PARTICIPANTS_PER_ROOM`
   is 50, `infra/livekit.prod.yaml` says 30, `livekit.vps.yaml` says 50, and the LMS
   join path calls `ensure_livekit_room(room_name)` with **no argument**, so the room
   is created with that function's hardcoded default. Test one class at the intended
   size rather than assuming.
4. **Free ports on `srv845161`.** The meeting stack claims 8002, 5432, 6379, 7880,
   7881, 6789 and several UDP ranges, on a box already running ~11 PM2 apps, nginx
   and mongod. 6379 and 5432 are the realistic collisions. Run `ss -ltnp` and
   `ss -lunp` and reconcile before `docker compose up -d`.
5. **Capacity.** The meeting guide asks for 4 vCPU / 8 GB with recording, on that
   same shared box. Get `nproc`, `free -h`, `df -h` before committing to a single-box
   deploy; a second VPS may be the right answer.
6. **How the two Next.js apps are served in production.** `ecosystem.config.js`
   defines only `lms-backend`; there is no PM2 entry, Dockerfile or `vercel.json` for
   `client/` or `admin/`. `ADMIN_URL` feeds the LMS CORS allow-list and the
   instructor's Join button lives in that app, so its production origin must be
   confirmed on the host (`nginx -T | grep server_name`).

### 8.11 Documents that will mislead a deployer

- **`meeting-platform/docs/sso-lms-integration.md` is fiction relative to the code.**
  It documents SAML 2.0 ACS, OIDC callback and LTI 1.3 launch endpoints. **None of it
  exists** — a grep for `saml|openid|oidc|lti` across the meeting backend returns
  nothing. Anyone handed that file as the spec will spend a day exchanging SAML
  metadata for a mechanism this build does not implement. **The real contract is
  `docs/CLT_INTEGRATION.md`.** Left unchanged — the meeting application is read-only
  for this work.
- **`SERVER.md` named the student host as the API upstream.** Following it gave a
  JWKS URL that returns the Next.js app's HTML. **Fixed this phase.**
- **`docs/CLT_INTEGRATION.md` called the seat cap `LIVEKIT_MAX_SEATS`.** The code
  reads `LIVEKIT_MAX_PARTICIPANTS`; a variable of that name is read by nothing and
  silently leaves the cap at the default. **Fixed this phase.**

### 8.12 One consequence worth deciding on purpose

Decision **A1** in §0 reads "native LiveKit embed in Next.js (not an iframe) — keeps
`WatermarkOverlay` on live video". **The redirect design ends that.** The student
leaves the LMS origin entirely, and there is no watermark of any kind in the meeting
frontend. `WatermarkOverlay` still wraps the student watch page, but that frame now
contains only the Join button, not the video.

**Live classes are unwatermarked.** Recorded lessons and the learn page are
unaffected. If per-viewer attribution on live video matters, that is a meeting-side
feature request and it conflicts with the constraint that the meeting application is
not to be modified. A1 is reopened in §0 rather than left reading as settled.

---

## 9. Course → Module → Class: restructuring the student Class Schedule

**The ask.** Make `/class-bookings` navigate like `https://course.clt-academy.com`:
a course, then its modules, then the classes inside a module.

**The finding that shapes everything below.** The hierarchy is easy — we already
hold every field it needs. What the reference does at its third level is *not*
a layout we can copy, because the thing it books does not exist in our data.
§9.2 is that decision; everything after it depends on the answer.

### 9.1 What the reference actually does

Walked by hand, all three levels (2026-09-19):

| Level | Content |
|---|---|
| 1 | Programme cards — blurb, "10 Courses", **View Courses** |
| 2 | Module cards — "Module 1", description, **"1 Languages · 7 Sessions"**, **Enroll Now** |
| 3 | Modal — module description, then **Available Sessions grouped by language**: `Tuesday 2:00 PM [Select]`, `Thursday 11:30 AM [Select]` … then **Book This Slot** |

Two details carry more weight than the layout:

- **Level 3 has no dates.** Every row is a weekday and a time. The unit of
  choice is *which weekly slot you attend this module in* — a standing
  commitment, not an event.
- **Sessions are grouped by language first**, slot second.

Their vocabulary also collides with ours: the Level-1 card says "10 Courses"
and Level 2 calls the same things "Module 1…10". **In our terms the Level-1
card is a Course and the count is of Modules (`Section`).** This plan uses our
words throughout; adopting theirs would import the confusion.

### 9.2 THE DECISION: a slot is not a session

Our model stores **dated one-offs**. `LiveClass.scheduledStart` is an instant
(`schema.ts:996`). There is no `dayOfWeek`, no `rrule`, no template document.
"Weekly" exists only as `POST /admin/live-classes/:id/repeat`, which
materialises N dated copies and tags them with a shared `seriesId`
(`liveClass.controller.ts:1236-1298`).

And **`seriesId` is written once and never read.** A repo-wide search finds the
three write sites, the schema field, its sparse index and a DTO emit — no
query, no `$match`, no `$group`, no sort. The index has no reader. The student
app reconstructs repeat-groups instead, from `title|instructor|course|section`
(`class-bookings/page.tsx:1507`).

So "Tuesday 2:00 PM" would have to be *derived*, and the derivation is unsafe:

| Case | What happens |
|---|---|
| Untouched weekly series | Correct today. `setDate(+7*i)` preserves the wall clock, and neither Asia/Dubai nor Asia/Kolkata observes DST. A future academy in a DST zone drifts by an hour mid-series. |
| A member is edited | **Wrong, silently.** Nothing constrains a series to one weekday or time — the repeat code states that editing a generated class afterwards "is a normal, independent edit and never affects the others" (`liveClass.controller.ts:1211-1217`). |
| A member is rescheduled | **Wrong.** Reschedule is a plain `adminUpdate`; `seriesId` is untouched. Collapsing to one slot hides the moved session. |
| A member is cancelled | Counted unless filtered — cancelled rows keep their `seriesId`. |
| Created singly, never repeated | **No `seriesId` at all.** Only `repeat` sets it, so most of a hand-built timetable has none. |

**Three options, and a recommendation.**

- **(A) Hierarchy over dated sessions.** Course → Module → the module's dated
  sessions, grouped by language, each labelled `Tuesdays 2:00 PM · next Mon 22
  Sep`. One booking = one dated session, exactly as today.
- **(B) Derived slots, single booking.** Present "Tuesday 2:00 PM" with the
  date hidden; a click books the next occurrence. Looks like the reference,
  and every row in the table above becomes a way to book the wrong thing.
- **(C) A real recurrence model.** A `ClassSlot` template that owns weekday,
  time, language, module and capacity; dated classes generated from it;
  "Book This Slot" enrols you in the series. This is what the reference is
  actually doing.

**Recommend (A) now, (C) as its own project if the owner wants a standing
commitment.** (A) delivers the requested navigation, keeps every safety
property below intact, and its slot label is *more* informative than the
reference's — it tells the student both the pattern and the next date. (B) is
the trap: it looks like the goal and quietly detaches booking from the thing
being booked. **Reject (B).**

> The cost of (A), stated plainly: the student still books one dated session at
> a time. If the owner's real requirement is "choose your weekly slot once and
> be enrolled for the whole module", that is (C) and no amount of frontend work
> substitutes for it. **That question should be answered before Phase 3.**

### 9.3 What exists, and what is missing

| Need | State |
|---|---|
| Module on a class | ✅ `LiveClass.sectionId` — **but optional** (`schema.ts:1024`), and every admin form labels it "Module (optional)" |
| Language on a class | ✅ `LiveClass.language` — but **no schema enum** (enforced only in the admin route) and **no index** |
| Repeat identity | ⚠️ `seriesId` exists, is never read, and does not constrain weekday or time |
| Modules of a course | ✅ `GET /courses/:slug` → `{ course, sections, lessons }` |
| Classes of a course | ✅ `GET /courses/:slug/live-classes`, already door-resolved |
| **Classes of a MODULE** | ❌ **Does not exist.** No route, service or repository filters `LiveClass` by `sectionId` |
| **Counts** ("7 Sessions · 1 Language") | ❌ Nothing produces them. No LiveClass aggregation exists anywhere in the codebase |
| Indexes for a module-first query | ❌ None on `sectionId`, `language`, or `{courseId, sectionId}` |
| The grouping itself | ✅ Already computed — `page.tsx:1499-1522` buckets by `title|instructor|course|module` and resolves `courseTitle`/`moduleTitle` |

The last row is the good news: **most of the hierarchy is already being
computed and then used only as labels.** The work is navigation, counts, and
the decision in §9.2.

### 9.4 The traps

Each of these has bitten this codebase before; the citation is where it is
recorded.

1. **Module blocking fails open.** `GET /courses/:slug` returns `sections[]`
   **unfiltered by `blockedLessons`** (`course.controller.ts:78-85`). Build
   Level 2 from that list and a blocked module renders as browsable, with the
   refusal arriving only as `MODULE_BLOCKED` at click time. Today the block is
   invisible *because* the page only draws modules that arrived attached to a
   class the server already judged.
   → **Build every module node from the classes the server returned, never
   from the section list.** This is an access-control regression, not a visual
   one, and it is the highest risk in the change.

2. **Cross-academy guests lose their door.** A guest's own course arrives as an
   **id** (`yourCohort.courseId`), and both course endpoints are **slug-keyed**.
   Group on the host's `course.id`/`sectionId` — the obvious fields — and a
   guest's booked class vanishes from their own course and every label reads
   the other academy's. Recorded three times already:
   `liveClass.repository.ts:57-78`, `liveClass.controller.ts:624-633`,
   `admin.routes.ts:2138-2167`.
   → Key every node on `yourCohort.courseId ?? course.id` **and**
   `yourCohort.sectionId ?? sectionId`; label with `yourCohort.courseTitle` /
   `sectionTitle`.

3. **The current page is already half-regressed here, and this change should
   fix it.** `effCourseId` (`page.tsx:364`) is door-aware; `secKey`
   (`:1506`) and `moduleTitle` (`:1515`) read the **host's** section.
   `yourCohort.sectionTitle` is on the DTO and consumed nowhere in `client/src`.
   So today's grouping key mixes the guest's course with the host's module.

4. **Counting in Mongo gives the wrong number.** Entitlement is per-student
   application code — `doorsFor()` walking `blockedLessons`
   (`classEntitlement.service.ts:240-259`). A `$group` cannot see module
   blocking or the caller's door, so "7 Sessions" would sit above three
   bookable slots.
   → Derive counts from the **same rows the student was served**, or accept
   that a server count is "sessions in this module", not "sessions you can
   book", and label it accordingly.

5. **Classes with no module disappear.** `sectionId` is optional on both the
   class and each guest cohort. A drill-down whose only path to a class runs
   *through* a module hides every un-moduled one — and `/class-bookings` is the
   sole booking entry in the nav (`ClientSidebar.tsx:16`), so those classes
   become unbookable.
   → A **"General sessions"** node per course, always rendered when non-empty.

6. **`seatsLeftForYou`, not arithmetic.** Any new badge written as
   `sessionCapacity - bookedCount` shows a guest the room's remainder and then
   refuses `SESSION_FULL`. The client contract is one line
   (`page.tsx:362-363`) and is trivially not-copied. A module-level total must
   sum `seatsLeft(lc)`.

7. **The booking state machine.** `getSlotStatus` (`page.tsx:128-188`) encodes
   ten states and **the order is load-bearing**: existing-booking before
   cutoff, cutoff before full/locked. `'locked'` (one reservation per group,
   `:633`) is **group-scoped** — re-scoping it to "one per module" changes
   booking semantics and is a product decision, not a refactor. Around it sit
   the 60-minute cutoff, the 15-minute live lead, the 20-minute join grace, the
   same-day in-person refusal (`:139-145`) and the 2× attendance cap.

8. **Seven server error codes are mapped to specific copy** in `handleBook`
   (`page.tsx:1570-1584`): `CONTACT_ADMIN`, `SESSION_FULL`, `ALREADY_BOOKED`,
   `NOT_ENROLLED`, `MODULE_BLOCKED`, `PENDING_APPROVAL`, `ACCESS_REJECTED`,
   plus the pending-registration pre-empt. A fresh handler ships with a generic
   toast.

9. **Timezone.** Weekday and time only exist relative to a zone. The student
   app renders in the **device** zone (`lib/timezone.ts:24`), and day buckets
   go through `zonedKey` with a UTC-noon header trick
   (`page.tsx:1537-1550`) precisely because naive bucketing slips a day at
   UTC+13. A weekday-first UI makes this *more* exposed.

10. **`my-bookings` shares the cache.** It hydrates from the same
    `useAllLiveClasses()` array (`my-bookings/page.tsx:194`). Changing that
    query key, its params, or moving to a paginated endpoint silently empties
    that page.

11. **Pricing.** A Level-1 course grid is the first commerce-shaped surface in
    `/class-bookings`, and the reference's Level-2 button is literally "Enroll
    Now". `SHOW_PRICING` is not imported there today
    (`lib/pricingVisibility.ts`) — it must be, or the pricing blackout leaks
    through the new page.

12. **`$or` composition.** A module/language query wants its own `$or`
    (host-course arm + guest-cohort arm) *on top of* `servedClassFilter`'s.
    Compose with `andFilter`; a second `$or` assignment silently deletes the
    first — the P-04 shape, recorded at `tenancy.ts:148-154`.

13. **Anonymous callers get an empty list.** `GET /courses/:slug/live-classes`
    is `optionalAuthenticate`, but an anonymous caller resolves to
    `ACCOUNT_GONE` and the handler short-circuits to `[]`
    (`liveClass.controller.ts:620-621`). A public catalogue cannot use it as-is.

14. **List and book disagree on enrolment status**, deliberately
    (`classEntitlement.service.ts:34-43`): listing accepts `notDropped`,
    booking requires `active`. A completed enrolment can see and join but not
    book. Any "Book This Slot" built off the list will therefore show slots
    that 403 — either pre-empt it in the UI or leave the refusal legible.

### 9.4b What a read of the code corrected in the above

Five claims in 9.1-9.4 were checked against the source and did not survive.
They are corrected here rather than deleted, because each one changes a phase.

1. **A blocked module is NOT filtered out by the server, and never was.**
   `liveClasses.routes.ts:139` sets `isEnrolled = e.ok || e.code ===
   'MODULE_BLOCKED'`, and the module is populated on the row either way
   (`:109`). Only the Mux fields are stripped (`ENTITLED_ONLY_FIELDS`, `:32`).
   `liveClass.service.ts:81` does the same for the course endpoint. So blocked
   modules *already* render as browsable on the flat page today - which is
   exactly why `handleBook` has a `MODULE_BLOCKED` branch at `page.tsx:1570`.
   Trap #1's mitigation ("build from returned rows") therefore buys nothing:
   those rows include the blocked ones.
   **Resolution:** `isEntitled` is computed on both list paths but never put
   on the wire (it appears nowhere in `client/src`). Emit it. Then the
   hierarchy can draw a blocked module *locked* rather than either hiding it
   (a behaviour change - rows that are visible today would vanish) or
   pretending it is open (today's behaviour, which fails on the click).

2. **Phase 1 is already done.** Trap #3 was accurate at `8422c4c`; the fix
   landed during the review. `effSectionId`/`effSectionTitle` at
   `page.tsx:377-385`, used in the group key `:1527`, the label `:1534` and
   the search haystack `:1512`.

3. **Phase 2's endpoint is redundant and its index would not be used.**
   `GET /live-classes` is unpaginated and unwindowed and already returns every
   served class carrying `yourCohort`, `seatsLeftForYou`, `bookingClosesAt`,
   `joinOpensAt`, `joinClosesAt`, `isBooked` **and** the populated course and
   section - a strict superset of what the proposed route would return. A
   second route is a second source of truth that can drift from
   `useAllLiveClasses`, which defeats Phase 5's own verify criterion. And
   `{courseId:1, sectionId:1, scheduledStart:1}` cannot serve a query that has
   no `sectionId` equality: Mongo would take the `courseId` prefix and
   blocking-sort, strictly worse than the existing `{courseId:1,
   scheduledStart:1}` (`schema.ts:1095`).
   **Resolution:** no new endpoint, no new index. Build from the cache.

4. **Module order and description never reach the client.** `Section` carries
   `order` and `description` (`schema.ts:588-596`), but the populate selects
   `'id title'` (`liveClasses.routes.ts:109`) and `toDTO` emits only those
   (`liveClass.controller.ts:215-219`). Built from returned rows, Level 2
   cannot sort Module 1..10 into course order and Level 3 cannot show the
   description the reference modal is built around.
   **Resolution:** widen the populate and the DTO. Two fields, additive.

5. **The date window was never mentioned, and it breaks the counts.**
   `windowClasses` (`page.tsx:1515`) clips the flat list to Monday-Sunday of
   the current week by default, while `allClasses` is every served class for
   all time. A module card counting the unclipped set reads "40 Sessions";
   counting the clipped set disagrees with the flat view by construction.
   **Resolution - the time policy, stated once:** *the hierarchy is a
   catalogue, not a diary.* It shows every session from now forward, ignores
   the week window entirely, and the range picker stays with the flat view
   where it belongs. A module card's "N Sessions" means **N bookable sessions
   still ahead of you*.

Two smaller slips, corrected in place below: the 2x attendance cap is per
class document (`bookings.routes.ts:233`), not per group; and `'locked'` is
purely a client-side rule - the server has no one-reservation-per-group
constraint, so re-scoping it is a UI change, not a booking-semantics change.

And one constraint that argues *for* this design and was missed:
`schema.ts:1068-1071` makes it unpersistable for a gated host class to carry
an unmoduled guest cohort, so `yourCohort.sectionId ?? sectionId` can never
silently fall back to the host's module. The inverse is legal - host module
null, guest cohort moduled - so one class can sit under a module for the guest
and under **General sessions** for the host. That is correct per-door
behaviour, not a bug.

### 9.5 The build

Each phase ships on its own and is verifiable alone.

- [x] **Phase 1 - Fix the door bug that is already there.** DONE. `secKey`
      and `moduleTitle` are door-aware via `effSectionId`/`effSectionTitle`,
      and the search haystack matches the guest's own course and module names.

- [x] **Phase 2 - Put the three missing fields on the wire.** DONE. No new endpoint
      (9.4b #3). Widen the section populate to `'id title order description'`
      on both list paths and emit `order`/`description` from `toDTO`; emit
      `isEntitled` alongside `isEnrolled` so a blocked module can be drawn
      locked (9.4b #1, #4). Align the client's `LANG_OPTIONS` with the
      backend's `LIVE_LANGUAGES` - the client offers Tamil, which cannot
      exist, and omits Arabic and Urdu, which can (`admin.routes.ts:1363`).
      *Verify:* a guest row carries its own module's order and description;
      a blocked row arrives `isEnrolled:true, isEntitled:false`; every
      language a class can hold is reachable from the filter.

- [x] **Phase 3 - The tree, from the rows already cached.** DONE. Build from
      `useAllLiveClasses()`: course (door-aware) -> module (`effSectionId`,
      ordered by `section.order`, **General sessions** bucket for null) ->
      language -> slot-group. Every count computed from the same filtered
      array that is rendered beneath it, so they cannot disagree (trap #4).
      Future-only, per the time policy in 9.4b #5.
      *Verify:* counts equal the cards beneath them; an un-moduled class
      appears under General; a blocked module appears **locked**, not hidden.

- [x] **Phase 4 - The three screens, plus URL state.** DONE. Level 1 course cards,
      Level 2 module cards with "N Sessions / N Languages", Level 3 the slot
      sheet grouped by language showing the module description. Reuse
      `SlotModal`'s action block wholesale - it is where the ten states, the
      seven error codes and the join clock live. **Do not rewrite it.**
      URL state is part of this phase, not an afterthought: `?view=`,
      `?course=`, `?module=`, `?class=`, so a drill-down is linkable and the
      back button works.
      *Verify:* every state in `getSlotStatus` still reachable; book, cancel,
      full, locked, cutoff-passed and live-now behave as on the flat page.

- [x] **Phase 5 - DONE. Default to the hierarchy, keep the flat view, keep the
      ~15 deep links working.** Ship the hierarchy as the landing view with
      the chronological list behind a toggle. Roughly fifteen emails, cron
      reminders, the digest and the booking routes link to `/class-bookings`
      with no parameters (`email.service.ts:903,1077,1105,1143,1312,1319`;
      `bookings.routes.ts:84,96,119,133`; `reminders.job.ts:120,208,220`;
      `digest.job.ts:86`; `liveClass.controller.ts:439,454`;
      `admin.routes.ts:1654,2573`) and every one of them is *about a specific
      session*. Making the hierarchy the default without touching them puts
      every reminder three drill-downs from its own class.
      **Point them at `?view=sessions`** so they keep landing on the
      chronological list.
      *Verify:* `my-bookings` still hydrates from the shared cache (trap #10);
      both views agree on the same class; a reminder link still lands on a
      list containing its session.

- [x] **Phase 6 - Slot labels.** DONE. Render a group as `Tuesdays 2:00 PM / next
      Mon 22 Sep`. Where a group's members disagree on weekday or time - a
      rescheduled member - show the dates rather than a false pattern.
      *Verify:* a deliberately drifted series does not claim a weekday.

### 9.5b What shipped, and what it was verified against

All six phases are in. Two commits: the wire fields (`fd1e7a2`) and the tree
itself (`b2a759b`), plus search at every level.

Departures from 9.5 as written, each forced by 9.4b:

· **No new endpoint and no new index.** The tree is built from the rows
  `useAllLiveClasses()` already holds.
· **A blocked module is drawn locked, not hidden.** It was never hidden.
· **`yourCohort` grew `sectionOrder` and `sectionDescription`.** Not budgeted,
  but without them a guest's modules could only be ordered by the HOST's
  `section.order`, which ranks one course's module by a position in another.
· **`lib/classSchedule.ts` is new.** The door readers, the clock rules and
  `getSlotStatus` had to be reachable from both views, and a second copy of
  them is a second set of answers.
· **Search works at all three levels**, per the reference, rather than Level 1
  only.

Measured against the running app, signed in as a student:

| Check | Result |
|---|---|
| `isEntitled` on the wire | 95/95 rows |
| module `order` populated | 24/24 rows that have a module |
| blocked module distinguishable | deliberately blocked one -> `isEnrolled:true, isEntitled:false`, stream fields stripped; reverted after |
| three levels render | yes, light and dark |
| drill-down + back button | Level 3 -> 2 -> 1, URL and headings follow |
| cold deep link | `?course=&module=` lands straight on Level 3 |
| SlotModal from the tree | opens, and correctly refuses a course she is not enrolled in |
| weekly label | "Saturdays . 10:32 AM", derived from the sessions |
| flat view | tiles, tabs, filters and range all unchanged |
| phone width | no horizontal overflow at 375px |
| React console | 0 warnings at every level |
| backend suites | remindermails 21, bookingsapi 71, bookingfixes 14, digest 26, crossorgclass 23, upcomingfeed 8 — all pass; `check:seats` clean |

### 9.6 What I would not do

- **Not weekday-only labels replacing the date.** Detaching the booking from
  the dated thing booked makes every row of the 9.2 table a way to book the
  wrong session. Note this is narrower than the plan's original blanket
  rejection of (B): Phase 6 *is* the safe half of it - derive the pattern from
  the rows in the group, and show dates the moment they disagree.
- **Not a denormalised session count on `Section`.** It would drift. (The
  original citation `schema.ts:1046-1050` was wrong - that comment belongs to
  `LiveClassSchema.pre('validate')`; `SectionSchema` at `:588-600` has no
  validator at all. The conclusion stands on its own.)
- **Not a new `?sectionId=` filter on `GET /live-classes`.** Not because of
  the query key - `useAllLiveClasses(status)` already takes and keys on a
  param - but because the endpoint already returns everything the tree needs.
- **Not re-scoping `'locked'` from group to module** without the owner
  deciding. It is a client-only rule (the server enforces entitlement, the 2x
  per-class cap, capacity and duplicate-booking, and nothing else), so this is
  a product call about what the UI should permit, not a schema question.
- **Not hiding blocked modules.** They are visible today (9.4b #1); removing
  them is a behaviour change the owner has not asked for. Lock them instead.

### 9.7 Open questions - for the owner, before Phase 5 lands

1. **Is "Book This Slot" a standing weekly commitment, or one session?**
   There is a fourth option between (A) and (C) that 9.2 missed:
   **(D) dated sessions, series-level booking** - keep the schema exactly as
   it is, and add one action that books every future member of an existing
   group in a single call. The group key already exists at `page.tsx:1527`;
   each booking still runs the unchanged entitlement, capacity, cutoff and cap
   gates. No template document, no `seriesId` reader, no migration. (D) gives
   the reference's actual semantics - *choose your weekly cohort once* - at a
   fraction of (C)'s cost. Phases 1-6 are compatible with all of A, C and D.
2. **Should a student be limited to one slot per module?** The reference
   implies it. We allow one reservation per *group* in the UI and cap
   attendance at 2x *per class document* - both different rules.
3. **Does Level 1 list enrolled courses only, or the whole catalogue?**
4. **What is shown for a course with no modules?** Every class falls into
   "General sessions" and Level 2 becomes a single card - worth skipping
   straight to Level 3 in that case.

### 9.8 What this plan still does not cover

Named here so it is a decision and not an oversight. The current page carries
seven filters plus search (`page.tsx:1321`), status tabs with counts (`:1413`),
**two different** four-tile metric rows - online (`:1720`) and in-person
(`:1733`, fed by `offlineStats` at `:1444`) - three empty states, a delivery
toggle, a mini-calendar and a range shifter. Under Course -> Module -> Class,
`filterCourse` and `filterProgram` become redundant with the navigation axis
itself and `filterLanguage` collides with Level 3's own language grouping.
Phases 3-5 keep all of that chrome on the flat view and give the hierarchy
only search; folding the tiles into the hierarchy is deferred until the owner
has seen it. Separately: the 2038-line file contains no `aria-*` or `role=`
attribute anywhere, and the modal is a mobile bottom sheet (`:588`) - a
three-level drill-down needs focus management and a back affordance that a
single-screen page never did. Phase 4 adds them for the new surfaces only.
