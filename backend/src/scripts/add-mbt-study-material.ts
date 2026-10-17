/* ─────────────────────────────────────────────────────────────
   Add the Basic 1–7 PPTs and the Meta Trader Guide to MBT as study material
   (the user, 2026-10-17) — each a document lesson in its own module, the way
   every MBT module already has its "MBT N PDF": Basic N PPT in MBT N, the Meta
   Trader Guide in MBT 1. A student blocked from a module does not see its PPT.

   Basic 5 was given with Basic 4's link, so it is left out unless the right
   link is passed with --basic5 <url>.

   The Drive files must be shared "Anyone with the link", or students see
   "You need access".

   Dry run by default. --apply adds the lessons; a lesson already there (same
   title in the same module) is left alone, so it can be run again.

   Usage (from backend/):
     bun src/scripts/add-mbt-study-material.ts
     bun src/scripts/add-mbt-study-material.ts --apply
     bun src/scripts/add-mbt-study-material.ts --basic5 https://drive.google.com/file/d/…/view --apply
───────────────────────────────────────────────────────────── */
import '@/config/timezone.ts'
import mongoose, { Types } from 'mongoose'

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined }
const APPLY = process.argv.includes('--apply')
const BASIC5 = arg('--basic5')

const MBT = '6a3bdaa925c9f5a007590e0e'   // MARKET BREAK-OUT TRADING PROGRAM (shared)
const drive = (id: string) => `https://drive.google.com/file/d/${id}/view?usp=drive_link`
/* [module number, lesson title, link] */
const ITEMS: Array<[number, string, string | null]> = [
  [1, 'Basic 1 PPT', drive('1-sasOPalXMU-KHbJMZHktRmd0MoYTOYv')],
  [1, 'Meta Trader Guide', drive('1qAeAaGJqUJOnZ8Pwo-ZfXrhYKtMLBKbj')],
  [2, 'Basic 2 PPT', drive('1aSq_OhR6rVZdVU4osGj831OyJcPfCrof')],
  [3, 'Basic 3 PPT', drive('19ekudJt-HwJUK1bOgVtBvE0UJ6UTsmTS')],
  [4, 'Basic 4 PPT', drive('1GFcS-n5PFYpp06xmFn-KvxzclOk_WU1B')],
  [5, 'Basic 5 PPT', BASIC5 ?? null],
  [6, 'Basic 6 PPT', drive('1j0YSNFDL7XqeHtckib-LtC-X8PyafCcj')],
  [7, 'Basic 7 PPT', drive('1y9KcvTE68AcNYuC43E9eZUNn4gWF7tcp')],
]
if (BASIC5 && !/^https:\/\/drive\.google\.com\/file\/d\/[\w-]+/.test(BASIC5)) { console.error('--basic5 must be a Google Drive file link'); process.exit(1) }
if (BASIC5 && BASIC5.includes('1GFcS-n5PFYpp06xmFn-KvxzclOk_WU1B')) { console.error('--basic5 is Basic 4\'s link again'); process.exit(1) }

const { connectDatabase } = await import('@/config/database.ts')
await connectDatabase()
const M = await import('@/models/schema.ts')
const done = async (code: number) => { await mongoose.disconnect(); process.exit(code) }

const course = await M.CourseModel.findById(MBT).select('title').lean<{ title: string }>()
if (!course) { console.error('MBT course not found'); await done(1) }
const sections = await M.SectionModel.find({ courseId: MBT }).select('title order').lean<Array<{ _id: Types.ObjectId; title: string; order: number }>>()
const moduleN = (n: number) => sections.find(s => new RegExp(`^MBT ${n}\\b`).test(s.title))

console.log(`\n${course!.title}\n`)
const plan: Array<{ section: { _id: Types.ObjectId; title: string }; title: string; url: string; order: number }> = []
for (const [n, title, url] of ITEMS) {
  const sec = moduleN(n)
  if (!sec) { console.log(`  ✗ ${title}: no module "MBT ${n}"`); continue }
  if (!url) { console.log(`  – ${title}: left out — its link was the same as Basic 4's (pass --basic5 <link>)`); continue }
  const have = await M.LessonModel.findOne({ sectionId: sec._id, title }).select('_id').lean()
  if (have) { console.log(`  = ${title}: already in ${sec.title}`); continue }
  const last = await M.LessonModel.findOne({ sectionId: sec._id }).sort({ order: -1 }).select('order').lean<{ order?: number }>()
  const order = (last?.order ?? -1) + 1 + plan.filter(p => String(p.section._id) === String(sec._id)).length
  plan.push({ section: sec, title, url, order })
  console.log(`  + ${title} → ${sec.title} (lesson ${order + 1})  ${url}`)
}

if (!APPLY) { console.log(`\nDry run — ${plan.length} lesson(s) to add, nothing changed. Re-run with --apply.`); await done(0) }

for (const p of plan) {
  await M.LessonModel.create({
    courseId: new Types.ObjectId(MBT), sectionId: p.section._id, title: p.title, type: 'article',
    contentUrl: p.url, order: p.order, isFree: false, durationMins: 0,
  })
}
console.log(`\nAdded ${plan.length} lesson(s).`)
await done(0)
