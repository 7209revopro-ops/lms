# Tamara integration

Pay in 3 (BNPL) for UAE students, AED. Built against
[docs.tamara.co](https://docs.tamara.co/reference/tamara-api-reference-documentation).

Sibling of the Tabby integration, but **not** the same shape. Three differences
decide whether this is correct, and all three are easy to get wrong by
analogy — they are called out in full below.

---

## Status right now

**The integration is complete and unit-tested. It has never run against a live
Tamara merchant**, because the only credential we hold is a production API
token and creating a session with it would be a real BNPL order.

| | |
|---|---|
| API token | ✅ in `backend/.env` — **PRODUCTION** (`iss: "Tamara PP"` = Partners Portal) |
| Notification token | ❌ **missing** — webhooks cannot be verified without it |
| Public key | ❌ **missing** — on-site widgets will not render |
| Sandbox merchant | ❌ **missing** — `api-sandbox.tamara.co` answers "Merchant is not found" |

What the production token *did* confirm, via a read-only call:

```
PAY_BY_INSTALMENTS   2 / 3 / 4 instalments   1 – 100,000 AED   1% customer fee
PAY_NOW                                       1 – 100,000 AED   no fee
```

---

## The three things Tamara does differently

### 1. `approved` is NOT paid

Tabby hands you an authorised payment the moment the customer finishes. Tamara
stops at `approved` — the customer has paid Tamara their first instalment, but
**the merchant holds nothing** — and waits for you to call
`POST /orders/{id}/authorise`.

Miss it and the order **expires after 72 hours**, with the customer's money
already taken. Course access is granted at `authorised`, never at `approved`.

Revenue is a third thing again: nothing reaches a settlement until **capture**.
So there are two notions of "paid" on different statuses — grant access at
`authorised`, recognise revenue at `*_captured`. A course is delivered
instantly, so we capture immediately rather than wait for Tamara's 21-day
auto-capture.

### 2. The webhook JWT does not sign the body

Its only claims are `exp`, `iat`, `iss`. No order id, no event type, no body
hash. It proves the caller holds our notification token and **nothing about the
payload** — a valid token with a tampered body verifies.

So every event is re-read from `GET /orders/{id}` before anything is acted on.
The webhook is a hint that something changed, never a statement of what. `exp`
is enforced too: without it, one captured token is a replayable credential
forever.

### 3. `updated` means *partially cancelled* — and arrives as `order_canceled`

Tamara's state machine routes `updated` **onward to capture**, so such an order
is still live and will still settle. It shares the `order_canceled` event with a
real cancellation, so `if (event === 'order_canceled') revokeAccess()` would
strip a paying student of their course. `reconcileTamaraCancellation()` branches
on the order's real status instead.

### Spelling traps

`authorised` is British (-ised). `canceled` is American (single L). Tamara mixes
both conventions **inside one payload** — `authorized_amount` sits next to
`status: "authorised"`. The status enum rejects anything outside the documented
eleven rather than defaulting.

---

## Configuration

| Key | Where | Notes |
|---|---|---|
| `TAMARA_API_KEY` | `backend/.env` | Bearer auth on outbound calls. Never reaches the client. |
| `TAMARA_NOTIFICATION_TOKEN` | `backend/.env` | **Different credential.** HS256 secret for verifying inbound webhook JWTs. Using the API token here fails every check. |
| `TAMARA_PUBLIC_KEY` | `backend/.env` | Widgets only |
| `TAMARA_WEBHOOK_ID` | `backend/.env` | Set from the id the first registration logs — Tamara has no list-webhooks endpoint, so boot cannot otherwise tell whether ours is registered |
| `TAMARA_BASE_URL` | `backend/.env` | `https://api-sandbox.tamara.co` or `https://api.tamara.co` |
| `NEXT_PUBLIC_TAMARA_PUBLIC_KEY` | `client/.env` | Same public key, for the widgets |

The OpenAPI spec defaults the base URL to **sandbox** and the currency to
**SAR** on every endpoint. Both are pinned explicitly here — a generated client
or a copied example would otherwise point at sandbox in production, or charge
in the wrong currency.

---

## Where it lives

| Concern | Implementation |
|---|---|
| API client | `backend/src/services/tamara.service.ts` |
| Checkout, fulfilment, refund | `backend/src/services/order.service.ts` — `createTamaraOrder`, `fulfillTamaraFromWebhook`, `reconcileTamaraCancellation`, `_refundTamara` |
| Routes | `POST /checkout/tamara/{prescore,create-order,verify-return}` |
| Webhook | `POST /api/v1/webhooks/tamara` |
| Widgets | `client/src/components/payments/TamaraWidget.tsx` |
| Boot registration | `backend/src/index.ts` (instance 0 only) |

### Endpoints used

| Purpose | Call |
|---|---|
| Eligibility | `POST /pre-checkout/v1/eligibility` |
| Create session | `POST /checkout` |
| **Source of truth** | `GET /orders/{id}` |
| Authorise | `POST /orders/{id}/authorise` |
| Capture | `POST /payments/capture` — **order id in the BODY**, there is no `/orders/{id}/capture` |
| Refund | `POST /payments/simplified-refund/{id}` |
| Cancel | `POST /orders/{id}/cancel` |
| Webhook registration | `POST /webhooks` |

### Payload details that bite

- `merchant_url` has **no `notification` key** — only success/failure/cancel.
  The webhook is registered against the account, not per session. Sending one
  is silently ignored and gives false confidence.
- `shipping_address` is **required** even for a digital course.
- `consumer.phone_number` is **local** format (`501234567`), but the eligibility
  endpoint wants **international** (`971501234567`). Both without a `+`.
- Caps: item name 255, sku 128, description 256.

---

## Security

The same binding the Tabby audit forced is applied here from the start:
fulfilment requires the order to be a Tamara order, the Tamara order to be the
one recorded for it (or Tamara's own `order_reference_id` to name it), and the
amount and currency to match. Without it a student could point any pending
order of theirs at a Tamara order genuinely paid for something cheaper.

Also: order ids are UUID-shape-checked before reaching an authenticated URL;
outbound calls have 15s/25s deadlines; the redirect is pinned to Tamara's own
checkout hosts; Tamara error bodies are logged rather than thrown (they echo
the buyer's name, email and phone); and the API is gated on market, not just
the UI.

---

## Testing

```bash
cd backend && bun run test:tamara     # 100 assertions, no network, no DB
```

Covers the payload contract, the money-movement endpoint shapes, the status
vocabulary including both spelling traps, JWT signature **and** expiry, id
validation, phone normalisation, and eligibility failing safe. It is in the
main `bun run test` chain.

### Sandbox, once credentials exist

| Scenario | How |
|---|---|
| Approve | Any random UAE mobile, 9 digits starting `5` |
| Decline | `526422337` — the only documented UAE decline trigger |
| Expire | No test credential exists. Only elapsed time (72h unauthorised) or the customer cancelling |
| OTP | **No fixed code.** Click "Send code" — the 4 digits are shown at the bottom of the sandbox screen |
| UAE ID check | Three clicks through Uqudo, no Emirates ID entered |
| Cards | Success `4242 4242 4242 4242` CVV 100 · Decline `4556 2537 5271 2245` |

Tamara warns against reusing phone numbers or using "special" ones like
`500000000` or `512345678` — randomise them.

---

## What is needed to finish

1. **A sandbox API token** for `api-sandbox.tamara.co`. Everything above is
   built; nothing has been exercised against a live merchant.
2. **The notification token.** Until it lands, the webhook endpoint cannot
   verify callers and fulfilment depends entirely on the return-URL path.
3. **The public key**, for the widgets.
4. **Ask Tamara which account flags are on** — auto-authorisation and
   auto-capture are per-account, not per-request, and they change the shape of
   the state machine. The code is written to be correct under all four
   combinations, but the go-live behaviour should be confirmed rather than
   assumed.
