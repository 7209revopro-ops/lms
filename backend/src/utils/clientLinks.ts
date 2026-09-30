/* ─────────────────────────────────────────────────────────────────────────
   Where a notification sends the student.

   One constant, because there are fifteen of these across emails, cron
   reminders, the weekly digest and the booking routes, and they must not
   drift apart.
   ───────────────────────────────────────────────────────────────────────── */

/**
 * The student's class schedule, AS A CHRONOLOGICAL LIST.
 *
 * `/class-bookings` now lands on the Course → Module → Class catalogue
 * (plan.md §9), which is the right first screen for someone browsing but the
 * wrong one for someone arriving from a message about ONE session: it would
 * put every reminder, cancellation and "book again" three drill-downs away
 * from the thing it is about.
 *
 * `?view=sessions` keeps those arrivals on the flat dated list, where the
 * session they were told about is visible on landing.
 */
export const SCHEDULE_LINK = '/class-bookings?view=sessions'

/** The same, absolute, for an email body. */
export const scheduleUrl = (clientUrl?: string): string =>
  `${(clientUrl ?? process.env['CLIENT_URL'] ?? 'http://localhost:3000').replace(/\/+$/, '')}${SCHEDULE_LINK}`

/**
 * One class's own landing page — the join panel, scheduled countdown, live
 * player or recording, whichever fits its current state. Gated the same way
 * for every visitor (booking, enrolment, module, academy, time window), so
 * it is safe to hand to anyone: it enrols no one and unlocks nothing by
 * itself.
 */
export const liveClassWatchPath = (liveClassId: string): string => `/live-classes/${liveClassId}/watch`

/** The same, absolute — the one link staff should copy or share for a class.
    External classes have their own meetingUrl instead; this is the fallback
    for everything else (internal, offline, or external before a link is set)
    and the formula every caller building that link must share, not
    reinvent. */
export const liveClassWatchUrl = (liveClassId: string, clientUrl?: string): string =>
  `${(clientUrl ?? process.env['CLIENT_URL'] ?? 'http://localhost:3000').replace(/\/+$/, '')}${liveClassWatchPath(liveClassId)}`
