# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Layout

Independent sub-projects in one monorepo:

| Directory | Role | Default port | Package manager |
|-----------|------|-------------|-----------------|
| `backend/` | Express + Bun + MongoDB REST API | 8000 | **Bun** |
| `admin/` | Next.js 15 admin dashboard | 3001 (3002 in preview) | npm |
| `client/` | Next.js 15 student-facing app | 3000 (3003 in preview) | npm |
| `mobile/` | Expo (React Native) student app — plan.md §13 | Metro 8081 | npm (`npx expo install` for packages) |
| `shared/` | Types + pure rules used by `mobile/` (and `client/` later); no dependencies | — | — |

> **Worktree note**: This repo is open in a Claude worktree at `.claude/worktrees/objective-hypatia-c27ed3`. The main project lives at `C:\Users\MSI-PC\Delta\lms\`. Changes that affect both must be applied in **both** locations.

---

## Commands

### Backend (use `bun`, never `npm`)
```bash
cd backend
bun run dev          # watch mode (bun --watch)
bun run build        # bundle → dist/
bun run type-check   # tsc --noEmit only
bun run seed         # wipe + re-seed DB
```

### Admin / Client (use `npm`)
```bash
cd admin   # or cd client
npm run dev          # next dev
npm run build        # production build
npm run type-check   # tsc --noEmit only
npm run lint         # ESLint
```

### Preview servers (`.claude/launch.json`)
The preview tool starts admin on **3002** and client on **3003** (not the default 3001/3000). The backend is NOT in launch.json — start it separately with `bun run dev` from `backend/`.

---

## Architecture

### API contract

All responses use this envelope:
```json
{ "success": true,  "data": <payload>, "meta": <pagination?> }
{ "success": false, "error": { "code": "SNAKE_CASE_ERROR", "message": "human string" } }
```
All routes are prefixed `/api/v1`. Both Next.js apps proxy `/api/v1/*` → backend, so frontend code never hardcodes the backend URL.

### Auth — two independent sessions

| Cookie | Used by | Middleware |
|--------|---------|------------|
| `lms_at` | student client | `authenticate()` |
| `lms_admin_at` | admin dashboard | `authenticateAdmin()` |

Both are httpOnly, 15-min access tokens with 30-day refresh tokens stored hashed in MongoDB. Reuse detection: any reused refresh token invalidates **all** sessions for that user.

The key backend middleware functions in `auth.middleware.ts`:
- `authenticate` / `authenticateAdmin` — sets `req.user`
- `requireRole(...roles)` — throws 403 if role not in list
- `requireEnrollmentApproval` — blocks `pending`/`rejected` students from guarded routes
- Convenience exports: `requireAdmin`, `requireAnyAdmin`, `requireInstructor`

### CORS

Allowed origins are defined in `backend/src/config/cors.ts`. Currently: `env.CLIENT_URL`, `env.ADMIN_URL`, `http://localhost:3002`, `http://localhost:3003`. **Add new preview ports here when needed.**

### Timezone — critical

Three layers, three rules:

- **Backend** runs on **UAE time (Asia/Dubai, UTC+4)**. `backend/src/config/timezone.ts` must be the **first** import in `backend/src/index.ts` — it sets `process.env.TZ` before any `Date` objects are created. Cron job schedules, day-boundary math, and email date labels assume this timezone. Storage is UTC.
- **Admin** displays in the **active academy's zone**: Dubai → Asia/Dubai, Bangalore → Asia/Kolkata (map in `admin/src/lib/timezone.ts`; resolved per-session by `TimezoneScope` in `admin/src/app/providers.tsx` — super admins follow the org switcher, everyone else their own org). The datetime-local picker helpers convert academy wall-clock ↔ UTC ISO.
- **Client** displays in the **student's device timezone** (no forced zone; `client/src/lib/timezone.ts` deliberately exports the device zone only — do not re-add the old Dubai monkey-patch).

### React Query cache namespacing

Client uses `['courses', ...]`, admin uses `['admin', 'courses', ...]`. This prevents cache collisions if both apps ever share a browser tab. Always follow this pattern when adding new query keys.

### Student enrollment state machine

```
signup → enrollmentStatus: 'pending'   (viewer — browse only, no bookings)
admin approve → 'approved'              (student — full access)
admin reject/revoke → 'rejected'        (viewer — browse only)
admin block → isActive: false           (login disabled entirely)
```

### Known field-naming quirk

`Enrollment.blockedLessons[]` stores **section/module IDs**, not lesson IDs. The field name is a legacy misnomer. The booking route (`POST /bookings`) checks `session.sectionId` against this array to enforce module-level access control.

### Live class types

`LiveClass.type` can be `'external'` (Zoom/Meet link) or `'internal'` (Mux stream). A separate boolean `isOnline: false` marks **in-person/offline** classes, which additionally have `location` and `room` fields. The booking route applies module-blocking to both types equally.

### Form validation pattern

Backend: Zod schema → `validate(schema)` middleware applied per route.  
Frontend: React Hook Form + Zod resolver. DOM value manipulation (e.g., `input.value = x`) does **not** update RHF state — always call the registered `onChange` handler or use `setValue`.

### File uploads

Static files served at `/uploads/images/:file` and `/uploads/videos/:file` without auth. Filenames are random hex so URLs are unguessable. Supports S3/R2 or local disk (configured via env).

---

## Key env variables

```bash
# backend/.env
PORT=8000
MONGODB_URI=
JWT_SECRET=
CLIENT_URL=http://localhost:3000
ADMIN_URL=http://localhost:3001

# client/.env
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000

# admin/.env  (same pattern)
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
```

Backend startup runs two idempotent migrations on every boot:
1. `seedDefaultRoles()` — ensures system roles exist
2. `UserModel.updateMany({ role: 'student', enrollmentStatus: { $exists: false } }, ...)` — migrates legacy accounts that predate the `enrollmentStatus` field
