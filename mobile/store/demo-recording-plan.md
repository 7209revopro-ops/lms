# Delta LMS app: demo screen recording plan

**Goal:** one short video (about 3 minutes) that shows every student feature.
Each scene is a separate clip of 30 seconds or less, so a mistake costs one
retake, not the whole video. The clips are joined afterwards into one MP4.

**How it is recorded:** `adb shell screenrecord` on the phone (1080×2400,
8 Mbps). The clips are joined with ffmpeg.

## Before recording

| # | Step | Why |
|---|------|-----|
| 1 | Run the QA backend (`lms_qa_reviews`, port 8001) with mail, WhatsApp, Meet and push turned off | Nothing real is sent to anyone |
| 2 | Seed one class that is live now, already booked by the demo student, with a Meet link | Shows the **Join** button working |
| 3 | Make sure there is one open class to book and cancel (the Arabic "Reading the order book") | The booking and cancelling scenes |
| 4 | Phone in dark mode, on Wi-Fi. Optional: the owner turns on Do Not Disturb, so no pop-ups appear | Clean, consistent frames |
| 5 | Force-stop the app | Scene 1 starts from a cold launch |

## Scenes (target length)

| # | Scene | What it shows | Time |
|---|-------|---------------|------|
| 1 | **App opening** | Launch from the app drawer: the new icon, the navy splash, then Home (greeting, streak, "What you missed", next class) | 12 s |
| 2 | **Class booking** | Schedule → course card → View modules → Module 01 → Filter (Arabic) → **Book a seat** → Reserved | 30 s |
| 3 | **Cancelling** | On the same card: **Cancel reservation** → confirm → back to Book a seat, seat count restored | 12 s |
| 4 | **My bookings → Join** | Profile → My bookings → the live class → **Join** → Google Meet opens | 18 s |
| 5 | **Chat** | Messages → a mentor → type and send a message → it gets ✓ | 18 s |
| 6 | **Help & support** | Profile → Help & support → the ticket list → open a ticket → the new-ticket form | 15 s |
| 7 | **Assignments** | Learning → Assignments → open one (the brief, and submit) | 15 s |
| 8 | **Learning** | Learning → a course → a lesson (video, notes, Q&A tabs) | 18 s |
| 9 | **Journey and notifications** | Schedule → Your journey; the bell → notifications | 15 s |
| 10 | **Profile and account** | Profile: progress, rate classes, recordings, details, security | 15 s |

**Total:** about 2 min 50 s.

## Afterwards

1. Pull the clips off the phone, then trim the dead time at the start and end of each.
2. Join them in scene order into `delta-lms-app-demo.mp4`.
3. Cancel any seat left booked by the demo. All demo data stays in the QA
   database; no phone settings are changed.
