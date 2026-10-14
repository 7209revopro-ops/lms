/* ─────────────────────────────────────────────────────────────
   Create the MSNR course (Malaysian Support & Resistance) from its syllabus
   (Delta_MSNR_Syllabus.pdf, Delta International Trading Academy): the course
   and its 6 modules, set up like the other Forex courses.

     · Dubai academy, shared with both academies (sharedAcademies)
     · programme Forex (4x-trading), English, level intermediate
     · journey level 6, after DSLP (programOrder 6)
     · owner/mentor: the same account as the other Forex courses (DSLP's)
     · DRAFT, price 0 — invisible to students. Set the price and picture in
       admin, then Publish. (Published at price 0 it would be free to enrol.)
     · no lessons, like DSLP — classes are scheduled per module

   Dry run by default — prints what it would create. --apply creates it.
   Refuses if a course titled MSNR already exists.

   Usage (from backend/):
     bun src/scripts/create-msnr-course.ts
     bun src/scripts/create-msnr-course.ts --apply
───────────────────────────────────────────────────────────── */
import '@/config/timezone.ts'
import mongoose from 'mongoose'

const APPLY = process.argv.includes('--apply')

const COURSE = {
  title: 'MSNR - Malaysian Support & Resistance',
  slug:  'msnr-malaysian-support-resistance',
  description:
    'MSNR teaches trading from a fresh level to the next fresh level, with the storyline. '
    + 'The course builds in one direction: first the levels, then the direction, then the trigger, then the entry, '
    + 'and finally the daily routine that ties it together. Six modules, six sessions, ending with a daily analysis '
    + 'routine and a risk plan.',
}

const MODULES: Array<{ title: string; topics: string[]; outcome: string }> = [
  { title: 'Support and Resistance, and the Basics of MSNR',
    topics: ['Support and resistance basics', 'Basics of MSNR: reading the line chart', 'A-level and V-level: how to mark them', 'Fresh and unfresh levels', 'Core concepts of MSNR'],
    outcome: 'Mark fresh A-levels and V-levels on a line chart and say which ones are tradeable.' },
  { title: 'Key Levels',
    topics: ['QML level', 'HNS level', 'Open-close levels', 'SBR and RBS: role reversal after a break'],
    outcome: 'Identify and mark every key level type, and tell a fresh level from a used one.' },
  { title: 'Storyline, Trend Line and Daily Bias',
    topics: ['Storyline: how it starts and how it is confirmed', 'Internal and external breakouts, and roadblocks', 'Trend line', 'Daily bias: deciding the direction for the day'],
    outcome: 'Build a storyline on the higher timeframe and state the daily bias before the session.' },
  { title: 'Rejection Candle and Rejection Wick',
    topics: ['Rejection candle concept', 'Rejection wick concept', 'Valid and invalid rejections', 'Refinements: narrowing a higher-timeframe level to a lower-timeframe entry'],
    outcome: 'Judge whether a rejection at a level is valid, and refine it on a lower timeframe.' },
  { title: 'Advanced and Precise Entry Techniques',
    topics: ['Advanced entry techniques', 'Precise entries on the lower timeframe', 'Conservative and aggressive entries', 'Stop loss and target placement from the level'],
    outcome: 'Plan a complete entry with the stop beyond the wick and a target at the next fresh level.' },
  { title: 'Daily Analysis and Risk Management',
    topics: ['Daily analysis routine: levels, storyline, bias, entry zones', 'Risk management according to MSNR concepts', 'Reward versus risk, and when to skip a trade', 'Pre-trade checklist and review'],
    outcome: 'Run a full daily analysis and take only the trades that pass the checklist.' },
]
const moduleTitle = (i: number) => `MODULE ${i + 1} - ${MODULES[i]!.title}`
const moduleText = (m: typeof MODULES[number]) =>
  `Topics: ${m.topics.join('; ')}.\n\nBy the end of the module: ${m.outcome}`

const { connectDatabase } = await import('@/config/database.ts')
await connectDatabase()
const M = await import('@/models/schema.ts')
const done = async (code: number) => { await mongoose.disconnect(); process.exit(code) }

const dubai = await M.OrganizationModel.findOne({ slug: 'dubai' }).select('_id name').lean<{ _id: mongoose.Types.ObjectId; name: string }>()
if (!dubai) { console.error('Dubai academy not found'); await done(1) }
/* The same owner as the other Forex courses. */
const dslp = await M.CourseModel.findOne({ title: /^DSLP/i, organizationId: dubai!._id, status: 'published' })
  .select('instructorId').lean<{ instructorId: mongoose.Types.ObjectId }>()
if (!dslp) { console.error('DSLP course not found — cannot pick the owner'); await done(1) }
const owner = await M.UserModel.findById(dslp!.instructorId).select('name email').lean<{ name: string; email: string }>()

const existing = await M.CourseModel.findOne({ $or: [{ title: /MSNR|Malaysian Support/i }, { slug: COURSE.slug }] }).select('title status').lean<{ title: string; status: string }>()
if (existing) { console.error(`Refusing: "${existing.title}" (${existing.status}) already exists.`); await done(1) }
for (const [i, m] of MODULES.entries()) {
  if (moduleText(m).length > 1000) { console.error(`Module ${i + 1} description is over 1000 characters`); await done(1) }
}

console.log(`\n${COURSE.title}`)
console.log(`  ${dubai!.name}, shared with both academies · Forex · English · intermediate · journey level 6 · DRAFT · price 0`)
console.log(`  owner: ${owner?.name ?? '?'} <${owner?.email ?? '?'}>`)
console.log(`  ${COURSE.description}\n`)
MODULES.forEach((m, i) => console.log(`  ${moduleTitle(i)}\n    ${moduleText(m).replace(/\n\n/g, '\n    ')}\n`))

if (!APPLY) { console.log('Dry run — nothing created. Re-run with --apply.'); await done(0) }

const course = await M.CourseModel.create({
  title: COURSE.title, slug: COURSE.slug, description: COURSE.description,
  price: 0, isFree: false, status: 'draft', level: 'intermediate', language: 'English',
  program: '4x-trading', programOrder: 6, sharedAcademies: true,
  instructorId: dslp!.instructorId, organizationId: dubai!._id,
})
for (const [i, m] of MODULES.entries()) {
  await M.SectionModel.create({ courseId: course._id, title: moduleTitle(i), description: moduleText(m), order: i })
}
console.log(`Created ${COURSE.title} (${String(course._id)}) with ${MODULES.length} modules, as a DRAFT.`)
console.log('Next, in admin: Courses → MSNR → add the picture and price → Publish.')
await done(0)
