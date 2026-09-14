/* ─────────────────────────────────────────────────────────────
   "Request validation failed" — the refusal has to name the field.

   Reported symptom: a student on the payment step of Settings → Request is
   refused with "Request validation failed" and nothing else. The Application
   Summary beside the button showed Experience and Programs blank, which is
   exactly what the server is refusing — but the message says neither.

   The cause was on the client (a prefill effect that overwrote what the
   student had typed, plus a submit that only validated the last step). This
   suite guards the half that lives here:

     · complete-registration REFUSES an incomplete application. If it ever
       accepted one, half-registered students would reach the admin queue.
     · the refusal carries details[] with a `field` on every entry. The
       student-facing form now reads exactly that to say "Please check:
       experienceLevel, programs" instead of the generic sentence, so the
       shape is a contract, not an implementation detail.
     · a COMPLETE application is accepted, so the strictness above is not
       simply refusing everything.

   Boots the REAL Express app against an ISOLATED throwaway database
   (lms_regvalidation_suite), dropped on exit.

   Run: bun run test:regvalidation
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_regvalidation_suite'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.SMTP_HOST    = ''
process.env.SMTP_USER    = ''
process.env.SMTP_PASS    = ''
process.env.EMAIL_FROM   = ''
process.env.RATE_LIMIT_AUTH_MAX = '900'
process.env.RATE_LIMIT_API_MAX  = '9000'
process.env.R2_ACCOUNT_ID        = ''
process.env.R2_ACCESS_KEY_ID     = ''
process.env.R2_SECRET_ACCESS_KEY = ''
process.env.R2_PUBLIC_URL        = ''

export {}

let pass = 0, fail = 0
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; lines.push(`  PASS  ${label}`) }
  else    { fail++; lines.push(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}
function section(n: string) { lines.push(`\n${n}`) }

const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const app = (await import('@/app.ts')).default
const { UserModel, OrganizationModel } = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_regvalidation_suite') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}
await mongoose.connection.db!.dropDatabase()

const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`

type Jar = Map<string, string>
async function call(method: string, p: string, jar?: Jar, body?: unknown) {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (jar?.size) headers['cookie'] = [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const res = await fetch(`${BASE}${p}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (jar) for (const raw of res.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(';'); const i = pair!.indexOf('=')
    if (i > 0) jar.set(pair!.slice(0, i), pair!.slice(i + 1))
  }
  const text = await res.text()
  let body2: any = text; try { body2 = JSON.parse(text) } catch {}
  return { status: res.status, body: body2 }
}

const PW = 'RegValid1'
const fieldsOf = (r: { body: any }): string[] =>
  (r.body?.error?.details ?? []).map((d: any) => d?.field).filter(Boolean)

/* A complete, valid application — the baseline every case below varies. */
const COMPLETE = {
  phone:              '+971501234567',
  emergencyContact:   '+971507654321',
  gender:             'Female',
  dateOfBirth:        '1998-04-11',
  nationality:        'Australian',
  homeCountry:        'Australia',
  occupation:         'Analyst',
  idType:             'Passport',
  idNumber:           'PA123456',
  countryAttendance:  'United Arab Emirates',
  villa:              'Villa 12',
  city:               'Dubai',
  addressCountry:     'United Arab Emirates',
  passportUrl:        'kyc/passport-scan.png',
  idDocUrl:           'kyc/id-scan.png',
  photoUrl:           '',
  experienceLevel:    'Beginner',
  preferredStartDate: '2027-01-15',
  hearAboutUs:        'Instagram',
  referralName:       '',
  programs:           ['forex'],
  paymentMethod:      'Card Credit',
  avatarUrl:          '',
}

try {

const org = await OrganizationModel.create({
  name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer',
})

let seq = 0
async function signedInStudent(): Promise<Jar> {
  const email = `reg${seq++}-${Date.now()}@rv.local`
  await UserModel.create({
    name: 'Aliya Abdulla', email, passwordHash: await hashPassword(PW),
    role: 'student', isActive: true, isVerified: true,
    enrollmentStatus: 'pending', organizationId: org._id,
  })
  const jar: Jar = new Map()
  await call('POST', '/auth/login', jar, { email, password: PW })
  return jar
}

/* ═════════════════ A — the exact shape from the screenshot ═════════════════ */
section('A. Experience and Programs blank — what the student actually sent')
{
  const jar = await signedInStudent()
  const r = await call('PATCH', '/auth/me/complete-registration', jar, {
    ...COMPLETE, experienceLevel: '', programs: [],
  })
  check('A1 it is refused', r.status === 422, String(r.status))
  check('A2 with VALIDATION_ERROR', r.body?.error?.code === 'VALIDATION_ERROR',
    String(r.body?.error?.code))

  /* The contract the form now depends on. Without a field name the student
     sees "Request validation failed" and has nowhere to go. */
  const f = fieldsOf(r)
  check('A3 details name experienceLevel', f.includes('experienceLevel'), f.join(', '))
  check('A4 details name programs', f.includes('programs'), f.join(', '))
  check('A5 every detail entry carries a field',
    (r.body?.error?.details ?? []).length > 0 &&
    (r.body?.error?.details ?? []).every((d: any) => typeof d?.field === 'string' && d.field.length > 0),
    JSON.stringify(r.body?.error?.details)?.slice(0, 200))
}

/* ═════════════════ B — each required field, one at a time ═════════════════ */
section('B. Every field the form can leave empty is named on its own')
{
  /* One case per field, so a schema that stops requiring one of them fails
     here rather than silently letting half-finished applications through. */
  /* EVERY required field, not a chosen few.

     The first version of this list held ten, and they were the ten that
     already had a minimum on them. A fuzz over the whole schema found eight
     more -- nationality, homeCountry, occupation, idNumber, countryAttendance,
     addressCountry, hearAboutUs, paymentMethod -- declared as
     `z.string().max(n)`, which accepts ''. Blank in every one of them returned
     200. Picking the fields to test is how that stayed invisible, so the list
     is now the complete set. */
  const cases: [string, Record<string, unknown>][] = [
    ['experienceLevel',   { experienceLevel: '' }],
    ['programs',          { programs: [] }],
    ['gender',            { gender: '' }],
    ['idType',            { idType: '' }],
    ['phone',             { phone: '' }],
    ['city',              { city: '' }],
    ['dateOfBirth',       { dateOfBirth: '' }],
    ['preferredStartDate',{ preferredStartDate: '' }],
    ['passportUrl',       { passportUrl: '' }],
    ['idDocUrl',          { idDocUrl: '' }],
    ['nationality',       { nationality: '' }],
    ['homeCountry',       { homeCountry: '' }],
    ['occupation',        { occupation: '' }],
    ['idNumber',          { idNumber: '' }],
    ['countryAttendance', { countryAttendance: '' }],
    ['addressCountry',    { addressCountry: '' }],
    ['hearAboutUs',       { hearAboutUs: '' }],
    ['paymentMethod',     { paymentMethod: '' }],
  ]
  for (const [field, override] of cases) {
    const jar = await signedInStudent()
    const r = await call('PATCH', '/auth/me/complete-registration', jar, { ...COMPLETE, ...override })
    const f = fieldsOf(r)
    check(`B:${field} is refused and named`,
      r.status === 422 && f.includes(field), `status=${r.status} fields=[${f.join(', ')}]`)
  }
}

/* ═════════════════ B2 — whitespace is not an answer ═════════════════ */
section('B2. A field holding only spaces is as empty as one holding nothing')
{
  /* Without .trim() in the schema, "   " passes min(1) and a registration is
     filed with a nationality of three spaces. */
  const jar = await signedInStudent()
  const r = await call('PATCH', '/auth/me/complete-registration', jar, {
    ...COMPLETE, nationality: '   ', occupation: '  ', idNumber: ' ',
  })
  const f = fieldsOf(r)
  check('B2.1 spaces-only values are refused and named',
    r.status === 422 && ['nationality', 'occupation', 'idNumber'].every(x => f.includes(x)),
    `status=${r.status} fields=[${f.join(', ')}]`)
}

/* ═════════════════ C — several at once ═════════════════ */
section('C. Several missing fields are ALL named, not just the first')
{
  const jar = await signedInStudent()
  const r = await call('PATCH', '/auth/me/complete-registration', jar, {
    ...COMPLETE, experienceLevel: '', programs: [], gender: '', city: '',
  })
  const f = fieldsOf(r)
  /* The form prints the list, so one-at-a-time would send the student round
     the loop four times. */
  check('C1 all four are reported together',
    ['experienceLevel', 'programs', 'gender', 'city'].every(x => f.includes(x)),
    f.join(', '))
}

/* ═════════════════ D — the strictness is not blanket ═════════════════ */
section('D. A COMPLETE application is accepted')
{
  const jar = await signedInStudent()
  const r = await call('PATCH', '/auth/me/complete-registration', jar, COMPLETE)
  check('D1 a full, valid application succeeds', r.status === 200,
    `status=${r.status} ${JSON.stringify(r.body?.error ?? {}).slice(0, 160)}`)

  /* And the optional fields really are optional. */
  const jar2 = await signedInStudent()
  const r2 = await call('PATCH', '/auth/me/complete-registration', jar2, {
    ...COMPLETE, emergencyContact: '', villa: '', referralName: '', photoUrl: '', avatarUrl: '',
  })
  check('D2 empty OPTIONAL fields are still accepted', r2.status === 200,
    `status=${r2.status} ${JSON.stringify(r2.body?.error ?? {}).slice(0, 160)}`)
}

} catch (err) {
  fail++
  lines.push(`  FAIL  suite threw — ${(err as Error).message}\n${(err as Error).stack}`)
} finally {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
  server.close()
}

console.log(lines.join('\n'))
console.log(`\nregistrationvalidation.suite — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
