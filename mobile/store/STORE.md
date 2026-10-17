# Delta Institutions — App Store & Google Play submission pack

Prepared 2026-10-17 for P4 (plan.md §13.11–13.12). Everything here is a draft
for the owner to confirm; nothing has been submitted.

---

## 1. What only the owner can do (in this order)

| # | Item | Why / where | Blocks |
|---|---|---|---|
| 1 | **Apple Developer Program — organisation** account ($99/yr) | Needs a **D-U-N-S number** (can take 1–2 weeks — start first) | iOS build signing, TestFlight, App Store |
| 2 | **Google Play Console — organisation** account ($25 once) | Identity verification can take days | Play internal testing, release |
| 3 | `npx eas-cli@latest login` then `eas init` in `mobile/` | Links the project; gives the push project id | Cloud builds, push |
| 4 | Push credentials in EAS: **FCM v1** service-account key (Firebase project for `com.deltainstitutions.lms`) and an **APNs key** (Apple account) | `eas credentials` | Push on real phones |
| 5 | Backend `.env`: `PUSH_ENABLED=true`, `MOBILE_MIN_VERSION`, `MOBILE_LATEST_VERSION`, store URLs once live | plan.md §13.4 B3/B5 | Push; forced update |
| 6 | Vercel env (website): `APPLE_TEAM_ID`, `ANDROID_CERT_SHA256` | `/.well-known` app links | WhatsApp/email links opening the app |
| 7 | **Review and publish `/privacy`** (currently marked Draft) and fill in a privacy **contact email** | Both stores require a live privacy URL | Submission |
| 8 | Decide the **payment-method question** at registration (§6) | Store payment rules | Review risk |
| 9 | A **reviewer demo account** (§5) on production | Apple 2.1 / Play "app access" | Review |
| 10 | Deploy the backend (`git pull` + PM2 restart on srv845161) | New endpoints: push tokens, delete code, sessions header, app config | Every app feature against production |

---

## 2. Listing text

**App name:** Delta Institutions
**Subtitle (iOS, ≤30):** Classes, courses and mentors
**Category:** Education
**Short description (Play, ≤80):** Book and join your Delta classes, learn your courses and message your mentors.

**Full description:**

> The Delta Institutions app is for students of Delta Institutions academies in Dubai and Bangalore.
>
> • **Your classes** — see your programme's schedule by course and module, book a seat in a weekly slot, and join online classes in one tap: Google Meet, the in-app classroom or the live stream. In-person classes show where and when.
> • **Reminders that open the class** — get notified before a class starts and tap straight in.
> • **Your courses** — watch lessons, read materials, take quizzes, keep private notes and pick up where you left off.
> • **Class assignments** — submit your work after a class and see your mentor's review.
> • **Message your mentors** — ask the mentors of your programme directly.
> • **Help when you need it** — raise a support request and follow the reply.
>
> New students can apply in the app; an admin approves each enrolment. An existing Delta account signs in with its password or an email code.

**Keywords (iOS, ≤100 chars):** forex,trading course,digital marketing,AI course,Dubai,classes,academy,mentor,learning,Delta

**Screenshots to capture** (6.7" iPhone, 6.5" iPhone, Android phone; light mode; demo data, no real student names):
Home with the next class · Class schedule (module, weekly slots) · Class detail with Join · Lesson video · Quiz · Messages thread · Notifications.

**Support URL:** the website (https://lms.deltainstitutions.com) · **Privacy policy URL:** https://lms.deltainstitutions.com/privacy · **Terms:** https://lms.deltainstitutions.com/terms

---

## 3. Apple privacy "nutrition label" and Google Play Data safety

What the app and its backend actually collect (from the code — keep in step with `/privacy`). All data is **linked to the user**, **not used for tracking**, **not sold**, collected **only to provide the service**.

| Data type (Apple / Google wording) | Collected | Purpose | Optional? |
|---|---|---|---|
| Name, email address | Yes | Account, app functionality | Required |
| Phone number | Yes (full application) | App functionality (class reminders by WhatsApp), account | Full application only |
| Physical address | Yes (full application) | Enrolment records | Full application only |
| Other user contact info (emergency contact) | Yes | Enrolment records | Full application only |
| Photos (profile photo, passport / ID copies) | Yes | Identity verification for enrolment | Full application only |
| Government ID number, date of birth, gender, nationality | Yes — Google: "Other personal info"; Apple: "Other user content / sensitive info" | Enrolment / regulatory | Full application only |
| User content: messages to mentors, support requests, notes, assignments, reviews | Yes | App functionality | Optional |
| Product interaction / app activity (lessons completed, watch time, bookings, attendance) | Yes | App functionality | Required for the service |
| Device or other IDs (app-generated device id, push token) | Yes | Security (device limit), push notifications | Required / optional (push) |
| Crash data | Only if a Sentry DSN is configured | App stability | — |
| Financial info | **No** in the app (no purchases; card data never reaches our servers) | — | — |
| Location | **No** | — | — |

Google Play: data is **encrypted in transit**; users **can request deletion** — in-app (Profile → Delete account) and on the website (Settings). Deletion URL for the Play form: https://lms.deltainstitutions.com/privacy (section "Your choices and rights").

---

## 4. Store rules this app is built around

- **No in-app purchasing (plan.md M6).** The app shows no prices, no checkout, no "buy" link. Enrolment arrives through admissions, CRM imports and the website.
- **Account deletion in the app (Apple 5.1.1(v), Google Play policy).** Profile → Delete account: a real deletion of the account and its records (`services/userCascade.ts`), confirmed with the password **or an emailed code** for students who sign in without a password.
- **Sign in with Apple** is not required: the app has no third-party (Google/Facebook) sign-in.
- **Permissions** are asked only when used, with specific reasons: camera and photos (registration documents), notifications (after sign-in). No microphone (`RECORD_AUDIO` blocked), no location, no tracking — **no App Tracking Transparency prompt needed**.
- **Content protection:** screenshots are blocked on lesson and class-video screens (Android), with an email watermark on video.
- **Export compliance:** standard HTTPS only → `ITSAppUsesNonExemptEncryption = false` (set in `app.json`).
- **Age rating:** 12+ / Teen suggested (financial-trading education; no user-to-user public content — chat is student ↔ own mentor only). Answer "No" to gambling: the courses teach trading, the app offers none.

---

## 5. Notes for the reviewers (App Review Information / Play "App access")

> Delta Institutions is the student app of a training academy. Students are enrolled by the academy; new sign-ups are reviewed by an admin before classes can be booked.
>
> **Demo account:** `<create on production — see below>` / password `<…>`
> The account is an approved student with one course in progress, an upcoming online class it has booked, a past class with a recording, and a mentor conversation, so every screen has content.
>
> **To test account deletion**, please create a new account in the app (Create an account → Express) and delete that one (Profile → Delete account), so the demo account stays available.
>
> The app has no in-app purchases. Course fees are handled by the academy outside the app.

**Demo account to prepare on production:** a student in the Dubai academy, `enrollmentStatus: approved`, its device limit not reached (or devices toggled off for it, so a reviewer's phone is not held for approval), enrolled on one course with a few lessons, booked on a class in the next 1–2 weeks, one past class with a recording, one chat thread. Re-book a future class before each submission.

---

## 6. Decision needed — the payment-method question in the full application

The full registration (copied from the website) asks **"Payment method"** with options including *Card*, *USDT*, *Tabby*, *Tamara*. Nothing is charged in the app, but a reviewer can read a payment selector as steering to outside payment for digital content (Apple 3.1.1 / 3.1.3). Options:

1. **Keep it** (it is a preference the admissions team uses; the course is an in-person/live educational service) and say so in the review notes.
2. **Hide it in the app** — the server already treats it as optional; admissions asks it later.

Recommendation: **2** for the first submission (lowest risk), then revisit.

---

## 7. Beta plan

- **iOS:** `eas build --profile production --platform ios` → `eas submit` → **TestFlight** internal group (staff) → external group of ~20 real students.
- **Android:** `eas build --profile production --platform android` → Play **internal testing** track → closed testing with the same students. (New personal Play accounts must run a 14-day, 12-tester closed test before production; organisation accounts are exempt — another reason to use an organisation account.)
- **Exit criteria (plan.md §13.12 P4):** both stores approve; crash-free sessions ≥ 99.5% over the beta; the money paths pass on real phones — sign in → book → join; WhatsApp Join link → class; chat send/receive; push tap → screen; register (express and full, with camera documents); delete account.
