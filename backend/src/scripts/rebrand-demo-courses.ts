/* ─────────────────────────────────────────────────────────────
   Rename the generic development seed courses to Delta's real programmes so
   the tutorial recording looks like the actual academy rather than a starter
   template. Local databases only.

   Titles and module names mirror production (MBT 1–8, the Digital Marketing
   modules, Delta Wave Theory, MMC), but the rows are the local seed rows —
   nothing is copied out of the production database.

   Usage:  bun src/scripts/rebrand-demo-courses.ts
───────────────────────────────────────────────────────────── */
import mongoose from 'mongoose'

const DB_URL = process.env['DATABASE_URL'] ?? 'mongodb://localhost:27017/lms'
if (!/(localhost|127\.0\.0\.1)/.test(DB_URL)) {
  console.error('❌ Local databases only — refusing to rename courses elsewhere.')
  process.exit(1)
}

await mongoose.connect(DB_URL)
const { CourseModel, SectionModel, LessonModel } = await import('@/models/schema.ts')

/* Ordered to match how the seed created them, so the student's enrolments
   (course 1 = 62% complete) land on the flagship programme. */
const PLAN: { title: string; subtitle: string; program?: string; modules: string[] }[] = [
  {
    title: 'Market Break-out Trading Programme',
    subtitle: 'Read structure, spot the break, manage the risk.',
    program: '4x-trading',
    modules: ['MBT 1 — Basics of Forex', 'MBT 2 — Reading Candles', 'MBT 3 — Market Structure',
              'MBT 4 — Order Types & Live Trade', 'MBT 5 — Chart Patterns', 'MBT 6 — Entry & Exit',
              'MBT 7 — Volume Analysis', 'MBT 8 — Trading Psychology'],
  },
  {
    title: 'Digital Marketing Programme',
    subtitle: 'From first post to paid campaigns that convert.',
    program: 'digital-marketing',
    modules: ['Social Media Marketing', 'Meta Ads', 'Google Ads', 'LinkedIn Ads',
              'Website', 'Search Engine Optimization', 'Ecommerce', 'AI for Marketers'],
  },
  {
    title: 'Delta Wave Theory Trading Programme',
    subtitle: 'Impulse, correction and the waves in between.',
    program: '4x-trading',
    modules: ['IM 1 — Wave Basics', 'IM 2 — Impulse', 'IM 3 — Correction', 'IM 4 — Advanced Waves'],
  },
  { title: 'MMC — Market Making Cycle', subtitle: 'Accumulation, manipulation, distribution.',
    program: '4x-trading', modules: ['Advance 1', 'Advance 2', 'Advance 3', 'Advance 4'] },
  { title: 'Crypto Genesis', subtitle: 'Digital assets, explained without the hype.', modules: [] },
  { title: 'Forex Foundations', subtitle: 'Your first steps in the currency markets.', modules: [] },
  { title: 'Risk & Money Management', subtitle: 'Protect the account before you grow it.', modules: [] },
  { title: 'Technical Analysis Essentials', subtitle: 'Charts, levels and confirmation.', modules: [] },
  { title: 'Trading Psychology', subtitle: 'The discipline behind every good trade.', modules: [] },
  { title: 'Financial Markets 101', subtitle: 'How the markets actually work.', modules: [] },
]

const courses = await CourseModel.find({}).sort({ createdAt: 1 }).select('_id title').lean()
console.log(`  ${courses.length} course(s) found\n`)

for (const [i, c] of courses.entries()) {
  const plan = PLAN[i]
  if (!plan) continue
  await CourseModel.updateOne({ _id: c._id }, {
    $set: { title: plan.title, subtitle: plan.subtitle, ...(plan.program ? { program: plan.program } : {}) },
  })
  console.log(`  ${String(c.title).slice(0, 30).padEnd(30)} -> ${plan.title}`)

  if (plan.modules.length) {
    const sections = await SectionModel.find({ courseId: c._id }).sort({ order: 1 }).select('_id').lean()
    for (const [j, s] of sections.entries()) {
      const name = plan.modules[j]
      if (!name) continue
      await SectionModel.updateOne({ _id: s._id }, { $set: { title: name } })
      /* Lessons inside take the module name plus a part number, which is how
         the real courses read in the curriculum sidebar. */
      const lessons = await LessonModel.find({ sectionId: s._id }).sort({ order: 1 }).select('_id').lean()
      for (const [k, l] of lessons.entries()) {
        await LessonModel.updateOne({ _id: l._id },
          { $set: { title: `${name.replace(/^(MBT|IM) \d+ — /, '')} — Part ${k + 1}` } })
      }
    }
  }
}

console.log('\n  Done — local catalogue now reads as Delta programmes.\n')
await mongoose.disconnect()
process.exit(0)
