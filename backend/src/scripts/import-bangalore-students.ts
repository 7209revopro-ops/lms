/* ─────────────────────────────────────────────────────────────
   Add Bangalore students from a sheet and enrol them in their course.

   Input: a CSV with the columns  name,email,phone,course  (phone as
   +91XXXXXXXXXX; course "MBT" = the shared MARKET BREAK-OUT TRADING PROGRAM,
   the one the online classes are on). Extra columns are ignored.

   Per student (the email decides who they are):
     · no account      → create a Bangalore student: approved ("Bulk Import"
                         badge), Forex, phone; no password — the welcome mail
                         sets one;
     · Bangalore account → approve if pending, add Forex, add the phone if
                         missing; nothing else about the account changes;
     · other academy's account, with no enrolments → moved to Bangalore, then
                         as above (with enrolments: reported, left alone);
     · staff account   → reported, left alone;
   then enrolled in the course with every module open (source 'script'),
   unless already enrolled. Course.enrolledCount follows.

   Stages:
     (none)     dry run — prints the plan, writes nothing
     --apply    create / approve / move / enrol; tracked per email in the
                bulk_import_log collection under --batch, so a re-run skips
                what is done
     --welcome  the 7-day set-password welcome mail, once per NEW account
                (accounts that existed already have a way in). --send-to=x
                redirects every mail to x for a test; --limit=N sends N.

   Usage (from backend/):
     bun src/scripts/import-bangalore-students.ts --file=blr-mbt-students.csv
     bun src/scripts/import-bangalore-students.ts --file=blr-mbt-students.csv --apply
     bun src/scripts/import-bangalore-students.ts --file=blr-mbt-students.csv --welcome
───────────────────────────────────────────────────────────── */
import '@/config/timezone.ts'
import mongoose, { Types } from 'mongoose'
import { readFileSync } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'

const args = new Map<string, string>()
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([a-z-]+)(?:=(.*))?$/)
  if (m) args.set(m[1]!, m[2] ?? 'true')
}
const FILE    = args.get('file')
const APPLY   = args.has('apply')
const WELCOME = args.has('welcome')
const BATCH   = args.get('batch') ?? 'blr-mbt-2026-10'
const SEND_TO = args.get('send-to')
const LIMIT   = args.has('limit') ? Number(args.get('limit')) : Infinity
if (!FILE) { console.error('usage: --file=<csv> [--apply | --welcome]'); process.exit(1) }

const ORG_SLUG = 'bangalore'
const CATEGORY = '4x-trading'
const COURSES: Record<string, string> = {
  MBT: '6a3bdaa925c9f5a007590e0e',   // MARKET BREAK-OUT TRADING PROGRAM (shared by both academies)
}
const BADGE = { approvedByEmail: 'bulk-import@system', approvedByName: 'Bulk Import', approvedByRole: 'system' }
const EMAIL_RE = /^[A-Za-z0-9._%+\-']+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000

/* ── read the CSV (quoted fields allowed) ── */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let q = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++ } else q = false } else cell += ch; continue }
    if (ch === '"') q = true
    else if (ch === ',') { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = '' }
    else cell += ch
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows.filter(r => r.some(c => c.trim()))
}
const [head, ...body] = parseCsv(readFileSync(FILE, 'utf8'))
const col = (k: string) => head!.findIndex(h => h.trim().toLowerCase() === k)
const [cName, cEmail, cPhone, cCourse] = ['name', 'email', 'phone', 'course'].map(col)
if ([cName, cEmail, cCourse].some(i => i! < 0)) { console.error('CSV needs name,email,phone,course columns'); process.exit(1) }

type Row = { name: string; email: string; phone: string; course: string; action: string; note: string }
const rows: Row[] = []
const seen = new Set<string>()
for (const r of body) {
  const email = (r[cEmail!] ?? '').trim().toLowerCase()
  const row: Row = { name: (r[cName!] ?? '').trim(), email, phone: cPhone! >= 0 ? (r[cPhone!] ?? '').trim() : '', course: (r[cCourse!] ?? '').trim().toUpperCase(), action: '', note: '' }
  if (!EMAIL_RE.test(email))        { row.action = 'skip'; row.note = 'invalid email' }
  else if (seen.has(email))         { row.action = 'skip'; row.note = 'duplicate in sheet' }
  else if (!COURSES[row.course])    { row.action = 'skip'; row.note = `unknown course "${row.course}"` }
  seen.add(email); rows.push(row)
}

const { connectDatabase } = await import('@/config/database.ts')
await connectDatabase()
const M = await import('@/models/schema.ts')
const db = mongoose.connection.db!
const logCol = db.collection('bulk_import_log')

const org = await M.OrganizationModel.findOne({ slug: ORG_SLUG }).select('_id name').lean<{ _id: Types.ObjectId; name: string }>()
if (!org) { console.error(`Academy '${ORG_SLUG}' not found`); process.exit(1) }

/* ── plan ── */
const users = new Map((await M.UserModel.find({ email: { $in: rows.map(r => r.email) } })
  .select('email name role organizationId enrollmentStatus categories phone enrollmentApplication.phone').lean<any[]>()).map(u => [u.email as string, u]))
const enrolled = new Set((await M.EnrollmentModel.find({ userId: { $in: [...users.values()].map(u => u._id) } }).select('userId courseId status').lean<any[]>())
  .filter(e => e.status !== 'dropped').map(e => `${e.userId}:${e.courseId}`))
const anyEnrolment = new Set((await M.EnrollmentModel.find({ userId: { $in: [...users.values()].map(u => u._id) } }).select('userId').lean<any[]>()).map(e => String(e.userId)))

for (const r of rows) {
  if (r.action) continue
  const u = users.get(r.email)
  const courseId = COURSES[r.course]!
  if (!u) { r.action = 'create+enrol'; continue }
  if (u.role !== 'student') { r.action = 'skip'; r.note = `existing ${u.role} account`; continue }
  const steps: string[] = []
  if (String(u.organizationId) !== String(org._id)) {
    if (anyEnrolment.has(String(u._id))) { r.action = 'skip'; r.note = 'account in another academy with enrolments — move by hand'; continue }
    steps.push('move to Bangalore')
  }
  if (u.enrollmentStatus !== 'approved') steps.push(`approve (was ${u.enrollmentStatus ?? 'unset'})`)
  if (!enrolled.has(`${u._id}:${courseId}`)) steps.push('enrol')
  r.action = steps.length ? steps.join(' + ') : 'nothing to do'
  r.note = 'existing account'
}

const tally = (list: Row[]) => {
  const t = new Map<string, number>()
  for (const r of list) { const k = r.action + (r.note && r.action === 'skip' ? ` — ${r.note}` : ''); t.set(k, (t.get(k) ?? 0) + 1) }
  return [...t.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `  ${String(n).padStart(4)}  ${k}`).join('\n')
}

if (!APPLY && !WELCOME) {
  console.log(`\nAcademy: ${org.name}   Batch: ${BATCH}   Students in file: ${rows.length}\n`)
  for (const r of rows) console.log(`  ${r.email.padEnd(36)} ${r.name.slice(0, 26).padEnd(26)} ${r.phone.padEnd(14)} ${r.course.padEnd(4)} ${r.action}${r.note && r.action === 'skip' ? ` (${r.note})` : ''}`)
  console.log(`\nPlan:\n${tally(rows)}\n\nDry run — nothing changed. Next: --apply`)
  await mongoose.disconnect(); process.exit(0)
}

/* ── apply ── */
if (APPLY) {
  const added = new Map<string, number>()
  for (const r of rows) {
    if (r.action === 'skip' || r.action === 'nothing to do') continue
    const courseId = new Types.ObjectId(COURSES[r.course]!)
    try {
      let u = users.get(r.email)
      if (!u) {
        u = await M.UserModel.create({
          name: r.name || r.email.split('@')[0], email: r.email, role: 'student',
          isActive: true, isVerified: true, signupType: 'full',
          enrollmentStatus: 'approved', ...BADGE, approvedAt: new Date(),
          categories: [CATEGORY], category: CATEGORY,
          organizationId: org._id,
          ...(r.phone ? { phone: r.phone, enrollmentApplication: { phone: r.phone } } : {}),
        })
        await logCol.updateOne({ batch: BATCH, email: r.email },
          { $setOnInsert: { batch: BATCH, email: r.email, name: r.name, userId: u._id, created: true, importedAt: new Date() } }, { upsert: true })
      } else {
        const set: Record<string, unknown> = {}
        if (String(u.organizationId) !== String(org._id)) set['organizationId'] = org._id
        if (u.enrollmentStatus !== 'approved') Object.assign(set, { enrollmentStatus: 'approved', ...BADGE, approvedAt: new Date() })
        if (r.phone && !u.phone) set['phone'] = r.phone
        if (r.phone && !u.enrollmentApplication?.phone) set['enrollmentApplication.phone'] = r.phone
        await M.UserModel.updateOne({ _id: u._id }, { ...(Object.keys(set).length ? { $set: set } : {}), $addToSet: { categories: CATEGORY } })
        await logCol.updateOne({ batch: BATCH, email: r.email },
          { $setOnInsert: { batch: BATCH, email: r.email, name: r.name, userId: u._id, created: false, importedAt: new Date() } }, { upsert: true })
      }
      const has = await M.EnrollmentModel.findOne({ userId: u._id, courseId }).select('status').lean<{ status?: string }>()
      if (!has) {
        await M.EnrollmentModel.create({ userId: u._id, courseId, blockedLessons: [], source: 'script', organizationId: org._id })
        added.set(String(courseId), (added.get(String(courseId)) ?? 0) + 1)
      } else if (has.status === 'dropped') {
        await M.EnrollmentModel.updateOne({ userId: u._id, courseId }, { $set: { status: 'active', blockedLessons: [] } })
        added.set(String(courseId), (added.get(String(courseId)) ?? 0) + 1)
      }
      r.action = `done: ${r.action}`
    } catch (err) {
      r.action = 'error'; r.note = String((err as Error).message).slice(0, 100)
    }
  }
  for (const [courseId, n] of added) await M.CourseModel.updateOne({ _id: courseId }, { $inc: { enrolledCount: n } })
  console.log(`\nResult:\n${tally(rows)}`)
  rows.filter(r => r.action === 'error').forEach(r => console.log(`  error ${r.email}: ${r.note}`))
  console.log('\nNext, once you have checked a few in admin: --welcome')
}

/* ── welcome mail: new accounts only, once each ── */
if (WELCOME) {
  const { sendImportedStudentWelcome } = await import('@/services/email.service.ts')
  const clientUrl = process.env['CLIENT_URL'] ?? 'http://localhost:3000'
  const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')
  const due = await logCol.find({ batch: BATCH, created: true, welcomeQueuedAt: { $exists: false } }).toArray()
  console.log(`\nWelcome mails due: ${due.length}${SEND_TO ? ` (all redirected to ${SEND_TO})` : ''}`)
  let sent = 0
  for (const l of due) {
    if (sent >= LIMIT) break
    try {
      await M.AuthTokenModel.updateMany({ userId: l['userId'], purpose: 'reset-password', usedAt: { $exists: false } }, { $set: { usedAt: new Date() } })
      const raw = randomBytes(32).toString('hex')
      await M.AuthTokenModel.create({ userId: l['userId'], tokenHash: sha256(raw), purpose: 'reset-password', expiresAt: new Date(Date.now() + TOKEN_TTL_MS) })
      await sendImportedStudentWelcome(SEND_TO ?? l['email'], l['name'] || l['email'], CATEGORY, `${clientUrl}/reset-password?token=${raw}`)
      /* A redirected test does not count: the student still gets theirs. */
      if (!SEND_TO) await logCol.updateOne({ _id: l._id }, { $set: { welcomeQueuedAt: new Date() } })
      sent++
      await new Promise(res => setTimeout(res, 350))
    } catch (err) {
      console.log(`  mail failed for ${l['email']}: ${(err as Error).message}`)
    }
  }
  console.log(`Queued: ${sent}`)
  await new Promise(res => setTimeout(res, 1500))
}

await mongoose.disconnect()
process.exit(0)
