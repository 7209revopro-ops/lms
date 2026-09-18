# Cross-academy classes — implementation plan

**Scope: one live class serving two academies' students, where each academy keeps
its own course.** This is the plan `docs/cross-org-instructor-plan.md` deferred
under "Why classes are not in this plan", and the decision `docs/work-status.md`
§5 has been waiting on.

---

## Implementation status

| Phase | State | Commit |
|---|---|---|
| 0 — resolve the caller's academy | **done** | `18f8128` |
| 1 — extract the entitlement predicate | **done** | `18f8128` |
| 2 — schema and authoring, inert | **done** | `6e11c41` |
| 3 — seats | **done** | |
| 4 — roster, homework and attendance split | **done** | |
| 5 — mail clocks | **done** | |
| 6a — narrow the browse feed, alone | not started | |
| 6b — open it | not started | |

Guest cohorts are read only when `CROSS_ORG_CLASSES=true`, and it is off. A
cohort can be authored today and no guest student can book, see or enter the
class. That is phase 2's contract, and `backend/src/tests/crossorgclass.suite.ts`
pins it — including the case that matters most: a Bangalore student correctly
enrolled in the Bangalore course, on a class that names their cohort, is still
refused while the flag is off.

Phase 2 also closed a hole that predates this work. `create()` and `update()`
validated only that `sectionId` PARSED, so a class could be gated to a module of
a **different** course — an id that appears in nobody's `blockedLessons` for the
class's own course, so the module gate silently never fired. A design keyed on
(course, module) pairs cannot inherit that, so it is fixed for the host pair as
well as for every guest cohort.

**Not built in phase 2, and needed before the feature can be authored by a
human:** the admin route and its Zod schema do not accept `guestCohorts`, so a
cohort can only be created through the service layer. The admin form listed
under phase 2 in this plan has not been built either. Neither blocks phase 3.

**Phase 3 landed with its three riders**, which were the parts most likely to be
dropped. Seat counters are now moved only by `services/seatPool.service.ts`, and
`bun run check:seats` fails the build on any other `$inc` against them. Deleting
a user now deletes their bookings and returns the seats; before this it left the
rows behind and the seat was consumed forever.

`backend/src/scripts/reconcile-class-seats.ts` was run dry against the local
database and found **4 drifted classes out of 94** — two overcounting, two
undercounting. That is the backlog the cascade leak created, visible for the
first time. It has NOT been applied anywhere.

**Phase 4 landed, and it found one thing the plan did not anticipate.** The
narrowing had to distinguish a class the caller OWNS from one they are merely a
guest on. An UNSTAMPED seat means "the host's door" — which is every booking
that exists today — so matching it unconditionally would have shown a guest
academy the host's entire legacy roster. It is matched only on classes the
caller owns.

One asymmetry is now explicit and tested. The host keeps AUTHORITY over seats in
the room it owns, because it can cancel the class out from under both cohorts
and withholding authority over a single seat would be a fiction. What it does
not get is the guest academy's student LIST. Authority over the room, no
visibility of the other academy's people.

**Phase 5 landed both steps.** There are now zero hard-coded zone strings in
email.service.ts, and every class mail prints its zone — GST or IST — whether or
not anything else is threaded through. That was step 1 and it protects every
recipient on its own: a labelled wrong time is a question, an unlabelled one is
a missed class.

Step 2 threads the reader. Two rules, and the split is deliberate:

- **Students** read their OWN academy's clock. They booked through their own
  academy's course and think in its terms.
- **Staff** read the CLASS's academy clock, because that is what the admin panel
  already shows them for the same class. An instructor comparing the panel
  against their inbox must not find two different times.

Both are labelled, so neither misleads even where the choice is arguable.

One defect fixed in passing that had already reached real students: an invalid
date rendered as the literal text "Invalid Date at Invalid Date". Every
formatter now answers with a dash, which is obviously missing rather than
confidently wrong, and the suite pins it for five kinds of bad input.

**Phase 6a is next**, and it ships alone on purpose: it takes something away
from students with no stake in this feature, and this repo has already lived
through a support wave from live classes appearing to vanish.
---

## The answer

**Yes, it is possible, and the best method is one class document with a guest
list.** Keep exactly one `LiveClass` — one room, one Meet link, one attendance
set — and add to it an array of **guest cohorts**, where each entry names one
visiting academy, *that academy's own course*, *that course's own module*, and
that academy's seat floor. The Dubai class stays owned by Dubai. Bangalore is
named on its guest list with the Bangalore Digital Marketing course and the
Bangalore module-2 section id. A Bangalore student who bought that module then
sees the class **on their own Bangalore course page**, books it against
Bangalore's seat floor, and walks into the same room as the Dubai cohort.

Nothing is shared except the room. Each academy keeps selling, owning, pricing
and reporting on its own course, and — this is the part every simpler approach
gets wrong — **each academy's module blocking keeps working**, because the class
tests a Bangalore student against a *Bangalore* section id.

The cost is real and is stated in full below. The short version: the guest
academy is a passenger (it cannot edit, move or cancel the class), somebody must
pick the twin module by hand every time and nothing can catch a wrong pick, and
six phases of invisible work come before the one that answers the question.

---

## Why the other approaches lose

### The three options recorded in `work-status.md` §5

**(a) Share the course too.** Contradicts the premise. `Course.slug` is
`unique: true`, so there is one catalogue row; the student catalogue is scoped to
the student's own academy (`course.controller.ts`); pricing is per-course
`priceAED`/`priceINR`, not per-academy; and `enrolledCount`, progress and
certificates would all land on one academy's course. You said explicitly that
each academy keeps selling and owning its own. This answers a different question.

**(b) Auto-enrol on booking.** Worse than "pollutes their records". It requires
punching through a live tenancy guard — `enrollment.service.ts:44-53` throws 403
*"This course belongs to another organization"* — and it writes a real
`Enrollment` row that immediately feeds My Learning, `progressPercent`,
`certificateId`, `Course.enrolledCount` and every org-scoped report in the wrong
academy. Fatally, the synthetic row has an **empty `blockedLessons`**, so the
Bangalore admin's module blocks are not bypassed, they are **erased**. It breaks
the exact gate you are scoping the class by.

**(c) Shared classes carry no course.** Recorded as the smallest change. It is
not a change, it is a schema weakening — `courseId` is `required: true`
(`schema.ts:945`). And the `if (session.courseId)` guard it relies on
(`bookings.routes.ts:170`) also guards the module gate two lines later, because
that gate is written `if (enrollment && session.sectionId)`. A course-less class
is not gate-free-but-safe, it is **ungated**. It additionally breaks
`getWatchAccess`, the admin-observer programme check, `#notifyEnrolledStudents`
and `ClassAssignment` submission outright (`courseId` required, copied from the
session) — a Mongoose validation error surfacing days later, to a student, with
no obvious cause.

### The three that come up in design review

**Mirror the class — two rows, one per academy, linked by a tag.** The closest
competitor, and genuinely tempting: no entitlement change, each academy owns its
row, roster and clock, every existing gate keeps working. It loses on **the
room**, which is the thing actually being asked for. `roomNameFor(liveClassId)`
derives `lms-<id>`, so two rows are two LiveKit rooms and the cohorts never meet.
Force a shared `cltRoomName` and `cltWebhook.service.ts` does
`findOne({ cltRoomName })` against a **sparse, non-unique** index — attendance
marks, `cltRecordingId`, `startedAt`/`endedAt` and `viewerCount` all land on
whichever row Mongo returns first, and the other academy's roster shows nobody
attended. Google Meet is minted once per document, so it is two links, and a
rate-limited second call is a hard 503 that leaves one academy with a class and
the other without. Two rows also means two `{userId, liveClassId}` unique index
slots — one person, two seats, one room. And the student booking screen groups
cards by title+instructor+course+module
(`client/src/app/(dashboard)/class-bookings/page.tsx` ~1484), so "one class"
renders as two cards.

**Pluralise `courseId` to `courseIds[]`.** 60 distinct read/write sites across 11
backend source files, 4 scripts, the test suites, 12 admin files and 6 client
files. `liveClass.repository.ts` alone has 9 query sites treating it as a scalar.
And after all that it still does not answer the module gate: you would need a
parallel `sectionIds[]` with an implicit positional contract between two arrays
that nothing validates. That is a guest list with worse ergonomics and nowhere to
hang a seat floor.

**A `sharedAcrossOrgs`-style boolean on `LiveClass`.** The shipped instructor
precedent, and the one place the analogy breaks. An instructor has no students,
no seats and no money behind them, so a boolean saying "lent" is complete. A
class must say *which* course the guest cohort holds and *which* of its modules
gates entry. Widen on a boolean and the enrolment lookup still queries the single
`courseId` — `NOT_ENROLLED` for the entire second cohort — and if you widen that
too, the module gate compares a Dubai section id against a Bangalore enrolment's
Bangalore section ids, which can never match. **Module blocking then fails OPEN,
silently, at seven sites.** It also inherits the debt the instructor plan already
records: the day a third academy opens, `true` silently means "all three".

---

## The design rule everything follows

The instructor plan's rule still holds and is not restated. This plan adds one
more, and it is the whole feature in a sentence:

> **A student is admitted through a door, and every question is asked of that
> door.** A door is the triple *(academy, course, module)*. The class's own
> `courseId`/`sectionId`/`organizationId` are the host's door. Each guest cohort
> is another door. Entitlement never compares a value from one door against a
> value from another — which is precisely how a Dubai section id ends up tested
> against a Bangalore enrolment and module blocking fails open.

And the corollary that keeps it safe:

> **Sharing widens reads. It never widens writes.** `callerMayAccess`,
> `requireSameOrgUser`, `LiveClassController.#canManage` and
> `callerMayManageSession` are not touched. Editing, rescheduling, cancelling and
> deleting a shared class stay with the owning academy. The one write carve-out
> is per-*seat*, not per-class, and is narrowed three independent ways — the
> `requireSameOrgUser` carve-out template.

---

## Data model

Everything is **additive**. No existing field changes type, nullability or
meaning. `courseId` stays `required: true`. `organizationId` still names the
**owner** and stays non-patchable — that immutability is load-bearing and must
not be relaxed.

### `LiveClassSchema` — three new fields

```ts
const GuestCohortSchema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
  courseId:       { type: Schema.Types.ObjectId, ref: 'Course',       required: true },
  sectionId:      { type: Schema.Types.ObjectId, ref: 'Section' },
  seatFloor:      { type: Number, required: true, min: 0, max: 500 },  // what this academy was promised
  seatsLeft:      { type: Number, required: true, min: 0 },            // COUNTDOWN — see Seats
}, { _id: false })

// on LiveClassSchema:
guestCohorts:      { type: [GuestCohortSchema], default: [] },
hostSeatsLeft:     { type: Number, min: 0 },   // undefined ⇒ no allocation in force
overflowSeatsLeft: { type: Number, min: 0 },   // undefined ⇒ no allocation in force
```

```ts
LiveClassSchema.index({ 'guestCohorts.organizationId': 1, scheduledStart: 1 })
LiveClassSchema.index({ 'guestCohorts.courseId': 1, scheduledStart: 1 })
```

**There is no mirror.** The host's door is read from the singular fields; it is
never copied into the array. This is the single most important shape decision in
the plan, and it is why this design was chosen over three others that all put the
host in the array and kept the singular fields in sync with a `pre('validate')`
hook. `update()` writes through `this.liveRepo.updateByIdPopulated(id, patch)` —
verified — and **`findByIdAndUpdate` does not run document validators**. A mirror
held together by a hook that never fires on the edit path is a mirror that drifts,
and the symptom of drift is the booking answer disagreeing with the join answer.
Here that state is not merely invalid, it is unrepresentable.

`undefined` on `hostSeatsLeft` is the explicit signal *"no allocation in force"*.
Every one of the thousands of existing classes carries it, and the seat helper
then executes today's exact single-statement CAS. That is the back-compat story
and it needs no migration at all.

### `ClassBookingSchema` — three new fields

```ts
seatOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization', index: true },
seatCourseId:       { type: Schema.Types.ObjectId, ref: 'Course' },
seatSectionId:      { type: Schema.Types.ObjectId, ref: 'Section' },
```

The whole door, stamped at booking time in **all four** booking paths. Not
`required` — absent reads as "the class's host door", so the roster filter and
the release path are correct on day one with no backfill.

Three fields, not one. A seat-organization stamp alone is not enough:
`classAssignment.service.ts:110-116` copies `courseId` **and** `sectionId` from
the session, so a Bangalore student's homework would be filed against the *Dubai*
course with the *Dubai* section — and `ClassAssignment.courseId` is `required`.
The same three fields are what let the DTO label a card in the caller's own
catalogue language (see Discovery), and what make per-cohort reporting answerable
without a join.

The existing `{userId, liveClassId}` unique index is already correct for one class
serving two cohorts — one person, one seat, one room — and is left exactly as it
is.

### Validation, in two places, because one is not enough

**Schema `pre('validate')`** — the `sharedAcrossOrgs` precedent
(`schema.ts:284-286`), the check that cannot be forgotten at a new call site:

- a cohort's `organizationId` must not equal the class's own;
- cohort `organizationId`s must be distinct;
- **if the class has a `sectionId`, every guest cohort must have one too** —
  otherwise an admin silently opens the class to the guest academy's entire
  course while the host cohort is gated to one module;
- if `guestCohorts.length > 0`, `hostSeatsLeft` and `overflowSeatsLeft` must both
  be numbers;
- `hostSeatsLeft + Σ seatsLeft + overflowSeatsLeft + bookedCount === sessionCapacity`.

**Service layer** — because the hook above does not run on the edit path, and
because these need lookups. New `#assertCohortsUsable(cohorts, classOrgId)` in
`liveClass.service.ts`, modelled line-for-line on `#assertInstructorUsable`
including **tenancy before role**, so error codes cannot enumerate the other
academy's ids. Per cohort: the Organization exists; `course.organizationId ===
cohort.organizationId`; `section.courseId === cohort.courseId`.

**Applied to the host pair too.** `liveClass.service.ts:346-348` and `:759-761`
validate only `Types.ObjectId.isValid`, so a class can already point at a foreign
course's section — which is exactly why `#studentsAtModule` needs its defensive
`targetIdx === -1` branch. A design keyed on *(course, section)* pairs cannot
inherit that hole, and the fix is four lines while we are in the file.

The seat invariant is likewise asserted **in `seatPool.service.ts` on every
allocation change and in the service-layer update guard**, not only in the hook.
Treating a document validator as the enforcement point for a counter invariant
would be a silent-corruption bug on the first capacity edit.

---

## The booking and join predicate

This is the crux. It is extracted **before** anything is widened, because the
enrolment-plus-module question is hand-written in eight places today and there is
no shared helper — and `tenancy.ts`'s own header records that the same rule copied
four times grew four bugs, one of which exposed passport scans.

New file `backend/src/services/classEntitlement.service.ts`:

```ts
export interface Door {
  organizationId: string
  courseId:       string
  sectionId:      string | null
  isHost:         boolean
}

export type EntitlementCode = 'WRONG_ACADEMY' | 'NOT_ENROLLED' | 'MODULE_BLOCKED'

export interface Entitlement {
  ok:         boolean
  code?:      EntitlementCode
  door?:      Door                              // the seat pool, the roster owner, the labels
  enrolment?: { _id: unknown; blockedLessons: unknown[] }
}

export async function resolveClassEntitlement(
  live:      Pick<ILiveClass,'organizationId'|'courseId'|'sectionId'|'guestCohorts'>,
  userId:    string,
  callerOrg: string | null,                     // from resolveCallerOrg — never read blind
  statuses:  'active' | 'notDropped',
): Promise<Entitlement>
```

**The algorithm, exactly.**

1. `DOORS = [hostDoorFrom(live), ...live.guestCohorts]`. For every class in the
   database today this list has length 1, which is what makes Phase 1 a pure
   refactor.
2. **Academy.** Pick the door whose `organizationId` equals `callerOrg`. If
   `callerOrg` is `null` — tenancy rule 3b, *exists, no academy on record* — try
   the host door first, then each guest door, and take the first that yields an
   enrolment. `ACCOUNT_GONE` is handled by the caller via `callerIsGone()`
   **before** this runs; collapsing the two is P-18. If the class itself carries
   no `organizationId` (rule 2, legacy row), the host door matches anyone.
3. No door matches → `WRONG_ACADEMY`. For a class with no cohorts this is
   byte-identical to today's `String(live.organizationId) !== String(ctx.organizationId)`
   at `liveClassJoin.service.ts:311`, **including its falsy semantics** — that
   comparison is guarded on `live.organizationId && ctx.organizationId` and the
   guard must be preserved verbatim.
4. **Enrolment.** `EnrollmentModel.findOne({ userId, courseId: door.courseId,
   status: statuses === 'active' ? 'active' : { $ne: 'dropped' } })` →
   `NOT_ENROLLED` if none.
5. **Module — the point of the whole design.** Compare `door.sectionId` against
   *that enrolment's* `blockedLessons`.

### Why the module gate works, stated as an invariant

`blockedLessons` stores **section ids** (legacy misnomer, documented in
`CLAUDE.md`). The gate is a set-membership test, and a set-membership test is
only meaningful when both sides live in the same namespace.

> **Both sides of the comparison always come from the same course.**
> `door.sectionId` is a Section of `door.courseId`, asserted by
> `#assertCohortsUsable`. `enrolment.blockedLessons` holds Section ids of
> `door.courseId`, because the enrolment was found by `courseId: door.courseId`.

So a Bangalore student is tested against the **Bangalore module-2 section id**,
which is exactly what a Bangalore admin writes into `blockedLessons` when they
revoke that student's module 2. The revocation matches, and it bites.

The failure this prevents is the one every cheaper design ships. Widen only the
enrolment lookup — a boolean flag, or an auto-enrolment — and step 5 compares a
**Dubai** section id against a **Bangalore** enrolment's blocked list. Those ids
can never be equal. `blocked.includes(...)` returns `false` for every blocked
student, `MODULE_BLOCKED` never fires, and **the gate fails open for the entire
visiting cohort, at seven independent sites, with nothing in the logs**. The
Bangalore admin who revoked module 2 watches that student walk into the class.

### The status predicate stays a parameter

Booking demands `status: 'active'` (`bookings.routes.ts:174`). Join, watch, the
schedule list and the upcoming feed all accept `$ne: 'dropped'`. So a `completed`
enrolment can see and join but not book a new seat. That is a real, live
inconsistency and it is **preserved deliberately**: `POST /bookings` and
book-for-student pass `'active'`, the other six pass `'notDropped'`. Unifying it
would change behaviour for every existing single-academy student with a completed
enrolment, in a phase whose value proposition is "nothing changed". It is now
written down in one file with a comment naming the disagreement, and fixing it is
a separate decision. This is the `StudentJoinWindow` convention: only the thing
that genuinely differs becomes a parameter.

### The eight call sites

| # | Site | Statuses |
|---|---|---|
| 1 | `bookings.routes.ts:170-188` — `POST /bookings` | `active` |
| 2 | `admin.routes.ts:1430-1448` — book-for-student (**the student's** academy, not the admin's) | `active` |
| 3 | `liveClassJoin.service.ts:311-352` — `assertStudentMayJoin` (covers Meet **and** LiveKit) | `notDropped` |
| 4 | `liveClass.service.ts:536-553` — `getWatchAccess` | `notDropped` |
| 5 | `liveClasses.routes.ts:365-374` — `hasSessionAccess` (homework) | `notDropped` |
| 6 | `liveClasses.routes.ts:76-86, :120-126` — `isEnrolled`/`isEntitled` | `notDropped`, batched |
| 7 | `liveClass.service.ts:103-113, :141-143` — `listUpcomingForUser` | `notDropped`, batched |
| 8 | `liveClass.service.ts:61-88` — `listForCourseSlug` | `notDropped`, batched |

Sites 6-8 are lists and must not run one resolver call per row. They get a batch
sibling `annotateEntitlements(classes, userId, callerOrg, statuses)` that loads
the caller's enrolments once — which is exactly what they do today — and applies
steps 2-5 in memory. Same logic, one implementation, no N+1.

`assertStudentMayJoin` keeps its ordering contract byte-for-byte: account →
approval → resolver (permanent refusals) → booking → **time window last**, as 425
with `Retry-After`. `assertAdminMayObserve` (`:167-170`) gains the same door test:
an admin of any **serving** academy may observe.

`requireEnrollmentApproval` stays on every booking path. Approval is granted per
academy by that academy's own admins, and this feature does not change who
approves whom. A Bangalore student whose Bangalore approval is pending is refused
by Bangalore's own rule, before any of this runs.

---

## Seats

A guaranteed **floor** per academy, plus a **common overflow**. No cron, no
release job, no reconciliation dependency on a validator.

Counters are **remaining** seats, counted **down**. That is the trick that keeps
the whole thing atomic: a countdown compares against a literal, so the per-cohort
condition fits inside `$elemMatch` — where `$expr` is illegal — and the entire
reservation stays one `updateOne` against one document.

**Invariant:** `hostSeatsLeft + Σ guestCohorts[].seatsLeft + overflowSeatsLeft +
bookedCount === sessionCapacity`.

```js
// host student
updateOne({ _id, hostSeatsLeft: { $gt: 0 },
            $expr: { $lt: ['$bookedCount','$sessionCapacity'] } },
          { $inc: { bookedCount: 1, hostSeatsLeft: -1 } })

// guest student of academy X
updateOne({ _id,
            guestCohorts: { $elemMatch: { organizationId: X, seatsLeft: { $gt: 0 } } },
            $expr: { $lt: ['$bookedCount','$sessionCapacity'] } },
          { $inc: { bookedCount: 1, 'guestCohorts.$[c].seatsLeft': -1 } },
          { arrayFilters: [{ 'c.organizationId': X }] })

// overflow — either academy, only if the above matched nothing
updateOne({ _id, overflowSeatsLeft: { $gt: 0 },
            $expr: { $lt: ['$bookedCount','$sessionCapacity'] } },
          { $inc: { bookedCount: 1, overflowSeatsLeft: -1 } })
```

Two attempts at most, each atomic on its own. A failed CAS writes nothing, so
there is no torn intermediate state and no transaction. The existing `$expr` cap
stays in **every** filter as the global backstop, so even a corrupted allocation
can never oversell the room. The helper returns which pool it drew from, and the
caller stamps the booking with it.

Release is the mirror, floor-guarded, incrementing the pool named by the booking
row's `seatOrganizationId` — which is exactly why that stamp has to exist. The
pool is read from the booking, **never re-derived**: a student's entitlement can
change between booking and cancelling, and a re-derived door returns the seat to
the wrong academy.

This was chosen over the alternative formulations for readability. The competing
designs reached for `$let`/`$filter`/`$reduce` inside `$expr` on the hottest write
in the booking path; one of them conceded in its own review that "nobody will
review it confidently". An unreviewable predicate guarding seat accounting is a
liability, not a neutral cost.

### Back-compat and blast radius

Both are wrapped in `reserveSeat(liveClassId, poolOrgId)` / `releaseSeat(booking)`
in a new `backend/src/services/seatPool.service.ts`. **When `hostSeatsLeft` is
`undefined` — every existing class — the helper runs today's exact statement,
unchanged.** The allocation path only ever executes for a class an admin
deliberately gave cohorts.

**There are twelve sites, not ten** (the count in the brief was wrong; verified by
grep):

- **Reserve (4):** `bookings.routes.ts:225`, `:265`; `admin.routes.ts:1468`, `:1501`
- **Release (8):** `bookings.routes.ts:247`, `:252`, `:281`, `:379`;
  `admin.routes.ts:1484`, `:1489`, `:1517`, `:2305`

Miss one and a seat leaks from one academy's floor with nothing to reconcile it.
The helper must be the **only** way to touch `bookedCount`: enforce it with a
CI grep that fails on any raw `$inc: { bookedCount`, and with a test that asserts
the invariant after a randomised book/cancel storm across both cohorts
(`backend/src/tests/joinclass.concurrency.suite.ts` is the existing harness).

### Three riders the allocation forces

1. **`cascadeUserDeletion`** (`services/userCascade.ts`) deletes Enrollment,
   LessonProgress, AuthToken, Review and Device rows but **not `ClassBooking`**,
   and never decrements `bookedCount` — verified. Today that permanently consumes
   one flat seat. With floors it permanently consumes one **academy's** seat. Add
   booking deletion plus `releaseSeat` to the cascade in the same phase.
2. **A reconciler.** New `backend/src/scripts/reconcile-class-seats.ts`,
   idempotent, on demand: recompute `bookedCount` from
   `countDocuments({ liveClassId, status: { $in: ['booked','attended'] } })` and
   re-derive the pools from the floors. This is the first time the denormalised
   counter is ever checked against reality, and it is not optional — expect a
   handful of drifted rows from the deleted-user leak.
3. **Capacity edits.** Lowering `sessionCapacity` or a floor below what is already
   taken must be refused. A capacity **raise** on a cohort-bearing class goes to
   overflow. And `sessionCapacity` still disagrees between Zod (max 10000,
   `admin.routes.ts:1329`) and Mongoose (max 500, `schema.ts:978`) — drop the Zod
   max to 500. The `LIVEKIT_MAX_PARTICIPANTS` ceiling is checked only at create
   (`liveClass.service.ts:288-298`); re-check it in `update()` once cohorts can
   raise the total.

**Why no timed release of unclaimed floor seats.** Booking closes at
`start − 1h` absolute, so a release job has exactly one hour of dead time, and
releasing after the cut-off advertises capacity nobody can book. The overflow pool
buys the same thing with no cron and no clock.

---

## Discovery — and the brief's premise was half wrong

Only **one** student-facing list is org-scoped today. `GET /live-classes/upcoming`
has no `organizationId` term at all (`liveClass.repository.ts:35-50`, verified),
so a Bangalore DM student **already** sees every Dubai DM class in their browse
feed, annotated "Purchase to join", because `categoryFilter` narrows on
`Course.program` — the same string in both academies. So part of this job is
closing a leak, not only opening a door.

One new read-side predicate, in the file the precedent lives in, with the same
header discipline:

```ts
/* servedClassFilter(callerOrg)
   THIS ANSWERS "MAY YOU SEE AND USE", NEVER "MAY YOU CHANGE".
   Before a write you want callerMayAccess() / callerMayManageSession().
   COMPOSE UNDER $and via andFilter(). */
export function servedClassFilter(callerOrg: string | null | undefined) {
  if (!callerOrg || !Types.ObjectId.isValid(callerOrg)) return null
  const oid = new Types.ObjectId(callerOrg)
  return { $or: [{ organizationId: oid }, { 'guestCohorts.organizationId': oid }] }
}
```

**Always attached with `andFilter()`, never by assigning `$or`.** Mandatory, not
stylistic: `liveClass.repository.ts:88/:97` assign `query.$or` for the live/ended
status buckets and `admin.routes.ts:2085` assigns `filter.$or` for roster search.
A second `$or` assignment silently deletes them — that is the P-04 shape, twice.

| Surface | Today | Change |
|---|---|---|
| **`GET /courses/:slug/live-classes`** — the course page | `listForCourse` matches `{ courseId }` as a bare scalar | **WIDEN** to `{ $or: [{ courseId }, { 'guestCohorts.courseId': courseId }] }` |
| **`GET /live-classes`** — the booking page | hard-narrowed to the caller's academy | **WIDEN** with `andFilter(lcOrgFilter, servedClassFilter(callerOrg))` |
| **`GET /live-classes/upcoming`** — the browse feed | **no org term at all** | **NARROW** with the same clause |
| **`GET /live-classes/:id/watch`** | no org logic at all | no discovery change; the resolver gates it — which **adds** a `WRONG_ACADEMY` refusal that does not exist today |

### The course page is the primary surface

This is a graft, and it is the fix for the winning design's one real product
weakness. As written, it declined to widen the course-page list on the grounds
that "the resolver gates them", which is true and beside the point: the Bangalore
student's own Bangalore Digital Marketing course page would never list the class
at all, because `listForCourse` matches the Dubai course id. Their only route in
would be the generic booking list — and that screen builds its card labels from
the populated `course.title` and `sectionId.title`, which are the **host's**
(verified at `class-bookings/page.tsx:1489-1492`). A Bangalore student who bought
the Bangalore course would be shown a card reading *"Digital Marketing (Dubai) —
Module 2"*.

So the promise is explicit, and it is a product commitment, not a query change:

> **A guest student reaches the class through their own course, and never sees
> the host academy's course or module name.**

Which means the DTO must resolve `courseTitle` and `moduleTitle` **from the
caller's matched door**, not from the populated host fields. For a student caller
the DTO carries `yourCohort: { organizationSlug, courseId, courseTitle,
sectionTitle, seatsLeft } | null`, and the client card reads those when present.

### The rest of the DTO

`liveClass.controller.ts:113-116` keeps `organizationId` + `organizationSlug`
meaning **the owner** — do not make it undefined. `zoneOf()` falls back to the
*viewer's* zone on an unknown slug, which is the silent bug `orgSlugs.ts` was
written to stop, and there are 16 render sites. Add beside it, resolved through
`orgSlugFor` and **never** `.populate('organizationId')` (populating turns
`String(live.organizationId)` into `"[object Object]"` and five tenancy
comparisons silently stop matching — `orgSlugs.ts:19-24` spells this out):

- `servingOrganizationSlugs: string[]`
- `guestCohorts: [{ organizationSlug, courseId, courseTitle, seatFloor, seatsLeft }]` (staff only)
- `yourCohort` (student only, as above)

`ENTITLED_ONLY_FIELDS`/`STAFF_ONLY_FIELDS` stripping (`liveClasses.routes.ts:135-142`)
is unchanged and still governs the join fields. `meetingUrl` still never leaves
the server except through `POST /:id/join`.

### Being told it exists

`#notifyEnrolledStudents` (`liveClass.service.ts:926-931`) mails only
`{ courseId: live.courseId }`, capped at `.limit(200)`. Correct discovery, correct
booking and correct joining still yield **zero Bangalore attendees**, because
nobody tells them.

Fan out **per door**: one roster query per door, and `#studentsAtModule(door.courseId,
door.sectionId, ids)` per door. That helper resolves module position *within one
course* via `sections.findIndex` and returns empty for a foreign section
(`targetIdx === -1`), so per-door is the only call that can work. `.limit(200)`
per door, with a `log.warn` when it truncates — today that truncation is silent
and a doubled roster hits it twice as often.

---

## Attendance, roster, homework, mail, clocks, and the room

### Roster — each academy administers its own seats

`buildBookingFilter` (`admin.routes.ts:1962-2092`) is "the ONE place the bookings
scope is computed" and stays that way. **Two edits inside it:**

**(a) Widen the class set** with `andFilter(lcFilter, servedClassFilter(callerOrg))`,
so a Bangalore admin can reach the shared class at all.

**(b) Narrow the booking rows** to `seatOrganizationId === callerOrg` for every
non-super-admin — **including the owner**. On a shared class a Dubai admin sees
only Dubai seats.

Without (b) this feature reintroduces N-07/P-04 verbatim: the booking query has no
org term today, it populates `name email avatarUrl`, and it feeds the list, the
stats strip **and** the CSV export. One shared class would put every Bangalore
student's name and email into Dubai's roster and download in a single request.
(b) is strictly narrower than today and a no-op on existing data, because no
foreign student can currently hold a seat.

Exception: the **instructor the session names** already sees the whole room, via
the existing `instructorOwnsSession` rule — assignment is narrower than the
academy. That is one person per class, it is necessary for somebody to actually
run it, and it is the only cross-academy PII flow this plan accepts. It is a
judgement call rather than a derivation, and it is on the owner's decision list.

### Writes — the read/write split holds

`callerMayAccess`, `requireSameOrgUser`, `#canManage` and `callerMayManageSession`
are **not touched**. Editing, rescheduling, cancelling, re-provisioning the room
and deleting a shared class stay owner-only, answering 404 across the wall.

One new, narrower sibling:

```ts
callerMayManageSeat(req, live, booking) =
  callerMayManageSession(req, live)
  || (classServesOrg(live, callerOrg) && String(booking.seatOrganizationId) === callerOrg)
```

Wired into **three routes only**: `PATCH /admin/bookings/:id/attendance` (`:2288`),
`/bulk-attendance` (`:2397`) and `/:id/cancel` (`:2434`). Narrow in three
independent ways — the class must name the caller's academy as a cohort, the seat
stamp must match, and everything else routes through the untouched funnels.

**Bulk-attendance has a specific trap.** It memoises one manage-decision for the
whole roster (`:2393-2397`). Under a split roster that hands one academy the
other's rows. It must memoise **per seat-organization**, not per session.

### Attendance data — untouched

One document, one `cltRoomName`, one webhook target. The LiveKit writer
(`cltWebhook.service.ts:107-130`, sets `attendedAt` + source, leaves status
`booked`) and the admin writer (sets `status: 'attended'`, never touches
`attendedAt`) behave exactly as today. They already disagree about which field
means "attended"; any per-cohort report must define it as
`status === 'attended' || attendedAt != null` and say so in a comment. This plan
neither fixes nor worsens that.

### Homework

`classAssignment.service.ts:113-116` stamps `organizationId`, `courseId` and
`sectionId` from the **session**. On a shared class that files a Bangalore
student's submitted work — title, note, uploaded files — into Dubai's review
queue, invisible to Bangalore staff, and against the wrong course. Stamp all
three from `booking.seatOrganizationId/seatCourseId/seatSectionId`, falling back
to the session's when absent. `#reach` (`:186-199`) then scopes correctly for
free, and the output is identical for every non-shared class.

### Mail — the only student-facing clock still lying

The app is already correct: `client/src/lib/timezone.ts` uses the **device** zone
deliberately, and the old Dubai monkey-patch must not come back.

Mail is not. Thirteen hard-coded `timeZone: 'Asia/Dubai'` strings in
`email.service.ts` plus six sites that pass no zone and inherit `process.env.TZ`,
with **no zone label anywhere**. A Bangalore student booked into a shared class
reads 18:00 in-app and 16:30 in every confirmation and reminder. Ninety minutes,
unlabelled. That is a missed class, not a cosmetic bug.

Two steps:

1. **Cheap and global — print the zone abbreviation on every class mail.** This
   kills the silent lie immediately, for everyone, whether or not the rest lands.
2. **Render class mail in the recipient's academy zone**, resolved from a small
   backend zone map beside `orgSlugs.ts`, for the booking confirmation, the five
   reminders, and critical/cancel mail. Default `Asia/Dubai`, so single-academy
   output is bit-identical.

**Format at the leaf; pass `Date` objects, never pre-formatted strings, across
those argument boundaries.** `sendCancelledNotification` types its argument
`Date | string` and re-parses with `new Date()` (`email.service.ts:1239`), and a
localised label already shipped as *"Invalid Date at Invalid Date"*
(`admin.routes.ts:2338-2345`).

### Timezone, stated per audience

| Audience | Zone | Work |
|---|---|---|
| Student, in-app | their device zone | none — already shipped |
| Admin | the **owner** academy's zone for the whole row, with the existing yellow foreign-zone tag, plus a new **"serves Dubai + Bangalore"** chip and a secondary **"also 09:00 Bangalore"** line on any multi-cohort class | small |
| Mail | the **recipient's** academy zone, always labelled | Phase 5 |

One class, one wall clock in the panel, explicitly labelled — chosen over
per-viewer rendering so `organizationSlug` stays defined and none of the 16
`zoneOf()` sites silently falls back. The "also 09:00 Bangalore" line is grafted
from a competing design and earns its place: it is the single cheapest thing that
stops two academies' staff mis-communicating about the same session.

**Job day-boundaries stay server-local** (digest 18:00, day-of reminders 07:00,
`setHours(0,0,0,0)`). A shared class is the first time two cohorts read the same
class from two different local days, so "today/tomorrow" wording is now wrong for
one side. Known residual, listed under sharp edges.

**Do not touch the three gates.** `bookingClosesAt` (start − 1h), the Meet window
(start … start + grace) and the LiveKit window (start − 15m … end + 15m) are
absolute UTC instants and the 15-minute anchor deliberately matches CLT's.
"Fixing timezones" there desynchronises CLT.

### The room — nothing to do, and that is the strongest argument for this shape

One `LiveClass` document means one Google Meet event, one `meetingUrl`, one Mux
stream, one `cltRoomName = lms-<id>`, one webhook resolution, one attendance set,
one `{userId, liveClassId}` unique index. Both cohorts are in the same room
because there is only one room. Nothing in the CLT, Mux or Meet integration
changes.

One rider: re-check `LIVEKIT_MAX_PARTICIPANTS` in `update()` once cohorts can push
capacity past the create-time check, so the refusal reaches the admin rather than
the 51st student.

---

## Phases

Each is independently shippable and revertible. **Nothing is visible to any user
until Phase 6**, with one deliberate exception (6a) explained there.

### Phase 0 — resolve the caller's academy properly

The smallest phase and it goes first, because everything after it leans on these
comparisons.

| File | Change |
|---|---|
| `liveClass.controller.ts:551` (`#canManage`) | `resolveCallerOrg` + `callerIsGone` instead of `req.user?.organizationId` |
| `liveClassJoin.service.ts:167`, `:311` | same |
| `admin.routes.ts:1991` (`buildBookingFilter`) | same |

The last one is the reason this is a phase and not a footnote. `buildBookingFilter`
reads `req.user!.organizationId` blind and, **when it is absent, adds no org clause
at all** — verified. That caller gets an unscoped roster of *both* academies, with
names and emails, through the list, the stats strip and the CSV. It is live today,
it is the literal N-07 shape `tenancy.ts`'s header was written about, and it is
the exact function Phase 4 is about to widen. A handful of lines. It lands before
the clause that lets a class name two academies, not after.

*Revert:* one commit. *User-visible:* nothing, unless a token was already missing
the field, in which case a leak closes.

### Phase 1 — extract the predicate, change nothing

Add `classEntitlement.service.ts` with `resolveClassEntitlement` and its batch
form, and route **all eight** hand-written enrolment+module checks through it,
each passing its own status predicate. No schema change; no cohorts exist; every
door list has length one; every answer is identical to today.

Green, **unmodified**, the live-class suites in `backend/src/tests/`:
`joinclass.{suite,property,adversarial,regression,concurrency}`, `bookingsapi`,
`bookingfixes`, `bookingcutoff`, `newsessiongate.{suite,property}`, `programscope`,
`orgassignment`, `adminmatrix`, `portalguards`,
`crossorginstructor.{suite,deep}`. If a suite needs editing, this phase has
changed behaviour it claimed not to change. `joinclass.property.suite.ts:218-219`
already encodes the gate precedence as a property and is the single best
regression signal.

This is the largest and riskiest phase and it ships no feature. That is the point:
it pays for itself by killing the eight-copies problem even if the feature is
cancelled. *Revert:* one commit — the eight call sites are mechanical.

### Phase 2 — schema and authoring, inert

`guestCohorts` / `hostSeatsLeft` / `overflowSeatsLeft`; the `pre('validate')`
rules; `#assertCohortsUsable` (**including the host pair**, closing the
pre-existing section↔course hole); the service-layer invariant assertion on the
update path; the DTO fields; and the admin form — pick the other academy, then its
course (list seeded by matching `Course.program` as a **soft hint only**), then
its module, then the floor.

**A cohort can be authored. No guest student can book.** The entitlement resolver
does not read `guestCohorts` yet. This is a deliberate correction to the winning
design, which made the class bookable here and left the roster split two phases
later — which would have put every Bangalore student's name and email into Dubai's
export for the length of the pilot. Authoring without booking is inert; booking
without the roster split is a leak.

*Revert:* drop the fields.

### Phase 3 — seats

`seatPool.service.ts` with the countdown CAS, wired into **all twelve** reserve
and release sites. `ClassBooking.seatOrganizationId/seatCourseId/seatSectionId`
stamped in all four booking paths. The `userCascade` booking-deletion and
seat-release rider. `reconcile-class-seats.ts`. The capacity/floor edit guards,
the Zod max drop to 500, and the `update()`-time LiveKit ceiling check. CI grep
forbidding raw `$inc: { bookedCount`.

Every class still has `hostSeatsLeft === undefined`, so every statement executed
is today's. Add a concurrency test asserting the invariant after a randomised
book/cancel storm across two cohorts. *Revert:* the helpers fall back to the flat
CAS.

### Phase 4 — the roster, homework and attendance split

`buildBookingFilter` widen-then-narrow; `callerMayManageSeat` on the three
attendance/cancel routes; bulk-attendance memoisation moved to per-seat-org;
`ClassAssignment` stamped from the booking's door.

Still no guest can book, so this is strictly narrower than today and a no-op on
every existing row. That is the point: the split is **proven correct before any
cross-academy data exists**. *Revert:* the filter returns to today's.

### Phase 5 — mail clocks

Step 1: the zone abbreviation on every class mail. Step 2: recipient-academy
rendering for the confirmation, the five reminders and critical/cancel mail,
passing `Date`s.

**This phase is not cuttable.** Ship 1-4 and 6 without it and a Bangalore student
reads 18:00 in the app and 16:30 in every mail, unlabelled. Today that student
receives no Dubai class mail at all — so cutting this creates a class of students
who are actively told the wrong time. That is worse than the status quo.

### Phase 6a — narrow the browse feed, alone

`servedClassFilter` in `tenancy.ts`, applied via `andFilter` to
`GET /live-classes/upcoming` only. Foreign non-shared classes disappear from the
feed. A leak closes.

**This is the one user-visible change before the feature, and it ships alone,
deliberately.** It is a take-away landing on students with no stake in this
feature — some may be using the feed as a catalogue. This repo has already lived
through a support wave from live classes appearing to vanish (the 100-row cap
incident), and that cause took real time to find precisely because the change was
not isolated. Ship it, watch a week of tickets, and revert it alone if it is
wrong — without taking the feature with it.

### Phase 6b — open it

The resolver reads `guestCohorts`. `servedClassFilter` applied to
`GET /live-classes`. `listForCourse` widened to `{ $or: [{ courseId },
{ 'guestCohorts.courseId': courseId }] }` — **the course page, which is the
primary surface**. `yourCohort` labels on the booking card. `#notifyEnrolledStudents`
and `#studentsAtModule` fanned out per door with a per-door cap and a truncation
warn. The admin "serves both" chip and the secondary clock line.

New suites `crossorgclass.{suite,adversarial,concurrency}.ts` in the
`crossorginstructor.deep.suite.ts` style: a Bangalore student blocked on
**Bangalore** module 2 gets `MODULE_BLOCKED`; a student of neither academy gets
`WRONG_ACADEMY`; an exhausted Bangalore floor does not consume a Dubai seat; a
Bangalore admin sees Bangalore seats only, in both directions; a search term
survives the widened filter (the `$and` trap).

*Revert:* **not free.** Removing the widening leaves guest students holding seats
they will be refused at the door. A revert after guests have booked must be paired
with cancelling those seats and mailing those students. Say that out loud before
this phase ships, not after.

---

## Migration

**No existing document is rewritten and no field changes meaning.** That is the
point of the shape.

- **`LiveClass`:** `guestCohorts` defaults to `[]`; `hostSeatsLeft` and
  `overflowSeatsLeft` stay `undefined`, which is the explicit "no allocation in
  force" signal. Thousands of existing classes take a code path byte-identical to
  today's. No backfill, at all.
- **`organizationId` still names the owner on every class.** So the boot backfill
  at `index.ts:89-103` needs no change and cannot re-stamp a shared class into the
  wrong academy on the next pm2 restart — the trap any design that left
  `organizationId` unset to mean "belongs to both" would hit.
- **`ClassBooking`:** the three stamps are absent on every existing row. Every
  reader treats absent as "the class's host door", so the roster filter is correct
  on day one. A one-off idempotent script
  (`backend/src/scripts/backfill-booking-seat-door.ts`, the `migrate-orgs.ts`
  shape: `updateMany({ seatOrganizationId: { $exists: false } }, …)` per class,
  `bulkWrite`, re-runnable) stamps them so the index is useful and reporting is
  uniform. **Nice to have, never blocking**, and it can run days after the deploy.
  Skip bookings whose `userId` no longer resolves and log the count —
  `reminders.job.ts:35-60` records what four dangling rows already cost: a throw
  inside a `.filter()` that silently stopped every reminder for every class.
- **`Enrollment`, `Section`, `Course`, `ClassAssignment`:** no schema change. No
  section renumbered, no course paired implicitly, nothing inferred from `program`.

### The one audit that must happen, and it is not a script

`class.organizationId === course.organizationId` **is not an enforced invariant
today.** `liveClass.service.ts:264-267` sets the class's academy to the *caller's*
org when present and only falls back to the course's — verified. Both the
instructor plan and the brief state the rule as "the class derives its
organizationId from its course"; that is the **fallback**, not the rule. So a
Dubai admin creating a class on a Bangalore course already produces a row stamped
Dubai on a Bangalore course.

Door resolution rests on that agreement. A mismatched row resolves a host door
whose academy and course belong to different academies, and every answer below it
is wrong in a way nothing reports.

This plan does **not** normalise those rows automatically — quietly re-homing a
booked class would launder a data problem into a deploy. Instead, before Phase 2:

1. A **read-only audit script** emits every class where
   `class.organizationId !== course.organizationId`, with title, date, instructor,
   course, both academies and its live booking count.
2. The owner reviews it **row by row**.
3. Confirmed-wrong rows are corrected by an **explicit list**, never a blanket
   rule. Any row that still disagrees afterwards is refused a guest cohort by
   `#assertCohortsUsable` — skipped and logged, never guessed.

This is grafted from a competing design and it is the single best thing that
design found. It is also the reason Phase 2 has a prerequisite that is a meeting,
not a migration.

### The pilot

Take one real Dubai DM module-2 class. Add one Bangalore cohort with a floor of,
say, 10 of its 40 seats. Watch one booking, one join, one attendance mark, one
homework submission and one reminder mail. Everything else in production is
untouched while that runs.

---

## Where the reviews disagreed, and the ruling

Four designs were produced and scored by three judges. They split.

**Two lenses — tenancy/correctness and operational reality — put the guest-list
shape first. The product-coherence lens put it third.** That is the real
disagreement and it is not papered over here: the product lens was right about a
specific, concrete failure, and its fix has been grafted in.

| Disagreement | Ruling |
|---|---|
| **Mirror the host into the array, or not?** Three designs mirrored and held the copy in sync with `pre('validate')`. One did not. | **No mirror.** I verified `update()` writes through `updateByIdPopulated`, so document validators never run on the edit path. A mirror held by a hook that cannot fire is a mirror that drifts silently, and the symptom is the booking answer disagreeing with the join answer. This is the decisive shape argument and it settles the ranking. |
| **Is the course page a discovery surface?** The winner said no ("the resolver gates them"). The product lens said that leaves the Bangalore student's own course page empty and the booking card labelled with the *Dubai* course and module. | **The product lens wins outright.** I verified the card labels come from the populated host `course.title` and `sectionId.title`. Grafted: `listForCourse` is widened, the course page is named the **primary** surface, and `yourCohort` labels are a stated product promise. |
| **Ship a bookable pilot before the roster split?** The winner did. Two other designs stated the opposite constraint explicitly. | **The other two win.** Phase 2 authors cohorts but does not make them bookable; Phase 4 lands the roster split before Phase 6b opens the door. |
| **Narrow `GET /live-classes/upcoming`?** Three said yes, one said it is a separate product decision. | **Narrow it — but as its own deploy (6a), watched alone.** It is a leak. It is also a take-away nobody asked for, and it deserves an unambiguous support signal. |
| **Can the guest academy's staff mark their own students present?** Range from "no" to five operations. | **Three routes only** — attendance, bulk-attendance, seat cancel — through `callerMayManageSeat`, narrowed three ways. Everything else stays owner-only. On the owner's decision list. |
| **Where does the seat invariant live?** The winner put it in `pre('validate')`. | **Overruled on its own facts.** It lives in `seatPool.service.ts` and the service-layer update guard; the hook is a backstop for create and `.save()` only. A reconciler ships in the same phase. |
| **Fix the blind `req.user?.organizationId` reads?** The winner said "not here". | **Overruled.** They are made Phase 0. The widening this feature adds runs *through* those comparisons, and `buildBookingFilter` returns an unscoped both-academy roster when the field is missing. |

---

## Deliberately not done

- **Un-sharing a class that has guest bookings.** Removing a cohort with
  `seatsLeft < seatFloor` is refused. What to do with those students is a product
  decision, not a code path.
- **A waitlist.** There is none anywhere in this codebase and none is added. An
  exhausted floor plus exhausted overflow is a flat `SESSION_FULL`, and the
  student's only recovery is an admin.
- **Automatic release of unclaimed floor seats.** One hour of usable time before
  the cut-off, and a cron nobody wants to own. Overflow buys the same thing.
- **Unifying the three enrolment-status predicates.** Real, live, and now visible
  in one file with a comment naming it. Fixing it changes behaviour for existing
  single-academy students and is its own decision.
- **The dead 2× attendance cap** (`bookings.routes.ts:191-204`). The
  `{userId, liveClassId}` unique index caps the count it reads at 1, so it can
  never fire. Nobody may build per-cohort attendance limits on it.
- **Per-academy reporting.** `GET /admin/reports/mentor-schedule` scopes only by
  `organizationId` with no assignment carve-out — it already misses lent
  instructors' borrowed classes and will count a shared class once, in the owner's
  academy. The booking stamps make a per-cohort split *possible*; this plan does
  not build it.
- **The CLT ticket's `orgSlug` claim.** It carries an ObjectId string and the
  *caller's* org, not the class's (`liveClassJoin.service.ts:217`, `:412`). It is
  already mislabelled, CLT cannot distinguish the cohorts, and nothing here relies
  on it doing so. Fixing it needs coordination with CLT.
- **A `ModuleLink` registry** so a twin is declared once instead of re-picked on
  all 30 weekly classes. Genuinely worth building later — with the rule that the
  class keeps its own resolved snapshot, so re-pointing a link cannot retroactively
  change who was entitled to a class that already ran.

---

## Known sharp edges

**Somebody picks the twin module by hand, every time, and nothing catches a wrong
pick.** `#assertCohortsUsable` proves the section belongs to the course. It cannot
prove it is the same syllabus. Pick Bangalore module 3 by mistake and the class
silently admits the wrong cohort and silently enforces the wrong admin's module
blocks — no error, nothing in the logs. `Course.program` is a programme scope,
one-to-many within an academy, so it is a hint in the picker and can never be the
check. Section **ordinal** matching was rejected as an entitlement key because
`Section.order` is mutable through the reorder endpoint: an admin dragging a
module in either course would silently repoint who may enter another academy's
class. The ordinal survives only in notifications, where a wrong answer means an
unsent email rather than an unauthorised seat.

**Seats will sit empty while somebody is refused.** A floor is a floor. Overflow
softens it; it does not remove it. If Dubai's floor is exhausted and Bangalore's
is half-unused, the Dubai student is told `SESSION_FULL` while seats stand idle.
Real occupancy cost, taken deliberately, landing on whoever sets the floors.

**The guest academy is a passenger, permanently.** A Bangalore admin with forty
students in a room cannot move it, cannot cancel it, and has to phone Dubai. That
will generate tickets, and the honest answer to each is "by design" — relaxing
`callerMayAccess`/`#canManage` is the exact mistake `tenancy.ts` exists to prevent.

**The owning academy loses the combined roster.** The Dubai admin teaching a
shared class sees only Dubai seats. The assigned *instructor* sees the whole room;
an admin does not, unless they are super_admin. That is a deliberate regression
against the naive behaviour and it will draw complaints from the person standing
in front of the class. If a combined view is wanted, it should be a new explicit
endpoint gated on class ownership, never a loosening of `buildBookingFilter`.

**Google Meet stays open and the cohort doubles.** Links are created with access
type OPEN and nobody is a calendar attendee (`googleMeet.service.ts:60-86`); the
LMS's only control is *when* it hands the URL over. Twice the people holding a
forwardable link with no knock behind it. Nothing here mitigates it. The only real
mitigation is preferring `internal`/LiveKit for shared classes, where the ticket is
minted per student per click — a recommendation the admin form should default to,
not a control.

**Job day-boundaries stay Dubai-anchored.** The digest fires at 18:00 and day-of
reminders at 07:00, bucketed by `setHours(0,0,0,0)` in server-local time. A shared
class is the first time two cohorts read the same class from two different local
days, so "today"/"tomorrow" wording is wrong for one side. The mandatory zone
label makes it visible rather than silent. Not fixed.

**`ClassBooking.seatOrganizationId` is a snapshot and will age.** A student moved
between academies keeps seats stamped with the old one. Correct for the seat
release, arguable for the roster. Nothing reconciles it.

**The third-academy story is untested.** `guestCohorts[]` scales where a boolean
would not — which is the main reason it was chosen over the instructor
precedent — but every seat rule, roster split and mail decision below it was
reasoned about for two academies. `Organization.slug` is still a closed two-value
enum and the admin zone map still has two entries, so this plan does not *deliver*
a third academy; it only avoids making it harder.

**Six phases precede the one a student can feel.** A team under pressure will be
tempted to collapse them and widen `bookings.routes.ts` directly. That collapse is
precisely how this ships with module blocking failing open for half the room.

---

## Decisions you must make before implementation starts

1. **Go/no-go on the shape.** One class document with a guest list, each academy
   naming its own course and module. Everything below assumes yes.
2. **Seat floors.** Who sets them — the owning academy's admin only, or both? And
   accept the consequence: a floor can leave seats empty while someone is refused.
   Default split proposal: proportional to each cohort's enrolment at that module,
   remainder to the host, freely editable up to the booking cut-off.
3. **May a guest academy's admin mark their own students present and cancel their
   own students' seats?** My recommendation is **yes**, through the three-route
   `callerMayManageSeat` carve-out. Saying no means Bangalore staff can see their
   students on a Dubai class and do nothing about them.
4. **Does the assigned instructor see both academies' students?** They must, to
   run the class — but it is a cross-academy PII flow that does not exist today,
   and it is your call, not a derivation.
5. **The browse-feed narrowing (Phase 6a).** It takes something away from students
   who have nothing to do with this feature. Confirm you want it, and that you
   accept a week of "my classes disappeared" tickets while it is watched alone.
6. **Phase 5 (mail clocks) is not cuttable.** Confirm the budget for it up front.
   Shipping the feature without it means telling a cohort of students the wrong
   time in every confirmation and reminder.
7. **The mismatched-class audit.** When does it happen and who reviews the rows?
   It blocks Phase 2 and it is a meeting, not a script.
8. **Rollback after guests have booked is not free.** Confirm you accept that
   backing the feature out at that point means cancelling those seats and mailing
   those students.
