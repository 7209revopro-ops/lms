/* Shared between AnnouncementPopup (writes/reads it) and the logout sweep in
   lib/api/user.ts (clears it) — one definition, so the two never drift into
   using different keys for the same thing. */
export const ANNOUNCEMENT_DISMISS_PREFIX = 'lms_announcement_dismissed_'
