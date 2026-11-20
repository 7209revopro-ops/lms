/* ─────────────────────────────────────────────────────────────
   cma-autobook — what CMA auto-booking does now (services/cmaAutoBook.service.ts)

   Preview by default: every upcoming CMA class (next 30 days) and how many of
   its enrolled students it would book — changes nothing, tells nobody.

     cd ~/lms/backend
     bun src/scripts/cma-autobook.ts              # preview
     bun src/scripts/cma-autobook.ts --commit     # book them and tell them, once

   To keep it running: CMA_AUTO_BOOK=on in .env, then pm2 restart lms-backend
   (it then runs every 2 minutes by itself).

   ONE class, even while it is live (2026-11-20) — every enrolled, approved
   student of its course not booked yet, told at once (in-app, e-mail now,
   WhatsApp with a sign-in link to their bookings, where Join is):
     bun src/scripts/cma-autobook.ts --class <class id>             # preview
     bun src/scripts/cma-autobook.ts --class <class id> --commit    # book + tell (type BOOK)
     bun src/scripts/cma-autobook.ts --today                        # list today's classes with their ids
───────────────────────────────────────────────────────────── */
import mongoose from 'mongoose'

const COMMIT = process.argv.includes('--commit')
const CLASS = (() => { const i = process.argv.indexOf('--class'); return i >= 0 ? process.argv[i + 1] : undefined })()
const TODAY = process.argv.includes('--today')
const die = (m: string): never => { console.error(`\n✖ ${m}\n`); process.exit(1) }
const DB_URL = process.env['DATABASE_URL'] ?? die('DATABASE_URL is not set (run from the backend folder so .env loads).')
mongoose.set('autoIndex', false); mongoose.set('autoCreate', false)
await mongoose.connect(DB_URL, { autoIndex: false, autoCreate: false })

const { bookCmaClasses, tellCmaStudents, tellClassNow, cmaCourseIds, cmaAutoBookOn } = await import('@/services/cmaAutoBook.service.ts')
const { CourseModel, LiveClassModel } = await import('@/models/schema.ts')
const fmt = (d: Date) => d.toLocaleString('en-GB', { timeZone: 'Asia/Dubai', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true })

/* Today's classes (UAE day) with their ids — to find the one for --class. */
if (TODAY) {
  const day = new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 10)
  const rows = await LiveClassModel.find({ scheduledStart: { $gte: new Date(`${day}T00:00:00+04:00`), $lte: new Date(`${day}T23:59:59+04:00`) }, status: { $ne: 'cancelled' } })
    .select('title scheduledStart status bookedCount sessionCapacity courseId').populate('courseId', 'title').sort({ scheduledStart: 1 }).lean() as any[]
  console.log(`\nToday's classes (${rows.length}):`)
  for (const c of rows) console.log(`  ${String(c._id)}  ${fmt(new Date(c.scheduledStart))}  ${c.status.padEnd(9)} ${String(c.bookedCount ?? 0).padStart(4)}/${String(c.sessionCapacity ?? '').padEnd(4)}  ${String(c.courseId?.title ?? '').slice(0, 20).padEnd(20)}  ${c.title.slice(0, 60)}`)
  console.log('')
  await mongoose.disconnect(); process.exit(0)
}

/* ONE class, even while live. */
if (CLASS) {
  const cls = await LiveClassModel.findById(CLASS).select('title scheduledStart status courseId bookedCount sessionCapacity').populate('courseId', 'title program').lean().catch(() => null) as any
  if (!cls) { await mongoose.disconnect(); die(`No class with id ${CLASS}. List today's:  bun src/scripts/cma-autobook.ts --today`) }
  console.log(`\n${cls.title}\n  ${cls.courseId?.title ?? '?'} (programme: ${cls.courseId?.program || 'not set'}) · ${fmt(new Date(cls.scheduledStart))} · ${cls.status} · ${cls.bookedCount ?? 0}/${cls.sessionCapacity ?? '?'} booked`)
  if (!['scheduled', 'live'].includes(cls.status)) { await mongoose.disconnect(); die(`This class is ${cls.status} — nothing to book.`) }
  const pre = await bookCmaClasses(new Date(), { dryRun: true, classId: CLASS })
  console.log(`  Students of the course not booked yet, who may attend: ${pre.booked}`)
  if (!COMMIT) {
    console.log(`\nPreview only — nothing booked, nobody told. To do it:  bun src/scripts/cma-autobook.ts --class ${CLASS} --commit\n`)
  } else if (pre.booked) {
    const ok = (globalThis as { prompt?: (m: string) => string | null }).prompt?.(`\nBook ${pre.booked} students into this class on the LIVE LMS and tell them now (in-app, e-mail, WhatsApp)? Type BOOK to continue:`)
    if (ok !== 'BOOK') { await mongoose.disconnect(); die('Stopped — nothing booked.') }
    const done = await bookCmaClasses(new Date(), { classId: CLASS })
    const told = await tellClassNow(CLASS)
    console.log(`\nBooked ${done.booked} · told ${told} students.\n`)
  } else {
    console.log('\nEveryone who may attend is already booked.\n')
  }
  await mongoose.disconnect(); process.exit(0)
}

const ids = [...await cmaCourseIds(true)]
const courses = await CourseModel.find({ _id: { $in: ids } }).select('title').lean() as any[]
console.log(`\nCMA courses (${courses.length}): ${courses.map(c => c.title).join(' · ') || 'none'}`)
console.log(`CMA_AUTO_BOOK is ${cmaAutoBookOn() ? 'ON — it runs every 2 minutes' : 'OFF — nothing runs by itself'}`)

const preview = await bookCmaClasses(new Date(), { dryRun: true })
console.log(`\nUpcoming CMA classes (30 days): ${preview.classes}`)
console.log(`Seats to book: ${preview.booked} in ${preview.plan.length} classes · ${new Set(preview.plan.flatMap(p => p.students)).size} students\n`)
for (const p of preview.plan.sort((a, b) => +a.start - +b.start)) console.log(`  ${fmt(p.start)}  ${p.title.slice(0, 60).padEnd(60)}  +${p.students.length}`)

if (!COMMIT) {
  console.log('\nPreview only — nothing booked, nobody told. To do it once:  bun src/scripts/cma-autobook.ts --commit\n')
} else if (preview.booked) {
  const ok = (globalThis as { prompt?: (m: string) => string | null }).prompt?.(`\nBook ${preview.booked} seats on the LIVE LMS and tell those students (in-app, e-mail, WhatsApp)? Type BOOK to continue:`)
  if (ok !== 'BOOK') { await mongoose.disconnect(); die('Stopped — nothing booked.') }
  const done = await bookCmaClasses(new Date())
  /* Told now rather than after the usual few minutes' settling. */
  const told = await tellCmaStudents(new Date(), {}, 0)
  console.log(`\nBooked ${done.booked} seats · told ${told} students.\n`)
} else {
  console.log('\nNothing to book.\n')
}
await mongoose.disconnect()
process.exit(0)
