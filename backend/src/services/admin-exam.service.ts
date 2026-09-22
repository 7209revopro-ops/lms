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
