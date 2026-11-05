/* ─────────────────────────────────────────────────────────────
   Bulk-import Dubai Digital Marketing students from the master sheet.

   Source: dm-dxb.csv (exported from "DM - MASTER DATA.xlsx", sheet DXB).
   Every row that has an email is imported — the ONLY skip reasons are
   duplicates (inside the sheet, or an email already registered in the LMS)
   and rows that cannot become accounts (no/invalid email). Existing users
   are never modified.

   The import follows the same path a real signup takes:
     1. --stage=import   create users as PENDING enrollment requests
                         (Dubai org, signupType 'express' so the portal asks
                         them to complete the full form later; no password)
     2. --stage=approve  flip those users to APPROVED with the badge
                         "Bulk Import" (approvedByRole 'system')
     3. --stage=welcome  mint a 7-day set-password token per student and
                         queue the welcome mail through the durable outbox.
                         EVERY imported student receives the mail, whatever
                         their sheet status (user decision, 2026-08-31).

   With no --stage the script is a DRY RUN: it prints the full plan and
   writes a report, but touches nothing.

   Progress is tracked in the raw `bulk_import_log` collection (one row per
   email), which is what makes every stage safe to re-run: work already done
   is skipped, never repeated — a student can never get two welcome mails.

   Every run writes a CSV report to .logs/import-reports/.

   Usage (from backend/, so .env is loaded):
     bun src/scripts/import-dubai-students.ts --file=C:/Users/MSI-PC/Downloads/dm-dxb.csv
     bun src/scripts/import-dubai-students.ts --file=... --stage=import
     bun src/scripts/import-dubai-students.ts --file=... --stage=approve
     bun src/scripts/import-dubai-students.ts --file=... --stage=welcome [--limit=N] [--send-to=you@x.com]
───────────────────────────────────────────────────────────── */
import mongoose from 'mongoose'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'

const ORG_SLUG        = 'dubai'
/* Category and batch are flags so the same proven code imports any programme.
   Defaults keep the original Digital Marketing run reproducible. */
const VALID_CATEGORIES = ['digital-marketing', '4x-trading', 'ai', 'jura', 'cma'] as const
type Category = typeof VALID_CATEGORIES[number]
const LOG_COLLECTION  = 'bulk_import_log'
const TOKEN_TTL_MS    = 7 * 24 * 60 * 60 * 1000
const MAIL_DELAY_MS   = 350
const BADGE = {
  approvedByEmail: 'bulk-import@system',
  approvedByName:  'Bulk Import',
  approvedByRole:  'system',
}
const EMAIL_RE = /^[A-Za-z0-9._%+\-']+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/

/* ─── args ──────────────────────────────────────────── */
const args = new Map<string, string>()
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([a-z-]+)(?:=(.*))?$/)
  if (m) args.set(m[1]!, m[2] ?? 'true')
}
const FILE    = args.get('file')
const STAGE   = args.get('stage') ?? 'dry-run'
const LIMIT   = args.has('limit') ? Number(args.get('limit')) : Infinity
const SEND_TO = args.get('send-to')
const CATEGORY = (args.get('category') ?? 'digital-marketing') as Category
const BATCH    = args.get('batch') ?? 'dm-dxb-2026-08'

if (!FILE) {
  console.error('❌ --file=<path to dm-dxb.csv> is required.')
  process.exit(1)
}
if (!['dry-run', 'import', 'approve', 'welcome'].includes(STAGE)) {
  console.error(`❌ Unknown --stage=${STAGE}. Use import | approve | welcome (or omit for a dry run).`)
  process.exit(1)
}
if (!VALID_CATEGORIES.includes(CATEGORY)) {
  console.error(`❌ Unknown --category=${CATEGORY}. Use one of: ${VALID_CATEGORIES.join(' | ')}`)
  process.exit(1)
}
if (SEND_TO && !EMAIL_RE.test(SEND_TO)) {
  console.error('❌ --send-to must be a valid email address.')
  process.exit(1)
}

/* ─── tiny RFC-4180 CSV parser ──────────────────────── */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], field = '', inQ = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else inQ = false
      } else field += ch
    } else if (ch === '"') inQ = true
    else if (ch === ',') { row.push(field); field = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.some(c => c !== '')) rows.push(row)
      row = []
    } else field += ch
  }
  row.push(field)
  if (row.some(c => c !== '')) rows.push(row)
  return rows
}

/* ─── cleaning helpers ──────────────────────────────── */
function titleCaseName(raw: string): string {
  return raw
    .replace(/\s*-?\s*FREE(\s*BATCH)?\s*$/i, '')       // "IBRAHIM T K - FREE BATCH" → "IBRAHIM T K"
    .trim()
    .split(/\s+/)
    /* Short all-caps chunks are initials (T K, KS, PKC) — leave them. */
    .map(w => (w.length <= 3 && w === w.toUpperCase()) ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
}
const cleanPhone  = (s: string) => s.replace(/[^\d+]/g, '')
const cleanGender = (s: string) => /^male$/i.test(s) ? 'Male' : /^female$/i.test(s) ? 'Female' : undefined
const cleanNationality = (s: string) => /^india(n)?$/i.test(s.trim()) ? 'Indian' : s.trim() || undefined

interface Row {
  code: string; name: string; email: string; sheetStatus: string
  phone?: string; emergencyContact?: string; nationality?: string; gender?: string
  dateOfBirth?: string; occupation?: string; countryAttendance?: string
  photoUrl?: string; idDocUrl?: string; passportUrl?: string; passportNo?: string; programs: string[]
  action: string; reason: string
}

/* ─── load + clean + validate the sheet ─────────────── */
const csv = parseCsv(readFileSync(FILE, 'utf8'))
const header = csv[0]!.map(h => h.trim())
const col = (name: string) => header.indexOf(name)
const C = {
  code: col('STUDENT CODE'), name: col('STUDENT NAME'), email: col('EMAIL ID'),
  phone: col('PHONE NUMBER'), status: col('STATUS'), home: col('HOME COUNTRY CONTACT NUMBER'),
  nat: col('NATIONALITY'), gender: col('GENDER'), dob: col('DOB'), occ: col('OCCUPATION'),
  attend: col('COUNTRY OF ATTENDANCE'), course: col('COURSE ENROLLED'),
  photo: col('PHOTO_URL'), idDoc: col('ID_DOC_URL'),
}
/* Optional columns — absent from the original DM export, present for Forex. */
const C_PASSPORT_URL = header.indexOf('PASSPORT_URL')
const C_PASSPORT_NO  = header.indexOf('PASSPORT NUMBER')
for (const [k, v] of Object.entries(C)) {
  if (v < 0) { console.error(`❌ CSV is missing the expected column for "${k}".`); process.exit(1) }
}

const rows: Row[] = []
const seenEmails = new Set<string>()
for (const r of csv.slice(1)) {
  const get = (i: number) => (r[i] ?? '').trim()
  const email = get(C.email).toLowerCase()
  const row: Row = {
    code: get(C.code), name: titleCaseName(get(C.name)), email,
    sheetStatus: get(C.status).toUpperCase(),
    phone: cleanPhone(get(C.phone)) || undefined,
    emergencyContact: cleanPhone(get(C.home)) || undefined,
    nationality: cleanNationality(get(C.nat)),
    gender: cleanGender(get(C.gender)),
    dateOfBirth: get(C.dob) || undefined,
    occupation: get(C.occ) || undefined,
    countryAttendance: get(C.attend) || undefined,
    photoUrl: get(C.photo) || undefined,
    idDocUrl: get(C.idDoc) || undefined,
    passportUrl: (C_PASSPORT_URL >= 0 ? get(C_PASSPORT_URL) : '') || undefined,
    passportNo:  (C_PASSPORT_NO  >= 0 ? get(C_PASSPORT_NO)  : '') || undefined,
    programs: get(C.course) ? [get(C.course)] : [],
    action: 'create', reason: '',
  }
  if (!email)                      { row.action = 'skip'; row.reason = 'no-email' }
  else if (!EMAIL_RE.test(email))  { row.action = 'skip'; row.reason = 'invalid-email' }
  else if (!row.name)              { row.action = 'skip'; row.reason = 'no-name' }
  else if (seenEmails.has(email))  { row.action = 'skip'; row.reason = 'duplicate-in-sheet' }
  else seenEmails.add(email)
  rows.push(row)
}

/* ─── connect + plan against the live data ──────────── */
const DB_URL = process.env['DATABASE_URL'] ?? 'mongodb://localhost:27017/lms'
await mongoose.connect(DB_URL)
const dbName = mongoose.connection.db!.databaseName
const { UserModel, OrganizationModel, AuthTokenModel } = await import('@/models/schema.ts')
const logCol = mongoose.connection.db!.collection(LOG_COLLECTION)

console.log('═'.repeat(64))
console.log(`  Stage:    ${STAGE.toUpperCase()}${STAGE === 'dry-run' ? '  (nothing will be written)' : ''}`)
console.log(`  Database: ${dbName}  (${DB_URL.replace(/\/\/[^@/]+@/, '//***@')})`)
console.log(`  Sheet:    ${FILE}  (${rows.length} rows)`)
console.log(`  Category: ${CATEGORY}   Org: ${ORG_SLUG}   Batch: ${BATCH}`)
console.log('═'.repeat(64))

const org = await OrganizationModel.findOne({ slug: ORG_SLUG }).select('_id name').lean()
if (!org && STAGE !== 'dry-run') {
  console.error(`❌ Organization '${ORG_SLUG}' not found in ${dbName} — refusing to continue.`)
  await mongoose.disconnect(); process.exit(1)
}
if (!org) console.log(`⚠️  Organization '${ORG_SLUG}' not found (dry run continues; a real run would abort).`)

const candidateEmails = rows.filter(r => r.action === 'create').map(r => r.email)
const existing = new Set(
  (await UserModel.find({ email: { $in: candidateEmails } }).select('email').lean())
    .map(u => u.email as string),
)
const logRows = new Map<string, any>(
  (await logCol.find({ batch: BATCH }).toArray()).map(l => [l['email'] as string, l]),
)

for (const r of rows) {
  if (r.action !== 'create') continue
  const log = logRows.get(r.email)
  if (log)                        { r.action = 'tracked'; r.reason = 'imported-earlier' }
  else if (existing.has(r.email)) { r.action = 'skip';    r.reason = 'already-in-LMS' }
}

/* ─── stage execution ───────────────────────────────── */
const sleep = (ms: number) => new Promise(res => setTimeout(res, ms))
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

if (STAGE === 'import') {
  for (const r of rows) {
    if (r.action !== 'create') continue
    try {
      const user = await UserModel.create({
        name: r.name, email: r.email, role: 'student',
        isActive: true, isVerified: true,
        /* MUST be 'full': the admin students / enrollment-requests list filters
           OUT signupType 'express' (admin.controller.ts listEnrollmentRequests),
           routing those accounts to the separate Express Members tab instead.
           Imported students belong in the normal students table. */
        signupType: 'full',
        enrollmentStatus: 'pending',              // the "request table" stage
        categories: [],
        organizationId: org!._id,
        enrollmentApplication: {
          ...(r.phone             && { phone: r.phone }),
          ...(r.emergencyContact  && { emergencyContact: r.emergencyContact }),
          ...(r.gender            && { gender: r.gender }),
          ...(r.dateOfBirth       && { dateOfBirth: r.dateOfBirth }),
          ...(r.nationality       && { nationality: r.nationality }),
          ...(r.occupation        && { occupation: r.occupation }),
          ...(r.countryAttendance && { countryAttendance: r.countryAttendance }),
          ...(r.photoUrl          && { photoUrl: r.photoUrl }),
          ...(r.idDocUrl          && { idDocUrl: r.idDocUrl }),
          ...(r.passportUrl       && { passportUrl: r.passportUrl }),
          ...(r.passportNo        && { idType: 'Passport', idNumber: r.passportNo }),
          ...(r.programs.length   && { programs: r.programs }),
        },
      })
      await logCol.insertOne({
        batch: BATCH, email: r.email, studentCode: r.code, name: r.name,
        sheetStatus: r.sheetStatus, userId: user._id, importedAt: new Date(),
      })
      r.action = 'imported'; r.reason = 'pending request created'
    } catch (err: any) {
      r.action = 'skip'
      r.reason = err?.code === 11000 ? 'duplicate-race' : `error: ${String(err?.message).slice(0, 80)}`
    }
  }
}

if (STAGE === 'approve') {
  for (const r of rows) {
    const log = logRows.get(r.email)
    if (!log) continue
    if (log['approvedAt']) { r.action = 'tracked'; r.reason = 'approved-earlier'; continue }
    const user = await UserModel.findById(log['userId']).select('enrollmentStatus').lean()
    if (!user) { r.action = 'skip'; r.reason = 'user-vanished'; continue }
    if (user.enrollmentStatus !== 'pending') { r.action = 'skip'; r.reason = `not-pending (${user.enrollmentStatus})`; continue }
    await UserModel.findByIdAndUpdate(log['userId'], {
      $set: {
        enrollmentStatus: 'approved',
        categories: [CATEGORY], category: CATEGORY,
        ...BADGE, approvedAt: new Date(),
      },
    })
    await logCol.updateOne({ _id: log['_id'] }, { $set: { approvedAt: new Date() } })
    r.action = 'approved'; r.reason = `badge: ${BADGE.approvedByName}`
  }
}

if (STAGE === 'welcome') {
  const { sendImportedStudentWelcome } = await import('@/services/email.service.ts')
  const clientUrl = process.env['CLIENT_URL'] ?? 'http://localhost:3000'
  let sent = 0
  const eligible = rows.filter(r => {
    const log = logRows.get(r.email)
    return log && log['approvedAt'] && !log['welcomeQueuedAt']
  })
  console.log(`  Eligible for welcome mail: ${eligible.length}${SEND_TO ? `  (redirected to ${SEND_TO})` : ''}${Number.isFinite(LIMIT) ? `  (limit ${LIMIT})` : ''}`)
  for (const r of rows) {
    const log = logRows.get(r.email)
    if (!log) continue
    if (log['welcomeQueuedAt']) { r.action = 'tracked'; r.reason = 'mail-queued-earlier'; continue }
    if (!log['approvedAt']) { r.action = 'skip'; r.reason = 'not-approved-yet'; continue }
    if (sent >= LIMIT) { r.action = 'tracked'; r.reason = 'beyond --limit (next run)'; continue }
    try {
      /* Newest-link-wins, same as the organic forgot-password flow. */
      await AuthTokenModel.updateMany(
        { userId: log['userId'], purpose: 'reset-password', usedAt: { $exists: false } },
        { $set: { usedAt: new Date() } },
      )
      const raw = randomBytes(32).toString('hex')
      await AuthTokenModel.create({
        userId: log['userId'], tokenHash: sha256(raw),
        purpose: 'reset-password', expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
      })
      const url = `${clientUrl}/reset-password?token=${raw}`
      await sendImportedStudentWelcome(SEND_TO ?? r.email, r.name, CATEGORY, url)
      await logCol.updateOne({ _id: log['_id'] }, { $set: { welcomeQueuedAt: new Date(), ...(SEND_TO ? { welcomeRedirectedTo: SEND_TO } : {}) } })
      r.action = 'mailed'; r.reason = SEND_TO ? `queued → ${SEND_TO}` : 'welcome mail queued'
      sent++
      await sleep(MAIL_DELAY_MS)
    } catch (err: any) {
      r.action = 'skip'; r.reason = `mail-error: ${String(err?.message).slice(0, 80)}`
    }
  }
}

/* ─── report ────────────────────────────────────────── */
const summary = new Map<string, number>()
for (const r of rows) {
  const key = `${r.action}${r.reason ? ` — ${r.reason.replace(/:.*$/, '').replace(/\(.*$/, '').trim()}` : ''}`
  summary.set(key, (summary.get(key) ?? 0) + 1)
}
console.log('\n  Result:')
for (const [k, n] of [...summary.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${String(n).padStart(5)}  ${k}`)
}

const reportDir = join(process.cwd(), '.logs', 'import-reports')
mkdirSync(reportDir, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const reportPath = join(reportDir, `report-${STAGE}-${stamp}.csv`)
const esc = (s: string) => /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
writeFileSync(reportPath, [
  'studentCode,name,email,sheetStatus,action,reason',
  ...rows.map(r => [r.code, r.name, r.email, r.sheetStatus, r.action, r.reason].map(v => esc(v ?? '')).join(',')),
].join('\n'), 'utf8')
console.log(`\n  Report: ${reportPath}`)
if (STAGE === 'dry-run') console.log('  Nothing was written. Next: --stage=import\n')

/* Give the outbox's fire-and-forget delivery a moment to settle. */
if (STAGE === 'welcome') await sleep(1500)
await mongoose.disconnect()
process.exit(0)
