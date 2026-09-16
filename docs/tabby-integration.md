# Tabby integration — QA readiness

Pay in 4 (BNPL) for UAE students, AED. Built against
[docs.tabby.ai](https://docs.tabby.ai) — Pay in 4 custom integration.

This document is the map for Tabby's pre-production QA review: every item on
their
[full testing checklist](https://docs.tabby.ai/pay-in-4-custom-integration/full-testing-checklist)
and where it lives in this repo.

---

## Configuration

| Key | Where | Notes |
|---|---|---|
| `TABBY_SECRET_KEY` | `backend/.env` | `sk_test_…` sandbox, `sk_…` production. **Never** reaches the client. |
| `TABBY_MERCHANT_CODE` | `backend/.env` | AED store merchant code |
| `TABBY_WEBHOOK_SECRET` | `backend/.env` | A value **we** choose; registered with Tabby at boot and echoed back as a bearer header |
| `TABBY_CURRENCY` | `backend/.env` | `AED` |
| `NEXT_PUBLIC_TABBY_PUBLIC_KEY` | `client/.env` | `pk_test_…` / `pk_…` — snippets only |
| `NEXT_PUBLIC_TABBY_MERCHANT_CODE` | `client/.env` | same value as the backend merchant code |

Test vs live is decided by **which key authorises the call** — there is no
`sk_live_` prefix. Swapping in a production `sk_…` key is the whole go-live step.

The webhook registers itself on every boot (`backend/src/index.ts`), pointing at
`<BACKEND_PUBLIC_URL>/api/v1/webhooks/tabby`. Registration is idempotent: it
lists the existing webhooks first and only posts when ours is absent, because
Tabby allows **four** webhooks per merchant_code + key pair and does not
document what a repeat POST of the same URL does — under PM2 that budget would
otherwise be spent within a few deploys. A non-HTTPS `BACKEND_PUBLIC_URL` is
skipped with an explanatory log rather than sent to Tabby to be 400'd.

### Infrastructure

Tabby delivers webhooks from eight fixed addresses. If the API sits behind a
firewall or WAF, allowlist them or deliveries are dropped:

```
34.166.36.90    34.166.35.211   34.166.34.222   34.166.37.207
34.93.76.191    34.166.128.182  34.166.170.3    34.166.249.7
```

TLS 1.2 or higher is required. Rate limits are 200 create-session calls per 10
seconds and 100/second for everything else; note that pre-scoring uses the same
create-session endpoint, so it counts against that budget (the client caches
each result for 5 minutes). Tabby prohibits performance testing against
production.

---

## Checklist → implementation

### API keys and environment
| Requirement | Where |
|---|---|
| No `sk_` in page source or network traffic | Secret key only in `backend/src/services/tabby.service.ts`; client uses `NEXT_PUBLIC_TABBY_PUBLIC_KEY` |
| Backend calls use the secret key | `TabbyService.authHeaders` |
| Public key only in frontend snippets | `client/src/components/payments/TabbyPromo.tsx` |
| Capture / refund / close on `/api/v2/` | `TabbyService` — `baseUrl = https://api.tabby.ai/api/v2` |

### On-site messaging
| Requirement | Where |
|---|---|
| Product snippet | `TabbyProductPromo` on the course page, beside the price |
| Cart snippet | `TabbyCartPromo` in the cart, per line item |
| Checkout snippet under the payment method | `TabbyCheckoutCard` under the Tabby button |
| Shown for **all** amounts, no merchant limits | No price threshold anywhere — Tabby alone decides eligibility |
| Amount updates as the basket changes | `TabbyWidget` re-instantiates on every `price` change |
| Mobile width | Widgets are Tabby's own; container is fluid |

### Tabby as a payment method
| Requirement | Where |
|---|---|
| Logo next to the payment method name | `TabbyLogo` — **see "Before submitting" below** |
| No merchant-side availability rules | Only Tabby's pre-scoring hides the button |

### Checkout
| Requirement | Where |
|---|---|
| Background pre-scoring | `POST /checkout/tabby/prescore` → `TabbyService.checkEligibility` |
| Opens in the same window | `window.location.href = checkoutUrl` |
| Total matches Tabby's checkout | Snippet amount comes from the **backend** `aedPriceFor()`, not the cart — see caveat below |
| `lang` sent on session creation | `TabbyCheckoutRequest.lang` |
| All required parameters sent | Full payload: `buyer`, `buyer_history`, `order`, `order_history`, `shipping_address` |
| Sessions disposable, URL never reused | A fresh order + session per attempt |
| Rejections shown as messages, not errors | `TabbyRejectedError` → `TABBY_REJECTED` → Tabby's exact copy rendered inline |
| Cart preserved on cancel/failure, cleared on success | `payment-return/page.tsx` clears **only** after a confirmed payment |
| `buyer_history` / `order_history` hold real values | `registered_since` is the student's real signup date; `order_history` is built from their settled orders |

### Payment verification and processing
| Requirement | Where |
|---|---|
| Webhook registered per merchant_code + key | `TabbyService.registerWebhook()` at boot — lists first, never exceeds Tabby's limit of 4 |
| `X-Merchant-Code` header on webhook endpoints | `TabbyService.webhookHeaders` |
| String fields within 255 chars | `tabbyField()` clips title and description |
| `getPayment` verification before capture | `fulfillTabbyFromWebhook` — fails **closed** if it cannot verify |
| Capture on `AUTHORIZED` | same |
| Lowercase webhook vs uppercase getPayment | Normalised to uppercase in `getPayment` |
| Webhook returns 200 and tolerates duplicates | Idempotent via a conditional `fulfillTabby` flip |
| Webhook before the order exists → retry | Returns **503**, so Tabby re-delivers (up to 4 times, 1–4 min backoff) |
| Capture confirmation is not a capture request | Skipped when `captures[]` is already populated |
| Unique `reference_id` per capture/refund | `capture-<orderId>`, `refund-<orderId>[-n]` — derived from the order, never a timestamp |

### Refunds and cancellations
| Requirement | Where |
|---|---|
| Refunds validate against **captured**, not authorized | `_refundTabby` sums `captures[]` |
| Uncaptured payments use Close | `_refundTabby` calls `closePayment` when nothing was captured |
| Reused `reference_id` replays the first refund | `attempt` = count of refunds already on the payment |
| Cumulative refunds ≤ captured | `refundableFils = captured − refunded`, rejected at ≤ 0 |
| Arrays read by value, never by position | `tabbySumFils()` sums the whole array |

Admin refunds run through the existing `POST /admin/orders/:id/refund`.

---

## Sandbox testing

Test credentials work **only** with an `sk_test_` key. OTP is always `8888`.

| Scenario | Email | Phone |
|---|---|---|
| Approved | `otp.success@tabby.ai` | `+971500000001` |
| Pre-scoring rejection | `otp.success@tabby.ai` | `+971500000002` |
| Checkout rejection | `otp.rejected@tabby.ai` | `+971500000001` |

Buyer email and phone are taken from the **LMS user record**, so set the test
student's profile to these values to force each outcome.

Two preconditions, or the button never appears:
1. `enrollmentApplication.homeCountry` must be exactly `United Arab Emirates`
2. the user record needs a `phone`

Locally, `BACKEND_PUBLIC_URL=http://localhost:8000` is unreachable from Tabby, so
webhook delivery will not happen — fulfilment falls back to
`POST /checkout/tabby/verify-return`, which the payment-return page calls. To
exercise the real webhook path (including the "close the tab before redirect"
corner case QA asks for), point `BACKEND_PUBLIC_URL` at a public HTTPS tunnel.

---

## Security fixes (audit round)

A multi-lens audit of the Tabby paths found one **critical, exploitable** flaw
and several hardening gaps. All are fixed and regression-tested.

### Critical — payment was never bound to the order it paid for

`fulfillTabbyFromWebhook` verified server-side that *some* Tabby payment was
`AUTHORIZED`/`CLOSED`, then fulfilled whichever order id it was handed. Nothing
compared the payment to the order.

`POST /checkout/tabby/verify-return` takes both ids from the request body and is
callable by any authenticated student, who legitimately learns their own payment
id from `?payment_id=` on the success redirect. So:

1. Buy the cheapest Tabby course. Its payment becomes `CLOSED` with `captures[]`
   populated.
2. Open an order for a 3,000 AED course; abandon the Tabby page.
3. Call `verify-return` with the **new** order id and the **old** payment id.

The status gate passed, the capture step was skipped precisely *because* the
payment was already captured, and the order flipped to `paid` — enrolment
granted, account auto-approved. Repeatable for every course in the catalogue,
and it still worked after the original order was refunded, because a refunded
Tabby payment stays `CLOSED`.

Fixed by binding the payment to the order before fulfilling — the order must be
a Tabby order, the payment must be the one recorded for it (or Tabby's own
`order.reference_id` must name it), and the authorised amount and currency must
match the order. Any mismatch refuses and logs loudly.

`fulfillTabby` also matched `status: { $ne: 'paid' }`, which let a **refunded**
order be resurrected to `paid` by a late callback. Now only `pending` may flip.

### Second audit pass

A second multi-lens pass ran against the hardened code — nine lenses plus a
regression lens on the fixes themselves. It found three more issues that matter,
two of which several independent lenses reached on their own.

**High — order tenancy was fictional.** `OrderSchema` has an `organizationId`,
and the admin refund route checks it before issuing a real gateway refund. But
`orderRepo.create()` never set it, and that check treats an order without one as
grandfathered:

```js
$or: [ { organizationId: orgId }, { organizationId: null }, { organizationId: { $exists: false } } ]
```

Since no order ever carried the field, every order matched the third clause and
the guard passed for every order in every academy — a Dubai admin could refund a
Bangalore order and vice versa. Orders are now stamped at creation
(`_orgIdFor()`), so the grandfather clause applies only to genuinely old rows.

**High — `CLOSED` was treated as proof of payment.** `CLOSED` is terminal but
covers three endings: captured in full, cancelled without capture, and
captured-then-refunded. Only the first is a payment. A student who opened a
checkout and then cancelled it in the Tabby app left a closed, never-captured
payment, which fell into the capture branch, failed there (a closed payment
cannot be captured), and was fulfilled anyway by the "funds are already
committed" allowance — which is only true of `AUTHORIZED`. Fulfilment on
`CLOSED` now requires that captures minus refunds actually covers the order.

**Medium — the return page lied on a 4xx.** A 403 or 404 from `verify-return`
(not your order, no such order) rendered "Your payment was received", inviting
support tickets about money that was never taken. 4xx and 5xx are now separated.

Also fixed in this pass, found independently while reading the code:

| Issue | Fix |
|---|---|
| `verifyTabbyReturn` reported only `needsRegistration`, so the client treated any 200 as success — it emptied the cart and showed a thank-you even when fulfilment had been refused | Returns `paid`; the cart survives and an honest "not confirmed" screen is shown |
| The client-supplied `slug` went unvalidated into the `product_url` handed to Tabby, putting an arbitrary link inside a trusted third party's UI | The course's own slug is used; the body value is ignored |
| Every PM2 fork registered the webhook on boot — `instances: 2` tuned to core count, all listing an empty result and all posting, burning Tabby's 4-webhook budget each deploy | Only instance 0 registers |
| One student could spend ~8% of Tabby's merchant-wide 200-per-10s session budget under the general 100/min limit; a dozen could stall checkout for everyone | Dedicated `checkoutRateLimit` (12/min) on every session-creating route, all gateways |
| `_createEnrollment` is check-then-create; a webhook racing a verify-return could throw a duplicate-key error and be answered with a retry, hiding a fulfilment that succeeded | Duplicate-key swallowed, everything else rethrown |

Found by the audit and fixed after review:

| Issue | Fix |
|---|---|
| The boot backfill blanket-stamped every unscoped order as **Dubai**. Since creation never set the field, every order in the database was homed to Dubai regardless of buyer — a Dubai admin could list and refund Bangalore students' orders, and a Bangalore admin could refund none of their own | Orders now derive their academy from the **buyer** and mis-homed rows are repaired, exactly as support tickets already were in the same block |
| `order_history` reported every past order's minor units as AED — a $199 Stripe order became "AED 199", a ₹16,417 Razorpay order became "AED 16,417" (~22× its value). This is credit history asserted to a **lender** | `tabbyHistoryAmountAED()` converts at the checkout's own rates and omits rows in a currency it has no rate for |
| An abandoned Tabby checkout permanently burned a limited-use coupon slot — the slot is claimed before the gateway call and only released on a throw | `cancelTabbyFromWebhook()` on `REJECTED`/`EXPIRED`, mirroring the Tamara path, with the same payment→order binding and release gated on the conditional flip |
| Sentry shipped the whole `Cookie` header — live `lms_at` / `lms_admin_at` session JWTs — plus parsed request bodies to a third party on every captured error | Request data stripped at `requestDataIntegration` and again in `beforeSend` |

### Other fixes

| Issue | Fix |
|---|---|
| Swapped `sk_`/`pk_` keys booted silently, 401'ing every call and risking the secret being copied into `NEXT_PUBLIC_` | `env.ts` now validates both prefixes and refuses to boot |
| Tabby-only routes had no server-side country check — the UAE rule lived only in the UI, so a non-UAE student could call the API directly | `assertTabbyOffered()` on prescore and create-order |
| `payment_id` from the browser was spliced unvalidated into the path of a secret-key-authenticated request (`../../v1/webhooks` would redirect the call) | UUID shape check at the route, again in the service, plus `encodeURIComponent` |
| No timeout on any outbound Tabby call — a stalled response held a webhook or checkout request open indefinitely | 15 s reads / 25 s writes via `AbortSignal.timeout` |
| Pre-scoring is a create-session call against Tabby's rate budget, callable in a loop by any authenticated user | 60 s server-side cache per student + course |
| The raw Tabby error body was thrown into the error envelope (echoes buyer email, phone, order history; visible in dev) | Logged, not thrown |
| `window.location.href` set from a server-supplied URL with no host check | Pinned to `checkout.tabby.ai` / `checkout.tabby.sa` over HTTPS |

Two findings were investigated and **not** fixed, deliberately:

- *Enrolment lost if a side effect throws after the paid flip* — the order is
  marked paid before the enrolment write, so a Mongo error there leaves a paid
  order with no enrolment and the Tabby retry short-circuits on
  `already-fulfilled`. Not attacker-triggerable; needs a reconciliation job
  rather than a reordering, since flipping last would risk double enrolment.
- *Arabic localisation* — unchanged; see below.

---

## Tests

```bash
cd backend && bun run test:tabby           # 57 — pure logic, no network
cd backend && bun run test:tabby:sandbox   # 16 — real Tabby sandbox calls
cd backend && bun run test:tabby:routes    # 52 — the HTTP surface, attacked
```

See [tabby-testing-guide.md](tabby-testing-guide.md) for how to run and read
these, plus the manual OTP walkthrough.

`test:tabby` covers the parts that move money and the parts QA fails you for:
webhook registration idempotency and headers, capture/refund `reference_id`
derivation (including that a genuine *second* refund gets a distinct key, or
Tabby silently replays the first), totals summed by value rather than array
position, the verbatim rejection copy, and the 255-char clipping. Runs against a
stubbed `fetch` — no credentials, network or database needed. Also wired into
the main `bun run test` chain; the sandbox and routes suites stay opt-in because
they need the network.

---

## Going live

Tabby's own cutover list, in order:

1. Finish the testing checklist, then submit for **QA review**.
2. Coordinate the go-live date with your Tabby account manager.
3. Swap `sk_test_…` → `sk_…` and `pk_test_…` → `pk_…`.
4. **Webhooks must be re-registered with the live key** — a webhook registered
   with a test key only ever receives test payments. This happens automatically
   on the next boot after the key changes, but confirm it in the logs.
5. Confirm the base URL matches the region (`api.tabby.ai` for UAE,
   `api.tabby.sa` for KSA). This integration is UAE/AED.
6. Run one complete live transaction end to end before announcing it.

---

## Before submitting for QA

Three things are **not** code and must be done by hand:

1. **Drop in the official logo.** Save the Tabby logo from the Marketing Toolkit
   (the Figma deck linked from `docs.tabby.ai/marketing/toolkit`) to
   `client/public/payments/tabby-logo.svg`. Until then `TabbyLogo` falls back to
   a plain purple wordmark, which will not pass the "Tabby logo appears next to
   payment method name" check. The trademark is deliberately not redrawn here.

2. **Set `priceAED` on every published course.** `coursePriceIn()` falls back to
   the **USD** price when a course has no AED override, so the cart would show
   `$199` while Tabby's checkout shows `AED 730.33`. QA checks "Checkout total
   matches amount displayed on Tabby Checkout". The Tabby *snippets* already
   quote the backend AED figure, so this only affects the cart's own price line —
   but it is a visible mismatch. Setting `priceAED` in admin fixes it with no
   code change.

3. **Decide on Arabic.** The client has no i18n framework — it is English-only.
   Several checklist items ("snippets display correctly in Arabic and English",
   "redirect and result pages localized in both languages") assume a bilingual
   storefront. The plumbing is ready — `lang` flows through the session payload
   and both snippet components — but the surrounding pages are not translated.
   Confirm with the Tabby business manager whether an English-only storefront is
   acceptable, or budget for i18n before submitting.
