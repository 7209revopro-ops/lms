# Exam Feature — Integration Plan (from `exam-taker` → LMS)

> Draft for review. **No code has been changed** — this is the spec/plan only.
> Ported from `/delta/digital academy/exam-taker` (the standalone "tLogic Exam System").
> Once you approve this (and the open decisions at the bottom), I'll build it in phases.

---

## 1. Goal

Bring the exam-taker experience **natively into the LMS**: a **timed, proctored, one-attempt
exam** with a question bank, anti-cheat enforcement, and admin per-question grading — running
inside the LMS's existing auth, courses, enrolment, org-scoping, admin dashboard and student app.
No separate app, no separate login, no separate database.

---

## 2. What the exam-taker does today (source of truth)

- **Timed exam**, duration enforced **server-side** (`examStartedAt + 70min - now`), auto-submits on expiry.
- **Question bank**: `mcq | true-false | short-text | essay`, each with `order` + `maxMarks`.
- **Locked progression** — must answer the current question before advancing.
- **Auto-save** every ~800ms + `localStorage` backup; syncs on reconnect.
- **Anti-cheat**: block copy/paste/cut/right-click; log tab-switch/blur (**4 → auto-suspend**);
  PrintScreen / screenshot combos → **instant suspend**. Stored on the attempt + an append-only log.
- **One-time**: cannot re-take once submitted; after submission the student can view grades.
- **Admin**: manage questions, create students, see status (Not started / In progress / Submitted /
  Suspended), grade **per question** (marks + feedback), read the activity log.

## 3. What the LMS already has (and the gap)

| Capability | LMS Quiz (`QuizModel`, per-lesson) | LMS Assignment | Exam-taker |
|---|---|---|---|
| Scope | one per **lesson** | one per lesson | standalone exam |
| Question types | `mcq / true_false / short` | file/text submission | + **essay**, per-question `maxMarks` |
| Timer | `timeLimit` field, **not** enforced as a live server countdown | — | **server-enforced countdown + auto-submit** |
| Attempts | **multiple** (`attemptNumber`) | one | **one-time** |
| Grading | **auto only** | manual grade | **auto (mcq/tf) + manual per-question (short/essay) + feedback** |
| Anti-cheat / proctoring | none | none | **tab-switch, copy-paste, screenshot, auto-suspend** |
| Activity log | none | none | **append-only ExamLog** |
| Locked progression | no | — | yes |

**Conclusion:** the LMS quiz is a fundamentally different, lightweight tool. I recommend a **new
`Exam` feature** rather than overloading `Quiz` — reusing the LMS's User / Course / Enrollment /
org-scoping / admin patterns, but with its own models, routes and pages. *(Alternative in §10.)*

---

## 4. Proposed data model (LMS `schema.ts`)

All new Mongoose models in the `lms` DB, following existing conventions (`baseSchemaOptions`, org via the course).

### `Exam` — one exam, attached to a **course**
```
courseId → Course              // exam belongs to a course (org inferred from it)
title, instructions
durationMinutes                // server-enforced
passPercent
questions: [ExamQuestion]      // embedded, ordered
availableFrom?, availableTo?   // optional open window
maxViolations                  // tab-switch count that auto-suspends (default 4)
antiCheat: { blockCopyPaste, blockRightClick, screenshotSuspend, tabSwitchSuspend } // toggles
isPublished
```
### `ExamQuestion` (embedded)
```
text | type: mcq | true_false | short | essay
choices[] | correctAnswer (mcq/tf only) | order | maxMarks | explanation?
```
### `ExamAttempt` — one per (student, exam)  *(unique index)*
```
userId → User | examId → Exam | courseId
status: not_started | in_progress | submitted | suspended
startedAt | submittedAt | suspendedReason
answers: [{ questionId, answer, marksAwarded?, feedback? }]
totalMarks | maxMarks | passed
gradedAt | gradedBy
```
### `ExamLog` — append-only proctoring trail
```
attemptId | userId | examId | event (tab_switch|paste|screenshot|blur|…) | detail | timestamp
```

---

## 5. API (mounted under the existing `/api/v1`)

### Student — `/exams` (authenticated + enrolled, `requireEnrollmentApproval`)
| Method | Path | Description |
|---|---|---|
| GET  | `/courses/:courseId/exam` | The exam for a course (no answers/correct keys) |
| POST | `/exams/:examId/start` | Create/return the attempt; stamps `startedAt` once |
| GET  | `/exams/:examId/status` | `timeRemainingMs`, saved answers, status |
| POST | `/exams/:examId/answer` | Upsert one answer (auto-save) |
| POST | `/exams/:examId/submit` | Finalize (manual or on timer expiry) |
| POST | `/exams/:examId/log` | Record a proctoring event (may auto-suspend) |
| GET  | `/exams/:examId/result` | Own grade — **only after submission** |

### Admin — `/admin/exams` (`requireAnyAdmin`, **org-scoped** like the rest of admin)
| Method | Path | Description |
|---|---|---|
| GET/POST | `/admin/courses/:courseId/exam` | Read / create-update the exam |
| POST/PUT/DELETE | `/admin/exams/:id/questions[/:qid]` | Question bank CRUD |
| GET | `/admin/exams/:id/attempts` | All students' status |
| GET | `/admin/attempts/:id` | One attempt: answers + questions + log |
| POST | `/admin/attempts/:id/grade` | Save per-question marks + feedback |
| POST | `/admin/attempts/:id/reset` | Let a student retake / clear a suspension |

*Duration, correct answers and marks are always resolved server-side — never trusted from the client.*

---

## 6. Student flow (LMS client — Next.js)

```
Course page → "Take exam" (visible only if published + within window + not yet submitted)
  → Rules screen → Start
  → Server-enforced countdown (from ExamAttempt.startedAt)
  → One question at a time, locked progression, auto-save each answer
  → Submit (manual) OR auto-submit at 00:00 OR auto-suspend on violations
  → Result page: score + per-question feedback once graded
```
Reuses the LMS client's existing anti-piracy layer (right-click already disabled, forensic
watermark) and adds exam-specific guards.

## 7. Anti-cheat (client guards + server truth)

- Client: block copy/paste/cut + context menu; listen for `visibilitychange`/`blur` and
  screenshot key combos → `POST /log`.
- Server: `maxViolations` reached → set attempt `suspended`; screenshot event (if
  `screenshotSuspend`) → instant `suspended`. **Server decides suspension**, client only reports.
- Offline: keep `localStorage` backup of answers, flush on reconnect (same as exam-taker).

## 8. Admin UX (LMS admin — Next.js)

- New **"Exams"** nav item (admins + managers), org-scoped.
- Per course: build/edit the exam + question bank (mcq/tf/short/essay, marks, order).
- Attempts table: student · status · score · submitted-at, with a **Grade** action.
- Grading page: activity log panel + per-question (student answer → marks input + feedback) → save.

---

## 9. Files to add / change (nothing deleted)

**Backend (`lms/backend`)**
- `src/models/schema.ts` — `ExamModel`, `ExamAttemptModel`, `ExamLogModel` (+ indexes).
- `src/services/exam.service.ts` — new (start/status/answer/submit/log/grade, server timer, org scope).
- `src/routes/*` — student `exam.routes.ts` + admin exam routes in `admin.routes.ts`; mount in `routes/index.ts`.
- zod validators; reuse `authenticate`, `requireEnrollmentApproval`, `requireAnyAdmin`.

**Admin (`lms/admin`)**
- `src/lib/api/exams.ts` (hooks), `app/(dashboard)/exams/…` pages, sidebar entry.

**Client (`lms/client`)**
- `src/lib/api/exam.ts`, `app/(dashboard)/exam/[courseId]/…` (rules → take → result), `ExamTimer`, guards.

## 10. Open decisions — need your call before I build

1. **New `Exam` feature vs. extend the existing `Quiz`.** I recommend **new** (proctored exam ≠ per-lesson quiz). Extending Quiz would entangle two very different tools.
2. **Exam scope**: one exam **per course** (recommended, like the single exam-taker exam) — or per lesson/module, or multiple exams per course?
3. **Duration**: keep the exam-taker's fixed style, but **per-exam configurable** (default 70 min) — OK?
4. **Anti-cheat strength**: port all of it (copy-paste block, tab-switch auto-suspend at N, screenshot→suspend), or a softer "log-only, don't auto-suspend" mode you can toggle per exam?
5. **Question types**: add **essay + short-text manual grading** (exam-taker has them; LMS quiz doesn't). Confirm.
6. **Who/where**: all courses & both orgs (Dubai + Bangalore), or start with specific courses?
7. **Retakes/reset**: allow admin to reset an attempt (retake / lift suspension)? (Recommended yes.)

## 11. Suggested build order (phased, each testable)

- **A** — Backend models + student exam API (start/status/answer/submit, server timer, one-attempt).
- **B** — Admin: exam + question-bank CRUD API & pages.
- **C** — Client: take-exam UI (rules → timer → locked progression → submit → result).
- **D** — Anti-cheat: client guards + `/log` + server auto-suspend + activity-log view.
- **E** — Grading: per-question manual marks + feedback; result page shows graded feedback.

---

*Reply with the §10 decisions (or "go with your recommendations") and I'll start at Phase A.*
