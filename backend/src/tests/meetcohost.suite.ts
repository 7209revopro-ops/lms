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

const { staffMeetCohosts, ensureMeetCohosts, meetJoinAsViewer, meetAutoRecord, __test } = await import('@/services/googleMeet.service.ts')

/* A stand-in for Google: one meeting space, its members, and every request. */
function fakeGoogle(o: { members?: string[]; refuse?: string[]; listFails?: boolean; refusePatch?: boolean } = {}) {
  const calls: Array<{ method: string; url: string; email?: string; data?: unknown }> = []
  const members = new Map((o.members ?? []).map((e, i) => [`spaces/s1/members/m${i}`, e.toLowerCase()]))
  let n = members.size
  const auth = {
    request: async (r: { url?: string; method?: string; data?: { email?: string } }) => {
      const method = String(r.method ?? 'GET'), url = String(r.url ?? '')
      calls.push({ method, url, ...(r.data?.email ? { email: r.data.email } : {}), data: r.data })
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
      if (method === 'PATCH') {
        if (o.refusePatch) throw Object.assign(new Error('Unsupported for this edition'), { status: 400 })
        return { data: {} }
      }
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

  /* ── V ────────────────────────────────────────────── */
  section('V  students join as viewers')
  delete process.env['GOOGLE_MEET_JOIN_AS_VIEWER']
  check('V1 off by default', meetJoinAsViewer() === false)
  process.env['GOOGLE_MEET_JOIN_AS_VIEWER'] = ' ON '
  check('V2 GOOGLE_MEET_JOIN_AS_VIEWER=on turns it on', meetJoinAsViewer() === true)
  delete process.env['GOOGLE_MEET_JOIN_AS_VIEWER']
  const viewerPatch = (g: ReturnType<typeof fakeGoogle>) =>
    g.calls.findIndex(c => c.method === 'PATCH' && c.url.endsWith('/v2/spaces/s1?updateMask=config.moderationRestrictions.defaultJoinAsViewerType'))
  {
    const g = fakeGoogle()
    const m = await __test.createCoHostedMeetingWith(g.auth, { ...base, cohostEmail: 'teacher@gmail.com', staffCohosts: [STAFF], joinAsViewer: true })
    const lastCohost = g.calls.map(c => c.method === 'POST' && c.url.endsWith('/members')).lastIndexOf(true)
    check('V3 a class room is switched to viewers, after the instructor is co-host',
      viewerPatch(g) > lastCohost && lastCohost >= 0 && m.meetSpace?.cohost === 'teacher@gmail.com', JSON.stringify(g.calls))
  }
  {
    const g = fakeGoogle({ refuse: ['teacher@gmail.com'] })
    await __test.createCoHostedMeetingWith(g.auth, { ...base, cohostEmail: 'teacher@gmail.com', staffCohosts: [STAFF], joinAsViewer: true })
    check('V4 not switched when the instructor could not be made co-host (they would be muted)', viewerPatch(g) === -1, JSON.stringify(g.calls))
  }
  {
    const g = fakeGoogle()
    await __test.createCoHostedMeetingWith(g.auth, { ...base, cohostEmail: 'mentor@gmail.com' })
    check('V5 a meeting that does not ask (mentor meetings) is not switched', viewerPatch(g) === -1, JSON.stringify(g.calls))
  }
  {
    const g = fakeGoogle({ refusePatch: true })
    const m = await __test.createCoHostedMeetingWith(g.auth, { ...base, cohostEmail: 'teacher@gmail.com', staffCohosts: [STAFF], joinAsViewer: true })
    check('V6 Google refusing viewer mode still leaves a working room', m.meetingCode === 'abc-defg-hij' && m.meetSpace?.cohost === 'teacher@gmail.com', JSON.stringify(m))
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

  /* ── R ────────────────────────────────────────────── */
  section('R  every room records itself (2026-11-16)')
  const RECMASK = 'config.artifactConfig.recordingConfig.autoRecordingGeneration'
  const recPatch = (g: ReturnType<typeof fakeGoogle>) =>
    g.calls.find(c => c.method === 'PATCH' && c.url.endsWith(`/v2/spaces/s1?updateMask=${RECMASK}`))
  const recValue = (c: { data?: unknown } | undefined) =>
    (c?.data as { config?: { artifactConfig?: { recordingConfig?: { autoRecordingGeneration?: string } } } } | undefined)
      ?.config?.artifactConfig?.recordingConfig?.autoRecordingGeneration
  delete process.env['MEET_AUTO_RECORD']
  check('R1 on by default', meetAutoRecord() === true)
  process.env['MEET_AUTO_RECORD'] = ' Off '
  check('R2 MEET_AUTO_RECORD=off turns it off', meetAutoRecord() === false)
  delete process.env['MEET_AUTO_RECORD']
  {
    const g = fakeGoogle()
    await __test.createCoHostedMeetingWith(g.auth, { ...base, cohostEmail: 'teacher@gmail.com', staffCohosts: [STAFF] })
    check('R3 a new class room is switched to record itself', recValue(recPatch(g)) === 'ON', JSON.stringify(g.calls))
    const create = g.calls.find(c => c.method === 'POST' && c.url.endsWith('/v2/spaces'))
    check('R4 ...after the room exists, never inside the create call (a refusal cannot cost the class)',
      !JSON.stringify(create?.data ?? {}).includes('artifactConfig'), JSON.stringify(create?.data))
  }
  {
    const g = fakeGoogle()
    await __test.createCoHostedMeetingWith(g.auth, { ...base, cohostEmail: 'mentor@gmail.com' })
    check('R5 mentor and staff meetings record too', recValue(recPatch(g)) === 'ON', JSON.stringify(g.calls))
  }
  {
    process.env['MEET_AUTO_RECORD'] = 'off'
    const g = fakeGoogle()
    await __test.createCoHostedMeetingWith(g.auth, { ...base, cohostEmail: 'teacher@gmail.com', staffCohosts: [STAFF] })
    check('R6 with MEET_AUTO_RECORD=off nothing is switched', recPatch(g) === undefined, JSON.stringify(g.calls))
    delete process.env['MEET_AUTO_RECORD']
  }
  {
    const g = fakeGoogle({ refusePatch: true })
    const m = await __test.createCoHostedMeetingWith(g.auth, { ...base, cohostEmail: 'teacher@gmail.com', staffCohosts: [STAFF] })
    check('R7 Google refusing auto-record still leaves a working room', m.meetingCode === 'abc-defg-hij' && m.meetSpace?.cohost === 'teacher@gmail.com', JSON.stringify(m))
  }
  {
    const g = fakeGoogle()
    const off = await __test.patchAutoRecord(g.auth, 'spaces/s1', false)
    check('R8 an existing room can be switched off again (the script\'s --off)', off === null && recValue(recPatch(g)) === 'OFF', JSON.stringify(g.calls))
    const r = await __test.patchAutoRecord(fakeGoogle({ refusePatch: true }).auth, 'spaces/s1', true)
    check('R9 a refusal comes back as a reason, never a throw', typeof r === 'string' && r.includes('400'), String(r))
  }

  /* ── G ────────────────────────────────────────────── */
  section('G  the recording reaches the class')
  /* A stand-in for Google's conference records, recordings and Drive. */
  function fakeRecordings(o: { confs: Array<{ name: string; startTime: string }>; recs: Record<string, Array<{ state: string; file?: string }>>; shareFails?: boolean }) {
    const calls: Array<{ method: string; url: string; data?: unknown }> = []
    const meet = { request: async (r: { url: string; method?: string }) => {
      calls.push({ method: String(r.method ?? 'GET'), url: r.url })
      if (r.url.includes('/conferenceRecords?filter=')) return { data: { conferenceRecords: o.confs } }
      const conf = r.url.replace(/^.*\/v2\//, '').replace(/\/recordings$/, '')
      return { data: { recordings: (o.recs[conf] ?? []).map(x => ({ state: x.state, ...(x.file ? { driveDestination: { file: x.file } } : {}) })) } }
    } }
    const drive = { request: async (r: { url: string; method?: string; data?: unknown }) => {
      calls.push({ method: String(r.method ?? 'GET'), url: r.url, data: r.data })
      if (o.shareFails) throw Object.assign(new Error('Google Drive API has not been used in project'), { status: 403 })
      return { data: {} }
    } }
    const shares = () => calls.filter(c => c.url.includes('/drive/v3/files/'))
    return { meet: meet as any, drive: drive as any, calls, shares }
  }
  const cls = { scheduledStart: new Date('2026-11-16T15:00:00Z'), durationMins: 90 }
  const FILTER = 'space.name = "spaces/s1"'
  {
    const f = fakeRecordings({ confs: [{ name: 'conferenceRecords/c1', startTime: '2026-11-16T14:58:00Z' }], recs: { 'conferenceRecords/c1': [{ state: 'FILE_GENERATED', file: 'files/f1' }] } })
    const url = await __test.fetchMeetRecordingWith(f.meet, f.drive, FILTER, cls)
    check('G1 a finished recording (FILE_GENERATED) comes back as its Drive link', url === 'https://drive.google.com/file/d/f1/view?usp=sharing', String(url))
    const s = f.shares()[0]
    check('G2 ...shared with anyone holding the link, as a viewer', s?.method === 'POST' && JSON.stringify(s?.data) === JSON.stringify({ role: 'reader', type: 'anyone' }), JSON.stringify(f.shares()))
    check('G3 the room is looked up as asked (by its space name)', decodeURIComponent(f.calls[0]?.url ?? '').includes(FILTER), f.calls[0]?.url)
  }
  {
    const f = fakeRecordings({ confs: [{ name: 'conferenceRecords/c1', startTime: '2026-11-16T14:58:00Z' }], recs: { 'conferenceRecords/c1': [{ state: 'ENDED' }] } })
    const url = await __test.fetchMeetRecordingWith(f.meet, f.drive, FILTER, cls)
    check('G4 a recording still being made (ENDED) is not ready yet', url === null && f.shares().length === 0, String(url))
  }
  {
    const f = fakeRecordings({ confs: [{ name: 'conferenceRecords/c0', startTime: '2026-11-09T15:00:00Z' }], recs: { 'conferenceRecords/c0': [{ state: 'FILE_GENERATED', file: 'files/old' }] } })
    const url = await __test.fetchMeetRecordingWith(f.meet, f.drive, FILTER, cls)
    check('G5 a recording from another day in the same room is not this class\'s', url === null, String(url))
  }
  {
    const f = fakeRecordings({
      confs: [{ name: 'conferenceRecords/c2', startTime: '2026-11-16T15:20:00Z' }, { name: 'conferenceRecords/c1', startTime: '2026-11-16T14:58:00Z' }],
      recs: { 'conferenceRecords/c1': [], 'conferenceRecords/c2': [{ state: 'FILE_GENERATED', file: 'files/f2' }] },
    })
    const url = await __test.fetchMeetRecordingWith(f.meet, f.drive, FILTER, cls)
    check('G6 a class that dropped and restarted: the recording of the later call is found', url === 'https://drive.google.com/file/d/f2/view?usp=sharing', String(url))
  }
  {
    const f = fakeRecordings({ confs: [{ name: 'conferenceRecords/c1', startTime: '2026-11-16T14:58:00Z' }], recs: { 'conferenceRecords/c1': [{ state: 'FILE_GENERATED', file: 'files/f1' }] }, shareFails: true })
    const url = await __test.fetchMeetRecordingWith(f.meet, f.drive, FILTER, cls)
    check('G7 not shareable yet → no link (students never get one they cannot open); found again next round', url === null, String(url))
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
