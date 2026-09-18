# LMS ↔ CLT Connect — Integration Reference

How the LMS hands a verified identity to the meeting platform, and how the two
sides fit together now that they are both built.

**Status:** Phases 1–6 complete on both sides, and in use.

Read §3a first if you are new to this. The signed ticket described in §3 is
still the credential CLT verifies, but a browser never carries one — since
Phase 6 the LMS redirects the browser to CLT holding a one-time **code**, and
CLT trades that code for the ticket over the server-to-server channel. The
class no longer renders inside the LMS at all.

---

## 1. The trust model in one paragraph

The LMS is the **identity and entitlement authority**. It decides who may enter a
room and with what powers, and says so in a short-lived signed ticket. CLT
Connect verifies that ticket and exchanges it for a LiveKit token. CLT never
reads the LMS database and never holds anything that could mint a ticket — it
holds only a public key. A full compromise of the meeting platform therefore
cannot forge an LMS instructor.

This is deliberately **not** the HS256 pattern each app uses for its own
sessions. A shared secret across a trust boundary lets either side impersonate
the other.

---

## 2. Key distribution

| | |
|---|---|
| Algorithm | **EdDSA / Ed25519** |
| Private key | LMS only, `INTEGRATION_JWT_PRIVATE_KEY` (base64 of a PKCS#8 PEM) |
| Public key | published at **`GET /.well-known/jwks.json`** — unauthenticated, `Cache-Control: public, max-age=300` |
| Key id | `kid` in the ticket header selects the key |

Live example:

```json
{ "keys": [ {
  "kty": "OKP", "crv": "Ed25519",
  "x": "wnIsk32mGFYN-DPWTuf6iHcRcx8Rcb1fYno3HddSJ0g",
  "alg": "EdDSA", "use": "sig", "kid": "lms-2026-08"
} ] }
```

**Rotation.** The LMS publishes the new key alongside the old (`*_PREVIOUS` env
pair). Both verify during the overlap, so in-flight joins do not break. After
one CLT cache TTL the old key is dropped. No coordinated deploy.

> CLT must therefore **select by `kid`**, not assume `keys[0]`, and refetch the
> JWKS when it sees a `kid` it does not know.

---

## 3. The join ticket

Minted by the LMS, consumed **once** by CLT.

```jsonc
{
  "iss": "lms.deltainstitutions",
  "aud": "clt-connect",
  "sub": "665f1a2b3c4d5e6f7a8b9c0d",   // LMS user _id — THE correlation key
  "jti": "f81d4fae-…",                  // single-use; replay key
  "iat": 1756000000,
  "exp": 1756000090,                    // 90 seconds

  "name":  "Aisha Rahman",
  "email": "aisha@example.com",
  "role":  "student",                   // student | instructor | admin
  "avatarUrl": "https://…/a.png",       // optional — shown when the camera is off

  "liveClassId": "665f000000000000000000aa",
  "roomName":    "lms-665f000000000000000000aa",
  "orgSlug":     "dubai",

  "grants": { "canPublish": true, "roomAdmin": false, "bypassLobby": true }
}
```

`role` is the CLT-facing role, not the LMS one: every observer role
(`super_admin`, `admin`, `sub_admin`) arrives as `admin`. The LMS role decided
*whether* they may enter and *with what scope* before the ticket existed — see
§5.

An admin observer's `grants` carry two more fields:

```jsonc
"grants": {
  "canPublish": false, "roomAdmin": false, "bypassLobby": true,
  "hidden":    true,     // how they ARRIVE
  "mayUnhide": true      // whether they may CHANGE it, from inside the room
}
```

`hidden` and `mayUnhide` are separate on purpose: the first is a state, the
second a permission. An instructor gets neither — they are never hidden, so
there is nothing to unhide. CLT re-reads `mayUnhide` from the LiveKit token's
metadata on every `/visibility` call, so hiding the button is a courtesy and
refusing the call is the rule.

Rules CLT must honour:

1. **90-second TTL.** The ticket authorises *entering*. The LiveKit token
   (12h, already implemented) sustains the session.
2. **`jti` is single-use.** Record it in Redis with TTL = ticket lifetime.
   A second presentation is `409`, not a second join.
3. **`grants` are the LMS's decision.** Map them onto the existing helpers in
   `livekit_tokens.py`. Do not re-derive them, and never accept grants from the
   client.
4. **`roomName` is derived** by the LMS as `lms-<liveClassId>`. It is never
   client-supplied — that is what stops a student with any valid booking from
   minting themselves into another classroom.
5. Tickets arrive in a **POST body**, never a query string.

---

## 3a. The redirect handoff (Phase 6 — how a join actually happens)

Nothing bearer-shaped is ever put in a URL. A URL is the worst place for a
credential: it lands in history, `Referer`, proxy logs, and whatever is on
screen when somebody shares it. So the browser carries a **code** — 32 random
bytes, opaque, unsigned, worthless to anyone but CLT.

```
  browser                LMS                        CLT
    │  click Join         │                          │
    ├────────────────────►│  issueHandoff()          │
    │                     │  stores sha256(code)     │
    │◄────────────────────┤  {url: …/lms/enter?c=…}  │
    │                                                │
    ├───────────── GET /lms/enter?c=<code> ─────────►│
    │                     │◄─ POST /integrations/    │
    │                     │   handoff/exchange ──────┤  (HMAC S2S, signs the code)
    │                     │   burn code, AUTHORISE,  │
    │                     │   mint ticket ──────────►│
    │◄──────────── LiveKit token, room ──────────────┤
```

Four properties are worth stating because each one is a decision:

**Authorisation runs at exchange, not at issue.** The stored row is an
*intent* — a class id, a user id, and `host` or `student`. Every real check
(booking, enrolment, blocked module, academy, programme scope, time window)
runs when CLT redeems the code. A class cancelled or a booking withdrawn in the
seconds between the click and the arrival is therefore honoured rather than
raced.

**The code is single-use, and losing the race is indistinguishable from being
wrong.** The burn is one atomic `findOneAndUpdate` on `usedAt`. A replayed code
and an invented code get the same `409` and the same words, so there is no
oracle telling an attacker that a real code existed.

**It is stored hashed.** Only `sha256(code)` is written; a database read hands
over nothing usable. No ticket is ever persisted.

**It expires in 120 seconds** (`HANDOFF_TTL_SEC`) — generous for a slow page
load, far shorter than a class. Expiry is checked on read as well, because the
TTL monitor is lazy.

### Two doors, one handler

The handoff hangs off **both** routers, and which one answers is what decides
whose session is used:

| Portal | Path | Guard |
|---|---|---|
| student (`client/`) | `POST /api/v1/live-classes/:id/handoff` | `authenticate` — `lms_at` only |
| admin + instructor (`admin/`) | `POST /api/v1/admin/live-classes/:id/handoff` | `authenticateAdmin` — `lms_admin_at` only |

Both run the identical handler (`controllers/classHandoff.controller.ts`).

It was one route behind `authenticateAny`, which reads whichever session cookie
it finds and **prefers the admin one**. The two portals differ only by port in
development, and may share an apex domain in production (`COOKIE_DOMAIN`), so a
single browser can hold both cookies at once. When it did, a student pressing
"Join the class" on their own dashboard was issued the *admin's* hidden
observer ticket — someone else's session, obtained by sitting at the keyboard.
Splitting by mount removes the contest: the student router cannot see the admin
cookie, so there is nothing to prefer. Pinned by section I of
`handoff.suite.ts`.

---

## 4. Verification steps

In order. Any failure is a rejection, not a downgrade.

1. Read `kid` from the JWT header.
2. Look it up in the cached JWKS; refetch once on a miss.
3. Verify the **EdDSA** signature.
4. Check `iss == LMS_TICKET_ISSUER` and `aud == LMS_TICKET_AUDIENCE`.
5. Check `exp` (and `nbf`/`iat` skew — 60s tolerance is plenty).
6. `SETNX jti` in Redis with the remaining TTL. Already present → **409**.
7. Map `role` + `grants` → LiveKit token.
8. Record `sub` into `Participant.student_mongo_id` and `email` into
   `Participant.student_email` — the columns already exist and are unused.

Python sketch:

```python
from jose import jwt                      # or python-jose / pyjwt with EdDSA
import httpx, redis.asyncio as redis

_jwks_cache: dict | None = None

async def verify_lms_ticket(token: str) -> dict:
    header = jwt.get_unverified_header(token)
    jwk = await _key_for(header["kid"])            # refetch on unknown kid
    claims = jwt.decode(
        token, jwk, algorithms=["EdDSA"],
        issuer=settings.lms_ticket_issuer,
        audience=settings.lms_ticket_audience,
    )
    ttl = max(1, int(claims["exp"] - time.time()))
    if not await r.set(f"lms:jti:{claims['jti']}", "1", nx=True, ex=ttl):
        raise HTTPException(409, "This join link has already been used")
    return claims
```

---

## 5. Role mapping

Defined in CLT at `app/core/lms_roles.py`; the LMS side is
`services/liveClassJoin.service.ts`. CLT has two levels — a `tier` that carries
the permissions and a `display_role` that is only a label — so an LMS role maps
to a pair, not to a single value.

| LMS role | May enter | As | CLT helper |
|---|---|---|---|
| `instructor` | their **own** class | host, always visible, moderates | `mentor_token` |
| `super_admin` | **every** class | host **or** hidden observer | `admin_visible_token` / `admin_hidden_token` |
| `admin` | their **organisation's** classes | host or hidden observer | same |
| `sub_admin` | their organisation **and** their programme | host or hidden observer | same |
| `support` | — | not an observer role | — |
| `student` | classes they have **booked** | student; lobby unless `grants.bypassLobby` | `student_admitted_token` / `student_lobby_token` |

`support` is an LMS role and stays one — it serves help desk, assignments and
mail notifications. It is simply not on the observer list, so it cannot enter a
class. Removing it from the enum would break those services; leaving it out of
`ADMIN_OBSERVER_ROLES` is the whole of what "support cannot observe" means.

**`roomAdmin` is `super_admin` only** (`ROOM_CONTROL_ROLES`), and only when
entering visibly. Moderating a room from behind a hidden identity is refused on
both sides.

### Hidden, and the reveal

An admin observer is `hidden=true, can_publish=false`: absent from the
participant list, unable to speak. `grants.mayUnhide` — set for admin
observers, never for instructors or students — lets them step into the open
from inside the room via `POST /api/lms/visibility`, which rewrites the live
LiveKit permissions without a rejoin.

> The hidden token carries the person's **real name** even though nobody can
> see it. `set_visibility` rewrites permissions and *not* the name, so the name
> minted at entry is the one the room reads the instant they unhide. Without
> it a revealed admin appeared as a generic "Admin" and could speak
> unattributed. CLT's own stealth-viewer flow passes no name and keeps the
> generic one.

**Known gap.** Revealing and then re-hiding leaves the participant on the
roster of clients that were *already connected* at that moment — LiveKit does
not retract a participant those clients have already learned about. The server
state is correct (`hidden=true, can_publish=false`, so they cannot be seen or
heard) and anyone joining afterwards never learns of them; it is the stale
roster row that lingers.

---

## 6. The endpoints, both directions

**On CLT** (`app/api/lms.py`):

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/lms/enter` | one-time code | the redirect door — redeems the code, returns a LiveKit token |
| `POST` | `/api/lms/join` | ticket in body | the direct door, for a caller that already holds a ticket |
| `POST` | `/api/lms/visibility` | LiveKit token | reveal / re-hide; requires `mayUnhide` in the token metadata |
| `POST` | `/api/lms/rooms` | HMAC S2S | create/ensure the room for a LiveClass; **idempotent** |
| `POST` | `/api/lms/rooms/{room}/end` | HMAC S2S | end the meeting |
| `POST` | `/api/lms/recordings/{id}/playback` | HMAC S2S | a playback URL for a finished class |

`/enter` and `/join` share one `_admit()`, so the two doors cannot drift.

**On the LMS:**

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/v1/integrations/handoff/exchange` | HMAC S2S | CLT redeems a code; the LMS authorises and mints the ticket |
| `POST` | `/api/v1/live-classes/:id/handoff` | `lms_at` | student portal — issue a code |
| `POST` | `/api/v1/admin/live-classes/:id/handoff` | `lms_admin_at` | admin/instructor portal — issue a code |
| `GET` | `/.well-known/jwks.json` | none | the public key CLT verifies with |

The S2S signature covers the **code**, not an empty body — one signature, one
code. `utils/cltSignature.ts` is the single implementation, shared with the
webhook path.

---

## 7. What each phase delivered

| Phase | Delivered |
|---|---|
| 1 | Ed25519 signing + JWKS on the LMS; ticket verifier, `jti` replay cache and CORS on CLT |
| 2 | `POST /api/lms/rooms`; `Course.lms_live_class_id`; seat cap validation |
| 3 | `POST /api/lms/join` and `/rooms/{room}/end`; participant identity carried through |
| 4 | The redirect handoff — one-time codes, `/lms/enter`, authorise-at-exchange |
| 5 | Watermark + floating identity tag; the in-room visibility toggle; LMS avatar when the camera is off; auto-recording that nobody can switch off |
| 6 | The embedded classroom **deleted** — `LiveKitStudio.tsx`, `LiveKitRoomView.tsx`, the `LIVE_CLASS_HANDOFF` flag and all three `livekit` packages are gone from both LMS apps; `ClassEntryPanel` replaces them |

Since Phase 6 the LMS ships **no LiveKit client code**. The only remaining
occurrences of the string in the built bundles are `provider === 'livekit'`,
the data value that distinguishes a LiveKit class from a Mux or Meet one.

`ClassEntryPanel` exists once per app and is the entire in-LMS classroom UI:

* **admin** — *Watch hidden* (primary) and *Join visibly*; the assigned
  instructor instead sees a single *Start the room*, because visibility is not
  a choice they have.
* **client** — *Join the class*, plus the two refusals that are not errors:
  `425` counts down to the doors opening, and a `409` before the instructor
  arrives reads as "waiting", retrying every 8s so the student never has to
  refresh.

---

## 8. Configuration

### LMS `backend/.env`
```bash
INTEGRATION_JWT_PRIVATE_KEY=<base64 of an Ed25519 PKCS#8 PEM>
INTEGRATION_JWT_KID=lms-2026-08
INTEGRATION_JWT_ISSUER=lms.deltainstitutions
INTEGRATION_JWT_AUDIENCE=clt-connect
INTEGRATION_TICKET_TTL_SEC=90

# Where to send the BROWSER. CLT_BASE_URL is the server-to-server address; the
# SPA that serves /lms/enter may be somewhere else entirely. Split them (a dev
# setup, or an API subdomain) and sending the browser to the API origin yields
# a 404 from a URL that looks perfectly correct. Falls back to CLT_BASE_URL, so
# single-origin installs need no new setting.
CLT_PUBLIC_URL=http://localhost:5173
CLT_BASE_URL=http://localhost:8002
CLT_S2S_SECRET=<32 random bytes, same value as LMS_S2S_SECRET in CLT>
```

> `LIVE_CLASS_HANDOFF` was the Phase 4 flag that chose between `embed` and
> `redirect`. Phase 6 deleted the embed path, so the flag is gone and any
> lingering value is inert.

Generate a key:

```bash
bun -e "const{generateKeyPairSync}=require('node:crypto');const{privateKey}=generateKeyPairSync('ed25519');console.log(Buffer.from(privateKey.export({type:'pkcs8',format:'pem'}).toString()).toString('base64'))"
```

> **Base64, not raw PEM.** A PEM is multi-line and `.env` is line-based; Bun's
> parser expands `\n` escapes and then ends the value at the first newline, so a
> one-line escaped PEM silently arrives as just the `-----BEGIN` header and
> OpenSSL rejects it with `BAD_END_LINE`. Base64 has nothing for a parser to
> reinterpret and survives PM2, systemd and CI secret stores unchanged. Raw PEM
> is still accepted if you already have one working.

### CLT `backend/.env`
```bash
LMS_JWKS_URL=http://localhost:8000/.well-known/jwks.json
LMS_TICKET_ISSUER=lms.deltainstitutions
LMS_TICKET_AUDIENCE=clt-connect
LMS_S2S_SECRET=<32 random bytes, same value as CLT_S2S_SECRET in the LMS>
CORS_ORIGINS=http://localhost:5173,http://localhost:3000,http://localhost:3001
```

---

## 9. Failing safe

With no key configured the LMS reports the integration as disabled: the JWKS is
served but **empty**, and `mintTicket()` throws `IntegrationDisabledError` so
callers return a clean `503` rather than crashing in the signer. This is what
makes the feature safe to merge long before it is switched on — and it is what
the endpoint answered before a key existed.

---

## 10. Testing

| Suite | Command | Assertions |
|---|---|---|
| `backend/src/tests/integration.suite.ts` | `bun run test:integration` | 31 |
| `backend/src/tests/handoff.suite.ts` | `bun run test:handoff` | 35 |
| CLT `backend/tests/` | `pytest` | 56 |

`integration.suite.ts` verifies tickets the way CLT does — against the
published JWKS, never the private key — and then attacks them: tampered
signature, a payload edited to claim `instructor` + `roomAdmin`, a foreign key
wearing our `kid`, wrong audience, wrong issuer, expiry, and a rotation
mid-flight. It also asserts the JWKS never leaks the private `d` parameter.

`handoff.suite.ts` covers the code itself, in nine sections: the URL carries no
credential (A), only a signed caller may exchange (B), single use with no
oracle (C), expiry ahead of the TTL sweep (D), **authorisation at exchange, not
at issue** (E), a student cannot obtain a host handoff (F), the Phase 4 flag is
inert (G), the Phase 5 grants (H), and **one browser holding both portals'
cookies** (I).

On the CLT side `test_lms_roles.py` fails if a role is added to the LMS enum
and not mapped here — which is why that list is duplicated rather than
imported — and `test_lms_visibility.py` guards the `mayUnhide` gate and the
name a revealed admin wears.

---

## 11. Capacity

An interactive LiveKit room is capped at **`LIVEKIT_MAX_PARTICIPANTS` seats**,
default **50** (`liveClass.service.ts:21`). This section previously called the
variable `LIVEKIT_MAX_SEATS` and the default 30; a variable of that name is
read by nothing, so setting it silently leaves the cap where it was.
validated when `provider === 'livekit'`; the admin form auto-fills 30 in place
of the open-mode default of 500 and leaves it editable. Broadcast classes —
instructor publishes, students subscribe — keep the larger default, and Mux
classes are unaffected.
