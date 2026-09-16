/* ─────────────────────────────────────────────────────────────
   Prove — against Google, not against our own code — that the LMS's
   auto-generated Meet links are OPEN, so a student joins without the host
   having to admit them.

   Why this is needed. createGoogleMeetLink() asks Google to open every room,
   but that call is deliberately non-fatal: if the Google token lacks the
   `meetings.space.settings` scope it 403s and the room silently stays
   knock-required. Nothing in the database records what actually happened. So
   the only honest way to answer "are our links open?" is to ask Google for the
   real access type of real meetings.

   What it does:
     1. Prints the configured intent (GOOGLE_MEET_ACCESS_TYPE, default OPEN).
     2. Asks Google which scopes the support@ refresh token actually carries,
        and flags whether `meetings.space.settings` is among them.
     3. Reads the live access type of the most recent live-class meetings via
        the Meet API and reports OPEN vs knock-required.
     4. With --reopen, re-applies OPEN to any that are not (best-effort; a room
        hosted by an internal instructor can only be changed with that
        instructor's own auth, which this reports rather than guesses at).

   Read-only unless --reopen is given.

   Usage (from backend/):
     bun src/scripts/verify-meet-access.ts
     bun src/scripts/verify-meet-access.ts --limit=20
     bun src/scripts/verify-meet-access.ts --reopen
───────────────────────────────────────────────────────────── */
import mongoose from 'mongoose'
import { google } from 'googleapis'

const args = new Map<string, string>()
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([a-z-]+)(?:=(.*))?$/)
  if (m) args.set(m[1]!, m[2] ?? 'true')
}
const LIMIT  = Number(args.get('limit') ?? 15)
const REOPEN = args.has('reopen')

const CLIENT_ID     = process.env['GOOGLE_CLIENT_ID']
const CLIENT_SECRET = process.env['GOOGLE_CLIENT_SECRET']
const REFRESH_TOKEN = process.env['GOOGLE_REFRESH_TOKEN']
const CONFIGURED    = (process.env['GOOGLE_MEET_ACCESS_TYPE'] ?? 'OPEN').trim().toUpperCase() || 'OPEN'
const SETTINGS_SCOPE = 'https://www.googleapis.com/auth/meetings.space.settings'

console.log('═'.repeat(66))
console.log('  Google Meet — are auto-generated links OPEN (join without host)?')
console.log('═'.repeat(66))
console.log(`\n  Configured intent : GOOGLE_MEET_ACCESS_TYPE = ${CONFIGURED}` +
            (CONFIGURED === 'OPEN' ? '  ✓ (anyone with the link joins)' :
             CONFIGURED === 'OFF' || CONFIGURED === 'NONE' ? '  ⚠ opening is DISABLED — links stay knock-required' :
             '  ⚠ not OPEN — students will knock'))

if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
  console.error('\n❌ GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN are not all set.')
  console.error('   Cannot talk to Google. This is also why link-opening would fail at class creation.')
  process.exit(1)
}

const oauth = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET)
oauth.setCredentials({ refresh_token: REFRESH_TOKEN })

/* ── 1. what scopes does the support@ token actually carry? ── */
let hasSettingsScope = false
try {
  const { token } = await oauth.getAccessToken()
  const info = await oauth.getTokenInfo(token!)
  const scopes = info.scopes ?? []
  hasSettingsScope = scopes.includes(SETTINGS_SCOPE)
  console.log(`\n  support@ token scopes (${scopes.length}):`)
  for (const s of scopes) console.log(`     ${s === SETTINGS_SCOPE ? '★' : '·'} ${s}`)
  console.log(`\n  Can this token OPEN a room?  ${hasSettingsScope ? '✅ yes — it carries meetings.space.settings' : '❌ NO — meetings.space.settings is MISSING'}`)
  if (!hasSettingsScope) {
    console.log('     → Re-run get-google-token.ts (now updated to request it) and replace')
    console.log('       GOOGLE_REFRESH_TOKEN. Until then, support-hosted / external-instructor')
    console.log('       links stay knock-required whatever GOOGLE_MEET_ACCESS_TYPE says.')
  }
} catch (err: any) {
  console.log(`\n  ⚠ could not read token scopes: ${err?.message ?? err}`)
}

/* ── 2. the real access type of recent meetings ── */
await mongoose.connect(process.env['DATABASE_URL'] ?? 'mongodb://localhost:27017/lms')
const { LiveClassModel } = await import('@/models/schema.ts')
const classes = await LiveClassModel.find({ googleMeetCode: { $exists: true, $nin: [null, ''] } })
  .sort({ scheduledStart: -1 }).limit(LIMIT)
  .select('title scheduledStart googleMeetCode instructorId').lean()

console.log(`\n  Checking the ${classes.length} most recent Meet-backed classes against the live Meet API:\n`)
const meet = google.meet({ version: 'v2', auth: oauth })
const tally: Record<string, number> = {}
const notOpen: { code: string; title: string; access: string }[] = []

for (const c of classes as any[]) {
  const code = c.googleMeetCode
  try {
    const res = await meet.spaces.get({ name: `spaces/${code}` })
    const access = res.data.config?.accessType ?? 'UNKNOWN'
    tally[access] = (tally[access] ?? 0) + 1
    const when = c.scheduledStart ? new Date(c.scheduledStart).toISOString().slice(0, 16) : '—'
    console.log(`     ${access === 'OPEN' ? '✅ OPEN         ' : '⚠  ' + access.padEnd(12)} ${when}  ${String(c.title).slice(0, 40)}`)
    if (access !== 'OPEN') notOpen.push({ code, title: c.title, access })
  } catch (err: any) {
    const status = err?.response?.status ?? err?.status
    /* 403 here usually means the support token does not host that room (an
       internal instructor does), so it cannot even read its settings. */
    console.log(`     ❓ ${String(status ?? '?').padEnd(13)} ${String(c.title).slice(0, 40)}  (${status === 403 ? 'hosted by the instructor — check with their account' : (err?.message ?? 'error').slice(0, 40)})`)
    tally['unreadable'] = (tally['unreadable'] ?? 0) + 1
  }
}

console.log('\n  Summary:')
for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
  console.log(`     ${String(v).padStart(4)}  ${k}${k === 'OPEN' ? '  (join without host ✓)' : k === 'unreadable' ? '  (not hosted by support@ — verify separately)' : '  (students must knock)'}`)
}

/* ── 3. optionally re-open the ones we can ── */
if (REOPEN && notOpen.length && hasSettingsScope) {
  console.log(`\n  --reopen: setting ${notOpen.length} room(s) to OPEN…`)
  for (const r of notOpen) {
    try {
      await meet.spaces.patch({
        name: `spaces/${r.code}`, updateMask: 'config.accessType',
        requestBody: { config: { accessType: 'OPEN' } },
      })
      console.log(`     ✅ opened  ${r.title}`)
    } catch (err: any) {
      console.log(`     ❌ ${String(err?.response?.status ?? '?')}  ${r.title}  (${err?.response?.status === 403 ? 'hosted elsewhere' : 'failed'})`)
    }
  }
} else if (REOPEN && !hasSettingsScope) {
  console.log('\n  --reopen skipped: the token lacks meetings.space.settings, so it cannot open rooms.')
} else if (notOpen.length) {
  console.log(`\n  ${notOpen.length} room(s) are knock-required. Re-run with --reopen to open the ones support@ hosts.`)
}

console.log(`\n  Verdict: ${
  CONFIGURED === 'OPEN' && hasSettingsScope && !Object.keys(tally).some(k => k !== 'OPEN' && k !== 'unreadable')
    ? '✅ new auto-generated links are OPEN — students join without the host.'
    : '⚠  not fully open yet — see the flags above.'}\n`)

await mongoose.disconnect()
process.exit(0)
