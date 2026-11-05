/* ─────────────────────────────────────────────────────────────
   Add a programme category to students who ALREADY have an LMS account.

   The bulk importer deliberately never modifies an existing user, so a
   student who is already enrolled in one programme (say Digital Marketing)
   and now appears in another sheet (Forex) keeps their old account and is
   reported as "already-in-LMS". This script closes that gap: it ADDS the new
   category to those accounts.

   A student may belong to several programmes — `categories` is an array — so
   the write is a $addToSet. Nothing is ever removed:
     · existing categories are kept
     · the legacy single `category` field is only filled when it is empty,
       so a student's primary programme never silently changes
     · approval status, org, profile and enrolments are untouched

   Report-only by default; --apply performs the update.

   Usage (from backend/):
     bun src/scripts/add-category-to-existing.ts --file=forex-2026.csv --category=4x-trading
     bun src/scripts/add-category-to-existing.ts --file=forex-2026.csv --category=4x-trading --apply
───────────────────────────────────────────────────────────── */
import mongoose from 'mongoose'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const VALID = ['digital-marketing', '4x-trading', 'ai', 'jura', 'cma'] as const
type Category = typeof VALID[number]

const args = new Map<string, string>()
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([a-z-]+)(?:=(.*))?$/)
  if (m) args.set(m[1]!, m[2] ?? 'true')
}
const FILE     = args.get('file')
const CATEGORY = args.get('category') as Category | undefined
const APPLY    = args.has('apply')

if (!FILE)     { console.error('❌ --file=<csv with an EMAIL ID column> is required.'); process.exit(1) }
if (!CATEGORY || !VALID.includes(CATEGORY)) {
  console.error(`❌ --category is required and must be one of: ${VALID.join(' | ')}`); process.exit(1)
}

/* ─── CSV ───────────────────────────────────────────── */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], field = '', inQ = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++ } else inQ = false }
      else field += ch
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

const csv    = parseCsv(readFileSync(FILE, 'utf8'))
const header = csv[0]!.map(h => h.trim())
const cEmail = header.indexOf('EMAIL ID')
const cName  = header.indexOf('STUDENT NAME')
if (cEmail < 0) { console.error('❌ CSV must have an "EMAIL ID" column.'); process.exit(1) }

const wanted = new Map<string, string>()
for (const r of csv.slice(1)) {
  const email = (r[cEmail] ?? '').trim().toLowerCase()
  if (email && !wanted.has(email)) wanted.set(email, (cName >= 0 ? r[cName] ?? '' : '').trim())
}

/* ─── connect ───────────────────────────────────────── */
const DB_URL = process.env['DATABASE_URL'] ?? 'mongodb://localhost:27017/lms'
await mongoose.connect(DB_URL)
const dbName = mongoose.connection.db!.databaseName
const { UserModel } = await import('@/models/schema.ts')

console.log('═'.repeat(64))
console.log(`  Mode:     ${APPLY ? 'APPLY' : 'REPORT ONLY'}`)
console.log(`  Database: ${dbName}  (${DB_URL.replace(/\/\/[^@/]+@/, '//***@')})`)
console.log(`  Sheet:    ${FILE}  (${wanted.size} students)`)
console.log(`  Category: ${CATEGORY}`)
console.log('═'.repeat(64))

const existing = await UserModel.find({ email: { $in: [...wanted.keys()] } })
  .select('email name role category categories enrollmentStatus').lean()

interface Out { email: string; name: string; had: string; action: string }
const out: Out[] = []
let toAdd = 0
for (const u of existing) {
  const cats: string[] = (u as { categories?: string[] }).categories ?? []
  const legacy = (u as { category?: string }).category
  const all = [...new Set([...cats, ...(legacy ? [legacy] : [])])]
  const has = all.includes(CATEGORY)
  out.push({
    email: u.email as string,
    name:  (u.name as string) ?? '',
    had:   all.join(' + ') || '(none)',
    action: has ? 'already has it' : 'add',
  })
  if (!has) toAdd++
}
const missing = [...wanted.keys()].filter(e => !existing.some(u => u.email === e))

console.log(`\n  Found in the LMS      : ${existing.length}`)
console.log(`    · will gain ${CATEGORY}: ${toAdd}`)
console.log(`    · already have it     : ${existing.length - toAdd}`)
console.log(`  Not in the LMS        : ${missing.length}  (imported separately, nothing to do here)`)

if (toAdd > 0) {
  console.log(`\n  Accounts that will gain ${CATEGORY}:`)
  for (const o of out.filter(o => o.action === 'add')) {
    console.log(`     ${o.email.padEnd(34)} ${o.name.slice(0, 24).padEnd(24)} currently: ${o.had}`)
  }
}

if (APPLY && toAdd > 0) {
  const emails = out.filter(o => o.action === 'add').map(o => o.email)
  /* $addToSet keeps every category the student already has. */
  const res = await UserModel.updateMany(
    { email: { $in: emails } },
    { $addToSet: { categories: CATEGORY } },
  )
  /* Fill the legacy single field only when it is empty — never overwrite a
     student's existing primary programme. */
  const legacyRes = await UserModel.updateMany(
    { email: { $in: emails }, $or: [{ category: { $exists: false } }, { category: null }, { category: '' }] },
    { $set: { category: CATEGORY } },
  )
  console.log(`\n  → ${res.modifiedCount} account(s) gained ${CATEGORY}`)
  console.log(`  → ${legacyRes.modifiedCount} had an empty primary programme, now set to ${CATEGORY}`)

  const after = await UserModel.find({ email: { $in: emails } }).select('email categories').lean()
  const ok = after.filter(u => ((u as { categories?: string[] }).categories ?? []).includes(CATEGORY)).length
  console.log(`  → verified: ${ok}/${emails.length} now carry ${CATEGORY}`)
} else if (!APPLY) {
  console.log('\n  Nothing changed. Re-run with --apply to make the change.')
}

const dir = join(process.cwd(), '.logs', 'import-reports')
mkdirSync(dir, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const path  = join(dir, `add-category-${CATEGORY}-${stamp}.csv`)
const esc = (s: string) => /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
writeFileSync(path, [
  'email,name,categoriesBefore,action',
  ...out.map(o => [o.email, o.name, o.had, o.action].map(v => esc(String(v))).join(',')),
].join('\n'), 'utf8')
console.log(`\n  Report: ${path}\n`)

await mongoose.disconnect()
process.exit(0)
