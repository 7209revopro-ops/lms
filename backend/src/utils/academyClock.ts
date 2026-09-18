/* ─────────────────────────────────────────────────────
   academyClock — what time a class starts, said in a way that cannot mislead

   THE BUG THIS EXISTS FOR. Mail formats class times in a hard-coded
   'Asia/Dubai' at thirteen sites, with NO ZONE LABEL ANYWHERE. The student app
   renders in the student's own DEVICE zone, deliberately. So a Bangalore
   student booked into a class reads one time on screen and a different one in
   every confirmation and reminder — ninety minutes apart, with nothing on
   either to say which is which. That is a missed class, not a cosmetic bug.

   It has not bitten yet only because a student could never be booked into
   another academy's class. Cross-academy classes remove that accident.

   TWO THINGS, AND THE ORDER MATTERS:

     1. ALWAYS PRINT THE ZONE. A labelled wrong time is a question; an
        unlabelled wrong time is a missed class. The label is unconditional, so
        it protects every recipient immediately whether or not anything else is
        ever threaded through.

     2. Render in the RECIPIENT'S academy zone where that is known. Default
        Asia/Dubai, so output for a single-academy install is unchanged to the
        character.

   FORMAT AT THE LEAF. Callers pass Date objects across argument boundaries,
   never pre-formatted strings. sendCancelledNotification types its argument
   `Date | string` and re-parses it, and a localised label has already shipped
   to real students reading "Invalid Date at Invalid Date".

   NOT FOR GATES. bookingClosesAt, the Meet window and the LiveKit window are
   absolute UTC instants, and the 15-minute anchor deliberately matches CLT's.
   Nothing here is about when something happens, only about how it is said.
───────────────────────────────────────────────────── */

/** One academy → one zone. Mirrors admin/src/lib/timezone.ts; slugs are a
    closed enum on the schema, so a new academy is already a code change. */
const ORG_TIMEZONES: Record<string, string> = {
  dubai:     'Asia/Dubai',
  bangalore: 'Asia/Kolkata',
}

/** The academy the backend itself runs on, and the historical default. */
export const DEFAULT_ACADEMY_TZ = 'Asia/Dubai'

const ZONE_TAGS: Record<string, string> = {
  'Asia/Dubai':   'GST',
  'Asia/Kolkata': 'IST',
}

export function zoneForAcademy(slug?: string | null): string {
  return (slug && ORG_TIMEZONES[slug]) || DEFAULT_ACADEMY_TZ
}

/** 'GST' / 'IST', or the raw zone if it is one this product does not know. */
export function zoneTag(tz: string): string {
  return ZONE_TAGS[tz] ?? tz
}

export interface AcademyClock {
  /** 'Friday, September 18, 2026' */
  date:  string
  /** '09:00 AM GST' — ALWAYS carries the zone. */
  time:  string
  /** 'Friday, September 18, 2026 at 09:00 AM GST' */
  full:  string
  /** 'GST' on its own, for callers assembling their own sentence. */
  tag:   string
  zone:  string
}

/* An invalid Date must not reach a student. It has before: a localised label
   shipped as "Invalid Date at Invalid Date". Everything here answers with a
   dash instead, which is obviously missing rather than confidently wrong. */
const MISSING = '—'

export function academyClock(when: Date | string | null | undefined, slug?: string | null): AcademyClock {
  const zone = zoneForAcademy(slug)
  const tag  = zoneTag(zone)
  const d    = when instanceof Date ? when : new Date(String(when ?? ''))

  if (!when || Number.isNaN(d.getTime())) {
    return { date: MISSING, time: MISSING, full: MISSING, tag, zone }
  }

  const date = d.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: zone,
  })
  const time = `${d.toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', hour12: true, timeZone: zone,
  })} ${tag}`

  return { date, time, full: `${date} at ${time}`, tag, zone }
}

/** Just the clock time, labelled. For the short reminders. */
export function academyTime(when: Date | string | null | undefined, slug?: string | null): string {
  return academyClock(when, slug).time
}
