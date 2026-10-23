/* ─────────────────────────────────────────────────────────────
   The catalogue and everything around learning that is not a lesson —
   reviews, favourites, learning paths, achievements, streaks, Q&A,
   bookmarks, homework, exams — as the backend answers them. Types and
   pure normalisers only: no React, no HTTP.

   Several endpoints return raw populated Mongoose documents rather than
   DTOs (`_id` instead of `id`, `userId` as an object), so every list goes
   through a normaliser here.
───────────────────────────────────────────────────────────── */

import { courseOf, type CourseSummary } from './learning'

type Raw = Record<string, unknown>
const str = (v: unknown): string => (v == null ? '' : String(v))
const idOf = (o: unknown): string => {
  if (!o) return ''
  if (typeof o !== 'object') return str(o)
  const r = o as Raw
  return str(r['id'] ?? r['_id'])
}
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const person = (v: unknown): Person | null => {
  if (!v || typeof v !== 'object') return null
  const p = v as Raw
  return { id: idOf(p), name: str(p['name']) || '—', avatarUrl: (p['avatarUrl'] as string) || undefined, role: (p['role'] as string) || undefined }
}

export interface Person { id: string; name: string; avatarUrl?: string; role?: string }

/** Paginated list meta (snake_case on the wire). */
export interface PageMeta { total: number; page: number; totalPages: number; hasNext: boolean }
export function pageMetaOf(m: unknown): PageMeta {
  const r = (m ?? {}) as Raw
  return { total: num(r['total_count']), page: num(r['page'], 1), totalPages: num(r['total_pages'], 1), hasNext: r['has_next'] === true }
}

/* ── Catalogue ───────────────────────────────────────────── */

/** The website's programme pills (client courses page) — `program` query values. */
export const PROGRAMS = [
  { value: '', label: 'All' },
  { value: '4x-trading', label: 'Forex' },
  { value: 'jura', label: 'JURA' },
  { value: 'digital-marketing', label: 'Digital Marketing' },
  { value: 'ai', label: 'AI' },
] as const

export const COURSE_SORTS = ['popular', 'rating', 'newest'] as const
export type CourseSort = (typeof COURSE_SORTS)[number]

export interface CatalogQuery {
  search?: string
  program?: string
  category?: string
  level?: string
  sort?: CourseSort
  page?: number
}

/** GET /courses params — prefix search, as the website's search page uses. */
export function catalogParams(q: CatalogQuery, perPage = 12): Record<string, string | number> {
  const p: Record<string, string | number> = { page: q.page ?? 1, per_page: perPage, sort: q.sort ?? 'popular' }
  if (q.search?.trim()) { p['search'] = q.search.trim(); p['search_mode'] = 'prefix' }
  if (q.program) p['program'] = q.program
  if (q.category) p['category'] = q.category
  if (q.level) p['level'] = q.level
  return p
}

export interface Category { id: string; name: string; slug: string }
export const normalizeCategory = (c: unknown): Category => {
  const r = c as Raw
  return { id: idOf(r), name: str(r['name']), slug: str(r['slug']) }
}

export const coursesOf = (list: unknown): CourseSummary[] =>
  (Array.isArray(list) ? list : []).map(courseOf).filter((c): c is CourseSummary => !!c && !!c.slug)

/** "2h 30m" / "45m". */
export function durationLabel(mins: number | undefined): string | null {
  if (!mins || mins <= 0) return null
  const h = Math.floor(mins / 60)
  const m = Math.round(mins % 60)
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`
}

/** "12.4k" for big counts. */
export function compactCount(n: number | undefined): string {
  if (!n) return '0'
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, '')}k` : String(n)
}

/* ── Reviews ─────────────────────────────────────────────── */

export interface CourseReview {
  id: string
  rating: number
  comment: string
  createdAt: string
  author: Person | null
  instructorReply?: string
  helpfulVotes: number
}
export function normalizeReview(r: unknown): CourseReview {
  const x = r as Raw
  return {
    id: idOf(x), rating: num(x['rating']), comment: str(x['comment']), createdAt: str(x['createdAt']),
    author: person(x['userId']), instructorReply: (x['instructorReply'] as string) || undefined, helpfulVotes: num(x['helpfulVotes']),
  }
}

export interface RatingHistogram { histogram: Record<'1' | '2' | '3' | '4' | '5', number>; total: number; avg: number }

/* ── Favourites ──────────────────────────────────────────── */

/** GET /favorites/me — rows with the course populated (raw, not a DTO). */
export function favoriteCoursesOf(rows: unknown): CourseSummary[] {
  return (Array.isArray(rows) ? rows : [])
    .map(r => courseOf((r as Raw)['courseId']))
    .filter((c): c is CourseSummary => !!c && !!c.slug)
}

/* ── Learning paths ──────────────────────────────────────── */

export interface PathSummary {
  id: string; title: string; slug: string; description?: string; thumbnailUrl?: string
  courseCount: number; enrolledCount: number; instructor: Person | null
}
export interface PathStep { order: number; isPrerequisite: boolean; course: CourseSummary }
export interface PathDetail extends PathSummary { steps: PathStep[] }

export function normalizePath(p: unknown): PathDetail {
  const x = p as Raw
  const courses = (Array.isArray(x['courses']) ? x['courses'] : []) as Raw[]
  const steps = courses
    .map(s => ({ order: num(s['order']), isPrerequisite: s['isPrerequisite'] === true, course: courseOf(s['courseId']) }))
    .filter((s): s is PathStep => !!s.course && !!s.course.slug)
    .sort((a, b) => a.order - b.order)
  return {
    id: idOf(x), title: str(x['title']), slug: str(x['slug']), description: (x['description'] as string) || undefined,
    thumbnailUrl: (x['thumbnailUrl'] as string) || undefined, courseCount: courses.length,
    enrolledCount: num(x['enrolledCount']), instructor: person(x['instructorId']), steps,
  }
}

/* ── Engagement ──────────────────────────────────────────── */

export interface Achievement {
  id: string; title: string; description: string
  iconKey: 'rocket' | 'flame' | 'trophy' | 'star' | 'medal' | 'crown' | 'heart' | 'graduation' | string
  target: number; progress: number; earned: boolean; earnedAt?: string
}
export interface Achievements { items: Achievement[]; earnedCount: number; total: number }

export interface Streak {
  currentStreak: number; longestStreak: number; lastActiveDate: string | null; totalDaysActive: number
  weeklyGoal: number; weekProgress: number; weekStartDate: string | null
}

export interface ActivityItem {
  id: string; isCompleted: boolean; completedAt?: string; watchTimeSecs?: number; updatedAt: string
  lesson: { id: string; title: string; type: string } | null
  course: { id: string; title: string; slug: string } | null
}
export interface Activity { items: ActivityItem[]; week: { lessonsCompleted: number; minutesWatched: number } }
export function normalizeActivity(a: unknown): Activity {
  const x = (a ?? {}) as Raw
  const week = (x['week'] ?? {}) as Raw
  return {
    week: { lessonsCompleted: num(week['lessonsCompleted']), minutesWatched: num(week['minutesWatched']) },
    items: ((x['items'] as Raw[] | undefined) ?? []).map(i => {
      const l = i['lessonId'] as Raw | string | undefined
      const c = i['courseId'] as Raw | string | undefined
      return {
        id: idOf(i), isCompleted: i['isCompleted'] === true, completedAt: (i['completedAt'] as string) || undefined,
        watchTimeSecs: num(i['watchTimeSecs']), updatedAt: str(i['updatedAt'] ?? i['createdAt']),
        lesson: l && typeof l === 'object' ? { id: idOf(l), title: str(l['title']), type: str(l['type']) } : null,
        course: c && typeof c === 'object' ? { id: idOf(c), title: str(c['title']), slug: str(c['slug']) } : null,
      }
    }),
  }
}

/** Monday-based days of the streak week. A day is `active` when it falls in
 *  the current run — the `currentStreak` consecutive days ending on
 *  `lastActiveDate` (UTC dates, as the server counts them). Days of an earlier,
 *  broken run this week are unknown to the API and stay unmarked — better
 *  than the website's guess (it lights the first `weekProgress` days, and
 *  weekProgress counts lessons, not days). */
export function streakWeek(s: Pick<Streak, 'weekStartDate' | 'lastActiveDate' | 'currentStreak'>, today = new Date()) {
  const last = s.lastActiveDate?.slice(0, 10) ?? null
  const first = last && s.currentStreak > 0
    ? (() => { const d = new Date(`${last}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - (s.currentStreak - 1)); return d.toISOString().slice(0, 10) })()
    : null
  return weekDays(s.weekStartDate, today).map(d => ({ ...d, active: !!first && !!last && d.date >= first && d.date <= last }))
}

/** Monday-based days of the streak week, marking the ones up to today. */
export function weekDays(weekStart: string | null, today = new Date()): { date: string; label: string; isToday: boolean; isFuture: boolean }[] {
  const start = weekStart ? new Date(`${weekStart.slice(0, 10)}T00:00:00Z`) : (() => {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
    return d
  })()
  const todayIso = today.toISOString().slice(0, 10)
  return ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((label, i) => {
    const d = new Date(start); d.setUTCDate(start.getUTCDate() + i)
    const iso = d.toISOString().slice(0, 10)
    return { date: iso, label, isToday: iso === todayIso, isFuture: iso > todayIso }
  })
}

export interface Announcement { id: string; title: string; description: string; mediaUrl?: string; startDate: string; endDate: string }
export const normalizeAnnouncement = (a: unknown): Announcement => {
  const x = a as Raw
  return { id: idOf(x), title: str(x['title']), description: str(x['description']), mediaUrl: (x['mediaUrl'] as string) || undefined, startDate: str(x['startDate']), endDate: str(x['endDate']) }
}

/** A class the student attended and has not rated (GET /instructor-reviews/pending). */
export interface PendingRating {
  liveClassId: string; title: string; scheduledStart: string
  instructorId: string; instructorName: string; courseId?: string; courseTitle?: string
}

export const RATING_WORDS = ['', 'Poor', 'Fair', 'Good', 'Great', 'Excellent'] as const

export interface SessionFeedback { id: string; liveClassId: string; rating: number; comment?: string }
export function normalizeFeedback(f: unknown): SessionFeedback {
  const x = f as Raw
  return { id: idOf(x), liveClassId: idOf(x['liveClassId']), rating: num(x['rating']), comment: (x['comment'] as string) || undefined }
}

export interface Homework { id: string; liveClassId: string; title: string; description: string; dueDate?: string; createdAt: string }
export const normalizeHomework = (h: unknown): Homework => {
  const x = h as Raw
  return { id: idOf(x), liveClassId: idOf(x['liveClassId']), title: str(x['title']), description: str(x['description']), dueDate: (x['dueDate'] as string) || undefined, createdAt: str(x['createdAt']) }
}

/* ── Lesson extras ───────────────────────────────────────── */

export interface VideoBookmark { id: string; lessonId: string; timeSecs: number; label?: string; createdAt: string }
export const normalizeBookmark = (b: unknown): VideoBookmark => {
  const x = b as Raw
  return { id: idOf(x), lessonId: idOf(x['lessonId']), timeSecs: num(x['timeSecs']), label: (x['label'] as string) || undefined, createdAt: str(x['createdAt']) }
}

/** 75 → "1:15", 3725 → "1:02:05". */
export function clockLabel(secs: number): string {
  const s = Math.max(0, Math.floor(secs))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60
  const mm = h ? String(m).padStart(2, '0') : String(m)
  return `${h ? `${h}:` : ''}${mm}:${String(r).padStart(2, '0')}`
}

export interface Thread {
  id: string; title?: string; body: string; author: Person | null
  isPinned: boolean; isResolved: boolean; upvoteCount: number; commentCount: number; createdAt: string
}
export const normalizeThread = (t: unknown): Thread => {
  const x = t as Raw
  return {
    id: idOf(x), title: (x['title'] as string) || undefined, body: str(x['body']), author: person(x['authorId']),
    isPinned: x['isPinned'] === true, isResolved: x['isResolved'] === true,
    upvoteCount: num(x['upvoteCount']), commentCount: num(x['commentCount']), createdAt: str(x['createdAt']),
  }
}

export interface ThreadComment { id: string; body: string; author: Person | null; upvoteCount: number; isInstructorAnswer: boolean; createdAt: string }
export const normalizeComment = (c: unknown): ThreadComment => {
  const x = c as Raw
  return { id: idOf(x), body: str(x['body']), author: person(x['authorId']), upvoteCount: num(x['upvoteCount']), isInstructorAnswer: x['isInstructorAnswer'] === true, createdAt: str(x['createdAt']) }
}

export interface AiNotes {
  summary: string; keyTopics: string[]; studyOrder: { title: string; tip: string; minutes: number }[]
  keyTakeaways: string[]; estimatedStudyTime?: string; difficulty?: string
}

export interface AiTurn { role: 'user' | 'assistant'; content: string }
/** POST /ai/chat sends at most 20 earlier turns; the server reads the last 10. */
export const aiHistory = (turns: AiTurn[]): AiTurn[] => turns.slice(-20).map(t => ({ role: t.role, content: t.content.slice(0, 4000) }))

/* ── Exams ───────────────────────────────────────────────── */

export type ExamAttemptStatus = 'not_started' | 'in_progress' | 'submitted' | 'suspended'
export interface ExamInfo {
  exam: {
    id: string; title: string; instructions?: string; durationMinutes: number; questionCount: number
    antiCheat: { blockCopyPaste: boolean; blockRightClick: boolean; screenshotSuspend: boolean; tabSwitchSuspend: boolean }
    maxViolations: number
  }
  attempt: { status: ExamAttemptStatus; timeRemainingMs: number | null }
}
export interface ExamQuestion { id: string; text: string; type: 'mcq' | 'true_false' | 'short' | 'essay'; choices: string[]; order: number; maxMarks: number }
export interface ExamStart { attemptId: string; timeRemainingMs: number; durationMinutes: number; questions: ExamQuestion[]; answers: Record<string, string> }
export interface ExamResult {
  status: ExamAttemptStatus; graded: boolean; totalMarks: number; maxMarks: number; passed: boolean; passPercent: number
  suspendedReason?: string
  questions: { id: string; text: string; type: string; yourAnswer: string | null; maxMarks: number; marksAwarded: number | null; feedback?: string; explanation?: string }[]
}

/** "4:05" from milliseconds left. */
export const countdown = (ms: number): string => clockLabel(Math.ceil(Math.max(0, ms) / 1000))

/* ── Journey (GET /live-classes/journey, the website's Class Schedule since 2026-10-21) ── */

export type LevelState = 'completed' | 'current' | 'next' | 'locked'
export interface JourneyModule { id: string; title: string; number: number; locked: boolean }
export interface JourneyLevel {
  courseId: string; title: string; slug?: string; thumbnailUrl?: string; description?: string
  level: number; state: LevelState; progressPercent: number
  modules: JourneyModule[]; modulesOpen: number; modulesTotal: number
  /** Why modules are locked: the fee (finance) or the academy. */
  lockReason?: 'payment' | 'academy'
  classesAttended: number
}
export interface Journey {
  programmes: { program: string; label: string; levels: JourneyLevel[] }[]
  /** The advisor's name only. */
  advisor: { name?: string } | null
}

/** A level the student can open now (its classes and lessons), vs one to unlock. */
export const levelHeld = (l: Pick<JourneyLevel, 'state'>) => l.state === 'completed' || l.state === 'current'

/** The support request the website's "Ask my advisor to unlock it" sends. */
export function unlockRequest(l: Pick<JourneyLevel, 'title' | 'lockReason'>, programme: string) {
  return {
    subject: `Unlock ${l.title}`.slice(0, 200),
    category: 'course' as const,
    message: `Hi, I would like to unlock "${l.title}" (${programme})${l.lockReason === 'payment' ? ' — please let me know about the fee' : ''}. Thank you.`,
  }
}
