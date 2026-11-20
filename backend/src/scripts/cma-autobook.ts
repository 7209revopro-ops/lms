/* ─────────────────────────────────────────────────────────────
   cma-autobook — what CMA auto-booking does now (services/cmaAutoBook.service.ts)

   Preview by default: every upcoming CMA class (next 30 days) and how many of
   its enrolled students it would book — changes nothing, tells nobody.

     cd ~/lms/backend
     bun src/scripts/cma-autobook.ts              # preview
     bun src/scripts/cma-autobook.ts --commit     # book them and tell them, once

   To keep it running: CMA_AUTO_BOOK=on in .env, then pm2 restart lms-backend
   (it then runs every 2 minutes by itself).
───────────────────────────────────────────────────────────── */
import mongoose from 'mongoose'

const COMMIT = process.argv.includes('--commit')
const die = (m: string): never => { console.error(`\n✖ ${m}\n`); process.exit(1) }
const DB_URL = process.env['DATABASE_URL'] ?? die('DATABASE_URL is not set (run from the backend folder so .env loads).')
mongoose.set('autoIndex', false); mongoose.set('autoCreate', false)
await mongoose.connect(DB_URL, { autoIndex: false, autoCreate: false })

const { bookCmaClasses, tellCmaStudents, cmaCourseIds, cmaAutoBookOn } = await import('@/services/cmaAutoBook.service.ts')
const { CourseModel } = await import('@/models/schema.ts')
const fmt = (d: Date) => d.toLocaleString('en-GB', { timeZone: 'Asia/Dubai', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true })

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
