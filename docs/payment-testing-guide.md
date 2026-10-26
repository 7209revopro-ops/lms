# Testing card (Abzer) and Tamara payments on /explore

Last verified 2026-10-26. Abzer is tested with its **sandbox** keys; Tamara with its **live** keys,
which means every completed Tamara payment is **real money**. Read section 1 before testing.

---

## 1. Settings

### Backend (`backend/.env` on the server)
| Variable | Value |
|---|---|
| `ABZER_ACCESS_KEY` / `ABZER_SECRET_KEY` | from Abzer (sandbox now, production at go-live) |
| `ABZER_BASE_URL` | sandbox `https://sandbox.billxpro.com/as/api/v100` · production `https://billxpro.com/as/api/v100` |
| `ABZER_TEMPLATE_CODE` | `paymentlink-mail-template` |
| `ABZER_WEBHOOK_SECRET` | any long random string — the SAME value goes into the Abzer console (below) |
| `TAMARA_API_KEY` | live API token |
| `TAMARA_BASE_URL` | `https://api.tamara.co` (live) — must match the key; a live key on the sandbox URL answers "Merchant is not found" |
| `TAMARA_NOTIFICATION_TOKEN` | from the Tamara partner portal — how we prove a webhook came from Tamara |
| `TAMARA_PUBLIC_KEY` | from the Tamara partner portal |
| `TAMARA_WEBHOOK_ID` | leave empty the first time — see 1.2 |
| `BACKEND_PUBLIC_URL` | the API's public **https** address — webhooks are registered against it |

### Website (`client/.env` locally, and the Vercel project's environment)
| Variable | Value |
|---|---|
| `NEXT_PUBLIC_TAMARA_PUBLIC_KEY` | the same value as `TAMARA_PUBLIC_KEY` (it is public by design). Empty → the Tamara instalment widget is hidden; payment still works. |

### 1.1 Abzer webhook (once, in the BillXPro admin console)
Webhook → URL `https://<api domain>/api/v1/webhooks/abzer`, method **POST**, body type **JSON_BODY**,
header **`X-Abzer-Secret: <ABZER_WEBHOOK_SECRET>`**.

### 1.2 Tamara webhook (automatic)
1. Deploy with `TAMARA_WEBHOOK_ID` empty and restart the backend.
2. In the log: `pm2 logs --lines 200 --nostream | grep -i "tamara webhook"` → `Tamara webhook registered … webhookId: "…"`.
3. Put that id in `TAMARA_WEBHOOK_ID`, restart. From then on: `Tamara webhook already registered`.

Webhooks cannot reach `localhost` — on a laptop, payments still complete through the return page
and the 10-minute stuck-order sweep.

---

## 2. Card (Abzer) — sandbox, no real money

1. Open `/explore`, pick a course, **Buy now**.
2. Details: your name, an email you can read, country **United Arab Emirates**, a UAE mobile.
3. Step 2 shows **Credit or debit card** (plus Tabby/Tamara when configured). Choose it → **Pay AED …**.
4. You land on BillXPro: *Delta International Management Development Training*, the amount, your name.
   **Accept and Continue** the Terms.
5. Card: the processor behind BillXPro is N-Genius. Earlier sandbox payments on this account were
   made with a Visa recorded as `411111******1111`, holder **Test User**, expiry **01/2039** — almost
   certainly the standard test number **4111 1111 1111 1111**; use any 3-digit CVV and complete any
   3-D Secure step shown. If it is declined, ask Abzer for their current sandbox test cards.

**Expect**
- Back on `/explore/checkout/return` → a **new** account is signed straight into the course; an
  existing account sees "You're enrolled — check your email".
- Admin → Orders: the order is **paid**, gateway **abzer**, with an Abzer receipt id.
- If you close the tab on Abzer's page instead: within ~10 minutes the sweep enrols you and the
  access email arrives (`pm2 logs | grep "Abzer sweep"`).

**Also try**
| Do | Expect |
|---|---|
| Cancel on Abzer's page | "Payment cancelled — no money was taken", button back to checkout |
| A declined card | "Payment not completed" |
| Open the return page of an unpaid order (`/explore/checkout/return?gateway=abzer&orderId=<id>&status=PAYMENT_GATEWAY_SUCCESS`) | **Not** enrolled — "Payment being confirmed". Only Abzer's own record can make an order paid. |
| Pay again with the same email | Second purchase works; still one enrolment per course |

---

## 3. Tamara — LIVE keys, real money

Tamara cannot be tested on live keys without paying. Either ask Tamara for **sandbox** keys (then
UAE test numbers: any `+971 5x…` approves, `+971 526422337` is declined, the OTP shows on screen,
3-D Secure password `Checkout1!`), or do **one small real purchase and refund it**:

1. In admin, make a **test course** priced low (your live limits: **AED 1 – 100,000**), published.
2. On `/explore`, buy it with **your own** UAE mobile and email, choose **Tamara** → **Pay**.
3. On `checkout.tamara.co` complete the first instalment with your own card.
4. **Expect:** back on our site, signed in to the course; Admin → Orders: **paid**, gateway **tamara**;
   Tamara partner portal: the order **captured** (we capture immediately — a course is delivered at once).
5. **Refund it:** Admin → Orders → the order → **Refund**. Expect **refunded** in admin and in the
   Tamara portal; Tamara returns the instalment to your card.

**Also check**
| Do | Expect |
|---|---|
| Cancel on Tamara's page | "Payment cancelled", no order paid, can try again |
| Close the tab after paying | The webhook (production) or the sweep (≤10 min) enrols you |
| A buyer Tamara refuses | Tamara greyed out with Tamara's own message; Card still available |

---

## 4. What the logs should say (production)
| Line | Meaning |
|---|---|
| `Abzer: order fulfilled … via: "verified"` | confirmed against Abzer's own record |
| `Tamara: order fulfilled` | authorised **and** captured |
| `Abzer sweep: recovered paid orders` / `Tamara sweep: …` | a lost webhook was caught |
| `Abzer webhook: invalid or missing secret header` | the console header is wrong or missing |
| `Tamara webhook: JWT rejected` with `bad-signature` | `TAMARA_NOTIFICATION_TOKEN` is wrong |
| `Abzer: customer-code conflict (409) — asking again` | Abzer's per-minute limit (see 6) — retried automatically |

---

## 5. Automated tests (no money, from `backend/`)
```bash
bun run test:abzer            # 68 checks, Abzer stubbed + real DB + real HTTP
bun run test:paymentamounts   # random prices × coupons through Tabby/Tamara/Abzer
bun run test:tamarafulfil     # Tamara authorise/capture races, sweep, risk block
ABZER_ACCESS_KEY=… ABZER_SECRET_KEY=… bun run test:abzersandbox   # the REAL Abzer sandbox only
```

## 6. Known limits (outside our code)
- **Abzer**: every payment request creates a new customer coded by the minute + one random digit —
  about **11 checkouts per minute** account-wide; beyond that Abzer answers 409. We retry for up to
  ~22 s. Reported to Abzer.
- **Tabby**: its Cloudflare edge blocks ~10+ requests/second from one address for several seconds.
  We pace to 6/second and retry. Ask Tabby to allow-list the API server's IP if traffic grows.
- **A coupon worth the whole price** is refused at checkout ("contact us") — no gateway can charge
  0.00. Whether such coupons should enrol for free is a business decision.
