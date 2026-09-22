import { Types } from 'mongoose'
import {
  ExamModel, ExamAttemptModel, ExamLogModel,
  type IExam, type IExamQuestion, type ExamQuestionType,
} from '@/models/schema.ts'
import { ExamError } from '@/services/exam.service.ts'

/* One incoming question from the admin editor. `id` is present when editing an
   existing embedded question — we keep its _id so student attempts (which key
   answers by question _id) survive an edit; absent means a brand-new question. */
export interface ExamQuestionInput {
  id?:           string
  text:          string
  type:          ExamQuestionType
  choices?:      string[]
  correctAnswer?: string
  order:         number
  maxMarks:      number
  explanation?:  string
}

export interface ExamUpsertInput {
  title:           string
  instructions?:   string
  durationMinutes: number
  passPercent:     number
  availableFrom?:  string | null
  availableTo?:    string | null
  maxViolations:   number
  antiCheat: {
    blockCopyPaste:    boolean
    blockRightClick:   boolean
    screenshotSuspend: boolean
    tabSwitchSuspend:  boolean
  }
  isPublished:     boolean
  questions:       ExamQuestionInput[]
}

export class AdminExamService {
  /* ── The full exam for a course (admin view — includes answer keys). ── */
  async getForCourse(courseId: string): Promise<IExam | null> {
    if (!Types.ObjectId.isValid(courseId)) throw new ExamError('INVALID_ID', 'Invalid course id.', 400)
    return ExamModel.findOne({ courseId })
  }

  /* ── The exam by its own id (used by attempt/grade routes to resolve org). ── */
  async getRaw(examId: string): Promise<IExam> {
    if (!Types.ObjectId.isValid(examId)) throw new ExamError('NOT_FOUND', 'Exam not found.', 404)
    const exam = await ExamModel.findById(examId)
    if (!exam) throw new ExamError('NOT_FOUND', 'Exam not found.', 404)
    return exam
  }

  /* ── Create or replace the one exam attached to a course. ──
     Question _ids are preserved when the editor sends an `id`, so answers that
     students have already saved keep pointing at the right question. */
  async upsertForCourse(courseId: string, dto: ExamUpsertInput): Promise<IExam> {
    if (!Types.ObjectId.isValid(courseId)) throw new ExamError('INVALID_ID', 'Invalid course id.', 400)

    this.validate(dto)

    const questions = dto.questions.map((q) => {
      const base: Partial<IExamQuestion> & { _id?: Types.ObjectId } = {
        text:    q.text.trim(),
        type:    q.type,
        choices: this.normalizeChoices(q),
        order:   q.order,
        maxMarks: q.maxMarks,
      }
      if (q.type === 'mcq' || q.type === 'true_false') base.correctAnswer = q.correctAnswer
      if (q.explanation && q.explanation.trim()) base.explanation = q.explanation.trim()
      if (q.id && Types.ObjectId.isValid(q.id)) base._id = new Types.ObjectId(q.id)
      return base
    })

    const availableFrom = dto.availableFrom ? new Date(dto.availableFrom) : undefined
    const availableTo   = dto.availableTo ? new Date(dto.availableTo) : undefined
    if (availableFrom && availableTo && availableFrom.getTime() >= availableTo.getTime()) {
      throw new ExamError('BAD_WINDOW', 'The exam must open before it closes.', 400)
    }

    const fields = {
      title:           dto.title.trim(),
      instructions:    dto.instructions?.trim() || undefined,
      durationMinutes: dto.durationMinutes,
      passPercent:     dto.passPercent,
      maxViolations:   dto.maxViolations,
      antiCheat:       dto.antiCheat,
      isPublished:     dto.isPublished,
      availableFrom,
      availableTo,
      questions,
    }

    const existing = await ExamModel.findOne({ courseId })
    if (existing) {
      existing.set(fields)
      // clearing an optional date needs an explicit unset — set() with undefined won't
      if (!availableFrom) existing.availableFrom = undefined
      if (!availableTo) existing.availableTo = undefined
      existing.markModified('questions')
      await existing.save()
      return existing
    }

    return ExamModel.create({ courseId: new Types.ObjectId(courseId), ...fields })
  }

  /* ── Delete the exam and everything hanging off it (attempts + proctor logs). ── */
  async deleteForCourse(courseId: string): Promise<void> {
    if (!Types.ObjectId.isValid(courseId)) throw new ExamError('INVALID_ID', 'Invalid course id.', 400)
    const exam = await ExamModel.findOne({ courseId }).select('_id')
    if (!exam) return
    await ExamLogModel.deleteMany({ examId: exam._id })
    await ExamAttemptModel.deleteMany({ examId: exam._id })
    await ExamModel.deleteOne({ _id: exam._id })
  }

  /* ── Every student's attempt on an exam (for the admin attempts table). ── */
  async listAttempts(examId: string): Promise<Array<{
    attemptId: string
    student: { id: string; name: string; email: string }
    status: string
    totalMarks: number | null
    maxMarks: number | null
    passed: boolean | null
    violations: number
    submittedAt: Date | null
    graded: boolean
  }>> {
    if (!Types.ObjectId.isValid(examId)) throw new ExamError('NOT_FOUND', 'Exam not found.', 404)
    const attempts = await ExamAttemptModel
      .find({ examId })
      .populate('userId', 'name email')
      .sort({ updatedAt: -1 })
      .lean()

    return attempts.map((a) => {
      const u = a.userId as unknown as { _id: Types.ObjectId; name?: string; email?: string } | null
      return {
        attemptId: String(a._id),
        student: {
          id:    u ? String(u._id) : '',
          name:  u?.name ?? 'Unknown',
          email: u?.email ?? '',
        },
        status:      a.status,
        totalMarks:  a.totalMarks ?? null,
        maxMarks:    a.maxMarks ?? null,
        passed:      a.passed ?? null,
        violations:  a.violations ?? 0,
        submittedAt: a.submittedAt ?? null,
        graded:      Boolean(a.gradedAt),
      }
    })
  }

  /* ── Apply per-question marks + feedback; recompute the total and pass. ──
     Grades can touch any question (including overriding an auto-graded one).
     A manual question the student left blank still gets an answer row so the
     mark is recorded. */
  async gradeAttempt(
    examId: string,
    attemptId: string,
    grades: Array<{ questionId: string; marksAwarded: number; feedback?: string }>,
    graderId: string,
  ): Promise<{ totalMarks: number; maxMarks: number; passed: boolean }> {
    if (!Types.ObjectId.isValid(examId) || !Types.ObjectId.isValid(attemptId)) {
      throw new ExamError('NOT_FOUND', 'Attempt not found.', 404)
    }
    const exam = await ExamModel.findById(examId)
    if (!exam) throw new ExamError('NOT_FOUND', 'Exam not found.', 404)

    const attempt = await ExamAttemptModel.findOne({ _id: attemptId, examId })
    if (!attempt) throw new ExamError('NOT_FOUND', 'Attempt not found.', 404)
    if (attempt.status === 'in_progress') {
      throw new ExamError('NOT_SUBMITTED', 'This attempt is still in progress.', 409)
    }

    const maxByQ = new Map(exam.questions.map(q => [String(q._id), q.maxMarks]))

    for (const g of grades) {
      const max = maxByQ.get(g.questionId)
      if (max === undefined) throw new ExamError('BAD_QUESTION', 'Unknown question in this exam.', 400)
      const marks = Math.max(0, Math.min(g.marksAwarded, max))
      const existing = attempt.answers.find(a => a.questionId === g.questionId)
      if (existing) {
        existing.marksAwarded = marks
        if (g.feedback !== undefined) existing.feedback = g.feedback
      } else {
        attempt.answers.push({ questionId: g.questionId, answer: '', marksAwarded: marks, ...(g.feedback ? { feedback: g.feedback } : {}) })
      }
    }

    /* Recompute over the full paper so the total always reflects every mark. */
    const awardedByQ = new Map(attempt.answers.map(a => [a.questionId, a.marksAwarded]))
    let total = 0
    let maxMarks = 0
    for (const q of exam.questions) {
      maxMarks += q.maxMarks
      total += awardedByQ.get(String(q._id)) ?? 0
    }

    attempt.totalMarks = total
    attempt.maxMarks = maxMarks
    attempt.passed = maxMarks > 0 ? (total / maxMarks) * 100 >= exam.passPercent : true
    attempt.gradedAt = new Date()
    attempt.gradedBy = Types.ObjectId.isValid(graderId) ? new Types.ObjectId(graderId) : undefined
    attempt.markModified('answers')
    await attempt.save()

    return { totalMarks: total, maxMarks, passed: attempt.passed }
  }

  /* ── Reset an attempt so the student can retake (also lifts a suspension). ── */
  async resetAttempt(examId: string, attemptId: string): Promise<void> {
    if (!Types.ObjectId.isValid(examId) || !Types.ObjectId.isValid(attemptId)) {
      throw new ExamError('NOT_FOUND', 'Attempt not found.', 404)
    }
    const attempt = await ExamAttemptModel.findOne({ _id: attemptId, examId }).select('_id')
    if (!attempt) throw new ExamError('NOT_FOUND', 'Attempt not found.', 404)
    await ExamLogModel.deleteMany({ attemptId: attempt._id })
    await ExamAttemptModel.deleteOne({ _id: attempt._id })
  }

  /* ── One attempt in full: student, answers vs. the key, and the proctor log. ── */
  async getAttemptDetail(examId: string, attemptId: string): Promise<{
    attempt: {
      id: string
      student: { id: string; name: string; email: string }
      status: string
      startedAt: Date | null
      submittedAt: Date | null
      suspendedReason: string | null
      violations: number
      totalMarks: number | null
      maxMarks: number | null
      passed: boolean | null
      graded: boolean
    }
    exam: { id: string; title: string; passPercent: number }
    questions: Array<{
      id: string
      text: string
      type: ExamQuestionType
      choices: string[]
      maxMarks: number
      correctAnswer: string | null   // admins may see the key
      autoGradable: boolean
      answer: string
      marksAwarded: number | null
      feedback: string | null
    }>
    logs: Array<{ event: string; detail: string | null; timestamp: Date }>
  }> {
    if (!Types.ObjectId.isValid(examId) || !Types.ObjectId.isValid(attemptId)) {
      throw new ExamError('NOT_FOUND', 'Attempt not found.', 404)
    }
    const exam = await ExamModel.findById(examId)
    if (!exam) throw new ExamError('NOT_FOUND', 'Exam not found.', 404)

    const attempt = await ExamAttemptModel.findOne({ _id: attemptId, examId })
      .populate('userId', 'name email')
      .lean()
    if (!attempt) throw new ExamError('NOT_FOUND', 'Attempt not found.', 404)

    const logs = await ExamLogModel.find({ attemptId }).sort({ timestamp: 1 }).lean()

    const byId = new Map((attempt.answers ?? []).map(a => [a.questionId, a]))
    const questions = [...exam.questions].sort((a, b) => a.order - b.order).map((q) => {
      const a = byId.get(String(q._id))
      const autoGradable = q.type === 'mcq' || q.type === 'true_false'
      return {
        id:            String(q._id),
        text:          q.text,
        type:          q.type,
        choices:       q.choices ?? [],
        maxMarks:      q.maxMarks,
        correctAnswer: autoGradable ? (q.correctAnswer ?? null) : null,
        autoGradable,
        answer:        a?.answer ?? '',
        marksAwarded:  a?.marksAwarded ?? null,
        feedback:      a?.feedback ?? null,
      }
    })

    const u = attempt.userId as unknown as { _id: Types.ObjectId; name?: string; email?: string } | null
    return {
      attempt: {
        id:              String(attempt._id),
        student:         { id: u ? String(u._id) : '', name: u?.name ?? 'Unknown', email: u?.email ?? '' },
        status:          attempt.status,
        startedAt:       attempt.startedAt ?? null,
        submittedAt:     attempt.submittedAt ?? null,
        suspendedReason: attempt.suspendedReason ?? null,
        violations:      attempt.violations ?? 0,
        totalMarks:      attempt.totalMarks ?? null,
        maxMarks:        attempt.maxMarks ?? null,
        passed:          attempt.passed ?? null,
        graded:          Boolean(attempt.gradedAt),
      },
      exam: { id: String(exam._id), title: exam.title, passPercent: exam.passPercent },
      questions,
      logs: logs.map(l => ({ event: l.event, detail: l.detail ?? null, timestamp: l.timestamp })),
    }
  }

  /* ── Validation shared by create + update. ── */
  private validate(dto: ExamUpsertInput): void {
    if (!dto.questions.length) throw new ExamError('NO_QUESTIONS', 'Add at least one question.', 400)
    const orders = new Set<number>()
    for (const [i, q] of dto.questions.entries()) {
      const where = `Question ${i + 1}`
      if (!q.text?.trim()) throw new ExamError('BAD_QUESTION', `${where}: text is required.`, 400)
      if (q.maxMarks < 0) throw new ExamError('BAD_QUESTION', `${where}: marks cannot be negative.`, 400)
      if (q.type === 'mcq') {
        const choices = (q.choices ?? []).map(c => c.trim()).filter(Boolean)
        if (choices.length < 2) throw new ExamError('BAD_QUESTION', `${where}: add at least two choices.`, 400)
        if (!q.correctAnswer || !choices.includes(q.correctAnswer.trim())) {
          throw new ExamError('BAD_QUESTION', `${where}: the correct answer must be one of the choices.`, 400)
        }
      }
      if (q.type === 'true_false') {
        if (q.correctAnswer !== 'True' && q.correctAnswer !== 'False') {
          throw new ExamError('BAD_QUESTION', `${where}: pick True or False as the answer.`, 400)
        }
      }
      orders.add(q.order)
    }
  }

  private normalizeChoices(q: ExamQuestionInput): string[] {
    if (q.type === 'mcq') return (q.choices ?? []).map(c => c.trim()).filter(Boolean)
    if (q.type === 'true_false') return ['True', 'False']
    return []
  }
}
