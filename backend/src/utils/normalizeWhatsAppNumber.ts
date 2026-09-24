/* Creatyvot/Meta expects the recipient as digits-only, no '+', e.g.
   "919876543210" — see the collection's "sendTo" variable note. Students'
   phone numbers are free-text (enrollmentApplication.phone), typed by hand
   at signup, so they arrive with '+', spaces, dashes, parens attached.

   Returns null rather than throwing on anything that doesn't look like a
   real MSISDN, so one bad phone number never aborts a whole send batch —
   callers log-and-skip. 7–15 digits is the ITU E.164 length range. */
export function normalizeWhatsAppNumber(raw: string | null | undefined): string | null {
  if (!raw) return null
  const digits = raw.replace(/[^0-9]/g, '')
  if (digits.length < 7 || digits.length > 15) return null
  /* A local number typed with a leading trunk '0' (e.g. "0501234567") is not
     digits-only wrong, but it IS missing a country code — Meta will accept
     it as a literal number and message nobody. There is no reliable way to
     fix that without knowing the student's country, so it is left as the
     caller's problem to source a properly-coded number; this function only
     guards shape, not correctness. */
  return digits
}
