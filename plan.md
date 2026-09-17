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
| A1 | Native LiveKit embed in Next.js (not an iframe) — keeps `WatermarkOverlay` on live video | ✅ default | settled |
| A2 | Cap LiveKit classes at **50** participants, ≤8 concurrent rooms | ✅ option (1) from §9 | settled |
| A3 | Mux stays; LiveKit is a **new `provider`**, non-destructive | ✅ default | settled |
| D3 | Who holds the **production** Ed25519 private key | ⏳ | **open — ops decision** |
| D4 | Do recordings appear in the LMS library, or stay in CLT's Recordings tab | ⏳ | **open — needed by Phase 5 only** |

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
| 2026-08-28 | — | Found: python-jose has **no EdDSA support**, so the verifier uses PyJWT (already installed). Found: `infra/livekit.prod.yaml` caps a room at **30**, not the 50 the plan assumed — added `max_participants_per_room` so production can be set correctly. |
