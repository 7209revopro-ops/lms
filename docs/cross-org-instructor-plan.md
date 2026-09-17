# Cross-academy instructors — implementation plan

**Scope: instructors only.** Class sharing is deliberately out of scope and is
planned separately, because it runs into a harder problem (see "Why classes are
not in this plan").

> Written to `docs/` rather than `plan.md` because that file already exists and
> tracks the live CLT Connect build.

---

## What was asked, and what was decided

A toggle on the instructor form meaning "for both organizations". When on:

- both academies' **admins and sub-admins** can see the instructor and schedule
  classes for them;
- **CRUD on a shared instructor is restricted to `super_admin` and `admin`** —
  sub-admins and support get view + schedule only.

That second point is the product owner's decision on the question this plan was
paused to ask. It matters because the guard involved (`requireSameOrgUser`)
protects `DELETE /users/:id` and `POST /users/:id/reset-2fa`, not just editing.

---

## The design rule everything follows

Four independent designs were produced and scored by three judges. They
disagreed about the data model and agreed completely about one thing:

> **Reads and writes get different predicates.** `callerMayAccess` and
> `requireSameOrgUser` answer *"may you CHANGE this"*. Sharing is a question
> about *"may you SEE and USE this"*. Conflating them is how N-07, N-10 and
> N-11 happened — one of which exposed students' passport scans.

So the widening is a **separate, named, read-side helper**, never a loosening of
the existing guard. The single exception is the CRUD carve-out the owner asked
for, which is deliberately narrow and role-gated rather than a general
relaxation.

---

## Data model

```ts
// UserSchema
sharedAcrossOrgs: { type: Boolean, default: false, index: true }
```

A boolean, not an array of org ids. The request is literally "both
organizations", and Delta has exactly two. **The honest cost:** the day a third
academy opens, `sharedAcrossOrgs: true` silently means "all three" and there is
no migration that does not revisit every read site. `sharedWithOrgIds[]` would
not have that problem. Traded away for a materially smaller change; recorded
here so the decision is visible rather than discovered.

**Schema validator:** the field may only be `true` when `role === 'instructor'`.
A shared *student* would widen student lists across academies, which is the
exact class of leak this codebase has already had. Making it unpersistable is
better than trusting every write path.

`organizationId` still means **owner**. A shared instructor is owned by the
academy that created them and lent to the other; that asymmetry is what keeps
reporting and "whose instructor is this" answerable.

---

## Phases

Each phase is independently shippable and revertible. Nothing is visible to
users until Phase 4.

### Phase 1 — schema and the read-side predicate

| File | Change |
|---|---|
| `backend/src/models/schema.ts` | Add `sharedAcrossOrgs` to `UserSchema` + the instructor-only validator |
| `backend/src/utils/tenancy.ts` | Add `sharedInstructorOrgFilter(orgId)` — returns the Mongo clause for "owned by this academy **or** a shared instructor". Header comment states in terms that it answers SEE/USE and never CHANGE. |

The helper lives beside `callerMayAccess` on purpose: someone reaching for one
should see the other and the comment explaining which is which.

### Phase 2 — widen the reads

| File | Change |
|---|---|
| `backend/src/repositories/user.repository.ts` (~207) | Instructor lists match owned-or-shared. **Must compose under `$and`** — this filter already assigns `$or` for search and category, so assigning `$or` again silently drops the search terms. |
| `backend/src/services/admin.service.ts` (~62) | Instructor counts on the dashboard follow the same rule |

Deliberately **not** changed: student lists, admin lists, support lists, order
and enrolment scoping, document access. The widening is guarded on
`role === 'instructor'` so those paths cannot accidentally inherit it.

### Phase 3 — scheduling and the CRUD carve-out

| File | Change |
|---|---|
| `backend/src/services/liveClass.service.ts` | A class may name a shared instructor from either academy. The class keeps deriving its own `organizationId` from its course — **sharing an instructor does not share the class.** |
| `backend/src/utils/tenancy.ts` | `requireSameOrgUser` gains one narrow allowance: pass when the target is a **shared instructor** and the caller is `super_admin` or `admin`. Sub-admin and support keep the 404. |

The carve-out is role-gated and record-gated: it cannot widen to students,
because the validator prevents a shared student existing; and it cannot widen to
sub-admins, because the role list is explicit.

### Phase 4 — the toggle

| File | Change |
|---|---|
| `backend/src/routes/admin.routes.ts` | Accept `sharedAcrossOrgs` on instructor create/update. **Only `super_admin` and `admin` may set it** — a sub-admin sending it is rejected, not silently ignored. |
| `admin/` instructor form | The on/off control, with help text saying what it does and who it is visible to |

### Phase 5 — tests

In the style of the existing suites (`portalguards`, `adminmatrix`):

- a shared instructor appears in **both** academies' instructor lists;
- a non-shared one appears in **exactly one**;
- **sub-admin** of the borrowing academy: can list and schedule, gets **404 on
  PATCH and DELETE**;
- **admin** of the borrowing academy: CRUD succeeds (the owner's decision);
- a shared **student** cannot be persisted;
- widening a filter does not drop an active search term (the `$and` trap);
- nothing else crosses: orders, enrolments, documents, student lists.

---

## Deliberately not done

- **Un-sharing in the UI.** The request says "at creation time". Flipping it off
  later needs a decision about instructors who already have future classes in
  the borrowing academy — see below.
- **Widening `GET /instructors`** (`instructors.routes.ts`). That public list is
  already unscoped by academy today; this plan does not change it either way,
  but it is worth a separate look.
- **Reporting.** Attendance and mentor-schedule reports scope by the *class's*
  academy. A shared instructor teaching for both will appear in both, which is
  correct — but no per-academy split is added.

---

## Known sharp edges

**Deleting a lent instructor.** With the carve-out, the borrowing academy's
admin can delete an instructor they do not own. `userCascade` should refuse
while future classes exist in *either* academy. Flagged for Phase 3; if it is
not built, the risk is an admin deleting a person mid-term for another academy.

**Calendar collisions.** One instructor, two academies scheduling
independently, and the two display in different timezones (Dubai vs Kolkata —
see `admin/src/lib/timezone.ts`). Nothing currently prevents double-booking. Out
of scope, but it will happen.

**`canManage` reads the caller's org off the request** rather than resolving it
(`liveClass.controller.ts` ~line 513, and the same shape in
`liveClassJoin.service.ts`). `tenancy.ts` warns that reading the field blind is
what caused N-07. It is only exploitable on a route that does not populate the
field, so this is a "verify before relying on it" note rather than a claim of a
live hole — but Phase 3 touches this function, so it should be checked then.

---

## Why classes are not in this plan

Sharing a class runs into a gate sharing an instructor does not. From
`backend/src/routes/bookings.routes.ts:168`:

```js
if (session.courseId) {
  enrollment = await EnrollmentModel.findOne({ userId, courseId: session.courseId, status: 'active' })
  if (!enrollment) → 403 NOT_ENROLLED
}
```

**Booking requires an active enrolment in the class's course**, and a course
belongs to one academy. So a class toggle on its own does not let the other
academy's students book — they still get `NOT_ENROLLED`. Three ways out, each a
different product:

1. **Share the course too** — coherent, everything downstream keeps working,
   but the course lands in their catalogue, My Learning, progress and
   certificates.
2. **Auto-enrol on booking** — they hold an enrolment in another academy's
   course, which pollutes their records and your reporting.
3. **Shared classes carry no course** — note the `if (session.courseId)` guard:
   a course-less class already skips this. Smallest change, but it also skips
   the module-access gate and cannot hang off a course.

That decision is the product owner's, and it is why classes are a separate
plan rather than a second toggle in this one.
