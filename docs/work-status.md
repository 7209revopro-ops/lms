# Work status

Where each active workstream stands, what is blocked on whom, and what happens
next. Updated 17 Sep 2026.

> This is the status board for recent work. `plan.md` at the repo root is a
> different document — the CLT Connect build plan — and is still live.

---

## At a glance

| Workstream | State | Blocked on |
|---|---|---|
| Tabby gateway | **Done, proven with a real sandbox purchase** | Logo asset + Arabic decision before QA submission |
| Tamara gateway | Code complete, **never run against a live merchant** | Sandbox credentials from Tamara |
| Mail backlog flood | Fixed and pushed | **Needs deploying + a script run on prod** |
| Cross-academy instructors | Implemented and tested | Nothing — **committed locally, not pushed** |
| Cross-academy classes | Planned only | A product decision (below) |

---

## 1. Tabby — done

Pay in 4, UAE, AED. Built against docs.tabby.ai and hardened over two security
audits. **A real end-to-end sandbox purchase completed**: OTP `8888`, AED
2,018.50, order `paid`, enrolment created, capture idempotency confirmed in the
logs.

138 assertions passing — 62 unit, 16 live sandbox, 60 route-attack.

**The audits found a critical flaw and fixed it.** A payment was never bound to
the order it paid for, so any student could replay one cheap completed payment
against unlimited pending orders and be enrolled for free. Plus: `CLOSED`
treated as proof of payment (a cancelled session granted a free course), orders
never stamped with `organizationId` (so the admin refund tenancy guard was
inert and one academy could refund another's orders), and Sentry shipping live
session JWTs to a third party.

**Before submitting for Tabby QA:**
1. Save the official logo to `client/public/payments/tabby-logo.svg` — their
   checklist requires it and the fallback wordmark will not pass.
2. Decide on Arabic. The client is English-only; several checklist items assume
   a bilingual storefront.

Going live is then one change: swap `sk_test_` for the production `sk_`.

Detail: [`tabby-integration.md`](tabby-integration.md),
[`tabby-testing-guide.md`](tabby-testing-guide.md).

---

## 2. Tamara — built, unproven

**The honest position: every line of this is unexercised.** It was built from
the documentation and verified against a stubbed API, not a live merchant.

The previous implementation could not have worked — it called
`POST /merchants/payment-types` (does not exist), sent a
`merchant_url.notification` key (no such concept), and matched webhook events
UPPERCASE when Tamara sends them lowercase, so no webhook ever matched.

Rebuilt against the real API. Three things Tamara does that a Tabby-shaped
implementation gets wrong, all now handled: `approved` is **not** paid and
needs a merchant authorise call within **72 hours**; the webhook JWT signs
nothing about the payload, so every event is re-read from `GET /orders/{id}`;
and `updated` means *partially cancelled* while arriving on the
`order_canceled` event.

100 unit assertions passing.

**Blocked.** The only credential held is a **production** API token. What is
needed, all from `partners-sandbox.tamara.co`:

1. **Sandbox API token** — nothing can be tested without it
2. **Notification token** — webhooks cannot be verified at all without it
3. **Public key** — widgets stay hidden
4. Confirm with Tamara whether **auto-authorisation and auto-capture** are on
   for the account; they change the state machine's shape

**Next step after credentials land:** the same adversarial audit that found the
Tabby flaw. It is not meaningful against code paths that have never executed.

Detail: [`tamara-integration.md`](tamara-integration.md).

---

## 3. Mail backlog — fixed, needs deploying

Both mail queues selected work with no floor on age, so a restart after an
outage sent every message that fell due while the sender was down — reminders
for classes that had already happened.

Fixed with a cutoff per queue: `EMAIL_OUTBOX_MAX_AGE_HOURS` (24h, generous —
a receipt delayed by an SMTP outage is still worth sending) and
`CRITICAL_MAIL_MAX_AGE_HOURS` (6h — a class-change notice is pointless once the
session has passed). Both env-overridable.

**Outstanding — this is on the production server, not here:**

```bash
cd ~/lms && git pull                     # restart first, so the cutoffs are live
cd backend && bun src/scripts/suppress-stale-mail.ts --hours=6           # DRY RUN
cd backend && bun src/scripts/suppress-stale-mail.ts --hours=6 --apply   # then apply
```

Pull and restart **before** running the script — suppressing the backlog while
the old code is still draining lets it keep sending.

---

## 4. Cross-academy instructors — done, committed locally

The "available to both organizations" toggle on instructor creation. A lent
instructor is visible to both academies' admins and sub-admins, who can
schedule classes for them. `organizationId` still names the owner.

**Two commits, local, not pushed:** `bab00fb`, `363634b`.

Four independent designs were scored by three judges before any code was
written. All converged on one rule: **reads and writes get different
predicates**. `callerMayAccess` is untouched; the widening is a separate
`sharedInstructorFilter` that answers "may you SEE and USE", never "may you
CHANGE".

Your decision — **CRUD on a lent instructor is open to `admin` and
`super_admin` of either academy, closed to sub-admins** — is implemented as a
narrow carve-out in `requireSameOrgUser`, gated three independent ways.

**57 assertions across two suites, each run three times, identical every run.**
Requirement 4 is genuinely proven: a borrowing admin *and* a borrowing
sub-admin each schedule a class for a Dubai-owned lent instructor, and the
class correctly belongs to Bangalore.

Detail: [`cross-org-instructor-plan.md`](cross-org-instructor-plan.md).

### Found while testing — real, not fixed

These are recorded as `NOTE` in the deep suite rather than silently accepted.

1. **`liveClass.service.create()` never validates `instructorId` at all** — not
   the academy, not the role, not even existence. Proven: an unshared
   cross-academy instructor, a **student's** id, and an id matching **no user**
   are all accepted. This predates the sharing feature, but it means the
   academy boundary on scheduling was never enforced. *Recommend fixing.*
2. **Un-lending leaves already-scheduled classes in place**, still naming an
   instructor the borrowing academy can no longer see or manage.
3. **`userCascade` does not refuse to delete a lent instructor** who has future
   classes in the borrowing academy.
4. **Nothing prevents double-booking** one instructor across two academies —
   and the two admin panels display in different timezones.
5. **`canManage` reads the caller's org off the request** rather than resolving
   it (`liveClass.controller.ts` ~513, same shape in `liveClassJoin.service.ts`).
   `tenancy.ts` warns this is what caused N-07. Only exploitable on a route that
   does not populate the field — verify before relying on it.

---

## 5. Cross-academy classes — needs a decision from you

Not started. It runs into a gate that instructor sharing does not.

`bookings.routes.ts:168` — **booking requires an active enrolment in the
class's course**, and a course belongs to one academy. So a class toggle on its
own changes nothing: the other academy's students still get `NOT_ENROLLED`.

Three ways out, each a different product:

| Option | What it costs |
|---|---|
| **Share the course too** | Coherent — everything downstream keeps working. But the course lands in their catalogue, My Learning, progress and certificates. |
| **Auto-enrol on booking** | They hold an enrolment in another academy's course. Pollutes their records and your reporting. |
| **Shared classes carry no course** | Smallest change — the `if (session.courseId)` guard already skips the gate. But it also skips module-access control and cannot hang off a course. |

Also unresolved: **one shared class has one seat pool**. Dubai students could
fill it before Bangalore students see it. Per-academy allocation needs a second
counter moved atomically.

**This decision is the next step.** Everything else is ready.

---

## Immediate next actions

| # | Action | Owner |
|---|---|---|
| 1 | Confirm the git remote — local still points at `Delta-init/lms` and you mentioned changing it | You |
| 2 | Deploy and run the mail suppression script on production | You |
| 3 | Request Tamara sandbox credentials + notification token + public key | You |
| 4 | Save the Tabby logo asset | You |
| 5 | Decide how cross-academy class booking should work (section 5) | You |
| 6 | Push the two cross-org commits once the remote is confirmed | Either |
| 7 | Fix `instructorId` validation on class creation | Me, on your go-ahead |
