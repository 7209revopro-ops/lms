/* ─────────────────────────────────────────────────────────────
   Hunt for an email address (or any string) across EVERY collection and
   every field in the database.

   `db.users.findOne({email})` only answers one question. This answers the
   real one: does this person exist anywhere at all — as a user, inside a
   bulk-import log, as an instructor reference on a course, in an audit entry,
   in a support ticket, or in the email outbox?

   It also catches the near-misses a exact-match query silently hides:
   a different case, a stray space, a dot the person does not use, or a
   different domain.

   Read-only. Documents are scanned in the process, so nothing is written and
   no index is required.

   Usage (from backend/):
     bun src/scripts/find-email-everywhere.ts akhilcp@deltainstitutions.com
     bun src/scripts/find-email-everywhere.ts akhilcp haritha.kg --loose
───────────────────────────────────────────────────────────── */
import mongoose from 'mongoose'

const args    = process.argv.slice(2)
const LOOSE   = args.includes('--loose')
const needles = args.filter(a => !a.startsWith('--')).map(s => s.trim().toLowerCase())
if (needles.length === 0) {
  console.error('❌ Give at least one email or fragment to search for.')
  process.exit(1)
}

const DB_URL = process.env['DATABASE_URL'] ?? 'mongodb://localhost:27017/lms'
await mongoose.connect(DB_URL)
const db = mongoose.connection.db!

console.log('═'.repeat(68))
console.log(`  Database: ${db.databaseName}  (${DB_URL.replace(/\/\/[^@/]+@/, '//***@')})`)
console.log(`  Searching every collection and field for: ${needles.join(', ')}`)
if (LOOSE) console.log('  (loose mode — also reports the local-part on any domain)')
console.log('═'.repeat(68))

/* Walk a document and yield "path = value" for every string that contains a
   needle, so the report says WHERE the match sits, not just that it matched. */
function* hits(value: unknown, needle: string, path = ''): Generator<string> {
  if (value === null || value === undefined) return
  if (typeof value === 'string') {
    if (value.toLowerCase().includes(needle)) yield `${path || '(root)'} = ${value.slice(0, 120)}`
    return
  }
  if (Array.isArray(value)) {
    for (const [i, v] of value.entries()) yield* hits(v, needle, `${path}[${i}]`)
    return
  }
  if (typeof value === 'object') {
    /* ObjectId, Date, Buffer etc. stringify to something meaningless here. */
    const proto = Object.getPrototypeOf(value)
    if (proto !== Object.prototype) return
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      yield* hits(v, needle, path ? `${path}.${k}` : k)
    }
  }
}

const collections = (await db.listCollections().toArray())
  .map(c => c.name).filter(n => !n.startsWith('system.')).sort()

let totalDocs = 0
const found: { collection: string; id: string; needle: string; where: string[] }[] = []

for (const name of collections) {
  const cursor = db.collection(name).find({}, { projection: {} })
  let scanned = 0
  for await (const doc of cursor) {
    scanned++
    for (const needle of needles) {
      const where = [...hits(doc, needle)]
      if (where.length) {
        found.push({ collection: name, id: String((doc as { _id: unknown })._id), needle, where })
      }
    }
  }
  totalDocs += scanned
}

console.log(`\n  scanned ${totalDocs} documents across ${collections.length} collections\n`)

if (found.length === 0) {
  console.log('  NOT FOUND — this address does not appear anywhere in the database.')
} else {
  const byCol = new Map<string, typeof found>()
  for (const f of found) {
    if (!byCol.has(f.collection)) byCol.set(f.collection, [])
    byCol.get(f.collection)!.push(f)
  }
  for (const [col, rows] of byCol) {
    console.log(`  ${col}  (${rows.length} match${rows.length === 1 ? '' : 'es'})`)
    for (const r of rows.slice(0, 12)) {
      console.log(`     _id ${r.id}`)
      r.where.slice(0, 6).forEach(w => console.log(`        ${w}`))
    }
    if (rows.length > 12) console.log(`     …and ${rows.length - 12} more`)
    console.log()
  }
}

/* The most useful near-miss: the same person on a different domain, or with
   the dots/case written differently. */
if (LOOSE) {
  console.log('  ── near-miss check on the users collection ──')
  for (const needle of needles) {
    const local = needle.split('@')[0]!.replace(/[^a-z0-9]/g, '')
    const rx = new RegExp(local.split('').join('[^a-z0-9]?'), 'i')
    const near = await db.collection('users')
      .find({ email: rx }).project({ email: 1, name: 1, role: 1, isActive: 1 }).limit(15).toArray()
    console.log(`  "${local}" →  ${near.length} similar account(s)`)
    near.forEach((n: Record<string, any>) =>
      console.log(`     ${String(n.email).padEnd(42)} ${String(n.role).padEnd(12)} ${n.isActive === false ? 'BLOCKED' : ''} ${n.name ?? ''}`))
  }
}

console.log()
await mongoose.disconnect()
process.exit(0)
