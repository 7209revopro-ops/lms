/* ─────────────────────────────────────────────────────
   drop-course-text-index — remove the courses collection's text index.

   WHY: MongoDB reads a course's `language` field as the language to stem the
   text index in and refuses any it does not support, so creating or editing a
   course in Malayalam, Hindi, Arabic, Tamil… failed with error 17262 and the
   admin showed "An unexpected error occurred". Nothing queries the index
   ($text is used nowhere); it is gone from models/schema.ts, but removing it
   from the code does not remove it from a database that already has it.

   Run from the backend folder (on the server: cd ~/lms/backend):
     bun src/scripts/drop-course-text-index.ts             # preview — changes nothing
     bun src/scripts/drop-course-text-index.ts --commit    # drop it
     bun src/scripts/drop-course-text-index.ts --restore   # put a text index back

   --restore builds { title, description, tags } as text again, but with
   language_override 'searchLanguage' — a field courses do not have — so the
   index no longer reads `language` and Malayalam courses still save. (The
   original form would fail to build once any such course exists.)

   Touches indexes only. No course document is read for change or written.
───────────────────────────────────────────────────── */
import mongoose from 'mongoose'

const argv    = process.argv.slice(2)
const COMMIT  = argv.includes('--commit')
const RESTORE = argv.includes('--restore')
const die = (msg: string): never => { console.error(`\n✖ ${msg}\n`); process.exit(1) }
if (COMMIT && RESTORE) die('Pick one: --commit or --restore.')

const DB_URL = process.env['DATABASE_URL'] ?? process.env['MONGODB_URI']
  ?? die('DATABASE_URL is not set — run this from the backend folder so .env loads.')

await mongoose.connect(DB_URL, { autoIndex: false, autoCreate: false })
const db = mongoose.connection.db ?? die('No database handle after connecting.')
const courses = db.collection('courses')

type Ix = { name: string; key: Record<string, unknown>; language_override?: string; default_language?: string }
const indexes = (await courses.indexes()) as unknown as Ix[]
const textIx  = indexes.filter(ix => Object.values(ix.key).includes('text') || '_fts' in ix.key)

console.log(`\nDatabase: ${db.databaseName} · courses: ${await courses.estimatedDocumentCount()}`)
console.log(`Indexes on courses: ${indexes.map(i => i.name).join(', ')}`)
console.log(textIx.length
  ? `Text index: ${textIx.map(i => `${i.name} (reads language from "${i.language_override ?? 'language'}")`).join(', ')}`
  : 'Text index: none')

if (RESTORE) {
  if (textIx.length) { console.log('\nA text index is already there — nothing to restore.\n'); await mongoose.disconnect(); process.exit(0) }
  await courses.createIndex(
    { title: 'text', description: 'text', tags: 'text' },
    { name: 'title_text_description_text_tags_text', language_override: 'searchLanguage', default_language: 'english' },
  )
  console.log('\n✔ Text index restored (language_override: searchLanguage).\n')
} else if (!textIx.length) {
  console.log('\n✔ Nothing to do — courses has no text index. Any course language saves.\n')
} else if (!COMMIT) {
  console.log(`\nPreview only — nothing changed. To drop it:\n  bun src/scripts/drop-course-text-index.ts --commit\n`)
} else {
  for (const ix of textIx) { await courses.dropIndex(ix.name); console.log(`✔ Dropped ${ix.name}`) }
  console.log('\nDone. Courses can now be saved in any language. Undo: --restore\n')
}
await mongoose.disconnect()
