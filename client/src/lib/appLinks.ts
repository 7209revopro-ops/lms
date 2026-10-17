/* ─────────────────────────────────────────────────────────────
   Links that open the student app instead of this website, when the app is
   installed (plan.md §13.4 B4). Served to Apple and Google from
   /.well-known/apple-app-site-association and /.well-known/assetlinks.json.
   Without the app — or before these are configured — every link opens the
   website exactly as before.

   Configured by env, never guessed: a wrong Team ID or signing fingerprint
   silently disables the feature, so an unset one answers 404 instead.
     APPLE_TEAM_ID        10-character Apple Developer Team ID
     ANDROID_CERT_SHA256  the app's signing-certificate SHA-256 fingerprint(s),
                          comma-separated (Play App Signing key first; EAS /
                          upload key too if internal builds should verify)

   Keep PATHS in step with the app's routes (mobile/src/app: j/, s/, the
   Messages tab, the Schedule tab, bookings).
───────────────────────────────────────────────────────────── */

export const APP_ID = 'com.deltainstitutions.lms'

export const PATHS = ['/j/*', '/s/*', '/messages', '/messages/*', '/class-bookings', '/class-bookings/*', '/my-bookings', '/my-bookings/*'] as const

const FINGERPRINT = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/

export function appleTeamId(): string | null {
  const v = process.env.APPLE_TEAM_ID?.trim().toUpperCase()
  return v && /^[A-Z0-9]{10}$/.test(v) ? v : null
}

export function androidFingerprints(): string[] {
  return (process.env.ANDROID_CERT_SHA256 ?? '')
    .split(',').map(s => s.trim().toUpperCase()).filter(s => FINGERPRINT.test(s))
}
