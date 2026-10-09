/* ─────────────────────────────────────────────────────────────
   Merge Bangalore's copies of the Forex courses back into the Dubai
   originals, now that one course can serve both academies
   (Course.sharedAcademies).

   On 28 Sep 2026 five Dubai courses were copied into Bangalore (MBT, DWT,
   MMC, HADC, DSLP): same titles, same module and lesson titles, new ids.
   For each pair this script:
     1. sets the Dubai course to "Both academies";
     2. moves every NOT-dropped enrolment on the copy onto the Dubai course —
        in place, so status, source, finance fields and dates are kept — and
        maps its blocked modules by module title. A student already enrolled
        in the Dubai course keeps that one; the copy's is set to dropped;
     3. moves lesson progress (lesson mapped by title) and favourites;
     4. moves live classes on the copy to the Dubai course (module mapped by
        title). Their academy is unchanged, so a Bangalore class stays
        Bangalore's and its bookings stay as they are;
     5. archives the copy (kept, never deleted) and corrects both courses'
        enrolledCount.
   Dropped enrolments on a copy are left where they are, as history.

   Dry run by default — prints every change. --apply writes, after saving a
   backup of every document it will touch to merge-course-copies-backup-<ts>.json.
   Re-running after an apply finds nothing left to move.

   Usage (from backend/):
     bun src/scripts/merge-academy-course-copies.ts
     bun src/scripts/merge-academy-course-copies.ts --apply
───────────────────────────────────────────────────────────── */
import '@/config/timezone.ts'
import fs from 'node:fs'
import mongoose, { Types } from 'mongoose'

const APPLY = process.argv.includes('--apply')
/* Bangalore copy → Dubai original. */
const PAIRS: Record<string, string> = {
  '6aba5e98b8459bb891a7d001': '6a3bdaa925c9f5a007590e0e',   // MARKET BREAK-OUT TRADING PROGRAM
  '6aba5e99b8459bb891a7d02a': '6a3cfcbf62479daf447af492',   // DELTA WAVE THEORY TRADING PROGRAMME
  '6aba5e99b8459bb891a7d03d': '6a773c96e9d3d22e4401b193',   // MMC (MARKET MAKING CYCLE)
  '6aba5e99b8459bb891a7d082': '6a8d9a41d662c2137dda405f',   // HADC - Heikin Ashi Decisive Candle
  '6aba5e99b8459bb891a7d093': '6a8d9ad05fb90dbe87d40370',   // DSLP - Delta Structure & Liquidity Programme
}

const { connectDatabase } = await import('@/config/database.ts')
await connectDatabase()
const db = mongoose.connection.db!
const C = (n: string) => db.collection(n)
const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
const oid = (s: string) => new Types.ObjectId(s)

type Op = { col: string; filter: Record<string, unknown>; update: Record<string, unknown>; before: unknown; say: string }
const ops: Op[] = []
const problems: string[] = []

for (const [copyId, dubaiId] of Object.entries(PAIRS)) {
  const copy = await C('courses').findOne({ _id: oid(copyId) })
  const dubai = await C('courses').findOne({ _id: oid(dubaiId) })
  if (!copy || !dubai) { problems.push(`missing course ${copy ? dubaiId : copyId}`); continue }
  if (norm(copy['title']) !== norm(dubai['title'])) { problems.push(`titles differ: "${copy['title']}" vs "${dubai['title']}"`); continue }
  console.log(`\n═══ ${dubai['title']}`)

  /* Module and lesson maps, by title. */
  const [cSecs, dSecs, cLes, dLes] = await Promise.all([
    C('sections').find({ courseId: copy._id }).toArray(), C('sections').find({ courseId: dubai._id }).toArray(),
    C('lessons').find({ courseId: copy._id }).toArray(),  C('lessons').find({ courseId: dubai._id }).toArray(),
  ])
  const secMap = new Map<string, Types.ObjectId>(), lesMap = new Map<string, Types.ObjectId>()
  for (const s of cSecs) { const d = dSecs.find(x => norm(x['title']) === norm(s['title'])); if (d) secMap.set(String(s._id), d._id as Types.ObjectId); else problems.push(`${dubai['title']}: module "${s['title']}" has no Dubai match`) }
  for (const l of cLes)  { const d = dLes.find(x => norm(x['title']) === norm(l['title']));  if (d) lesMap.set(String(l._id), d._id as Types.ObjectId); else problems.push(`${dubai['title']}: lesson "${l['title']}" has no Dubai match`) }

  /* 1. share the Dubai course */
  if (dubai['sharedAcademies'] !== true) {
    ops.push({ col: 'courses', filter: { _id: dubai._id }, update: { $set: { sharedAcademies: true } }, before: { _id: dubai._id, sharedAcademies: dubai['sharedAcademies'] ?? false }, say: 'set Dubai course to Both academies' })
  }

  /* 2. enrolments */
  let moved = 0
  for (const e of await C('enrollments').find({ courseId: copy._id, status: { $ne: 'dropped' } }).toArray()) {
    const u = await C('users').findOne({ _id: e['userId'] }, { projection: { name: 1, email: 1 } })
    const who = `${u?.['name'] ?? '?'} <${u?.['email'] ?? '?'}>`
    const twin = await C('enrollments').findOne({ userId: e['userId'], courseId: dubai._id })
    if (twin) {
      ops.push({ col: 'enrollments', filter: { _id: e._id }, update: { $set: { status: 'dropped', updatedAt: new Date() } }, before: e,
        say: `enrolment ${who}: already in the Dubai course (${twin['status']}) — copy's set to dropped` })
      continue
    }
    const blocked = ((e['blockedLessons'] as unknown[]) ?? []).map(String)
    const mapped = blocked.map(b => secMap.get(b)).filter(Boolean) as Types.ObjectId[]
    if (mapped.length !== blocked.length) problems.push(`${who}: ${blocked.length - mapped.length} blocked module(s) could not be mapped`)
    ops.push({ col: 'enrollments', filter: { _id: e._id }, update: { $set: { courseId: dubai._id, blockedLessons: mapped, updatedAt: new Date() } }, before: e,
      say: `enrolment ${who}: ${e['status']}, ${blocked.length} module(s) blocked → Dubai course` })
    moved++
  }

  /* 3. lesson progress + favourites */
  for (const p of await C('lessonprogresses').find({ courseId: copy._id }).toArray()) {
    const to = lesMap.get(String(p['lessonId']))
    if (!to) continue
    if (await C('lessonprogresses').findOne({ userId: p['userId'], lessonId: to })) { problems.push(`progress ${p._id}: student already has progress on the Dubai lesson — left`); continue }
    ops.push({ col: 'lessonprogresses', filter: { _id: p._id }, update: { $set: { courseId: dubai._id, lessonId: to } }, before: p, say: `lesson progress ${p._id} → Dubai lesson` })
  }
  for (const f of await C('favorites').find({ courseId: copy._id }).toArray()) {
    if (await C('favorites').findOne({ userId: f['userId'], courseId: dubai._id })) continue
    ops.push({ col: 'favorites', filter: { _id: f._id }, update: { $set: { courseId: dubai._id } }, before: f, say: `favourite ${f._id} → Dubai course` })
  }

  /* 4. live classes */
  for (const lc of await C('liveclasses').find({ courseId: copy._id }).toArray()) {
    const sec = lc['sectionId'] ? secMap.get(String(lc['sectionId'])) : undefined
    if (lc['sectionId'] && !sec) { problems.push(`class ${lc._id}: module not mapped — left`); continue }
    ops.push({ col: 'liveclasses', filter: { _id: lc._id }, update: { $set: { courseId: dubai._id, ...(sec ? { sectionId: sec } : {}) } }, before: lc,
      say: `class "${lc['title']}" ${new Date(lc['scheduledStart'] as Date).toISOString().slice(0, 16)} (academy unchanged) → Dubai course` })
  }

  /* 5. archive the copy, fix counters */
  ops.push({ col: 'courses', filter: { _id: copy._id }, update: { $set: { status: 'archived', enrolledCount: 0 } }, before: { _id: copy._id, status: copy['status'], enrolledCount: copy['enrolledCount'] },
    say: `archive the Bangalore copy (was ${copy['status']})` })
  if (moved) ops.push({ col: 'courses', filter: { _id: dubai._id }, update: { $inc: { enrolledCount: moved } }, before: { _id: dubai._id, enrolledCount: dubai['enrolledCount'] }, say: `Dubai enrolledCount +${moved}` })

  for (const o of ops.filter(o => !(o as any).printed)) { console.log(`  ${APPLY ? 'DO ' : '·  '} ${o.say}`); (o as any).printed = true }
}

if (problems.length) { console.log('\n⚠ Problems:'); for (const p of problems) console.log('  - ' + p) }
console.log(`\n${ops.length} change(s).`)

if (!APPLY) {
  console.log('Dry run — nothing written. Re-run with --apply.')
} else if (ops.length) {
  const file = `merge-course-copies-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  fs.writeFileSync(file, JSON.stringify(ops.map(o => ({ col: o.col, filter: o.filter, before: o.before })), null, 1))
  console.log(`Backup of every touched document: ${file}`)
  let done = 0
  for (const o of ops) { const r = await C(o.col).updateOne(o.filter, o.update); done += r.modifiedCount }
  console.log(`Applied: ${done} of ${ops.length} updates.`)
}
await mongoose.disconnect()
process.exit(0)
