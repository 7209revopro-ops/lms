/* ─────────────────────────────────────────────────────────────
   Who is being rate-limited, and what happens when nobody says.

   Both frontends run on Vercel and call this API server-to-server, so without
   a relayed client address every visitor arrives from the same place and lands
   in ONE bucket. The limits then stop being per-person and become per-platform:
   15 sign-ins per 15 minutes and 15 document uploads per hour, shared by
   everybody. A student sees "Too many requests" on their first attempt.

   The relay is proven with PROXY_SHARED_SECRET, and the failure this suite
   exists for is the HALF-installed one: the secret present here, absent in the
   Vercel projects. The existing boot warning cannot see that — it only checks
   this side — so the misconfiguration looked like a product limit.

   Asserted here:
     · a proven relay buckets per visitor, and an unproven one never can;
     · a forged header is worthless without the secret;
     · session refresh no longer shares the sign-in budget, because staying
       logged in should not spend attempts reserved for guessing passwords.

   Run: bun run test:ratelimitkey
───────────────────────────────────────────────────────────── */
process.env.NODE_ENV = 'test'
process.env.PROXY_SHARED_SECRET = 'test-relay-secret'

export {}

let pass = 0, fail = 0
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; lines.push(`  PASS  ${label}`) }
  else    { fail++; lines.push(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}
function section(n: string) { lines.push(`\n${n}`) }

const { clientKey, authRateLimit, refreshRateLimit, signupUploadRateLimit } =
  await import('@/middleware/rateLimit.middleware.ts')

/* Just enough of an Express request for keyGenerator. */
function req(headers: Record<string, string> = {}, ip = '10.0.0.9', user?: { id: string }): any {
  return { headers, ip, ...(user ? { user } : {}) }
}
const SECRET = 'test-relay-secret'

try {
  /* ═══════════════════════════════════════════════ */
  section('A · a proven relay buckets per visitor')
  {
    const a = clientKey(req({ 'x-lms-proxy-secret': SECRET, 'x-lms-client-ip': '203.0.113.7' }))
    const b = clientKey(req({ 'x-lms-proxy-secret': SECRET, 'x-lms-client-ip': '198.51.100.4' }))
    check('the visitor address becomes the bucket', a === 'ip:203.0.113.7', a)
    check('and two visitors get DIFFERENT buckets — the whole point', a !== b, `${a} / ${b}`)

    /* An IPv6 host is routinely handed a whole /64, so limiting one /128
       limits nothing. */
    const v6 = clientKey(req({ 'x-lms-proxy-secret': SECRET, 'x-lms-client-ip': '2001:0db8:85a3:0000:1:2:3:4' }))
    check('IPv6 is bucketed by /64, not by a single address',
      v6.includes('::/64'), v6)
  }

  /* ═══════════════════════════════════════════════ */
  section('B · without the secret there is nothing to trust')
  {
    /* The header alone is forgeable by anyone calling the API directly, so it
       must count for nothing. Both of these are one bucket — which is exactly
       the production symptom. */
    const forged1 = clientKey(req({ 'x-lms-client-ip': '203.0.113.7' }))
    const forged2 = clientKey(req({ 'x-lms-client-ip': '198.51.100.4' }))
    check('an unsigned client-ip header is ignored', !forged1.includes('203.0.113.7'), forged1)
    check('and everybody collapses into the SAME bucket', forged1 === forged2, `${forged1} / ${forged2}`)

    const wrongSecret = clientKey(req({ 'x-lms-proxy-secret': 'not-it', 'x-lms-client-ip': '203.0.113.7' }))
    check('a wrong secret is no better than none', !wrongSecret.includes('203.0.113.7'), wrongSecret)

    /* A relayed value that is not an address must be discarded, not trusted —
       otherwise an attacker mints a fresh bucket per request and the limiter
       stops existing. */
    for (const junk of ['not-an-ip', '../../etc', '']) {
      const k = clientKey(req({ 'x-lms-proxy-secret': SECRET, 'x-lms-client-ip': junk }))
      check(`a relayed "${junk || '(empty)'}" is refused rather than made into a bucket`,
        !k.includes(junk) || junk === '', k)
    }
  }

  /* ═══════════════════════════════════════════════ */
  section('C · an authenticated caller is the fairest bucket of all')
  {
    const u1 = clientKey(req({}, '10.0.0.9', { id: 'user-aaa' }))
    const u2 = clientKey(req({}, '10.0.0.9', { id: 'user-bbb' }))
    check('a signed-in caller keys on their user id', u1 === 'u:user-aaa', u1)
    check('so two people behind one address are still separate',
      u1 !== u2, `${u1} / ${u2}`)
  }

  /* ═══════════════════════════════════════════════ */
  section('D · refresh no longer shares the sign-in budget')
  {
    /* An access token lives 15 minutes, so every signed-in person spends one
       refresh per 15 minutes just by staying logged in. While that came out of
       the sign-in bucket, normal use competed with brute-force protection —
       and with a shared bucket it drained it outright. */
    const auth    = (authRateLimit as any)
    const refresh = (refreshRateLimit as any)
    check('they are different limiters', auth !== refresh)

    const { readFile } = await import('node:fs/promises')
    const nodePath = (await import('node:path')).default
    const routes = await readFile(
      nodePath.join(process.cwd(), 'src', 'routes', 'auth.routes.ts'), 'utf8')
    const adminRoutes = await readFile(
      nodePath.join(process.cwd(), 'src', 'routes', 'admin.routes.ts'), 'utf8')

    check('the student refresh route uses the refresh limiter',
      /router\.post\('\/refresh',\s*refreshRateLimit/.test(routes))
    check('and the admin one does too — same problem, same fix',
      /router\.post\('\/auth\/refresh',\s*refreshRateLimit/.test(adminRoutes))
    check('while sign-in keeps the tighter bucket',
      /router\.post\('\/login',\s*authRateLimit/.test(routes))

    /* The budget has to be bigger than "one per 15 minutes per tab", or the
       fix is cosmetic. */
    const limiterMax = await readFile(
      nodePath.join(process.cwd(), 'src', 'middleware', 'rateLimit.middleware.ts'), 'utf8')
    const refreshMax = /RATE_LIMIT_REFRESH_MAX',\s*isDev \? \d+ : (\d+)/.exec(limiterMax)?.[1]
    const authMax    = /RATE_LIMIT_AUTH_MAX',\s*isDev \? \d+ : (\d+)/.exec(limiterMax)?.[1]
    check('refresh is given real headroom', Number(refreshMax) >= 30, String(refreshMax))
    check('and more than sign-in, which is the point',
      Number(refreshMax) > Number(authMax), `${refreshMax} vs ${authMax}`)
  }

  /* ═══════════════════════════════════════════════ */
  section('E · the signup upload budget is counted in registrations')
  {
    /* One full signup sends exactly three files. A budget that reads as a file
       count silently means a third as many registrations. */
    const { readFile } = await import('node:fs/promises')
    const nodePath = (await import('node:path')).default
    const src = await readFile(
      nodePath.join(process.cwd(), 'src', 'middleware', 'rateLimit.middleware.ts'), 'utf8')
    const uploadMax = Number(
      /RATE_LIMIT_SIGNUP_UPLOAD_MAX',\s*isDev \? \d+ : (\d+)/.exec(src)?.[1])

    check('the limiter exists', !!signupUploadRateLimit)
    check('and allows at least ten complete registrations an hour',
      uploadMax >= 30, String(uploadMax))
    check('which is divisible by the three files a signup sends',
      uploadMax % 3 === 0, String(uploadMax))

    /* "later" is the one thing the student cannot work out for themselves. */
    check('the refusal says how long to wait, not "later"',
      /wait an hour/i.test(src) && !/try again later\.', 429/.test(src))
  }

} catch (err) {
  fail++
  lines.push(`  FAIL  suite threw — ${(err as Error).message}\n${(err as Error).stack}`)
}

console.log(lines.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
