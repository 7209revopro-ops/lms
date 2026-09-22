import { Types, type HydratedDocument } from 'mongoose'
import { EnrollmentRepository } from '@/repositories/enrollment.repository.ts'
import {
  ExamModel, ExamAttemptModel, ExamLogModel,
  type IExam, type IExamAttempt, type IExamQuestion,
} from '@/models/schema.ts'

export class ExamError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message)
    this.name = 'ExamError'
  }
}

/* Events that, per the exam's anti-cheat settings, can suspend an attempt. */
const SCREENSHOT_EVENTS = new Set(['screenshot', 'printscreen'])
const TABSWITCH_EVENTS = new Set(['tab_switch', 'blur', 'visibility_hidden'])

/** A question as the student sees it mid-exam — no correct answer, no
 *  explanation, no marks key beyond what's needed to render. */
export interface StudentExamQuestion {
  id: string
  text: string
  type: IExamQuestion['type']
  choices: string[]
  order: number
  maxMarks: number
}

export class ExamService {
  private readonly enrollRepo = new EnrollmentRepository()

  private async assertEnrolled(userId: string, courseId: Types.ObjectId | string): Promise<void> {
    const enrolled = await this.enrollRepo.findByUserCourse(userId, courseId)
    if (!enrolled) throw new ExamError('NOT_ENROLLED', 'You must be enrolled in this course.', 403)
  }

  private async loadExam(examId: string): Promise<IExam> {
    if (!Types.ObjectId.isValid(examId)) throw new ExamError('NOT_FOUND', 'Exam not found.', 404)
    const exam = await ExamModel.findById(examId)
    if (!exam) throw new ExamError('NOT_FOUND', 'Exam not found.', 404)
    return exam
  }

  private durationMs(exam: IExam): number {
    return exam.durationMinutes * 60_000
  }

  private remainingMs(exam: IExam, attempt: IExamAttempt): number {
    return attempt.startedAt.getTime() + this.durationMs(exam) - Date.now()
  }

  private assertWindowOpen(exam: IExam): void {
    if (!exam.isPublished) throw new ExamError('NOT_AVAILABLE', 'This exam is not available yet.', 403)
    const now = Date.now()
    if (exam.availableFrom && now < exam.availableFrom.getTime()) {
      throw new ExamError('NOT_AVAILABLE', 'This exam has not opened yet.', 403)
    }
    if (exam.availableTo && now > exam.availableTo.getTime()) {
      throw new ExamError('CLOSED', 'This exam has closed.', 403)
    }
  }

  private toStudentQuestions(exam: IExam): StudentExamQuestion[] {
    return [...exam.questions]
      .sort((a, b) => a.order - b.order)
      .map(q => ({
        id: String(q._id), text: q.text, type: q.type,
        choices: q.choices ?? [], order: q.order, maxMarks: q.maxMarks,
      }))
  }

  /* ── The exam for a course, as the student sees it (+ their attempt state) ── */
  async getForCourse(userId: string, courseId: string): Promise<{
    exam: {
      id: string; title: string; instructions?: string
      durationMinutes: number; questionCount: number
      antiCheat: IExam['antiCheat']; maxViolations: number
    }
    attempt: { status: IExamAttempt['status'] | 'not_started'; timeRemainingMs: number | null }
  } | null> {
    await this.assertEnrolled(userId, courseId)
    const exam = await ExamModel.findOne({ courseId, isPublished: true })
    if (!exam) return null

    const attempt = await ExamAttemptModel.findOne({ userId, examId: exam._id })
    let status: IExamAttempt['status'] | 'not_started' = 'not_started'
    let timeRemainingMs: number | null = null
    if (attempt) {
      status = attempt.status
      if (attempt.status === 'in_progress') timeRemainingMs = Math.max(0, this.remainingMs(exam, attempt))
    }

    return {
      exam: {
        id: String(exam._id), title: exam.title, instructions: exam.instructions,
        durationMinutes: exam.durationMinutes, questionCount: exam.questions.length,
        antiCheat: exam.antiCheat, maxViolations: exam.maxViolations,
      },
      attempt: { status, timeRemainingMs },
    }
  }

  /* ── Start (or resume) the one attempt. Stamps startedAt once. ── */
  async start(userId: string, examId: string): Promise<{
    attemptId: string; timeRemainingMs: number; durationMinutes: number
    questions: StudentExamQuestion[]; answers: Record<string, string>
  }> {
    const exam = await this.loadExam(examId)
    await this.assertEnrolled(userId, exam.courseId)
    this.assertWindowOpen(exam)

    let attempt = await ExamAttemptModel.findOne({ userId, examId: exam._id })
    if (attempt) {
      if (attempt.status === 'submitted') throw new ExamError('ALREADY_SUBMITTED', 'You have already submitted this exam.', 409)
      if (attempt.status === 'suspended') throw new ExamError('SUSPENDED', `This exam was suspended: ${attempt.suspendedReason ?? 'a rule was broken'}.`, 409)
      // in_progress → auto-submit if the clock has run out, else resume.
      if (this.remainingMs(exam, attempt) <= 0) {
        await this.finalize(exam, attempt, { auto: true })
        throw new ExamError('ALREADY_SUBMITTED', 'Your exam time has ended and it was submitted.', 409)
      }
    } else {
      attempt = await ExamAttemptModel.create({
        userId, examId: exam._id, courseId: exam.courseId,
        status: 'in_progress', startedAt: new Date(), answers: [],
      })
    }

    const answers: Record<string, string> = {}
    for (const a of attempt.answers) answers[a.questionId] = a.answer

    return {
      attemptId: String(attempt._id),
      timeRemainingMs: Math.max(0, this.remainingMs(exam, attempt)),
      durationMinutes: exam.durationMinutes,
      questions: this.toStudentQuestions(exam),
      answers,
    }
  }

  /* ── Live status: time left + saved answers. Auto-submits on expiry. ── */
  async status(userId: string, examId: string): Promise<{
    status: IExamAttempt['status']; timeRemainingMs: number; answers: Record<string, string>
    suspendedReason?: string
  }> {
    const exam = await this.loadExam(examId)
    let attempt = await ExamAttemptModel.findOne({ userId, examId: exam._id })
    if (!attempt) throw new ExamError('NOT_STARTED', 'You have not started this exam.', 409)

    if (attempt.status === 'in_progress' && this.remainingMs(exam, attempt) <= 0) {
      attempt = await this.finalize(exam, attempt, { auto: true })
    }

    const answers: Record<string, string> = {}
    for (const a of attempt.answers) answers[a.questionId] = a.answer
    return {
      status: attempt.status,
      timeRemainingMs: attempt.status === 'in_progress' ? Math.max(0, this.remainingMs(exam, attempt)) : 0,
      answers,
      ...(attempt.suspendedReason ? { suspendedReason: attempt.suspendedReason } : {}),
    }
  }

  /* ── Auto-save one answer. Rejected once the clock is out or the attempt is done. ── */
  async saveAnswer(userId: string, examId: string, questionId: string, answer: string): Promise<{ saved: boolean; timeRemainingMs: number }> {
    const exam = await this.loadExam(examId)
    const attempt = await ExamAttemptModel.findOne({ userId, examId: exam._id })
    if (!attempt) throw new ExamError('NOT_STARTED', 'You have not started this exam.', 409)
    if (attempt.status !== 'in_progress') throw new ExamError('NOT_IN_PROGRESS', 'This exam is no longer open for answers.', 409)
    if (this.remainingMs(exam, attempt) <= 0) {
      await this.finalize(exam, attempt, { auto: true })
      throw new ExamError('TIME_UP', 'Your exam time has ended.', 409)
    }
    if (!exam.questions.some(q => String(q._id) === questionId)) {
      throw new ExamError('BAD_QUESTION', 'Unknown question.', 400)
    }

    const existing = attempt.answers.find(a => a.questionId === questionId)
    if (existing) existing.answer = answer
    else attempt.answers.push({ questionId, answer })
    attempt.markModified('answers')
    await attempt.save()
    return { saved: true, timeRemainingMs: Math.max(0, this.remainingMs(exam, attempt)) }
  }

  /* ── Submit (manual). Auto-grades mcq/tf; short/essay await manual grading. ── */
  async submit(userId: string, examId: string): Promise<{ status: IExamAttempt['status'] }> {
    const exam = await this.loadExam(examId)
    const attempt = await ExamAttemptModel.findOne({ userId, examId: exam._id })
    if (!attempt) throw new ExamError('NOT_STARTED', 'You have not started this exam.', 409)
    if (attempt.status !== 'in_progress') return { status: attempt.status }
    const done = await this.finalize(exam, attempt, { auto: false })
    return { status: done.status }
  }

  /* ── Proctoring event. Suspends per the exam's anti-cheat settings. ── */
  async logEvent(userId: string, examId: string, event: string, detail?: string): Promise<{
    violations: number; suspended: boolean; timeRemainingMs: number
  }> {
    const exam = await this.loadExam(examId)
    const attempt = await ExamAttemptModel.findOne({ userId, examId: exam._id })
    if (!attempt) throw new ExamError('NOT_STARTED', 'You have not started this exam.', 409)

    await ExamLogModel.create({
      attemptId: attempt._id, userId, examId: exam._id,
      event: event.slice(0, 64), detail: detail?.slice(0, 500),
    })

    if (attempt.status !== 'in_progress') {
      return { violations: attempt.violations, suspended: attempt.status === 'suspended', timeRemainingMs: 0 }
    }

    let suspend = false
    let reason = ''
    if (SCREENSHOT_EVENTS.has(event) && exam.antiCheat.screenshotSuspend) {
      suspend = true; reason = 'A screenshot was attempted during the exam.'
    } else if (TABSWITCH_EVENTS.has(event) && exam.antiCheat.tabSwitchSuspend) {
      attempt.violations += 1
      if (attempt.violations >= exam.maxViolations) {
        suspend = true; reason = `Left the exam ${attempt.violations} times.`
      }
    }

    if (suspend) {
      await this.finalize(exam, attempt, { auto: true, suspendReason: reason })
      return { violations: attempt.violations, suspended: true, timeRemainingMs: 0 }
    }
    await attempt.save()
    return { violations: attempt.violations, suspended: false, timeRemainingMs: Math.max(0, this.remainingMs(exam, attempt)) }
  }

  /* ── Own result — only after submission/suspension. ── */
  async getResult(userId: string, examId: string): Promise<{
    status: IExamAttempt['status']; graded: boolean
    totalMarks: number | null; maxMarks: number | null; passed: boolean | null; passPercent: number
    questions: Array<{ id: string; text: string; type: IExamQuestion['type']; yourAnswer: string; maxMarks: number; marksAwarded: number | null; feedback: string | null; explanation?: string }>
  }> {
    const exam = await this.loadExam(examId)
    const attempt = await ExamAttemptModel.findOne({ userId, examId: exam._id })
    if (!attempt) throw new ExamError('NOT_STARTED', 'You have not started this exam.', 409)
    if (attempt.status === 'in_progress') throw new ExamError('NOT_SUBMITTED', 'Submit the exam to see your result.', 409)

    const byId = new Map(attempt.answers.map(a => [a.questionId, a]))
    const questions = [...exam.questions].sort((a, b) => a.order - b.order).map(q => {
      const a = byId.get(String(q._id))
      return {
        id: String(q._id), text: q.text, type: q.type,
        yourAnswer: a?.answer ?? '', maxMarks: q.maxMarks,
        marksAwarded: a?.marksAwarded ?? null, feedback: a?.feedback ?? null,
        ...(attempt.gradedAt && q.explanation ? { explanation: q.explanation } : {}),
      }
    })
    return {
      status: attempt.status, graded: Boolean(attempt.gradedAt),
      totalMarks: attempt.totalMarks ?? null, maxMarks: attempt.maxMarks ?? null,
      passed: attempt.passed ?? null, passPercent: exam.passPercent,
      questions,
    }
  }

  /* ── Finalize: auto-grade mcq/tf, compute totals, set submitted/suspended. ── */
  private async finalize(exam: IExam, attempt: HydratedDocument<IExamAttempt>, opts: { auto: boolean; suspendReason?: string }): Promise<HydratedDocument<IExamAttempt>> {
    const byId = new Map(attempt.answers.map(a => [a.questionId, a]))
    let autoTotal = 0
    let maxMarks = 0
    let hasManual = false

    for (const q of exam.questions) {
      maxMarks += q.maxMarks
      const ans = byId.get(String(q._id))
      if (q.type === 'mcq' || q.type === 'true_false') {
        const correct = ans && q.correctAnswer != null && ans.answer === q.correctAnswer
        const awarded = correct ? q.maxMarks : 0
        if (ans) ans.marksAwarded = awarded
        autoTotal += awarded
      } else {
        hasManual = true
      }
    }

    attempt.maxMarks = maxMarks
    attempt.totalMarks = autoTotal
    attempt.submittedAt = new Date()
    if (opts.suspendReason) {
      attempt.status = 'suspended'
      attempt.suspendedReason = opts.suspendReason
    } else {
      attempt.status = 'submitted'
    }
    // Fully gradable now only if there are no manual questions.
    if (!hasManual) {
      attempt.passed = maxMarks > 0 ? (autoTotal / maxMarks) * 100 >= exam.passPercent : true
      attempt.gradedAt = new Date()
    }
    attempt.markModified('answers')
    await attempt.save()
    return attempt
  }
}
