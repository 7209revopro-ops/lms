# How to test the Tabby gateway

Sandbox only. Every command here is safe to run against `sk_test_…` keys — no
real money moves. The suites refuse to run against a production key.

---

## 0. Before anything

Three things must be true or the Tabby button never appears and you will waste
an afternoon:

| | Check | Fix |
|---|---|---|
| 1 | `TABBY_SECRET_KEY` starts with `sk_test_` | It is the **server** key. `pk_` here means the keys are swapped — the backend now refuses to boot and tells you so. |
| 2 | The test student's `enrollmentApplication.homeCountry` is **exactly** `United Arab Emirates` | Tabby is UAE-only; the API enforces this now, not just the UI. |
| 3 | That student has a `phone` | It is the buyer phone sent to Tabby and it decides approve/reject. |

Quick confirmation that the credentials themselves work:

```bash
cd backend && bun run test:tabby:sandbox
```

A `401` there means the key or merchant code is wrong. Everything else is
downstream of this passing.

---

## 1. Automated — run these first

```bash
cd backend && bun run test:tabby && bun run test:tabby:sandbox && bun run test:tabby:routes
```

| Suite | What it covers | Needs |
|---|---|---|
| `test:tabby` | 57 assertions. Pure logic: webhook registration idempotency, capture/refund idempotency keys, payment-id validation, totals, rejection copy, field limits. | nothing |
| `test:tabby:sandbox` | 16 assertions. Real calls to Tabby: credentials accepted, pre-scoring approve **and** reject, session creation, `getPayment`, and that an unauthorised payment cannot be captured. | network + `sk_test_` |
| `test:tabby:routes` | 52 assertions. The HTTP surface attacked: anonymous, IDOR, malformed input, forged webhooks, and the payment-replay attack. | network + Mongo |

`test:tabby` runs in the main `bun run test` chain. The other two need the
network, so they stay opt-in.

---

## 2. Manual — the full purchase

The one thing automation cannot do is complete Tabby's OTP screen.

1. Start backend (`bun run dev`) and client (`npm run dev`).
2. Log in as your UAE test student. Set their profile email/phone to the
   identity you want (below) — Tabby decides from those, not from anything we send.
3. Open a paid course. You should see the **Pay in 4** button, the product-page
   snippet near the price, and the cart snippet in the cart.
4. Click through to Tabby's hosted page. **OTP is always `8888`.**
5. Complete it. You land back on `/payment-return`.

**Expected afterwards** — check in Mongo:

```js
db.orders.findOne({ gateway: 'tabby' }, { status: 1, amount: 1, tabbyPaymentId: 1 })
// status: 'paid', amount in fils (73033 for AED 730.33)
db.enrollments.countDocuments({ userId: <student> })  // 1
```

### The three identities

| Scenario | Email | Phone | Expect |
|---|---|---|---|
| Approved | `otp.success@tabby.ai` | `+971500000001` | Full purchase completes |
| Pre-scoring rejection | `otp.success@tabby.ai` | `+971500000002` | Button replaced by Tabby's own message — **not** an error toast |
| Checkout rejection | `otp.rejected@tabby.ai` | `+971500000001` | Redirected to the failure URL, cart **preserved** |

The rejection wording must be Tabby's exact published copy. If you see
"Checkout failed. Please try again." instead, something is swallowing the
rejection — that is a QA failure.

---

## 3. Webhooks

Locally `BACKEND_PUBLIC_URL=http://localhost:8000` is unreachable from Tabby, so
registration is skipped with an explanatory log and fulfilment falls back to
`/checkout/tabby/verify-return`. That is fine for most testing.

To exercise the **real** webhook path — including the corner case Tabby's QA
asks for, "complete OTP then close the tab before redirect":

```bash
cloudflared tunnel --url http://localhost:8000
```

Put the `https://…` URL in `BACKEND_PUBLIC_URL`, restart the backend, and look
for `Tabby webhook registered` in the logs. Then buy something and close the tab
the instant the OTP is accepted. The order should still become `paid`.

Confirm what is registered:

```bash
curl -s https://api.tabby.ai/api/v1/webhooks \
  -H "Authorization: Bearer $TABBY_SECRET_KEY" \
  -H "X-Merchant-Code: $TABBY_MERCHANT_CODE" | jq
```

Tabby allows **four** per merchant code + key. Registration lists first and
refuses to post a fifth, so delete stale tunnel URLs in the dashboard when you
rotate tunnels.

---

## 4. Refunds

Refund a paid Tabby order from the admin orders screen, or:

```bash
curl -X POST http://localhost:8000/api/v1/admin/orders/<id>/refund -b <admin cookies>
```

Two paths, and the code picks by asking Tabby, not by reading our own row:

- **Captured** → refunded, capped at the captured amount.
- **Never captured** → the payment is *closed* instead, which returns everything
  the customer paid. Tabby rejects a refund on an uncaptured payment, so this
  distinction is not cosmetic.

Refunding twice should give `ALREADY_REFUNDED`, not a second refund.

---

## 5. Security checks worth repeating by hand

These are all covered by `test:tabby:routes`, but they are the ones worth
re-running yourself after any change to the checkout code.

```bash
# Forged webhook — wrong secret. Must NOT fulfil anything.
curl -X POST http://localhost:8000/api/v1/webhooks/tabby \
  -H 'Content-Type: application/json' -H 'Authorization: Bearer wrong' \
  -d '{"id":"<real-payment-id>","status":"authorized","order":{"reference_id":"<order-id>"}}'

# Correct secret, but the payment is only CREATED at Tabby. Must still NOT fulfil.
curl -X POST http://localhost:8000/api/v1/webhooks/tabby \
  -H 'Content-Type: application/json' -H "Authorization: Bearer $TABBY_WEBHOOK_SECRET" \
  -d '{"id":"<created-payment-id>","status":"authorized","order":{"reference_id":"<order-id>"}}'
```

Then, logged in as a student, try to pay for an expensive course with the
payment id from a cheap one you already completed:

```bash
curl -X POST http://localhost:8000/api/v1/checkout/tabby/verify-return \
  -H 'Content-Type: application/json' -b <student cookies> \
  -d '{"orderId":"<expensive-pending-order>","paymentId":"<cheap-completed-payment>"}'
```

The order must stay `pending`. **This one was exploitable until this round of
fixes** — see the security section of [tabby-integration.md](tabby-integration.md).

---

## 6. Reading the logs

| Log line | Meaning |
|---|---|
| `Tabby webhook registered` | Credentials + merchant code accepted, endpoint live |
| `Tabby webhook already registered` | Normal on reboot — idempotent, not an error |
| `Tabby payment captured` | Money is settling to you |
| `payment does not belong to this order` | A replay was refused. If you did not cause it, investigate. |
| `authorised amount does not match the order` | Same — refused |
| `fulfilling an UNCAPTURED payment` | Student got the course, money not collected. **Chase this.** |
| `Tabby webhook: asking Tabby to re-deliver` | Webhook beat our own write; Tabby retries. Harmless unless it repeats. |
