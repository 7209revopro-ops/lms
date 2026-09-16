/**
 * Get a new Google OAuth2 refresh token for support@deltagroups.ae.
 *
 * Google permanently disabled the old copy-paste (OOB) flow in 2022 —
 * urn:ietf:wg:oauth:2.0:oob now fails with redirect_uri_mismatch. This uses
 * the replacement Google recommends for a desktop/CLI app: a LOOPBACK REDIRECT.
 * The script starts a tiny local web server, Google redirects the browser back
 * to it with the auth code, and the code is captured automatically — nothing to
 * copy and paste.
 *
 * ── ONE-TIME SETUP in Google Cloud Console ──────────────────────────────
 * The OAuth client must allow the loopback URL this prints. In
 * console.cloud.google.com → APIs & Services → Credentials → your OAuth 2.0
 * Client ID (the WEB client whose id is in GOOGLE_CLIENT_ID), under
 * "Authorized redirect URIs" add EXACTLY:
 *     http://localhost:53682/oauth2callback
 * Save, wait a moment, then run this.  (Change the port with --port=NNNNN if
 * 53682 is taken; register the matching URL.)
 *
 * ── RUN IT ON A MACHINE WITH A BROWSER ──────────────────────────────────
 * The redirect goes to localhost, so run this where you can open the browser —
 * e.g. your own PC — not over SSH on the server. It only reads
 * GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET; the refresh token it prints is then
 * copied into the SERVER's backend/.env.
 *
 *   cd backend
 *   bun src/scripts/get-google-token.ts
 */

import { google } from 'googleapis'
import http from 'node:http'
import { URL } from 'node:url'

const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET
if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('❌  Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in backend/.env')
  process.exit(1)
}

const PORT = Number(process.argv.find(a => a.startsWith('--port='))?.slice(7) ?? 53682)
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`

const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/meetings.space.readonly',
  /* Lets this token OPEN a meeting room so students join without knocking.
     Without it, setMeetAccessType() 403s and every auto-generated link stays
     knock-required for support-hosted / external-instructor classes. */
  'https://www.googleapis.com/auth/meetings.space.settings',
  'https://www.googleapis.com/auth/drive.file',
]

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI)
const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope:       SCOPES,
  prompt:      'consent',            // force a refresh_token every time
  login_hint:  'support@deltagroups.ae',
})

console.log('\n────────────────────────────────────────────────────────────')
console.log('  Google OAuth — loopback flow')
console.log('────────────────────────────────────────────────────────────')
console.log(`\n  Redirect URI this uses (must be registered on the OAuth client):`)
console.log(`     ${REDIRECT_URI}`)
console.log(`\n  1. Make sure that exact URI is in the client's Authorized redirect URIs.`)
console.log(`  2. Open this URL, sign in as support@deltagroups.ae, and approve`)
console.log(`     (tick the Meet "space settings" permission):\n`)
console.log('     ' + authUrl + '\n')
console.log(`  Waiting for Google to redirect back to localhost:${PORT} …`)
console.log('────────────────────────────────────────────────────────────\n')

/* A short-lived local server that catches exactly one redirect, exchanges the
   code, prints the refresh token, and shuts down. */
const server = http.createServer(async (req, res) => {
  if (!req.url || !req.url.startsWith('/oauth2callback')) {
    res.writeHead(404); res.end('not here'); return
  }
  const url = new URL(req.url, REDIRECT_URI)
  const code = url.searchParams.get('code')
  const err  = url.searchParams.get('error')

  const reply = (msg: string) => {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(`<!doctype html><meta charset=utf-8>
      <body style="font-family:system-ui;background:#0B0D14;color:#E8EAF0;display:grid;place-items:center;height:100vh;margin:0">
      <div style="text-align:center"><h2 style="color:#0057b8">Delta LMS</h2><p>${msg}</p>
      <p style="color:#6F7788;font-size:13px">You can close this tab and return to the terminal.</p></div>`)
  }

  if (err) {
    reply(`Authorisation failed: ${err}`)
    console.error(`\n❌  Google returned an error: ${err}\n`)
    server.close(); process.exit(1)
  }
  if (!code) { reply('No code received.'); return }

  try {
    const { tokens } = await oauth2Client.getToken(code)
    reply('Authorised. Your refresh token is in the terminal.')
    console.log('✅  Success!\n')
    if (!tokens.refresh_token) {
      console.log('⚠  Google returned NO refresh_token. This happens when the account')
      console.log('   was authorised before without a fresh consent. Revoke the app at')
      console.log('   https://myaccount.google.com/permissions (support@deltagroups.ae)')
      console.log('   and run this again — prompt=consent then returns a new one.\n')
    } else {
      console.log('  Put this in the SERVER\'s backend/.env, then restart the backend:\n')
      console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`)
      console.log('  Granted scopes:')
      for (const s of (tokens.scope ?? '').split(' ').filter(Boolean)) {
        console.log(`     ${s.endsWith('meetings.space.settings') ? '★' : '·'} ${s}`)
      }
      const opensRooms = (tokens.scope ?? '').includes('meetings.space.settings')
      console.log(`\n  Can open rooms: ${opensRooms ? '✅ yes' : '❌ NO — the settings scope was not granted; re-approve and tick it'}`)
    }
  } catch (e: any) {
    reply('Token exchange failed — see the terminal.')
    console.error('❌  Token exchange failed:', e?.response?.data?.error_description ?? e?.message ?? e)
  } finally {
    server.close(); process.exit(0)
  }
})

server.on('error', (e: any) => {
  if (e?.code === 'EADDRINUSE') {
    console.error(`❌  Port ${PORT} is already in use. Re-run with --port=NNNNN and register that URL instead.`)
  } else console.error('❌  Local server error:', e?.message ?? e)
  process.exit(1)
})
server.listen(PORT)
