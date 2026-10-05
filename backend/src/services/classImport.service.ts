/* ─────────────────────────────────────────────────────
   classImport.service.ts — "Import timetable" for live classes

   A spreadsheet row is ONE weekly session ("Tuesday 1–3 PM, Haffis, MBT 1").
   An import expands every row into one class per week for a chosen date range.

     preview()  — the dry run. Parses and checks every row, matches each mentor
                  to an LMS account, works out every date in the academy's own
                  zone, and marks what already exists or clashes. Writes NOTHING.
     start()    — re-runs the same checks server-side (the browser's copy of the
                  preview is never trusted), stores the plan as a ClassImport
                  job, and creates the classes in the background.
     resume()   — re-runs whatever a job has not created yet.
     undo()     — removes the classes one import created (never one a student
                  has already booked).

   Classes are created through the SAME path as the admin form
   (LiveClassController.createForImport), so every existing rule — programme
   scope, instructor validity, academy, Google Meet links — applies unchanged.
   What an import turns off is the per-class mail: one "you've been scheduled"
   email per class and one student notification per class would flood both
   inboxes. Each mentor gets a single summary at the end instead.

   Course + module per row: a class is only module-locked (blocked or unpaid
   modules, booking gates) when it carries its module, and one timetable spans
   several courses — "MBT 4" lives in one course, "IM 1" and "ADVANCE 4" in
   others. Each row therefore finds its module: the file's module column (a
   pick in the preview fills it), else its session code (batch + session
   number, matchModule), looked up first in the chosen course and then in the
   academy's other published courses of the same programme — an optional
   course column narrows it to one. The row goes to the course that owns its
   module. A row of a course with modules never goes in without one: no match,
   or two equally good ones, blocks it until a module (or "No module") is picked.

   Duplicate-proof: every class carries importRef = course + session id + date,
   unique in the database. A resume, a retry, or importing the same file twice
   cannot create the same class twice.
───────────────────────────────────────────────────── */
import { Types, type HydratedDocument } from 'mongoose'
import { logger } from '@/utils/logger.ts'
import { ensureOrgSlugs, orgSlugFor } from '@/utils/orgSlugs.ts'
import { zoneForAcademy, zoneTag } from '@/utils/academyClock.ts'
import { addDaysToDateKey, zoneMidnight, zoneDateKey } from '@/utils/zoneDay.ts'
import { wantsStaffEmail } from '@/utils/emailPrefs.ts'
import type { ClassImportPlatform, IClassImport } from '@/models/schema.ts'

export class ClassImportError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 400) {
    super(message)
    this.name = 'ClassImportError'
  }
}

/* ── Input ───────────────────────────────────────────── */

/** One spreadsheet row, as the browser read it: header → cell text. */
export type RawRow = Record<string, string | undefined>

export interface ImportSettings {
  courseId:        string
  startDate:       string     // YYYY-MM-DD, academy-local
  weeks:           number
  capacity:        number
  language:        string
  titleLabel?:     string
  location?:       string
  room?:           string
  defaultPlatform: ClassImportPlatform
  /* Create a class even when its mentor already has one at that time — an
     in-person group run alongside the same mentor's online class (the
     Malayalam offline batch, Oct 2026). The clash is still shown, just not
     skipped. Set by the CLI's --allow-clash only; the admin page never sends it. */
  allowMentorClash?: boolean
}

/** Per-row choices made in the preview screen. Keyed by spreadsheet row number. */
export interface RowOverride {
  include?:      boolean
  platform?:     ClassImportPlatform
  instructorId?: string
}

export interface Actor { id: string; role: string; organizationId?: string; categoryScope?: string }

/* ── Output ──────────────────────────────────────────── */

export type OccurrenceState = 'new' | 'exists' | 'conflict' | 'past'

export interface PreviewOccurrence {
  dateKey:  string
  startISO: string
  label:    string        // 'Tue, Oct 6'
  state:    OccurrenceState
  note?:    string
}

export interface PreviewRow {
  rowNumber:     number
  sessionKey:    string
  sessionId:     string
  day:           string
  startLabel:    string
  endLabel:      string
  durationMins:  number
  mentorName:    string
  instructor:    { id: string; name: string } | null
  /* 'staff': matched a staff account that is not an instructor — always flagged. */
  matchedBy:     'email' | 'exact' | 'first-name' | 'staff' | 'manual' | null
  /** Batch + session number, e.g. "MBT 7" — what the module is matched on. */
  code:          string
  /** The course the classes go into: the one owning the module, else the chosen one. */
  course:        { id: string; title: string }
  /** The course module the classes go into. null = none (General sessions). */
  module:        { id: string; title: string } | null
  /** 'sheet' = the row's module column (or a pick in the preview, which fills
      that column); 'name' = matched on the code; 'none' = told no module. */
  moduleFrom:    'sheet' | 'name' | 'none' | null
  title:         string
  mode:          'hybrid' | 'online' | 'offline'
  platform:      ClassImportPlatform | null      // null = offline only (no link)
  location?:     string
  room?:         string
  status:        'ready' | 'warning' | 'error'
  messages:      string[]
  occurrences:   PreviewOccurrence[]
  newCount:      number
  include:       boolean
}

export interface PreviewResult {
  course:      { id: string; title: string }          // the chosen (default) course
  /* Every course a row may go to — the chosen one first — with its modules in
     course order: what the preview's module picker offers. */
  courses:     Array<{ id: string; title: string; modules: Array<{ id: string; title: string }> }>
  academy:     { slug: string | null; zone: string; tag: string }
  instructors: Array<{ id: string; name: string; email: string; role: string }>
  /** The chosen course's modules in course order (courses[0].modules). */
  modules:     Array<{ id: string; title: string }>
  rows:        PreviewRow[]
  settingsErrors: string[]
  summary: {
    rows: number; ready: number; warnings: number; errors: number
    classes: number; meet: number; inapp: number; offline: number
    mentors: number; courses: number; firstDate: string | null; lastDate: string | null
  }
}

/* ── Parsing ─────────────────────────────────────────── */

const norm = (k: string) => k.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')

/* Header names the importer accepts for each field — the app-import format
   (session_id, start_time …) and the older spreadsheet template (Start Time …). */
const ALIASES: Record<string, string[]> = {
  sessionId:     ['session_id', 'id', 'session'],
  day:           ['day', 'weekday'],
  startTime:     ['start_time', 'start', 'from'],
  endTime:       ['end_time', 'end', 'to'],
  timeRange:     ['time', 'time_range', 'timing'],
  mentor:        ['mentor', 'instructor', 'mentor_name', 'trainer'],
  mentorEmail:   ['mentor_email', 'instructor_email', 'email'],
  batch:         ['batch', 'batch_code', 'code'],
  sessionNumber: ['session_number', 'session_no', 'number', 'no'],
  mode:          ['mode', 'delivery', 'format'],
  platform:      ['platform', 'meeting_platform', 'meeting', 'link_type'],
  room:          ['room'],
  notes:         ['notes', 'note', 'remarks'],
  module:        ['module', 'module_name', 'module_title', 'section'],
  course:        ['course', 'course_name', 'course_title'],
}

/* ── Which module a row's classes go into ──────────────
   Every class imported on 2 Oct 2026 — 609 of them — went in with no module:
   students saw them under "General sessions", and module blocking, which only
   applies to a class that has a module, did not apply to any of them.

   A row names its module by its code: "MBT 7" is the module "MBT 7 - Volume
   Analysis". Compared with spaces and punctuation squashed out, and the next
   character after the code must not be a digit, so "MBT 1" never takes
   "MBT 10". "IM 4 (1)" is also tried as "IM 4 PART 1". Only a single match
   counts — two candidates is a question for the person importing, not a guess. */
const squash = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, '')
/* Every module the first form that names any names — so two can be reported. */
function moduleHits<T extends { title: string }>(code: string, modules: T[]): T[] {
  const forms = [code.replace(/\(\s*(\d+)\s*\)\s*$/, ' PART $1'), code]
  for (const form of [...new Set(forms)]) {
    const k = squash(form)
    if (!k) continue
    const hits = modules.filter(m => { const t = squash(m.title); return t.startsWith(k) && !/^\d/.test(t.slice(k.length)) })
    if (hits.length) return hits
  }
  return []
}
export function matchModule<T extends { title: string }>(code: string, modules: T[]): T | null {
  const hits = moduleHits(code, modules)
  return hits.length === 1 ? hits[0]! : null
}
/* A module column (or a preview pick) saying "no module" on purpose. */
const NO_MODULE = /^(none|no module|n\/?a|-+|—|–|general|general sessions?)$/i

function pick(row: RawRow, field: keyof typeof ALIASES): string {
  const byNorm = new Map(Object.entries(row).map(([k, v]) => [norm(k), v]))
  for (const alias of ALIASES[field]!) {
    const v = byNorm.get(alias)
    if (v != null && String(v).trim() !== '') return String(v).trim()
  }
  return ''
}

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
function parseDay(raw: string): number | null {
  const v = raw.toLowerCase().trim().replace(/\.$/, '')
  if (!v) return null
  const i = DAYS.findIndex(d => d === v || (v.length >= 3 && d.startsWith(v)))
  return i >= 0 ? i : null
}

/** '1:00 PM', '1 pm', '13:00', '13:00:00' → minutes after midnight. '16:00 PM' is refused. */
export function parseTime(raw: string): number | null {
  const v = raw.trim().toUpperCase().replace(/\s+/g, ' ')
  const m = /^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(AM|PM)?$/.exec(v)
  if (!m) return null
  let h = Number(m[1]); const min = Number(m[2] ?? '0'); const mer = m[3]
  if (min > 59) return null
  if (mer) {
    if (h < 1 || h > 12) return null          // '16:00 PM' — a 24-hour time with a 12-hour suffix
    if (mer === 'AM' && h === 12) h = 0
    if (mer === 'PM' && h !== 12) h += 12
  } else if (h > 23) return null
  return h * 60 + min
}

function fmtMinutes(mins: number): string {
  const h24 = Math.floor(mins / 60) % 24, m = mins % 60
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${String(m).padStart(2, '0')} ${h24 < 12 ? 'AM' : 'PM'}`
}

function parseMode(raw: string): 'hybrid' | 'online' | 'offline' | null {
  const v = raw.toLowerCase().replace(/[^a-z]/g, '')
  if (!v) return 'online'
  if (v === 'offlineonline' || v === 'onlineoffline' || v === 'hybrid' || v === 'both') return 'hybrid'
  if (v === 'onlineonly' || v === 'online') return 'online'
  if (v === 'offlineonly' || v === 'offline' || v === 'inperson') return 'offline'
  return null
}

function parsePlatform(raw: string): ClassImportPlatform | null | undefined {
  const v = raw.toLowerCase().replace(/[^a-z]/g, '')
  if (!v) return undefined                                     // not given → default
  if (['googlemeet', 'meet', 'google', 'gmeet'].includes(v)) return 'meet'
  if (['inapp', 'app', 'lms', 'ourapp', 'livekit', 'meetingapp', 'ourmeetingapp'].includes(v)) return 'inapp'
  return null                                                  // given but unknown
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

/* ── Which course a row's classes go into ──────────────
   One timetable spans several courses: in the Dubai academy "MBT 4" is a
   module of MARKET BREAK-OUT TRADING PROGRAM, "IM 1" of DELTA WAVE THEORY
   TRADING PROGRAMME and "ADVANCE 4" of MMC. A row whose module the chosen
   course does not have looks in the academy's other published courses of the
   same programme, and goes to the course that owns it. */
interface ModuleRef { id: string; title: string; courseId: string }
interface CourseRef { id: string; title: string; slug: string; words: string[]; modules: ModuleRef[] }

/* A module named by text — a module cell or a session code — tier by tier:
   the row's own course first, then the programme's other courses together, so
   a module the chosen course has is never lost to a namesake elsewhere. The
   exact title first ("IM 4" when there are "IM 4" and "IM 4 - PART 1"), then
   matchModule's rule. Two equally good answers in a tier are a question for
   the person importing, never a guess. */
function findModule(text: string, tiers: ModuleRef[][]): { hit: ModuleRef | null; ambiguous: ModuleRef[] } {
  const k = squash(text)
  if (!k) return { hit: null, ambiguous: [] }
  for (const tier of tiers) {
    for (const found of [tier.filter(m => squash(m.title) === k), moduleHits(text, tier)]) {
      if (found.length === 1) return { hit: found[0]!, ambiguous: [] }
      if (found.length > 1) return { hit: null, ambiguous: found }
    }
  }
  return { hit: null, ambiguous: [] }
}

/* A course column, compared as whole words ("MMC" is "MMC (MARKET MAKING
   CYCLE)") or by slug. Letters outside a–z are not words here, so a name
   written only in them matches nothing rather than everything. */
function words(s: string): string[] {
  return s.toLowerCase().replace(/([a-z])(\d)/g, '$1 $2').replace(/(\d)([a-z])/g, '$1 $2')
    .match(/\d+(?:\.\d+)+|[a-z0-9]+/g) ?? []
}
const sameWords  = (have: string[], want: string[]) => have.length === want.length && want.every((w, i) => have[i] === w)
const startsWith = (have: string[], want: string[]) => want.length > 0 && want.length <= have.length && want.every((w, i) => have[i] === w)

function findCourse(text: string, courses: CourseRef[]): { hit: CourseRef | null; ambiguous: CourseRef[] } {
  const want = words(text), asSlug = slug(text)
  /* Nothing comparable (only punctuation, or letters outside a–z): no match,
     never "every course with an equally empty title". */
  if (!want.length) return { hit: null, ambiguous: [] }
  for (const test of [(c: CourseRef) => sameWords(c.words, want) || c.slug === asSlug, (c: CourseRef) => startsWith(c.words, want)]) {
    const found = courses.filter(test)
    if (found.length === 1) return { hit: found[0]!, ambiguous: [] }
    if (found.length > 1) return { hit: null, ambiguous: found }
  }
  return { hit: null, ambiguous: [] }
}

const listTitles = (xs: Array<{ title: string }>) =>
  xs.slice(0, 3).map(x => `"${x.title}"`).join(', ') + (xs.length > 3 ? ` and ${xs.length - 3} more` : '')

/* ── Service ─────────────────────────────────────────── */

type CreateFn = (
  dto: Parameters<import('@/controllers/liveClass.controller.ts').LiveClassController['createForImport']>[0],
  actor: Actor, seriesId: string, meta: { importJobId: string; importRef: string },
) => Promise<{ live: { id?: string; _id?: unknown } }>

export class ClassImportService {
  /* ── Dry run ───────────────────────────────────────── */
  async preview(
    settings: ImportSettings,
    rawRows: RawRow[],
    actor: Actor,
    overrides: Record<number, RowOverride> = {},
    now: Date = new Date(),
  ): Promise<PreviewResult> {
    const { CourseModel, UserModel, LiveClassModel, SectionModel } = await import('@/models/schema.ts')
    const { LIVEKIT_MAX_PARTICIPANTS } = await import('@/services/liveClass.service.ts')

    if (!Types.ObjectId.isValid(settings.courseId)) throw new ClassImportError('INVALID_COURSE', 'Pick a course.')
    type CourseRow = { _id: Types.ObjectId; title: string; slug?: string; organizationId?: Types.ObjectId; program?: string }
    const course = await CourseModel.findById(settings.courseId)
      .select('title slug organizationId program').lean<CourseRow>()
    if (!course) throw new ClassImportError('COURSE_NOT_FOUND', 'Course not found.', 404)

    /* Tenancy: an academy's admin imports into their own academy's courses.
       super_admin carries no academy and may import anywhere. */
    if (actor.role !== 'super_admin' && course.organizationId && actor.organizationId
        && String(course.organizationId) !== actor.organizationId) {
      throw new ClassImportError('FORBIDDEN', 'This course belongs to another academy.', 403)
    }
    if (actor.categoryScope && course.program !== actor.categoryScope) {
      throw new ClassImportError('FORBIDDEN', 'You can only import sessions for your programme\'s courses.', 403)
    }

    await ensureOrgSlugs().catch(() => {})
    const orgSlug = orgSlugFor(course.organizationId) ?? null
    const zone = zoneForAcademy(orgSlug)

    /* The courses a row may go to: the chosen one first, then this academy's
       other PUBLISHED courses of the same programme — where a timetable's
       "IM 1" or "ADVANCE 4" actually lives. Same academy, so every class keeps
       this import's clock; same programme, so a programme-scoped admin
       (checked above) never reaches past their own; published, so a session
       code never routes silently into a draft copy nobody is enrolled on (the
       chosen course itself is the admin's own choice, whatever its status). */
    const others = await CourseModel.find({
      _id: { $ne: course._id },
      organizationId: course.organizationId ?? { $exists: false },
      program: course.program ? course.program : { $in: [null, ''] },
      status: 'published',
    }).select('title slug').sort({ title: 1 }).lean<CourseRow[]>()
    const courseRows = [course, ...others]
    const sections = await SectionModel.find({ courseId: { $in: courseRows.map(c => c._id) } })
      .select('courseId title order').sort({ order: 1, createdAt: 1 })
      .lean<Array<{ _id: Types.ObjectId; courseId: Types.ObjectId; title: string }>>()
    const courses: CourseRef[] = courseRows.map(c => ({
      id: String(c._id), title: c.title, slug: c.slug ?? '', words: words(c.title),
      modules: sections.filter(s => String(s.courseId) === String(c._id))
        .map(s => ({ id: String(s._id), title: s.title, courseId: String(c._id) })),
    }))
    const home = courses[0]!
    const courseById = new Map(courses.map(c => [c.id, c]))
    const moduleById = new Map(courses.flatMap(c => c.modules).map(m => [m.id, m]))
    const elsewhere = courses.slice(1).flatMap(c => c.modules)
    const modules = home.modules.map(m => ({ id: m.id, title: m.title }))

    const settingsErrors: string[] = []
    if (!/^\d{4}-\d{2}-\d{2}$/.test(settings.startDate)) settingsErrors.push('Pick a start date.')
    if (!(settings.weeks >= 1 && settings.weeks <= 52)) settingsErrors.push('Weeks must be between 1 and 52.')

    /* Who may teach here: any staff account of this academy, or one lent to it
       (sharedAcrossOrgs) — the same rule the create path enforces. */
    /* A department's sub_admin matches and picks its own department's people
       only (plan.md §10, R5): the create path refuses anyone else, and this
       list — returned whole to the import page's mentor picker — used to name
       every staff member of the academy, every department, with their email. */
    const deptOnly = actor.role === 'sub_admin' && actor.categoryScope
      ? { $and: [{ $or: [{ category: actor.categoryScope }, { categories: actor.categoryScope }] }] }
      : {}
    const staff = await UserModel.find({
      role: { $nin: ['student'] },
      isActive: { $ne: false },
      ...(course.organizationId
        ? { $or: [{ organizationId: course.organizationId }, { sharedAcrossOrgs: true }, { organizationId: { $exists: false } }] }
        : {}),
      ...deptOnly,
    }).select('name email role').sort({ name: 1 }).lean<Array<{ _id: Types.ObjectId; name?: string; email?: string; role: string }>>()
    const instructors = staff.map(u => ({ id: String(u._id), name: u.name ?? u.email ?? 'Unnamed', email: u.email ?? '', role: u.role }))
    const byId = new Map(instructors.map(i => [i.id, i]))

    const matchMentor = (name: string, email: string): { inst: typeof instructors[number] | null; by: PreviewRow['matchedBy'] } => {
      if (email) {
        const hit = instructors.find(i => i.email.toLowerCase() === email.toLowerCase())
        if (hit) return { inst: hit, by: 'email' }
      }
      const n = name.toLowerCase().trim()
      if (!n) return { inst: null, by: null }
      /* Instructors first, by full name and then by first name; only when no
         instructor fits does any other staff account count. "Sara" in a
         timetable is the instructor Sara Khan before it is a support agent
         whose name is exactly "Sara" — matching all staff at once handed her
         classes to the support agent, as a "ready" row nobody was asked to
         check. A non-instructor match is always flagged ('staff'). */
      const pools = [instructors.filter(i => i.role === 'instructor'), instructors.filter(i => i.role !== 'instructor')]
      for (const [k, pool] of pools.entries()) {
        const exact = pool.filter(i => i.name.toLowerCase().trim() === n)
        if (exact.length === 1) return { inst: exact[0]!, by: k === 0 ? 'exact' : 'staff' }
        const first = pool.filter(i => i.name.toLowerCase().trim().split(/\s+/)[0] === n)
        if (first.length === 1) return { inst: first[0]!, by: k === 0 ? 'first-name' : 'staff' }
        if (exact.length > 1 || first.length > 1) return { inst: null, by: null }   // two people fit: a human picks
      }
      return { inst: null, by: null }
    }

    /* ── 1. Parse every row ─────────────────────────── */
    const rows: PreviewRow[] = []
    const seenKeys = new Map<string, number>()

    rawRows.forEach((raw, idx) => {
      const rowNumber = idx + 2                         // spreadsheet row (header is row 1)
      const messages: string[] = []
      let fatal = false
      const err = (m: string) => { messages.push(m); fatal = true }

      const dayRaw = pick(raw, 'day'), startRaw = pick(raw, 'startTime'), endRaw = pick(raw, 'endTime')
      const rangeRaw = pick(raw, 'timeRange'), mentorRaw = pick(raw, 'mentor')
      const batchRaw = pick(raw, 'batch'), numRaw = pick(raw, 'sessionNumber')
      if (!dayRaw && !startRaw && !mentorRaw && !batchRaw) return          // blank line

      const weekday = parseDay(dayRaw)
      if (weekday == null) err(`Day "${dayRaw || '—'}" is not a weekday.`)

      let start = startRaw ? parseTime(startRaw) : null
      let end   = endRaw ? parseTime(endRaw) : null
      /* A "1:00 PM - 3:00 PM" column, when present, must agree with start/end —
         it is exactly how a drag-filled start_time ("16:00 PM", "17:00 PM" …)
         gets caught before it becomes a class at the wrong hour. */
      if (rangeRaw) {
        const parts = rangeRaw.split(/\s*[-–—]\s*|\s+to\s+/i)
        const rs = parts[0] ? parseTime(parts[0]) : null, re = parts[1] ? parseTime(parts[1]) : null
        if (rs != null && re != null) {
          if (startRaw && start != null && start !== rs) err(`start_time "${startRaw}" does not match time "${rangeRaw}".`)
          if (endRaw && end != null && end !== re) err(`end_time "${endRaw}" does not match time "${rangeRaw}".`)
          if (!startRaw) start = rs
          if (!endRaw) end = re
        }
      }
      if (start == null) err(startRaw ? `Start time "${startRaw}" is not a valid time.` : 'Start time is missing.')
      if (end == null)   err(endRaw ? `End time "${endRaw}" is not a valid time.` : 'End time is missing.')
      let duration = 0
      if (start != null && end != null) {
        duration = (end - start + 1440) % 1440       // a session ending at midnight wraps
        if (duration < 5 || duration > 600) err(`Duration ${duration} min is out of range (5–600).`)
      }

      if (!batchRaw) err('Batch is missing.')
      const code = `${batchRaw}${numRaw ? ` ${numRaw}` : ''}`.replace(/\s+/g, ' ').trim()
      const label = settings.titleLabel?.trim()
      let title = `${code}${label ? ` · ${label}` : ''}`
      if (title.length < 3) title = `${title} session`

      /* Course + module. The module: the row's module column (a pick in the
         preview fills it with the module's id), else its session code — looked
         up in the row's course (the course column's, else the chosen one) and,
         failing that, in the programme's other courses; the row goes to the
         course that owns it. A course with modules never silently gets a class
         with none: no match, or two equally good ones, waits for a pick or an
         explicit "none". A chosen course with no modules imports as it always did. */
      const moduleRaw = pick(raw, 'module'), courseRaw = pick(raw, 'course')
      let rowCourse = home
      let mod: ModuleRef | null = null
      let moduleFrom: PreviewRow['moduleFrom'] = null
      const picked = moduleById.get(moduleRaw)
      if (picked) {
        mod = picked; rowCourse = courseById.get(picked.courseId)!; moduleFrom = 'sheet'
      } else {
        let fixed: CourseRef | null = null
        if (courseRaw) {
          const c = findCourse(courseRaw, courses)
          if (c.hit) fixed = rowCourse = c.hit
          else err(c.ambiguous.length
            ? `Course "${courseRaw}" matches ${listTitles(c.ambiguous)} — pick the module.`
            : `No course "${courseRaw}" in this academy's programme — pick the module.`)
        }
        const tiers = fixed ? [fixed.modules] : [home.modules, elsewhere]
        const where = fixed ? fixed.title : `this course${elsewhere.length ? ' or its programme\'s other courses' : ''}`
        if (courseRaw && !fixed) {
          /* reported above — which course is the question */
        } else if (moduleRaw && NO_MODULE.test(moduleRaw)) {
          moduleFrom = 'none'
        } else if (moduleRaw) {
          const m = findModule(moduleRaw, tiers)
          if (m.hit) { mod = m.hit; rowCourse = courseById.get(m.hit.courseId)!; moduleFrom = 'sheet' }
          else err(m.ambiguous.length
            ? `Module "${moduleRaw}" matches ${listTitles(m.ambiguous)} — pick one.`
            : `Module "${moduleRaw}" is not a module of ${where}.`)
        } else if (code && rowCourse.modules.length > 0) {
          const m = findModule(code, tiers)
          if (m.hit) { mod = m.hit; rowCourse = courseById.get(m.hit.courseId)!; moduleFrom = 'name' }
          else err(m.ambiguous.length
            ? `"${code}" could be ${listTitles(m.ambiguous)} — pick one.`
            : `No module of ${where} is named like "${code}" — pick one.`)
        }
      }

      const mode = parseMode(pick(raw, 'mode'))
      if (!mode) err(`Mode "${pick(raw, 'mode')}" — use "Offline + Online", "Online Only" or "Offline Only".`)

      const ov = overrides[rowNumber] ?? {}
      const fromFile = parsePlatform(pick(raw, 'platform'))
      if (fromFile === null) err(`Platform "${pick(raw, 'platform')}" — use "Google Meet" or "In-app".`)
      let platform: ClassImportPlatform | null =
        mode === 'offline' ? null : (ov.platform ?? fromFile ?? settings.defaultPlatform)

      if (platform === 'inapp' && settings.capacity > LIVEKIT_MAX_PARTICIPANTS) {
        err(`In-app rooms hold up to ${LIVEKIT_MAX_PARTICIPANTS} people — lower the capacity or use Google Meet.`)
      }

      /* Mentor: preview override → email → exact name → unique first name. */
      const mentorEmail = pick(raw, 'mentorEmail')
      let instructor: PreviewRow['instructor'] = null
      let matchedBy: PreviewRow['matchedBy'] = null
      if (ov.instructorId && byId.has(ov.instructorId)) {
        const i = byId.get(ov.instructorId)!; instructor = { id: i.id, name: i.name }; matchedBy = 'manual'
      } else {
        const { inst, by } = matchMentor(mentorRaw, mentorEmail)
        if (inst) { instructor = { id: inst.id, name: inst.name }; matchedBy = by }
      }
      if (!mentorRaw && !instructor) err('Mentor is missing.')
      else if (!instructor) err(`No LMS account matches mentor "${mentorRaw}" — pick one.`)

      const sessionId = pick(raw, 'sessionId')
      const sessionKey = sessionId || `${DAYS[weekday ?? 0]}-${start ?? 0}-${slug(mentorRaw)}`
      if (seenKeys.has(sessionKey)) {
        err(sessionId ? `session_id "${sessionId}" is also used on row ${seenKeys.get(sessionKey)}.`
                      : `Same day, time and mentor as row ${seenKeys.get(sessionKey)}.`)
      } else seenKeys.set(sessionKey, rowNumber)

      const room = pick(raw, 'room') || settings.room?.trim() || undefined
      const location = settings.location?.trim() || undefined

      rows.push({
        rowNumber, sessionKey, sessionId: sessionId || '—',
        day: weekday != null ? DAYS[weekday]![0]!.toUpperCase() + DAYS[weekday]!.slice(1) : dayRaw,
        startLabel: start != null ? fmtMinutes(start) : startRaw,
        endLabel:   end != null ? fmtMinutes(end) : endRaw,
        durationMins: duration,
        mentorName: mentorRaw,
        instructor, matchedBy, code,
        course: { id: rowCourse.id, title: rowCourse.title },
        module: mod ? { id: mod.id, title: mod.title } : null,
        moduleFrom, title,
        mode: mode ?? 'online', platform,
        ...(mode !== 'online' ? { location, room } : {}),
        status: fatal ? 'error' : 'ready',
        messages,
        occurrences: [],
        newCount: 0,
        include: false,
        /* stash for step 2 — not part of the response contract */
        ...({ _weekday: weekday, _start: start } as object),
      } as PreviewRow)
    })

    /* Same mentor, same day, overlapping rows — two classes the mentor cannot both teach. */
    for (const a of rows) for (const b of rows) {
      const A = a as PreviewRow & { _weekday: number | null; _start: number | null }
      const B = b as PreviewRow & { _weekday: number | null; _start: number | null }
      if (a.rowNumber >= b.rowNumber || !a.instructor || !b.instructor || a.instructor.id !== b.instructor.id) continue
      if (A._weekday == null || A._weekday !== B._weekday || A._start == null || B._start == null) continue
      if (A._start < B._start + b.durationMins && B._start < A._start + a.durationMins) {
        a.messages.push(`Overlaps row ${b.rowNumber} for the same mentor.`); a.status = 'error'
        b.messages.push(`Overlaps row ${a.rowNumber} for the same mentor.`); b.status = 'error'
      }
    }

    /* ── 2. Dates, in the ACADEMY's zone ────────────── */
    if (settingsErrors.length === 0) {
      const [y, mo, d] = settings.startDate.split('-').map(Number)
      const startWeekday = new Date(Date.UTC(y!, mo! - 1, d!)).getUTCDay()
      for (const r of rows) {
        const R = r as PreviewRow & { _weekday: number | null; _start: number | null }
        if (R._weekday == null || R._start == null) continue
        const first = (R._weekday - startWeekday + 7) % 7
        for (let w = 0; w < settings.weeks; w++) {
          const dateKey = addDaysToDateKey(settings.startDate, first + 7 * w)
          const startAt = new Date(zoneMidnight(dateKey, zone).getTime() + R._start * 60_000)
          r.occurrences.push({
            dateKey, startISO: startAt.toISOString(),
            label: startAt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: zone }),
            state: startAt.getTime() <= now.getTime() ? 'past' : 'new',
          })
        }
      }
    }

    /* ── 3. What already exists / clashes ───────────── */
    /* The ROW's course: a row that stays in the chosen course keeps the ref it
       always had, so files imported before rows had their own course still
       come back "Already imported". */
    const refOf = (r: PreviewRow, dateKey: string) => `${r.course.id}:${r.sessionKey}:${dateKey}`
    /* The key the same row had before rows found their own course: the chosen
       course's. A row now routed to another course must still find the class
       an earlier import made of it, or re-importing that file makes it twice
       — the mentor-clash check would miss it once that class was cancelled or
       handed to another mentor. */
    const legacyRefOf = (r: PreviewRow, dateKey: string) => `${settings.courseId}:${r.sessionKey}:${dateKey}`
    const allRefs = rows.flatMap(r => r.occurrences.flatMap(o => [refOf(r, o.dateKey), legacyRefOf(r, o.dateKey)]))
    const existing = new Set(
      allRefs.length
        ? (await LiveClassModel.find({ importRef: { $in: allRefs } }).select('importRef').lean<Array<{ importRef: string }>>()).map(x => x.importRef)
        : [],
    )

    const instIds = [...new Set(rows.map(r => r.instructor?.id).filter(Boolean) as string[])]
    const starts = rows.flatMap(r => r.occurrences.map(o => new Date(o.startISO).getTime()))
    const busy = instIds.length && starts.length
      ? await LiveClassModel.find({
          instructorId: { $in: instIds.map(i => new Types.ObjectId(i)) },
          status: { $ne: 'cancelled' },
          scheduledStart: { $gte: new Date(Math.min(...starts) - 600 * 60_000), $lte: new Date(Math.max(...starts) + 600 * 60_000) },
        }).select('instructorId scheduledStart durationMins title importRef courseId').lean<Array<{ instructorId: Types.ObjectId; scheduledStart: Date; durationMins: number; title: string; importRef?: string; courseId?: Types.ObjectId }>>()
      : []
    /* A department head learns that the mentor is busy — never the title of
       another department's class (plan.md §10). The clash itself still counts. */
    const ownCourses = actor.categoryScope && busy.length
      ? new Set((await CourseModel.find({ program: actor.categoryScope }).select('_id').lean<Array<{ _id: Types.ObjectId }>>()).map(c => String(c._id)))
      : null
    const clashName = (b: { title: string; courseId?: Types.ObjectId }) =>
      ownCourses && !ownCourses.has(String(b.courseId)) ? 'a class in another department' : `"${b.title}"`

    for (const r of rows) {
      for (const o of r.occurrences) {
        if (o.state === 'past') continue
        if (existing.has(refOf(r, o.dateKey)) || existing.has(legacyRefOf(r, o.dateKey))) { o.state = 'exists'; o.note = 'Already imported'; continue }
        if (!r.instructor) continue
        const s = new Date(o.startISO).getTime(), e = s + r.durationMins * 60_000
        const clash = busy.find(b => String(b.instructorId) === r.instructor!.id
          && !b.importRef?.startsWith(`${r.course.id}:${r.sessionKey}:`) && !b.importRef?.startsWith(`${settings.courseId}:${r.sessionKey}:`)
          && b.scheduledStart.getTime() < e && b.scheduledStart.getTime() + b.durationMins * 60_000 > s)
        if (clash && settings.allowMentorClash) o.note = `Alongside ${clashName(clash)} — same mentor, same time (allowed)`
        else if (clash) { o.state = 'conflict'; o.note = `Mentor already has ${clashName(clash)}` }
      }
      r.newCount = r.occurrences.filter(o => o.state === 'new').length
      if (r.status !== 'error') {
        const conflicts = r.occurrences.filter(o => o.state === 'conflict').length
        const exists = r.occurrences.filter(o => o.state === 'exists').length
        const past = r.occurrences.filter(o => o.state === 'past').length
        if (conflicts) r.messages.push(`${conflicts} date${conflicts > 1 ? 's' : ''} clash with the mentor's existing classes — skipped.`)
        const alongside = r.occurrences.filter(o => o.state === 'new' && o.note?.startsWith('Alongside')).length
        if (alongside) r.messages.push(`${alongside} date${alongside > 1 ? 's run' : ' runs'} at the same time as the mentor's other classes — created anyway (--allow-clash).`)
        if (exists) r.messages.push(`${exists} date${exists > 1 ? 's' : ''} already imported — skipped.`)
        if (past) r.messages.push(`${past} date${past > 1 ? 's are' : ' is'} in the past — skipped.`)
        if (r.matchedBy === 'first-name') r.messages.push(`Mentor matched by first name to ${r.instructor!.name} — check it.`)
        if (r.matchedBy === 'staff') {
          const role = byId.get(r.instructor!.id)?.role?.replace(/_/g, ' ') ?? 'staff'
          r.messages.push(`Mentor matched ${r.instructor!.name}, ${/^[aeiou]/i.test(role) ? 'an' : 'a'} ${role} account — not an instructor. Check it.`)
        }
        if (conflicts || r.matchedBy === 'first-name' || r.matchedBy === 'staff') r.status = 'warning'
        if (r.newCount === 0 && settingsErrors.length === 0) r.status = r.status === 'ready' ? 'warning' : r.status
      }
      r.include = r.status !== 'error' && r.newCount > 0 && overrides[r.rowNumber]?.include !== false
      delete (r as unknown as Record<string, unknown>)['_weekday']
      delete (r as unknown as Record<string, unknown>)['_start']
    }

    const included = rows.filter(r => r.include)
    const dates = included.flatMap(r => r.occurrences.filter(o => o.state === 'new').map(o => o.dateKey)).sort()
    const count = (p: (r: PreviewRow) => boolean) => included.filter(p).reduce((n, r) => n + r.newCount, 0)

    return {
      course: { id: String(course._id), title: course.title },
      courses: courses.map(c => ({ id: c.id, title: c.title, modules: c.modules.map(m => ({ id: m.id, title: m.title })) })),
      academy: { slug: orgSlug, zone, tag: zoneTag(zone) },
      instructors,
      modules,
      rows,
      settingsErrors,
      summary: {
        rows: rows.length,
        ready: rows.filter(r => r.status === 'ready').length,
        warnings: rows.filter(r => r.status === 'warning').length,
        errors: rows.filter(r => r.status === 'error').length,
        classes: count(() => true),
        meet: count(r => r.platform === 'meet'),
        inapp: count(r => r.platform === 'inapp'),
        offline: count(r => r.platform === null),
        mentors: new Set(included.map(r => r.instructor?.id)).size,
        courses: new Set(included.map(r => r.course.id)).size,
        firstDate: dates[0] ?? null,
        lastDate: dates[dates.length - 1] ?? null,
      },
    }
  }

  /* ── Start: re-check, store the plan, create in the background ── */
  async start(
    settings: ImportSettings, rawRows: RawRow[], actor: Actor,
    overrides: Record<number, RowOverride>, fileName?: string,
    createFn?: CreateFn,
  ): Promise<{ jobId: string; total: number }> {
    const { ClassImportModel, CourseModel } = await import('@/models/schema.ts')
    const p = await this.preview(settings, rawRows, actor, overrides)
    if (p.settingsErrors.length) throw new ClassImportError('INVALID_SETTINGS', p.settingsErrors.join(' '))

    const items = p.rows.filter(r => r.include).flatMap((r) => {
      const seriesId = new Types.ObjectId()
      return r.occurrences.filter(o => o.state === 'new').map(o => ({
        sessionId: r.sessionKey,
        seriesId,
        dateKey: o.dateKey,
        scheduledStart: new Date(o.startISO),
        durationMins: r.durationMins,
        title: r.title,
        instructorId: new Types.ObjectId(r.instructor!.id),
        platform: (r.platform ?? 'meet') as ClassImportPlatform,
        offline: r.platform === null,
        location: r.location,
        room: r.room,
        courseId: new Types.ObjectId(r.course.id),
        ...(r.module ? { sectionId: new Types.ObjectId(r.module.id) } : {}),
        importRef: `${r.course.id}:${r.sessionKey}:${o.dateKey}`,
      }))
    })
    if (items.length === 0) throw new ClassImportError('NOTHING_TO_IMPORT', 'Nothing selected to import.')
    if (items.length > 3000) throw new ClassImportError('TOO_MANY', `That is ${items.length} classes — import at most 3000 at a time.`)

    const course = await CourseModel.findById(settings.courseId).select('organizationId').lean<{ organizationId?: Types.ObjectId }>()
    const job = await ClassImportModel.create({
      createdBy: new Types.ObjectId(actor.id),
      actor,
      organizationId: course?.organizationId,
      courseId: new Types.ObjectId(settings.courseId),
      courseIds: [...new Set(items.map(it => String(it.courseId)))].map(id => new Types.ObjectId(id)),
      fileName,
      settings: {
        startDate: settings.startDate, weeks: settings.weeks, capacity: settings.capacity,
        language: settings.language, titleLabel: settings.titleLabel, location: settings.location,
        room: settings.room, defaultPlatform: settings.defaultPlatform,
      },
      status: 'running',
      total: items.length,
      /* An offline-only row has no platform. It is stored as 'meet' + offline:
         the create path only makes a Meet link when isOnline is true, so it
         gets none — see run(). */
      items: items.map(it => ({ ...it, status: 'pending' })),
    })

    void this.run(String(job._id), createFn).catch(err => logger.error({ err, jobId: String(job._id) }, '[ClassImport] run crashed'))
    return { jobId: String(job._id), total: items.length }
  }

  /* ── The background run. Safe to call again on an unfinished job. ── */
  /* pacingMs: a gap after each Google Meet class so a big import does not trip
     Google's per-user calendar rate limit. CLASS_IMPORT_PACING_MS overrides
     it (the test suite sets 0). */
  async run(jobId: string, createFn?: CreateFn, pacingMs = Number(process.env['CLASS_IMPORT_PACING_MS'] ?? 800)): Promise<void> {
    if (running.has(jobId)) return
    running.add(jobId)
    const { ClassImportModel, LiveClassModel } = await import('@/models/schema.ts')
    try {
      const job = await ClassImportModel.findById(jobId)
      if (!job) return
      const create: CreateFn = createFn ?? (async (dto, actor, seriesId, meta) => {
        const { LiveClassController } = await import('@/controllers/liveClass.controller.ts')
        return controllerSingleton(LiveClassController).createForImport(dto, actor, seriesId, meta)
      })
      if (job.status !== 'running') { job.status = 'running'; await job.save() }

      for (const item of job.items) {
        if (item.status === 'created' || item.status === 'skipped') continue
        /* Resume safety — a class from an earlier attempt already exists. */
        const already = await LiveClassModel.findOne({ importRef: item.importRef }).select('_id').lean<{ _id: Types.ObjectId }>()
        if (already) {
          await setItem(jobId, item._id, { status: 'skipped', liveClassId: already._id, error: 'Already existed' })
          continue
        }
        const isOffline = item.offline === true
        try {
          const { live } = await create({
            /* A job started before rows had their own course has none on its items. */
            courseId:        String(item.courseId ?? job.courseId),
            ...(item.sectionId ? { sectionId: String(item.sectionId) } : {}),
            title:           item.title,
            scheduledStart:  item.scheduledStart,
            durationMins:    item.durationMins,
            type:            item.platform === 'inapp' ? 'internal' : 'external',
            ...(item.platform === 'inapp' ? { provider: 'livekit' as const } : {}),
            instructorId:    String(item.instructorId),
            sessionCapacity: job.settings.capacity,
            language:        job.settings.language,
            isOnline:        !isOffline,
            location:        item.location,
            room:            item.room,
            organizationId:  job.organizationId ? String(job.organizationId) : undefined,
          }, actorOf(job), String(item.seriesId), { importJobId: jobId, importRef: item.importRef })
          const liveId = (live as { id?: string; _id?: unknown }).id ?? String((live as { _id?: unknown })._id)
          await setItem(jobId, item._id, { status: 'created', liveClassId: new Types.ObjectId(liveId) })
          if (item.platform === 'meet' && !isOffline && pacingMs > 0) await sleep(pacingMs)   // Google API pacing
        } catch (err) {
          const e = err as { code?: number | string; message?: string }
          if (e.code === 11000) {
            await setItem(jobId, item._id, { status: 'skipped', error: 'Already existed' })
          } else {
            await setItem(jobId, item._id, { status: 'failed', error: (e.message ?? 'Failed').slice(0, 500) })
            logger.warn({ err, jobId, importRef: item.importRef }, '[ClassImport] class failed')
          }
        }
      }

      /* Exact counters from the items — a resume must not double-count. */
      const fresh = await ClassImportModel.findById(jobId)
      if (!fresh) return
      fresh.created = fresh.items.filter(i => i.status === 'created').length
      fresh.skipped = fresh.items.filter(i => i.status === 'skipped').length
      fresh.failed  = fresh.items.filter(i => i.status === 'failed').length
      fresh.status = 'completed'
      fresh.finishedAt = new Date()
      await fresh.save()

      if (!fresh.summariesSentAt && fresh.failed === 0) await this.sendSummaries(fresh)
    } finally {
      running.delete(jobId)
    }
  }

  /* One email per mentor: their weekly sessions from this import. */
  private async sendSummaries(job: HydratedDocument<IClassImport>): Promise<void> {
    const { UserModel, CourseModel, SectionModel, ClassImportModel } = await import('@/models/schema.ts')
    const { sendInstructorImportSummary } = await import('@/services/email.service.ts')
    const created = job.items.filter(i => i.status === 'created')
    if (!created.length) return
    await ensureOrgSlugs().catch(() => {})
    const slugName = orgSlugFor(job.organizationId) ?? null
    const zone = zoneForAcademy(slugName)
    const courseOf = (it: typeof created[number]) => String(it.courseId ?? job.courseId)
    const sectionIds = [...new Set(created.filter(i => i.sectionId).map(i => String(i.sectionId)))]
    type Titled = Array<{ _id: Types.ObjectId; title?: string }>
    const [courseDocs, sectionDocs] = await Promise.all([
      CourseModel.find({ _id: { $in: [...new Set(created.map(courseOf))] } }).select('title').lean<Titled>(),
      sectionIds.length ? SectionModel.find({ _id: { $in: sectionIds } }).select('title').lean<Titled>() : Promise.resolve([] as Titled),
    ])
    const courseTitle = new Map(courseDocs.map(c => [String(c._id), c.title ?? '']))
    const moduleTitle = new Map(sectionDocs.map(s => [String(s._id), s.title ?? '']))

    const byInstructor = new Map<string, typeof created>()
    for (const it of created) {
      const k = String(it.instructorId)
      byInstructor.set(k, [...(byInstructor.get(k) ?? []), it])
    }
    for (const [instId, its] of byInstructor) {
      try {
        const u = await UserModel.findById(instId).select('name email role emailPrefs').lean<{ name?: string; email?: string; role?: string; emailPrefs?: unknown }>()
        if (!u?.email || !wantsStaffEmail(u as never, 'classScheduled')) continue
        /* One line per weekly session (series), not per date. One course heads
           the email; when a mentor's sessions span several, each line names its own. */
        const own = new Set(its.map(courseOf))
        const series = new Map<string, typeof its>()
        for (const it of its) series.set(String(it.seriesId), [...(series.get(String(it.seriesId)) ?? []), it])
        const sessions = [...series.values()].map(list => {
          const first = list.reduce((a, b) => (a.scheduledStart < b.scheduledStart ? a : b))
          return {
            title: first.title, start: first.scheduledStart, durationMins: first.durationMins, platform: first.platform,
            offline: first.offline === true, room: first.room, weeks: list.length,
            ...(own.size > 1 ? { course: courseTitle.get(courseOf(first)) } : {}),
            ...(first.sectionId ? { module: moduleTitle.get(String(first.sectionId)) } : {}),
          }
        }).sort((a, b) => {
          const wa = new Date(a.start.toLocaleString('en-US', { timeZone: zone })).getDay()
          const wb = new Date(b.start.toLocaleString('en-US', { timeZone: zone })).getDay()
          return wa - wb || a.start.getTime() - b.start.getTime()
        })
        const dates = its.map(i => i.dateKey).sort()
        const heading = own.size === 1 ? courseTitle.get([...own][0]!) ?? '' : ''
        await sendInstructorImportSummary(u.email, u.name ?? 'Instructor', heading, sessions, dates[0]!, dates[dates.length - 1]!, its.length, slugName)
      } catch (err) {
        logger.error({ err, instId }, '[ClassImport] summary email failed')
      }
    }
    await ClassImportModel.updateOne({ _id: job._id }, { $set: { summariesSentAt: new Date() } })
  }

  /* ── Resume an interrupted or partly failed job ── */
  async resume(jobId: string, actor: Actor, createFn?: CreateFn): Promise<void> {
    const job = await this.getForActor(jobId, actor)
    if (job.status === 'undone') throw new ClassImportError('UNDONE', 'This import was undone.')
    if (running.has(jobId)) return
    if (!job.items.some(i => i.status === 'pending' || i.status === 'failed')) return
    void this.run(jobId, createFn).catch(err => logger.error({ err, jobId }, '[ClassImport] resume crashed'))
  }

  /* ── Undo: delete what this import created — never a class with bookings. ── */
  async undo(jobId: string, actor: Actor): Promise<{ deleted: number; kept: number }> {
    const { LiveClassModel, ClassBookingModel, ClassImportModel } = await import('@/models/schema.ts')
    const { LiveClassService } = await import('@/services/liveClass.service.ts')
    const job = await this.getForActor(jobId, actor)
    if (running.has(jobId)) throw new ClassImportError('RUNNING', 'Wait for the import to finish before undoing it.', 409)
    if (job.status === 'undone') return { deleted: 0, kept: 0 }

    const svc = new LiveClassService()
    const classes = await LiveClassModel.find({ importJobId: job._id }).select('_id bookedCount status').lean<Array<{ _id: Types.ObjectId; bookedCount?: number; status?: string }>>()
    let deleted = 0, kept = 0
    for (const c of classes) {
      const booked = (c.bookedCount ?? 0) > 0
        || !!(await ClassBookingModel.exists({ liveClassId: c._id, status: { $ne: 'cancelled' } }))
      if (booked || (c.status && c.status !== 'scheduled')) { kept++; continue }
      try { await svc.delete(String(c._id)); deleted++ }
      catch (err) { kept++; logger.warn({ err, liveClassId: String(c._id) }, '[ClassImport] undo could not delete') }
    }
    await ClassImportModel.updateOne({ _id: job._id }, {
      $set: kept === 0
        ? { status: 'undone', undoneAt: new Date(), undoneBy: new Types.ObjectId(actor.id) }
        : { undoneAt: new Date(), undoneBy: new Types.ObjectId(actor.id) },
    })
    return { deleted, kept }
  }

  async getForActor(jobId: string, actor: Actor) {
    const { ClassImportModel, CourseModel } = await import('@/models/schema.ts')
    if (!Types.ObjectId.isValid(jobId)) throw new ClassImportError('NOT_FOUND', 'Import not found.', 404)
    const job = await ClassImportModel.findById(jobId)
    if (!job) throw new ClassImportError('NOT_FOUND', 'Import not found.', 404)
    if (actor.role !== 'super_admin' && job.organizationId && actor.organizationId
        && String(job.organizationId) !== actor.organizationId) {
      throw new ClassImportError('NOT_FOUND', 'Import not found.', 404)
    }
    /* The programme wall, as preview() puts it up: a programme-scoped admin
       reads, retries and undoes only imports into their own programme's
       courses. Without it the academy check above was the only one, and a
       Digital Marketing sub-admin could undo a Forex timetable. Every course
       the job touched counts — an older job names only its default one. */
    if (actor.categoryScope) {
      const ids = job.courseIds?.length ? job.courseIds : [job.courseId]
      const outside = await CourseModel.exists({ _id: { $in: ids }, program: { $ne: actor.categoryScope } })
      if (outside) throw new ClassImportError('NOT_FOUND', 'Import not found.', 404)
    }
    return job
  }

  /** Progress + per-item results for the status screen. */
  async status(jobId: string, actor: Actor) {
    const job = await this.getForActor(jobId, actor)
    const done = job.items.filter(i => i.status !== 'pending').length
    return {
      id: String(job._id), status: job.status, running: running.has(jobId),
      fileName: job.fileName, courseId: String(job.courseId),
      total: job.total, done,
      created: job.items.filter(i => i.status === 'created').length,
      skipped: job.items.filter(i => i.status === 'skipped').length,
      failed:  job.items.filter(i => i.status === 'failed').length,
      failures: job.items.filter(i => i.status === 'failed').slice(0, 50)
        .map(i => ({ title: i.title, dateKey: i.dateKey, error: i.error ?? '' })),
      startedAt: job.startedAt, finishedAt: job.finishedAt ?? null, undoneAt: job.undoneAt ?? null,
    }
  }

  async list(actor: Actor) {
    const { ClassImportModel, CourseModel } = await import('@/models/schema.ts')
    const filter: Record<string, unknown> = actor.role === 'super_admin' || !actor.organizationId ? {} : { organizationId: new Types.ObjectId(actor.organizationId) }
    /* Same programme wall as getForActor: a job is listed by the course it
       was started in, which preview() already held to the caller's programme. */
    if (actor.categoryScope) {
      const ours = await CourseModel.find({ program: actor.categoryScope }).select('_id').lean<Array<{ _id: Types.ObjectId }>>()
      filter['courseId'] = { $in: ours.map(c => c._id) }
    }
    const jobs = await ClassImportModel.find(filter).sort({ createdAt: -1 }).limit(20)
      .select('status fileName courseId courseIds total created skipped failed startedAt finishedAt undoneAt')
      .populate<{ courseId: { title?: string } | null }>('courseId', 'title').lean()
    return jobs.map(j => ({
      id: String(j._id), status: j.status, fileName: j.fileName ?? '', course: j.courseId?.title ?? '',
      courses: j.courseIds?.length || 1,
      total: j.total, created: j.created, skipped: j.skipped, failed: j.failed,
      startedAt: j.startedAt, finishedAt: j.finishedAt ?? null, undoneAt: j.undoneAt ?? null,
    }))
  }

  /** On boot: a job left 'running' by a restart is 'interrupted' — resumable. */
  static async markInterruptedOnBoot(): Promise<void> {
    const { ClassImportModel } = await import('@/models/schema.ts')
    const r = await ClassImportModel.updateMany({ status: 'running' }, { $set: { status: 'interrupted' } })
    if (r.modifiedCount) logger.warn({ jobs: r.modifiedCount }, '[ClassImport] imports interrupted by a restart — resume them from Live Classes → Import')
  }
}

/* ── module state ─────────────────────────────────────── */
const running = new Set<string>()

/* A plain object, not the Mongoose subdocument — #createOne reads it as req.user. */
function actorOf(job: HydratedDocument<IClassImport>): Actor {
  const a = job.actor
  return { id: a.id, role: a.role, organizationId: a.organizationId || undefined, categoryScope: a.categoryScope || undefined }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function setItem(jobId: string, itemId: Types.ObjectId, patch: Record<string, unknown>): Promise<void> {
  const { ClassImportModel } = await import('@/models/schema.ts')
  const set: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(patch)) set[`items.$.${k}`] = v
  await ClassImportModel.updateOne({ _id: jobId, 'items._id': itemId }, { $set: set })
}

let controller: unknown = null
function controllerSingleton<T>(Ctor: new () => T): T {
  if (!controller) controller = new Ctor()
  return controller as T
}

/* Exported for tests. */
export const __test = { parseTime, parseMode, parsePlatform, parseDay, zoneDateKey, matchModule, findModule, findCourse }
