/* ─────────────────────────────────────────────────────────────
   The staff co-host on Google Meet classes (services/googleMeet.service.ts).

     S  which account: deltatradinguniverse@gmail.com unless
        GOOGLE_MEET_STAFF_COHOSTS says otherwise; "off" turns it off
     E  ensureMeetCohosts adds what is missing, in order, skips who is there,
        and reports — never throws — what Google refuses
     C  a new class meeting: the staff co-host FIRST, then the instructor; once
        each; never the owner; mentor meetings (no staff list) are unchanged
     Y  changing the instructor never takes the staff co-host out, and adds it
        to a meeting made before it existed

   Runs against a stand-in for Google that records every call — no network,
   no database. Run: bun src/tests/meetcohost.suite.ts
───────────────────────────────────────────────────────────── */
export {}

let pass = 0, fail = 0
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; lines.push(`  PASS  ${label}`) }
  else    { fail++; lines.push(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}
function section(n: string) { lines.push(`\n${n}`) }

const { staffMeetCohosts, ensureMeetCohosts, __test } = await import('@/services/googleMeet.service.ts')

/* A stand-in for Google: one meeting space, its members, and every request. */
function fakeGoogle(o: { members?: string[]; refuse?: string[]; listFails?: boolean } = {}) {
  const calls: Array<{ method: string; url: string; email?: string }> = []
  const members = new Map((o.members ?? []).map((e, i) => [`spaces/s1/members/m${i}`, e.toLowerCase()]))
  let n = members.size
  const auth = {
    request: async (r: { url?: string; method?: string; data?: { email?: string } }) => {
      const method = String(r.method ?? 'GET'), url = String(r.url ?? '')
      calls.push({ method, url, ...(r.data?.email ? { email: r.data.email } : {}) })
      if (method === 'POST' && url.endsWith('/v2/spaces')) {
        return { data: { name: 'spaces/s1', meetingUri: 'https://meet.google.com/abc-defg-hij', meetingCode: 'abc-defg-hij', config: { accessType: 'OPEN' } } }
      }
      if (url.endsWith('/members') && method === 'GET') {
        if (o.listFails) throw Object.assign(new Error('backend error'), { status: 500 })
        return { data: { members: [...members].map(([name, email]) => ({ name, email })) } }
      }
      if (url.endsWith('/members') && method === 'POST') {
        const email = String(r.data?.email ?? '').toLowerCase()
        if (o.refuse?.includes(email)) throw Object.assign(new Error('The caller does not have permission'), { status: 403 })
        members.set(`spaces/s1/members/m${n++}`, email)
        return { data: {} }
      }
      if (method === 'DELETE') { members.delete(url.replace(/^.*\/v2\//, '')); return { data: {} } }
      return { data: { id: 'event-1' } }                 // the calendar event
    },
  }
  const added = () => calls.filter(c => c.method === 'POST' && c.url.endsWith('/members')).map(c => c.email)
  const removed = () => calls.filter(c => c.method === 'DELETE').length
  return { auth: auth as any, calls, members: () => [...members.values()].sort(), added, removed }
}

const STAFF = 'deltatradinguniverse@gmail.com'
const quiet = console.warn, quietInfo = console.info
console.warn = () => {}; console.info = () => {}           // the service logs every Google call

try {
  /* ── S ────────────────────────────────────────────── */
  section('S  which account co-hosts')
  delete process.env['GOOGLE_MEET_STAFF_COHOSTS']
  check('S1 by default, deltatradinguniverse@gmail.com', JSON.stringify(staffMeetCohosts()) === JSON.stringify([STAFF]), JSON.stringify(staffMeetCohosts()))
  process.env['GOOGLE_MEET_STAFF_COHOSTS'] = ' Ops@Delta.test, b@x.test ,ops@delta.test, not-an-address '
  check('S2 a list is cleaned: lower-cased, de-duplicated, non-addresses dropped',
    JSON.stringify(staffMeetCohosts()) === JSON.stringify(['ops@delta.test', 'b@x.test']), JSON.stringify(staffMeetCohosts()))
  process.env['GOOGLE_MEET_STAFF_COHOSTS'] = 'off'
  check('S3 "off" turns it off', staffMeetCohosts().length === 0)
  delete process.env['GOOGLE_MEET_STAFF_COHOSTS']

  /* ── E ────────────────────────────────────────────── */
  section('E  adding what is missing')
  {
    const g = fakeGoogle({ members: ['b@x.test'] })
    const r = await ensureMeetCohosts(g.auth, 'spaces/s1', ['a@x.test', 'B@x.test', 'c@x.test', 'a@x.test'])
    check('E1 adds the missing ones, in order', JSON.stringify(g.added()) === JSON.stringify(['a@x.test', 'c@x.test']), JSON.stringify(g.added()))
    check('E2 skips who is already a co-host', JSON.stringify(r.present) === JSON.stringify(['b@x.test']), JSON.stringify(r))
  }
  {
    const g = fakeGoogle({ refuse: ['c@x.test'] })
    const r = await ensureMeetCohosts(g.auth, 'spaces/s1', ['a@x.test', 'c@x.test'])
    check('E3 what Google refuses is reported, not thrown', JSON.stringify(r.failed) === JSON.stringify(['c@x.test']) && r.added.length === 1, JSON.stringify(r))
  }
  {
    const g = fakeGoogle({ listFails: true })
    const r = await ensureMeetCohosts(g.auth, 'spaces/s1', ['a@x.test'])
    check('E4 cannot list members — still adds', JSON.stringify(r.added) === JSON.stringify(['a@x.test']), JSON.stringify(r))
  }

  /* ── C ────────────────────────────────────────────── */
  section('C  a new class meeting')
  const base = { title: 'MBT 6 · Malayalam batch', start: new Date('2026-10-30T15:00:00Z'), end: new Date('2026-10-30T17:00:00Z'), host: 'support@deltagroups.ae' }
  {
    const g = fakeGoogle()
    const m = await __test.createCoHostedMeetingWith(g.auth, { ...base, cohostEmail: 'teacher@gmail.com', staffCohosts: [STAFF] })
    check('C1 the staff co-host first, then the instructor',
      JSON.stringify(g.added()) === JSON.stringify([STAFF, 'teacher@gmail.com']), JSON.stringify(g.added()))
    check('C2 the class still records the instructor as its co-host', m.meetSpace?.cohost === 'teacher@gmail.com', JSON.stringify(m.meetSpace))
  }
  {
    const g = fakeGoogle()
    await __test.createCoHostedMeetingWith(g.auth, { ...base, cohostEmail: STAFF, staffCohosts: [STAFF] })
    check('C3 an instructor who IS the staff account is added once', JSON.stringify(g.added()) === JSON.stringify([STAFF]), JSON.stringify(g.added()))
  }
  {
    const g = fakeGoogle()
    await __test.createCoHostedMeetingWith(g.auth, { ...base, cohostEmail: 'teacher@gmail.com', staffCohosts: ['support@deltagroups.ae'] })
    check('C4 the owner is never made its own co-host', JSON.stringify(g.added()) === JSON.stringify(['teacher@gmail.com']), JSON.stringify(g.added()))
  }
  {
    const g = fakeGoogle()
    await __test.createCoHostedMeetingWith(g.auth, { ...base, cohostEmail: 'mentor@gmail.com' })
    check('C5 a meeting that asks for no staff (mentor meetings) is unchanged', JSON.stringify(g.added()) === JSON.stringify(['mentor@gmail.com']), JSON.stringify(g.added()))
  }

  /* ── Y ────────────────────────────────────────────── */
  section('Y  changing the instructor')
  const space = { name: 'spaces/s1', host: 'support@deltagroups.ae', cohost: 'old@gmail.com' }
  {
    const g = fakeGoogle({ members: [STAFF, 'old@gmail.com'] })
    const r = await __test.syncMeetSpaceWith(g.auth, space, { cohost: 'new@gmail.com' })
    check('Y1 the old instructor goes, the new one comes, the staff co-host stays',
      JSON.stringify(g.members()) === JSON.stringify([STAFF, 'new@gmail.com'].sort()) && r.cohost === 'new@gmail.com', JSON.stringify(g.members()))
  }
  {
    const g = fakeGoogle({ members: [STAFF] })
    await __test.syncMeetSpaceWith(g.auth, { ...space, cohost: STAFF }, { cohost: 'new@gmail.com' })
    check('Y2 a staff address is never removed as the "outgoing instructor"', g.removed() === 0 && g.members().includes(STAFF), JSON.stringify(g.members()))
  }
  {
    const g = fakeGoogle({ members: ['old@gmail.com'] })
    await __test.syncMeetSpaceWith(g.auth, space, { cohost: 'new@gmail.com' })
    check('Y3 a meeting made before this gets the staff co-host on its next instructor change', g.members().includes(STAFF), JSON.stringify(g.members()))
  }
} catch (err) {
  fail++
  lines.push(`  FAIL  suite threw — ${(err as Error).message}\n${(err as Error).stack}`)
} finally {
  console.warn = quiet; console.info = quietInfo
}

console.log(lines.join('\n'))
console.log(`\nmeetcohost.suite — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
