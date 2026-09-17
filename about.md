# About — Delta International LMS

A learning-management platform for **Delta International**, a trading and skills
academy. It runs two academies (Dubai and Bangalore) from one codebase, sells
and delivers courses, runs live online classes, and manages the whole student
lifecycle from enrolment to certificate.

- **Repository:** github.com/Delta-init/lms
- **Production (student):** https://lms.deltainstitutions.com
- **Shape:** one monorepo, three apps — a backend API, a student app, and an admin dashboard.

---

## 1. What it is for

Delta teaches four programmes and the LMS delivers all of them:

| Programme (category slug) | What it covers |
|---|---|
| **Forex / Trading** (`4x-trading`) | Market Break-out Trading (MBT), Delta Wave Theory (DWT), Market Making Cycle (MMC) |
| **Digital Marketing** (`digital-marketing`) | Social, Meta/Google/LinkedIn ads, SEO, ecommerce |
| **JURA** (`jura`) | — |
| **AI** (`ai`) | — |

A student can belong to **several programmes at once** (the account stores a
list of categories, not a single one).

---

## 2. Two academies, one system (multi-org)

The platform is multi-tenant by **Organization**:

| Academy | Slug | Currency | Payment gateway |
|---|---|---|---|
| Dubai | `dubai` | AED | Abzer |
| Bangalore | `bangalore` | INR | Razorpay |

Every student, order and live class is scoped to an organisation. Admins see
data for their own academy; a super-admin can switch between them. Times are
shown in each academy's own zone (Dubai → Asia/Dubai, Bangalore →
Asia/Kolkata); the backend itself runs on UAE time and stores everything in UTC.

---

## 3. Architecture

Three independent apps in one repository:

| App | Role | Stack | Port (dev) |
|---|---|---|---|
| `backend/` | REST API | **Bun** + Express + MongoDB (Mongoose) | 8000 |
| `client/` | Student app | Next.js 15, React Query, Zustand, Tailwind | 3000 |
| `admin/` | Admin dashboard | Next.js 15 | 3001 |

- **API contract:** every response is `{ success, data, meta }` or `{ success:false, error:{ code, message } }`, all under `/api/v1`. Both front-ends proxy `/api/v1/*` to the backend, so no backend URL is hard-coded.
- **Database:** MongoDB, ~45 collections. Connection is via `DATABASE_URL` (note: not `MONGODB_URI`).
- **Two separate sessions:** a student cookie (`lms_at`) and an admin cookie (`lms_admin_at`), each httpOnly with a 15-minute access token and a 30-day refresh token stored hashed. They cannot cross over.

---

## 4. Roles & access

**Account roles:** `student`, `instructor`, `admin`, `super_admin`, `sub_admin`,
`support` (plus fine-grained custom roles with a permission matrix). The admin
dashboard admits everyone except plain students; instructors sign in there too.

**Enrolment state machine:**
```
signup → pending  (viewer: can browse only)
admin approve → approved  (full student access)
admin reject/revoke → rejected
admin block → isActive:false  (cannot sign in at all)
```

**Signup types:** *Express* (name, email, password — fast) or *Full
Registration* (a complete application with personal details, documents and
programme choice). Express accounts can complete the full form later.

---

## 5. What students can do (client app)

- **Accounts:** email+password or email-code sign-in; email verification; forgot/reset password; change email; two-factor authentication (TOTP); active-session list with remote sign-out; a **two-device limit** (first device auto-approved, a second needs admin approval).
- **Catalogue:** browse courses, filter by programme (Forex / JURA / Digital Marketing / AI) and status, search with live type-ahead, favourites, learning paths, recommendations, instructor profiles.
- **Learning:** video player (resume, watch-time tracking, mark-complete, progress %), per-lesson Q&A/discussion, personal notes, timestamped bookmarks, transcripts, AI-generated lesson notes, timed quizzes, and a downloadable completion **certificate**. Every video carries a moving forensic watermark.
- **Live classes:** browse the schedule, book a seat (slots show open/full/reserved/live/ended), join live (Google Meet or in-app Mux room), watch recordings afterwards, submit session homework, and rate the session.
- **Assignments:** submit files with a note; track status (awaiting review / approved / needs changes) and resubmit.
- **Payments:** cart, coupons, region-aware checkout via **Razorpay, Abzer, Tabby, Tamara**; order history; auto-enrolment on payment.
- **Motivation:** daily streaks with a weekly goal, achievement badges, progress dashboard, activity feed.
- **Support & comms:** notification centre, in-app AI chat assistant (daily allowance), support tickets.
- **Personalisation:** light/dark/system theme, layout options, PWA install, full responsive/mobile support.

*(A complete feature inventory lives in `LMS-Client-Features.md`.)*

---

## 6. What staff can do (admin app)

Manage students, enrolment requests and express members; courses, sections,
lessons, categories and learning paths; live classes, timetable, bookings,
availability and attendance; assignments; orders, coupons and reports; reviews;
instructors; roles/permissions; devices; support tickets; audit logs; and
per-user email-notification preferences. Admins can also **impersonate** a
student for support (with a permanent on-screen banner while active).

Module-level access control: an enrolment can have specific **modules locked**
per student — used so partially-paid students see only the first modules until
they clear their balance.

---

## 7. Integrations

- **Google Meet / Calendar** — live-class links are auto-generated on a Calendar event; the room is set to **OPEN** so students join without the host admitting them (requires the `meetings.space.settings` OAuth scope; anonymous, non-signed-in users are still held by Google's own rule).
- **Mux** — protected video streaming for lessons and in-app live rooms.
- **Cloudflare R2 / S3** — file storage; identity documents live in a private KYC bucket served only through short-lived signed links.
- **Email** — nodemailer with a primary + backup mailbox pool and a **durable outbox** that persists every message and retries with backoff, so notifications are never silently lost.
- **Payments** — Razorpay (INR), Abzer (AED), Tabby and Tamara (buy-now-pay-later, with pre-scoring).

---

## 8. Security & content protection

- bcrypt password hashing; passwords are never stored or recoverable in plain text.
- Short access tokens + rotating refresh tokens; **refresh-token reuse invalidates every session** for that account.
- Account lockout after repeated failed logins; password re-entry gate on sensitive actions (2FA changes, account deletion).
- Device whitelist for students; TOTP two-factor.
- Private KYC document storage; forensic drifting video watermark; right-click and devtools guards on the student app.
- Separate, non-interchangeable student and admin sessions.

---

## 9. Bulk data & operations (history)

The platform has been populated from the academy's master spreadsheets via
purpose-built, re-runnable scripts (all dry-run first, all idempotent):

- **Digital Marketing (Dubai):** 275 students imported → auto-approved with a "Bulk Import" badge → enrolled in the Digital Marketing course, with module access set by payment status (paid = all modules, pending = first half) → welcome emails with set-password links.
- **Forex 2026 (Dubai):** ~1,036 students imported the same way, enrolled into MBT / DWT / MMC by their current course, module access by payment status, welcome emails in daily batches. Payment status later reconciled against Zoho Books (matched on phone number, since student codes were unreliable).
- Supporting tools: staff-password reset, express→full account conversion with document upload, cross-collection email search, and a login diagnostic.

---

## 10. Key conventions (for developers)

- Backend uses **Bun** (`bun run dev`); the two Next apps use **npm**.
- `Enrollment.blockedLessons[]` actually stores **section/module IDs** (a legacy field name) — this is what gates module-level access.
- React Query keys are namespaced: client uses `['courses', …]`, admin uses `['admin', 'courses', …]`.
- `backend/src/config/timezone.ts` must be the first import in `index.ts`.
- The connection string env var is `DATABASE_URL`; production uses MongoDB auth (`?authSource=admin`).

---

## 11. Hosting & operations (in brief)

Runs on a single Linux VPS under **PM2** (the LMS backend is one Bun `fork`
process, `lms-backend`), fronted by **nginx** with TLS, backed by a local
**MongoDB**. The same host runs several of Delta's other apps. Deploys are
`git pull` → `bun run build` → `pm2 restart`. Email goes through a two-mailbox
Gmail SMTP pool with a durable retry outbox; files and DB backups go to
Cloudflare R2; Google Calendar/Meet powers live-class links.

> Full server, database, deploy, backup, env-var and script detail is kept in
> **`SERVER.md`** (gitignored — it holds infrastructure detail that should not
> live in the repo). Secrets themselves live only in `backend/.env`.

---

*This document is a human-readable overview generated from the codebase and
project history. For the exhaustive feature list see `LMS-Client-Features.md`;
for developer setup and conventions see `CLAUDE.md`; for infrastructure and
operations see `SERVER.md`.*
