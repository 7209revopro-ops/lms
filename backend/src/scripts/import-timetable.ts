/* ─────────────────────────────────────────────────────────────
   import-timetable — add a weekly timetable (.xlsx) as live classes, from the
   command line. Same engine as Admin → Live Classes → Import timetable
   (services/classImport.service.ts): same checks, same duplicate protection,
   same undo.

   PREVIEW BY DEFAULT. Without --commit it prints every class it would create
   and writes NOTHING (it even connects with index-building switched off).

   ── Preview ──────────────────────────────────────────────────
     bun src/scripts/import-timetable.ts \
       --file ~/english-timetable.xlsx \
       --course 6a3bdaa925c9f5a007590e0e \
       --start 2026-10-02 --weeks 1 --day Friday \
       --label "English batch" \
       --mentor Haffis=haffizullakhan@deltainstitutions.com \
       --mentor Moiz=moiz@deltainstitutions.com

   ── Add them ─────────────────────────────────────────────────
     …the same command + --commit          (5-second countdown; --yes skips it)

   ── After ────────────────────────────────────────────────────
     --status <jobId>   progress / result of an import
     --resume <jobId>   retry what failed (e.g. a Google Meet hiccup)
     --undo   <jobId>   remove what that import created (booked classes are kept)

   Options
     --file <xlsx>              sheet "Sessions" (or the first with a "day" column)
     --course <id>              course to add the classes to
     --start <YYYY-MM-DD>       first week, in the academy's local time
     --weeks <n>                weeks to create (default 1)
     --day <Friday[,Sunday]>    only these weekdays (default: all)
     --only <ENG-019,ENG-020>   only these session_ids (default: all)
     --label <text>             appended to the title: "MBT 4 · <label>"
     --capacity <n>             seats per class (default 30)
     --language <name>          English | Hindi/English | Hindi | Malayalam | Tamil | Arabic | Urdu
     --location <text> --room <text>   for Offline + Online sessions
     --default-platform inapp|meet     when the file has no platform (default inapp)
     --mentor Name=email        map a mentor name in the file to an LMS account
     --as <admin email>         who the import is recorded as (default: first super admin)
     --skip-blocked             with --commit, add the good rows even if some are blocked

   Google Meet links are made with this machine's Google account, so run
   --commit where that is configured (the production server).
───────────────────────────────────────────────────────────── */
import mongoose from 'mongoose'
import { basename } from 'node:path'
import readXlsxFile from 'read-excel-file/node'

/* ── args ─────────────────────────────────────────────── */
const argv = process.argv.slice(2)
const flag = (n: string) => argv.includes(`--${n}`)
const opt = (n: string): string | undefined => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined }
const opts = (n: string): string[] => argv.flatMap((a, i) => (a === `--${n}` && argv[i + 1] ? [argv[i + 1]!] : []))
const die = (msg: string): never => { console.error(`\n✖ ${msg}\n`); process.exit(1) }

const LANGUAGES = ['English', 'Hindi/English', 'Hindi', 'Malayalam', 'Tamil', 'Arabic', 'Urdu']
const statusId = opt('status'), resumeId = opt('resume'), undoId = opt('undo')
const COMMIT = flag('commit')
const WRITES = COMMIT || !!resumeId || !!undoId

/* ── connect ──────────────────────────────────────────── */
const DB_URL = process.env['DATABASE_URL'] ?? die('DATABASE_URL is not set (run from the backend folder so .env loads).')
/* Never let this script build indexes or create collections as a side effect —
   a preview must be read-only. The two indexes an import relies on are
   created explicitly, only when it is about to write (ensureImportIndexes). */
mongoose.set('autoIndex', false)
mongoose.set('autoCreate', false)
await mongoose.connect(DB_URL, { autoIndex: false, autoCreate: false })

const { UserModel, LiveClassModel, ClassImportModel } = await import('@/models/schema.ts')
const { ClassImportService } = await import('@/services/classImport.service.ts')
const svc = new ClassImportService()
type Actor = { id: string; role: string; organizationId?: string }

let exitCode = 0
try {
  const actor = await resolveActor()

  if (statusId)      await printStatus(statusId, actor)
  else if (resumeId) { await ensureImportIndexes(); await svc.resume(resumeId, actor); await follow(resumeId, actor) }
  else if (undoId)   await undo(undoId, actor)
  else               await importFile(actor)
} catch (err) {
  const e = err as { code?: string; message?: string }
  console.error(`\n✖ ${e.code ? `${e.code}: ` : ''}${e.message ?? String(err)}\n`)
  exitCode = 1
} finally {
  await mongoose.disconnect()
}
process.exit(exitCode)

/* ── the import ───────────────────────────────────────── */
async function importFile(actor: Actor) {
  const file = opt('file') ?? die('--file is required.')
  const courseId = opt('course') ?? die('--course is required (the course id).')
  const startDate = opt('start') ?? die('--start is required (YYYY-MM-DD).')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) die('--start must be YYYY-MM-DD.')
  const weeks = Number(opt('weeks') ?? 1)
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > 52) die('--weeks must be 1–52.')
  const capacity = Number(opt('capacity') ?? 30)
  const language = opt('language') ?? 'English'
  if (!LANGUAGES.includes(language)) die(`--language must be one of: ${LANGUAGES.join(', ')}`)
  const defaultPlatform = (opt('default-platform') ?? 'inapp') as 'inapp' | 'meet'
  if (!['inapp', 'meet'].includes(defaultPlatform)) die('--default-platform must be inapp or meet.')

  /* Read the sheet into header → text rows, exactly like the admin page does. */
  let rows = await readSheet(file)
  const days = opts('day').flatMap(d => d.split(',')).map(d => d.trim().toLowerCase()).filter(Boolean)
  const only = opts('only').flatMap(d => d.split(',')).map(d => d.trim().toLowerCase()).filter(Boolean)
  if (days.length) rows = rows.filter(r => days.some(d => (cell(r, 'day').toLowerCase()).startsWith(d.slice(0, 3))))
  if (only.length) rows = rows.filter(r => only.includes(cell(r, 'session_id').toLowerCase()))
  if (!rows.length) die('No rows left after --day / --only.')

  /* --mentor Name=email → that account, for every row with that mentor name. */
  const overrides: Record<number, { instructorId: string }> = {}
  for (const m of opts('mentor')) {
    const [name, email] = m.split('=').map(s => s?.trim())
    if (!name || !email) die(`--mentor must look like Name=email, got "${m}".`)
    const u = await UserModel.findOne({ email: email!.toLowerCase() }).select('_id name role').lean<{ _id: unknown; name?: string; role?: string }>()
    if (!u) die(`--mentor: no LMS account with email ${email}.`)
    if (u!.role === 'student') die(`--mentor: ${email} is a student account.`)
    rows.forEach((r, i) => { if (cell(r, 'mentor').toLowerCase() === name!.toLowerCase()) overrides[i + 2] = { instructorId: String(u!._id) } })
  }

  const settings = {
    courseId, startDate, weeks, capacity, language, defaultPlatform,
    titleLabel: opt('label'), location: opt('location'), room: opt('room'),
  }
  const p = await svc.preview(settings, rows, actor, overrides)
  printPreview(p, file, settings)

  if (p.settingsErrors.length) die(p.settingsErrors.join(' '))
  if (!COMMIT) {
    console.log(`\nPreview only — nothing was written.${p.summary.classes ? ` Add --commit to create these ${p.summary.classes} classes.` : ''}\n`)
    return
  }
  if (p.summary.classes === 0) { console.log('\nNothing to add.\n'); return }
  if (p.summary.errors > 0 && !flag('skip-blocked')) {
    die(`${p.summary.errors} session(s) are blocked (see above). Fix the file, or add --skip-blocked to add only the ready ones.`)
  }

  const course = p.course.title
  console.log(`\n▶ Adding ${p.summary.classes} classes to "${course}" — ${p.summary.meet} Google Meet, ${p.summary.inapp} in-app${p.summary.offline ? `, ${p.summary.offline} in person` : ''}.`)
  console.log(`  Recorded as ${actor.id === 'preview' ? '—' : await who(actor.id)}.`)
  if (!flag('yes')) await countdown(5)

  await ensureImportIndexes()
  const { jobId } = await svc.start(settings, rows, actor, overrides, basename(file))
  console.log(`  Import ${jobId} started.`)
  await follow(jobId, actor)
}

/* ── follow a running import to the end ───────────────── */
async function follow(jobId: string, actor: Actor) {
  let last = ''
  for (;;) {
    const s = await svc.status(jobId, actor)
    const line = `  ${s.done}/${s.total} done · ${s.created} created${s.skipped ? ` · ${s.skipped} already existed` : ''}${s.failed ? ` · ${s.failed} failed` : ''}`
    if (line !== last) { console.log(line); last = line }
    /* `running` is this process's own flag — it stays true until the mentor
       summary emails have gone, so exiting on it never cuts them off. */
    if (!s.running) {
      console.log(`\n${s.failed ? '⚠' : '✔'} Import ${s.status}: ${s.created} created, ${s.skipped} skipped, ${s.failed} failed.`)
      for (const f of s.failures) console.log(`   ✖ ${f.dateKey} ${f.title} — ${f.error}`)
      if (s.failed) console.log(`\n  Retry the failed ones:  bun src/scripts/import-timetable.ts --resume ${jobId}`)
      console.log(`  Undo this import:       bun src/scripts/import-timetable.ts --undo ${jobId}\n`)
      if (s.failed) exitCode = 2
      return
    }
    await new Promise(r => setTimeout(r, 1000))
  }
}

async function printStatus(jobId: string, actor: Actor) {
  const s = await svc.status(jobId, actor)
  console.log(`\nImport ${s.id} — ${s.status}${s.fileName ? ` (${s.fileName})` : ''}`)
  console.log(`  ${s.done}/${s.total} done · ${s.created} created · ${s.skipped} skipped · ${s.failed} failed`)
  for (const f of s.failures) console.log(`   ✖ ${f.dateKey} ${f.title} — ${f.error}`)
  console.log('')
}

async function undo(jobId: string, actor: Actor) {
  const n = await LiveClassModel.countDocuments({ importJobId: new mongoose.Types.ObjectId(jobId) })
  console.log(`\n▶ Undo import ${jobId}: ${n} classes. Classes a student has booked, or that have started, are kept.`)
  console.log('  Google Calendar invitations already made for Meet classes stay on the calendars.')
  if (!flag('yes')) await countdown(5)
  const r = await svc.undo(jobId, actor)
  console.log(`\n✔ ${r.deleted} removed${r.kept ? `, ${r.kept} kept` : ''}.\n`)
}

/* ── helpers ──────────────────────────────────────────── */
async function resolveActor(): Promise<Actor> {
  const email = opt('as')
  if (!email && !WRITES) return { id: 'preview', role: 'super_admin' }
  const u = email
    ? await UserModel.findOne({ email: email.toLowerCase() }).select('_id name email role organizationId isActive').lean<any>()
    : await UserModel.findOne({ role: 'super_admin', isActive: { $ne: false } }).sort({ createdAt: 1 }).select('_id name email role organizationId isActive').lean<any>()
  if (!u) die(email ? `--as: no account with email ${email}.` : 'No super admin found — pass --as <admin email>.')
  if (!['super_admin', 'admin'].includes(u.role)) die(`--as: ${u.email} is a ${u.role}; use an admin or super admin.`)
  if (u.isActive === false) die(`--as: ${u.email} is deactivated.`)
  return { id: String(u._id), role: u.role, organizationId: u.organizationId ? String(u.organizationId) : undefined }
}

async function who(id: string): Promise<string> {
  const u = await UserModel.findById(id).select('name email role').lean<any>()
  return u ? `${u.name ?? ''} <${u.email}> (${u.role})` : id
}

/* The two indexes the duplicate protection relies on — same spec as schema.ts,
   so the backend's own index sync later sees them as already present. */
async function ensureImportIndexes() {
  await LiveClassModel.collection.createIndex({ importRef: 1 }, { unique: true, partialFilterExpression: { importRef: { $type: 'string' } } })
  await LiveClassModel.collection.createIndex({ importJobId: 1 }, { sparse: true })
  await ClassImportModel.createIndexes()
}

async function readSheet(path: string): Promise<Array<Record<string, string>>> {
  let sheets
  try { sheets = await readXlsxFile(path) } catch (e) { return die(`Could not read ${path}: ${(e as Error).message}`) }
  const n = (s: unknown) => String(s ?? '').toLowerCase().trim()
  const chosen = sheets.find(s => n(s.sheet) === 'sessions' || n(s.sheet) === 'timetable')
    ?? sheets.find(s => (s.data[0] ?? []).some(c => n(c) === 'day'))
    ?? sheets[0]
  if (!chosen || chosen.data.length < 2) die(`${path}: no rows under a header row.`)
  const [head, ...body] = chosen!.data
  const headers = (head ?? []).map(h => String(h ?? '').trim())
  return body
    .filter(r => r.some(c => c != null && String(c).trim() !== ''))
    .map(r => Object.fromEntries(headers.map((h, i) => [h, cellText(r[i], h)]).filter(([h]) => h)))
}

function cellText(v: unknown, header: string): string {
  if (v == null) return ''
  const hm = (h: number, m: number) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  if (v instanceof Date) return hm(v.getUTCHours(), v.getUTCMinutes())
  if (typeof v === 'number') {
    if (/time|start|end/i.test(header) && v >= 0 && v < 1) { const m = Math.round(v * 1440); return hm(Math.floor(m / 60) % 24, m % 60) }
    return String(v)
  }
  return String(v).trim()
}

function cell(row: Record<string, string>, header: string): string {
  const key = Object.keys(row).find(k => k.toLowerCase().replace(/[^a-z0-9]+/g, '_') === header)
  return key ? (row[key] ?? '') : ''
}

function printPreview(p: Awaited<ReturnType<typeof svc.preview>>, file: string, s: { startDate: string; weeks: number; capacity: number; language: string }) {
  const pad = (v: string, w: number) => (v.length > w ? v.slice(0, w - 1) + '…' : v.padEnd(w))
  const PLAT: Record<string, string> = { meet: 'Google Meet', inapp: 'In-app' }
  const MODE: Record<string, string> = { hybrid: 'Offline+Online', online: 'Online only', offline: 'In person' }
  const MARK: Record<string, string> = { new: '', exists: '=', conflict: '!', past: '×' }
  console.log(`\n${basename(file)}  →  ${p.course.title}  (${p.academy.slug ?? 'no academy'}, times in ${p.academy.tag})`)
  console.log(`first week ${s.startDate} · ${s.weeks} week(s) · ${s.capacity} seats · ${s.language}\n`)
  console.log(`${pad('ID', 9)}${pad('Day', 5)}${pad(`Time (${p.academy.tag})`, 20)}${pad('Class', 30)}${pad('Mentor', 20)}${pad('Mode', 15)}${pad('Platform', 12)}Dates`)
  console.log('─'.repeat(140))
  const rows = [...p.rows].sort((a, b) => (a.occurrences[0]?.startISO ?? '').localeCompare(b.occurrences[0]?.startISO ?? ''))
  for (const r of rows) {
    const dates = r.occurrences.map(o => `${MARK[o.state]}${o.label.replace(/^\w+, /, '')}`).join(', ')
    const mentor = r.instructor?.name ?? `? ${r.mentorName}`
    const flagTxt = r.status === 'error' ? '  ✖ BLOCKED' : r.status === 'warning' ? '  ⚠' : ''
    console.log(`${pad(r.sessionId, 9)}${pad(r.day.slice(0, 3), 5)}${pad(`${r.startLabel}–${r.endLabel}`, 20)}${pad(r.title, 30)}${pad(mentor, 20)}${pad(MODE[r.mode] ?? r.mode, 15)}${pad(r.platform ? PLAT[r.platform]! : '—', 12)}${dates}${flagTxt}`)
    for (const m of r.messages) console.log(`${' '.repeat(9)}↳ ${m}`)
  }
  const x = p.summary
  console.log('─'.repeat(140))
  console.log(`${x.classes} classes to add · ${x.meet} Google Meet · ${x.inapp} in-app${x.offline ? ` · ${x.offline} in person` : ''} · ${x.mentors} mentor(s) · ${x.firstDate ?? '—'} → ${x.lastDate ?? '—'}`)
  console.log(`${x.ready} ready · ${x.warnings} warning(s) · ${x.errors} blocked     (dates: = already added, ! clashes with the mentor's class, × in the past — all skipped)`)
}

async function countdown(sec: number) {
  for (let i = sec; i > 0; i--) {
    process.stdout.write(`\r  Starting in ${i}s — Ctrl-C to cancel `)
    await new Promise(r => setTimeout(r, 1000))
  }
  process.stdout.write('\r' + ' '.repeat(40) + '\r')
}
