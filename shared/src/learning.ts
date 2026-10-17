/* ─────────────────────────────────────────────────────────────
   Courses, lessons, progress, quizzes, notes and class assignments — the
   student's side, as the API returns them (GET /enrollments/me,
   /courses/:slug, /courses/:slug/progress, /lessons/:id/*, /quizzes/*,
   /class-assignments/*). Pure: no React, no HTTP.

   Every rule that decides access lives on the server; the gates here only
   decide which explanation to show BEFORE asking it, so a locked lesson
   reads "locked" instead of a raw 403.
───────────────────────────────────────────────────────────── */

export type LessonType = 'video' | 'article' | 'quiz'

export interface CourseSummary {
  id: string
  title: string
  slug: string
  thumbnailUrl?: string
  lessonCount?: number
  instructor?: { id: string; name: string }
}

export interface MyEnrollment {
  id: string
  status: 'active' | 'completed' | 'dropped'
  progressPercent: number
  lastLessonId?: string
  enrolledAt: string
  /** null when the course was deleted after the enrolment was made. */
  course: CourseSummary | null
}

export interface Section { id: string; title: string; order: number }

export interface LessonOutline {
  id: string
  sectionId: string
  courseId: string
  title: string
  type: LessonType
  durationMins: number
  order: number
  isFree: boolean
  /** Articles only. Videos never ship a URL here — see /lessons/:id/play-url. */
  contentUrl?: string
  contentBody?: string
  hasVideo?: boolean
}

export interface CourseDetail {
  course: CourseSummary
  sections: Section[]
  lessons: LessonOutline[]
}

export interface CourseProgress {
  isEnrolled: boolean
  progressPercent: number
  status: 'active' | 'completed' | 'dropped' | null
  lastLessonId: string | null
  completedLessons: string[]
  /** SECTION (module) ids — the field's name is a legacy misnomer. */
  blockedLessons: string[]
}

export interface LessonProgress { watchTimeSecs: number; isCompleted: boolean; completedAt: string | null }
export interface PlayUrl { url: string; expiresIn: number }
export interface LessonNote { id: string; body: string; updatedAt: string }

/* ── Normalising ─────────────────────────────────────────── */

type Raw = Record<string, unknown>
const str = (v: unknown): string => (v == null ? '' : String(v))
const idOf = (o: Raw | undefined | null): string => str(o?.['id'] ?? o?.['_id'])

function courseOf(raw: unknown): CourseSummary | null {
  if (!raw || typeof raw !== 'object') return null
  const c = raw as Raw
  const instr = (c['instructorId'] ?? c['instructor']) as Raw | undefined
  return {
    id: idOf(c),
    title: str(c['title']),
    slug: str(c['slug']),
    thumbnailUrl: (c['thumbnailUrl'] as string | undefined) || undefined,
    lessonCount: typeof c['lessonCount'] === 'number' ? c['lessonCount'] : undefined,
    instructor: instr && typeof instr === 'object' && instr['name'] ? { id: idOf(instr), name: str(instr['name']) } : undefined,
  }
}

export function normalizeEnrollment(raw: unknown): MyEnrollment {
  const e = raw as Raw
  return {
    id: idOf(e),
    status: (e['status'] as MyEnrollment['status']) ?? 'active',
    progressPercent: Number(e['progressPercent'] ?? 0),
    lastLessonId: e['lastLessonId'] ? str(e['lastLessonId']) : undefined,
    enrolledAt: str(e['enrolledAt'] ?? e['createdAt']),
    /* courseId is populated; an unpopulated id string means the course is gone. */
    course: typeof e['courseId'] === 'object' ? courseOf(e['courseId']) : null,
  }
}

export function normalizeCourseDetail(raw: unknown): CourseDetail {
  const d = raw as Raw
  return {
    course: courseOf(d['course']) ?? { id: '', title: '', slug: '' },
    sections: ((d['sections'] as Raw[] | undefined) ?? []).map(s => ({ id: idOf(s), title: str(s['title']), order: Number(s['order'] ?? 0) })),
    lessons: ((d['lessons'] as Raw[] | undefined) ?? []).map(l => ({
      ...(l as unknown as LessonOutline),
      id: idOf(l),
      sectionId: str(l['sectionId']),
      courseId: str(l['courseId']),
      order: Number(l['order'] ?? 0),
      durationMins: Number(l['durationMins'] ?? 0),
      isFree: l['isFree'] === true,
    })),
  }
}

/* ── My learning ─────────────────────────────────────────── */

export type LearningBucket = 'notStarted' | 'inProgress' | 'completed'

/** The website's My Learning buckets, exactly. */
export function bucketOf(e: Pick<MyEnrollment, 'status' | 'progressPercent'>): LearningBucket {
  if (e.status === 'completed' || e.progressPercent >= 100) return 'completed'
  if (e.progressPercent > 0) return 'inProgress'
  return 'notStarted'
}

/* ── Course outline ──────────────────────────────────────── */

export interface ModuleOutline { section: Section; lessons: LessonOutline[] }

/** Modules in their order, each with its lessons in order. Lessons whose
 *  module no longer exists are kept, in a trailing untitled group, rather
 *  than silently disappearing. */
export function outlineOf(detail: Pick<CourseDetail, 'sections' | 'lessons'>): ModuleOutline[] {
  const sections = [...detail.sections].sort((a, b) => a.order - b.order)
  const known = new Set(sections.map(s => s.id))
  const byOrder = (a: LessonOutline, b: LessonOutline) => a.order - b.order
  const out = sections.map(section => ({
    section,
    lessons: detail.lessons.filter(l => l.sectionId === section.id).sort(byOrder),
  }))
  const orphans = detail.lessons.filter(l => !known.has(l.sectionId)).sort(byOrder)
  if (orphans.length) out.push({ section: { id: '', title: '', order: Number.MAX_SAFE_INTEGER }, lessons: orphans })
  return out
}

/** Lessons in reading order across every module — for Previous / Next. */
export function lessonSequence(detail: Pick<CourseDetail, 'sections' | 'lessons'>): LessonOutline[] {
  return outlineOf(detail).flatMap(m => m.lessons)
}

/** Where "Continue" should land: the last lesson opened, else the first
 *  lesson not yet completed, else the first lesson. */
export function resumeLesson(seq: LessonOutline[], progress: Pick<CourseProgress, 'lastLessonId' | 'completedLessons'> | undefined): LessonOutline | undefined {
  const last = progress?.lastLessonId ? seq.find(l => l.id === progress.lastLessonId) : undefined
  if (last) return last
  const done = new Set(progress?.completedLessons ?? [])
  return seq.find(l => !done.has(l.id)) ?? seq[0]
}

export type LessonGate = 'open' | 'pending' | 'notEnrolled' | 'blocked'

/** Why a lesson cannot be opened, or 'open'. Mirrors the website's gates —
 *  with the module check done on the lesson's MODULE id, which is what
 *  blockedLessons actually holds. */
export function lessonGate(
  lesson: Pick<LessonOutline, 'isFree' | 'sectionId'>,
  progress: Pick<CourseProgress, 'isEnrolled' | 'blockedLessons'> | undefined,
  enrollmentStatus: string | undefined,
): LessonGate {
  if (enrollmentStatus === 'pending') return 'pending'
  if (lesson.isFree) return 'open'
  if (progress && !progress.isEnrolled) return 'notEnrolled'
  if (progress?.blockedLessons.includes(lesson.sectionId)) return 'blocked'
  return 'open'
}

/* ── Video ───────────────────────────────────────────────── */

/** Where to resume a video: the saved position, unless it is so near the
 *  start or the end that starting over is what the student wants. */
export function resumeAt(savedSecs: number, durationSecs: number): number {
  const end = Number.isFinite(durationSecs) && durationSecs > 0 ? durationSecs : Infinity
  return savedSecs >= 10 && savedSecs < end - 15 ? Math.floor(savedSecs) : 0
}

export const WATCH_REPORT_SECS = 15
/** The server refuses a single report above this (POST /lessons/:id/watch-time). */
export const WATCH_REPORT_MAX = 300
/** Between two position ticks (one a second), playback — even at 2× — moves
 *  at most a couple of seconds. A bigger jump is a seek. */
const SEEK_GAP_SECS = 5

/** `mark` = position last reported up to; `last` = position at the last tick. */
export interface WatchMark { mark: number; last: number }

/** Feed every position tick; returns the seconds to report (0 = nothing yet)
 *  and the next state. Only played time counts: a seek in either direction
 *  restarts counting from where it landed, so skipping ahead is not "watched"
 *  and a rewind is never a negative. */
export function watchTick(state: WatchMark, positionSecs: number): { report: number; state: WatchMark } {
  const now = Math.floor(positionSecs)
  if (now < state.last || now - state.last > SEEK_GAP_SECS) {
    return { report: 0, state: { mark: now, last: now } }
  }
  const played = now - state.mark
  if (played >= WATCH_REPORT_SECS) {
    return { report: Math.min(played, WATCH_REPORT_MAX), state: { mark: now, last: now } }
  }
  return { report: 0, state: { mark: state.mark, last: now } }
}

/** What an article's resource link is. */
export function resourceKind(url: string | undefined): 'none' | 'image' | 'pdf' | 'link' {
  if (!url?.trim()) return 'none'
  if (/\.(png|jpe?g|gif|webp|avif)(\?|#|$)/i.test(url)) return 'image'
  if (/\.pdf(\?|#|$)/i.test(url)) return 'pdf'
  return 'link'
}

/* ── Quizzes ─────────────────────────────────────────────── */

export type QuestionType = 'mcq' | 'true_false' | 'short'
export interface QuizQuestion { id: string; text: string; type: QuestionType; choices: string[]; points: number }
export interface StudentQuiz { id: string; passPercent: number; timeLimit: number | null; questions: QuizQuestion[] }
export interface QuizSummary {
  hasAttempted: boolean; bestScore: number | null; passed: boolean; attempts: number
  passPercent: number; timeLimit: number | null; questionCount: number
}
export interface QuizResult {
  score: number; maxScore: number; scorePercent: number; passed: boolean; attempt: number
  breakdown: { questionId: string; correct: boolean; correctAnswer: string; points: number; explanation?: string }[]
}

/** The choices to offer, each with the value the server scores. MCQ and
 *  true/false answers are the choice's INDEX as a string ("0", "1", …) —
 *  true/false is "0" = True, "1" = False — so the label is display only.
 *  True/false gets its two choices even when the stored list is empty. */
export function choicesOf(q: QuizQuestion): { label: string; value: string }[] {
  const labels = q.type === 'true_false' && q.choices.length === 0 ? ['True', 'False'] : q.choices
  return labels.map((label, i) => ({ label, value: String(i) }))
}

/** A failed attempt returns no per-question breakdown (it would leak the
 *  answer key over retries), so only a pass can show corrections. */
export function correctionsOf(result: QuizResult): QuizResult['breakdown'] {
  return result.passed ? result.breakdown : []
}

/** The submit body: every question, answered or not (blank counts as wrong
 *  on the server, as on the website). */
export function quizAnswers(quiz: Pick<StudentQuiz, 'questions'>, answers: Record<string, string>) {
  return quiz.questions.map(q => ({ questionId: q.id, answer: (answers[q.id] ?? '').trim() }))
}

export function answeredCount(quiz: Pick<StudentQuiz, 'questions'>, answers: Record<string, string>): number {
  return quiz.questions.filter(q => (answers[q.id] ?? '').trim() !== '').length
}

/** mm:ss for a countdown. */
export function clock(secs: number): string {
  const s = Math.max(0, Math.floor(secs))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/* ── Class assignments (/class-assignments — not the older /assignments) ── */

export type AssignmentStatus = 'pending' | 'approved' | 'rejected'
export interface AssignmentFile { url: string; name: string; mimeType: string; sizeBytes: number }
interface Named { id: string; title?: string; name?: string }
export interface SubmittableClass { id: string; title: string; scheduledStart: string; course?: Named; module?: Named }
export interface MyAssignment {
  id: string; title: string; note?: string; files: AssignmentFile[]
  status: AssignmentStatus; attempt: number; lastReason?: string
  submittedAt: string; reviewedAt?: string
  liveClass?: Named & { scheduledStart?: string }; course?: Named; module?: Named
}

function named(raw: unknown): Named | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Raw
  return { id: idOf(o), title: o['title'] as string | undefined, name: o['name'] as string | undefined }
}

export function normalizeSubmittable(raw: unknown): SubmittableClass {
  const o = raw as Raw
  return { id: idOf(o), title: str(o['title']), scheduledStart: str(o['scheduledStart']), course: named(o['courseId']), module: named(o['sectionId']) }
}

export function normalizeAssignment(raw: unknown): MyAssignment {
  const a = raw as Raw
  const lc = a['liveClassId'] as Raw | undefined
  return {
    id: idOf(a),
    title: str(a['title']),
    note: (a['note'] as string | undefined) || undefined,
    files: (a['files'] as AssignmentFile[] | undefined) ?? [],
    status: (a['status'] as AssignmentStatus) ?? 'pending',
    attempt: Number(a['attempt'] ?? 1),
    lastReason: (a['lastReason'] as string | undefined) || undefined,
    submittedAt: str(a['submittedAt']),
    reviewedAt: (a['reviewedAt'] as string | undefined) || undefined,
    liveClass: lc && typeof lc === 'object' ? { ...named(lc)!, scheduledStart: lc['scheduledStart'] as string | undefined } : undefined,
    course: named(a['courseId']),
    module: named(a['sectionId']),
  }
}

/** What the server's /uploads/document accepts — checked before uploading
 *  so a wrong file is refused instantly instead of after a slow upload. */
export const ASSIGNMENT_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const
export const ASSIGNMENT_MAX_BYTES = 10 * 1024 * 1024
export const ASSIGNMENT_MAX_FILES = 10  // the server's limit (classAssignments.routes.ts)

export function fileProblem(f: { mimeType?: string; size?: number }): 'type' | 'size' | null {
  if (!f.mimeType || !(ASSIGNMENT_MIME as readonly string[]).includes(f.mimeType)) return 'type'
  if (f.size != null && f.size > ASSIGNMENT_MAX_BYTES) return 'size'
  return null
}
