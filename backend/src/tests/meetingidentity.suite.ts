/* ─────────────────────────────────────────────────────────────
   The name a person wears in the meeting room.

   The meeting application never asks anyone who they are — it reads the name
   out of the LMS's signed ticket, and its entry page has no name field. That is
   what makes the join promptless, and it makes the LMS the sole author of every
   name on every tile.

   So the rule has to hold, and it has to be ONE rule. Before this it was three:
   the host ticket sent the email's local part, and the two student paths sent
   the LMS display name. An instructor and their own student appeared under
   different conventions in the same room.

   Run: bun run test:meetingidentity
───────────────────────────────────────────────────────────── */
process.env.NODE_ENV     = 'test'
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_meetingidentity_suite'
process.env.PORT         = '0'
process.env.SMTP_HOST    = ''
process.env.SMTP_USER    = ''
/* CLT is not reachable from a test, and must not be: the identity decision is
   made before any call to it. */
process.env.CLT_BASE_URL = ''

/* A throwaway signing key, so the ticket is real and can be decoded. Generated
   rather than read from .env - a test must never depend on, or expose, the key
   an environment actually signs with. */
{
  const { generateKeyPairSync } = await import('node:crypto')
  const { privateKey } = generateKeyPairSync('ed25519')
  process.env.INTEGRATION_JWT_PRIVATE_KEY = Buffer.from(
    privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
  ).toString('base64')
  process.env.INTEGRATION_JWT_KID = 'suite-key'
}
export {}

let pass = 0
const failures: string[] = []
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; lines.push(`  PASS  ${label}`) }
  else { failures.push(`${label}${detail ? '  — ' + detail : ''}`); lines.push(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}
function section(n: string) { lines.push(`\n${n}`) }

/* Default mode: the variable is unset. */
const { meetingDisplayName, MEETING_NAME_MODE } = await import('@/utils/meetingIdentity.ts')

section('By default a person is their email address')
{
  check('the default mode is email', MEETING_NAME_MODE === 'email', MEETING_NAME_MODE)

  check('a student with a display name still shows their EMAIL',
    meetingDisplayName({ name: 'Basil Mohammed', email: 'basil@delta.test' }) === 'basil@delta.test',
    meetingDisplayName({ name: 'Basil Mohammed', email: 'basil@delta.test' }))

  check('an instructor shows their EMAIL, not the local part',
    meetingDisplayName({ email: 'teacher@delta.test' }, 'Instructor') === 'teacher@delta.test',
    meetingDisplayName({ email: 'teacher@delta.test' }, 'Instructor'))

  /* The old behaviour, named so a regression is obvious. */
  check('and NOT the old email local part',
    meetingDisplayName({ email: 'teacher@delta.test' }) !== 'teacher',
    meetingDisplayName({ email: 'teacher@delta.test' }))

  check('the host and a student of the same class use the SAME convention',
    meetingDisplayName({ email: 'a@x.test' }).includes('@')
    && meetingDisplayName({ name: 'S', email: 'b@x.test' }).includes('@'))
}

section('A tile is never blank')
{
  check('no email falls back to the display name',
    meetingDisplayName({ name: 'Only A Name', email: '' }) === 'Only A Name',
    meetingDisplayName({ name: 'Only A Name', email: '' }))
  check('neither one falls back to the caller-s label',
    meetingDisplayName({}, 'Instructor') === 'Instructor',
    meetingDisplayName({}, 'Instructor'))
  check('null and undefined are handled, not concatenated',
    meetingDisplayName({ name: null, email: undefined }, 'Participant') === 'Participant',
    meetingDisplayName({ name: null, email: undefined }, 'Participant'))
  check('whitespace is not a name',
    meetingDisplayName({ name: '   ', email: '  ' }, 'Participant') === 'Participant',
    meetingDisplayName({ name: '   ', email: '  ' }, 'Participant'))
  check('a name is trimmed rather than shown padded',
    meetingDisplayName({ name: '  Basil  ', email: '' }) === 'Basil',
    JSON.stringify(meetingDisplayName({ name: '  Basil  ', email: '' })))
}

/* ── The switch, loaded in a child process so the module-level read happens
      with the variable set. ── */
section('The switch flips the whole product, not one call site')
{
  /* The child runs a FILE, not an inline -e script: on Windows the inline form
     loses its quoting and bun ends up printing its own help text, which reads
     like a failing assertion and is not one. */
  const { spawnSync } = await import('node:child_process')
  const { writeFileSync, mkdtempSync } = await import('node:fs')
  const { join, sep } = await import('node:path')
  const { tmpdir } = await import('node:os')

  const dir = mkdtempSync(join(tmpdir(), 'meetingname-'))
  const probe = join(dir, 'probe.ts')
  /* split on sep rather than a \\ literal: the module specifier in the
     generated child must use forward slashes on every platform. */
  const modulePath = join(process.cwd(), 'src', 'utils', 'meetingIdentity.ts').split(sep).join('/')
  writeFileSync(probe, [
    `const m = await import('${modulePath}')`,
    `console.log(JSON.stringify({`,
    `  mode: m.MEETING_NAME_MODE,`,
    `  withName: m.meetingDisplayName({ name: 'Basil Mohammed', email: 'basil@delta.test' }),`,
    `  noName:   m.meetingDisplayName({ name: '', email: 'basil@delta.test' }),`,
    `}))`,
  ].join('\n'))

  /* process.execPath is the bun binary already running this suite, so the
     child cannot pick up a different runtime from PATH. */
  const proc = spawnSync(process.execPath, [probe], {
    env: { ...process.env, MEETING_DISPLAY_NAME: 'name' },
    encoding: 'utf8',
  })
  const out = String(proc.stdout ?? '').trim().split('\n').pop() ?? '{}'
  let parsed: any = {}
  try { parsed = JSON.parse(out) } catch { /* reported below */ }

  check('MEETING_DISPLAY_NAME=name switches the mode', parsed.mode === 'name', out)
  check('and a person then shows their LMS display name',
    parsed.withName === 'Basil Mohammed', String(parsed.withName))
  check('with the email as the fallback when they have no name',
    parsed.noName === 'basil@delta.test', String(parsed.noName))
}

/* ── The switch, through the REAL join path, not just the helper ──────────
   The section above proves MEETING_DISPLAY_NAME=name flips
   meetingDisplayName() in isolation. It does not prove the thing a person
   actually joins through — classHandoff.service's issueHandoff/exchangeHandoff
   — reads the switch at all, or reads it correctly for BOTH the student path
   (name looked up fresh from the DB) and the host path this suite's own
   history names as the one that drifted (liveClasses.routes.ts:host-ticket
   used to hand the helper an email and nothing else, so it showed an email in
   every mode — invisible in 'email' mode because that IS the answer, and only
   surfaces once an operator turns the switch on). The default-mode end-to-end
   block below cannot catch that class of bug either: in 'email' mode the
   ticket reads the same whether or not a name was ever supplied. Only running
   the real service with the switch ON proves the name was actually threaded
   through, not just that the argument was well-formed.

   A second spawned child, for the same reason as the first: the mode is read
   once at import time, and this process already imported the module in
   'email' mode above. Its own throwaway database, distinct from the main
   block's, so the two can never race each other. */
section('The switch, proven through the real service, not the helper alone')
{
  const { spawnSync } = await import('node:child_process')
  const { writeFileSync, unlinkSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { generateKeyPairSync } = await import('node:crypto')

  const { privateKey } = generateKeyPairSync('ed25519')
  const childPrivateKey = Buffer.from(
    privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
  ).toString('base64')

  /* Inside src/, not a system tmpdir: '@/…' only resolves against THIS
     project's tsconfig paths ('@/*' → 'src/*'), and bun finds that config by
     walking up from the file it runs — a tmpdir has no tsconfig.json in its
     ancestry at all. classHandoff.service.ts imports several more '@/…'
     modules internally, so this has to be a real, if temporary, member of the
     project. Removed in the finally below, success or failure. */
  const probe = join(process.cwd(), 'src', 'scripts', `zz-meetingname-probe-${process.pid}.ts`)
  const modelsPath  = '@/models/schema.ts'
  const handoffPath = '@/services/classHandoff.service.ts'

  writeFileSync(probe, [
    `import '@/config/timezone.ts'`,
    `const mongoose = (await import('mongoose')).default`,
    `mongoose.set('autoIndex', false)`,
    `await mongoose.connect(process.env.DATABASE_URL)`,
    `if (mongoose.connection.db.databaseName !== 'lms_meetingidentity_suite_namemode') { console.error('REFUSING - not the throwaway database'); process.exit(1) }`,
    `await mongoose.connection.db.dropDatabase()`,
    `const { UserModel, OrganizationModel, CourseModel, LiveClassModel, EnrollmentModel, ClassBookingModel } = await import('${modelsPath}')`,
    `const { issueHandoff, exchangeHandoff } = await import('${handoffPath}')`,
    `const claimsOf = (jwt) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'))`,
    `const org = await OrganizationModel.create({ name: 'DXB', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })`,
    `const teacher = await UserModel.create({ name: 'Basil Mohammed', email: 'instructor@delta.test', passwordHash: 'x', role: 'instructor', isActive: true, isVerified: true, organizationId: org._id })`,
    `const course = await CourseModel.create({ title: 'c', slug: 'c-nm-' + Date.now(), description: 'x', price: 0, isFree: true, status: 'published', language: 'English', organizationId: org._id, instructorId: teacher._id, category: 'ai', program: 'ai' })`,
    `const live = await LiveClassModel.create({ courseId: course._id, instructorId: teacher._id, title: 'class', type: 'internal', provider: 'livekit', scheduledStart: new Date(), durationMins: 60, organizationId: org._id, sessionCapacity: 10, bookedCount: 1 })`,
    `const pupil = await UserModel.create({ name: 'Zuriel Aloysius', email: 'student@delta.test', passwordHash: 'x', role: 'student', isActive: true, isVerified: true, organizationId: org._id, enrollmentStatus: 'approved' })`,
    `await EnrollmentModel.create({ userId: pupil._id, courseId: course._id, status: 'active' })`,
    `await ClassBookingModel.create({ userId: pupil._id, liveClassId: live._id, status: 'booked' })`,
    `const hostOut = await exchangeHandoff((await issueHandoff(String(live._id), String(teacher._id), 'host')).code)`,
    `const studentOut = await exchangeHandoff((await issueHandoff(String(live._id), String(pupil._id), 'student')).code)`,
    /* Marker-prefixed, not "the last line of stdout": exchangeHandoff logs
       through pino, which writes its own INFO/WARN lines to stdout on a
       timer, arriving AFTER this synchronous console.log — the earlier
       version of this probe took the last line and silently parsed one of
       those instead, reading every check below as "got undefined". */
    `console.log('RESULT_JSON:' + JSON.stringify({ hostName: claimsOf(hostOut.ticket).name, studentName: claimsOf(studentOut.ticket).name }))`,
    `await mongoose.connection.db.dropDatabase()`,
    `await mongoose.disconnect()`,
  ].join('\n'))

  try {
    const proc = spawnSync(process.execPath, [probe], {
      env: {
        ...process.env,
        MEETING_DISPLAY_NAME:          'name',
        DATABASE_URL:                  'mongodb://localhost:27017/lms_meetingidentity_suite_namemode',
        INTEGRATION_JWT_PRIVATE_KEY:   childPrivateKey,
        INTEGRATION_JWT_KID:           'suite-key-namemode',
      },
      encoding: 'utf8',
    })
    const marker = String(proc.stdout ?? '').split('\n').find(l => l.startsWith('RESULT_JSON:'))
    let parsed: any = {}
    try { parsed = JSON.parse((marker ?? '').slice('RESULT_JSON:'.length) || '{}') }
    catch { /* reported below, empty object fails every check */ }

    check('with the switch on, the HOST ticket carries their real LMS name',
      parsed.hostName === 'Basil Mohammed',
      `got ${JSON.stringify(parsed.hostName)} — stderr: ${String(proc.stderr ?? '').slice(0, 500)}`)
    check('not their email, which is the mode-off answer',
      parsed.hostName !== 'instructor@delta.test', String(parsed.hostName))
    check('and the STUDENT ticket carries their real LMS name too',
      parsed.studentName === 'Zuriel Aloysius',
      `got ${JSON.stringify(parsed.studentName)} — stderr: ${String(proc.stderr ?? '').slice(0, 500)}`)
  } finally {
    /* Success or failure, this is a temporary member of src/ and must not
       survive the run. */
    try { unlinkSync(probe) } catch { /* never written, or already gone */ }
  }
}

/* ===============================================================
   AND NOW THE PATH A PERSON ACTUALLY TAKES.

   Everything above tests the helper. The helper was green, and shipped, and
   WRONG WHERE IT COUNTED - because both Join buttons redirect through
   classHandoff.service, which built its own name (`user.name ?? 'Participant'`)
   and never called the helper at all. A unit suite around a rule proves the
   rule; it does not prove the rule is the one in force.

   So this section drives the real service: issue the one-time code the Join
   button issues, exchange it the way the meeting platform exchanges it, decode
   the ticket the meeting platform will read, and assert the name ON THE TILE.
   =============================================================== */
section('The name the meeting app will actually receive')

const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_meetingidentity_suite') {
  console.error('REFUSING TO RUN - not the throwaway database'); process.exit(1)
}
await mongoose.connection.db!.dropDatabase()

try {
  const { UserModel, OrganizationModel, CourseModel, LiveClassModel, EnrollmentModel, ClassBookingModel } =
    await import('@/models/schema.ts')
  const { issueHandoff, exchangeHandoff } = await import('@/services/classHandoff.service.ts')

  /* The claims the meeting platform reads out of the ticket. */
  const claimsOf = (jwt: string) =>
    JSON.parse(Buffer.from(jwt.split('.')[1]!, 'base64url').toString('utf8')) as Record<string, unknown>

  const org = await OrganizationModel.create({ name: 'DXB', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const teacher = await UserModel.create({
    name: 'Basil Mohammed', email: 'instructor@delta.test', passwordHash: 'x',
    role: 'instructor', isActive: true, isVerified: true, organizationId: org._id,
  })
  const course = await CourseModel.create({
    title: 'c', slug: `c-${Date.now()}`, description: 'x', price: 0, isFree: true,
    status: 'published', language: 'English', organizationId: org._id,
    instructorId: teacher._id, category: 'ai', program: 'ai',
  })
  /* provider MUST be livekit - assertJoinable refuses anything else, and the
     schema default is 'mux'. Every class predating this feature is 'mux'. */
  const live = await LiveClassModel.create({
    courseId: course._id, instructorId: teacher._id, title: 'class', type: 'internal',
    provider: 'livekit', scheduledStart: new Date(), durationMins: 60,
    organizationId: org._id, sessionCapacity: 10, bookedCount: 1,
  })
  const pupil = await UserModel.create({
    name: 'Basil Mohammed', email: 'student@delta.test', passwordHash: 'x',
    role: 'student', isActive: true, isVerified: true,
    organizationId: org._id, enrollmentStatus: 'approved',
  })
  await EnrollmentModel.create({ userId: pupil._id, courseId: course._id, status: 'active' })
  await ClassBookingModel.create({ userId: pupil._id, liveClassId: live._id, status: 'booked' })

  /* -- The instructor's Join, from the admin panel -- */
  {
    const { code } = await issueHandoff(String(live._id), String(teacher._id), 'host')
    const out = await exchangeHandoff(code)
    const claims = claimsOf(out.ticket)
    check('the HOST arrives as their email address',
      claims['name'] === 'instructor@delta.test', String(claims['name']))
    /* 'instructor' IS the host role. The meeting side branches on exactly this
       string (app/api/lms.py:296) to start the meeting; there is no 'host'
       role in the ticket vocabulary. The authority itself is the grant. */
    check('and as the instructor role the meeting app starts a class on',
      claims['role'] === 'instructor', String(claims['role']))
    check('carrying room admin, which is what makes them the host',
      (claims['grants'] as { roomAdmin?: boolean })?.roomAdmin === true,
      JSON.stringify(claims['grants']))
    check('and skipping the lobby, so Join lands them straight in',
      (claims['grants'] as { bypassLobby?: boolean })?.bypassLobby === true,
      JSON.stringify(claims['grants']))
  }

  /* -- The student's Join, from the client -- */
  {
    const { code } = await issueHandoff(String(live._id), String(pupil._id), 'student')
    const out = await exchangeHandoff(code)
    const claims = claimsOf(out.ticket)
    check('the STUDENT arrives as their email address',
      claims['name'] === 'student@delta.test', String(claims['name']))
    check('NOT as their profile name, which two students can share',
      claims['name'] !== 'Basil Mohammed', String(claims['name']))
    check('the email claim is carried separately, for attendance',
      claims['email'] === 'student@delta.test', String(claims['email']))
    check('the student is NOT a room admin',
      (claims['grants'] as { roomAdmin?: boolean })?.roomAdmin !== true,
      JSON.stringify(claims['grants']))
  }

  /* -- Host and student in the SAME room under the SAME convention -- */
  {
    const h = claimsOf((await exchangeHandoff((await issueHandoff(String(live._id), String(teacher._id), 'host')).code)).ticket)
    const s = claimsOf((await exchangeHandoff((await issueHandoff(String(live._id), String(pupil._id), 'student')).code)).ticket)
    check('nobody in the room is named by a different rule',
      String(h['name']).includes('@') && String(s['name']).includes('@'),
      `${h['name']} / ${s['name']}`)
    check('and the two are the same room', h['roomName'] === s['roomName'],
      `${h['roomName']} / ${s['roomName']}`)
  }

  /* -- A code is worth exactly one entry -- */
  {
    const { code } = await issueHandoff(String(live._id), String(pupil._id), 'student')
    await exchangeHandoff(code)
    let refused = false
    try { await exchangeHandoff(code) } catch { refused = true }
    check('a handoff code cannot be redeemed twice', refused)
  }

  await mongoose.connection.db!.dropDatabase()
  await mongoose.disconnect()
} catch (err) {
  check('the handoff path runs at all', false, String(err))
  try { await mongoose.connection.db!.dropDatabase(); await mongoose.disconnect() } catch {}
}

console.log(lines.join('\n'))
console.log(`\nmeetingidentity.suite — ${pass} passed, ${failures.length} failed`)
if (failures.length) console.error('\nFAILURES:\n' + failures.map(f => '  · ' + f).join('\n'))
process.exit(failures.length ? 1 : 0)
