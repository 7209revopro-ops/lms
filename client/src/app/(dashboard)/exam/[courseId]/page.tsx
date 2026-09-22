'use client'

import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Clock, ShieldAlert, ChevronLeft, ChevronRight,
  CheckCircle2, XCircle, FileText, ArrowLeft, Trophy, Hourglass,
} from 'lucide-react'
import {
  useCourseExam, useExamResult,
  startExam, getExamStatus, saveExamAnswer, submitExam,
  type StudentExamQuestion, type ExamStart,
} from '@/lib/api/exam'
import Spinner from '@/components/ui/Spinner'

type Phase = 'loading' | 'rules' | 'taking' | 'result' | 'none'

function fmtClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(sec).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

export default function ExamPage({
  params, searchParams,
}: {
  params: Promise<{ courseId: string }>
  searchParams: Promise<{ slug?: string }>
}) {
  const { courseId } = use(params)
  const { slug } = use(searchParams)
  const backHref = slug ? `/courses/${slug}` : '/my-learning'

  const { data: courseExam, isLoading } = useCourseExam(courseId)

  const [phase, setPhase] = useState<Phase>('loading')
  const [examId, setExamId] = useState<string>('')
  const [questions, setQuestions] = useState<StudentExamQuestion[]>([])
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [current, setCurrent] = useState(0)
  const [timeLeftMs, setTimeLeftMs] = useState(0)
  const [starting, setStarting] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)

  const answersRef = useRef(answers)
  answersRef.current = answers
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const finishedRef = useRef(false)   // guards against double auto-submit
  const initedRef = useRef(false)     // the phase decision must run only once

  /* ── Decide the initial phase once the exam loads ── */
  useEffect(() => {
    if (isLoading || initedRef.current) return
    if (courseExam === null || courseExam === undefined) { setPhase('none'); return }
    initedRef.current = true
    const st = courseExam.attempt.status
    setExamId(courseExam.exam.id)
    if (st === 'submitted' || st === 'suspended') { setPhase('result'); return }
    if (st === 'in_progress') { void begin(courseExam.exam.id); return }
    setPhase('rules')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, courseExam])

  /* ── Start / resume the attempt ── */
  const begin = useCallback(async (id: string) => {
    setStarting(true)
    setStartError(null)
    try {
      const data: ExamStart = await startExam(id)
      setExamId(id)
      setQuestions(data.questions)
      setAnswers(data.answers ?? {})
      setTimeLeftMs(data.timeRemainingMs)
      setCurrent(0)
      finishedRef.current = false
      setPhase('taking')
    } catch (e: any) {
      const code = e?.response?.data?.error?.code
      if (code === 'ALREADY_SUBMITTED' || code === 'SUSPENDED') { setPhase('result'); return }
      setStartError(e?.response?.data?.error?.message ?? 'Could not start the exam.')
      setPhase('rules')
    } finally {
      setStarting(false)
    }
  }, [])

  /* ── The finalizing submit (manual, timer, or forced) ── */
  const doSubmit = useCallback(async (auto: boolean) => {
    if (finishedRef.current) return
    finishedRef.current = true
    setSubmitting(true)
    // flush any pending answer saves first
    for (const t of Object.values(saveTimers.current)) clearTimeout(t)
    try {
      const pending = Object.entries(answersRef.current)
      await Promise.allSettled(pending.map(([qid, ans]) => saveExamAnswer(examId, qid, ans)))
      await submitExam(examId)
    } catch {
      /* server may already have auto-submitted on expiry — treat as done */
    } finally {
      setSubmitting(false)
      setPhase('result')
    }
    void auto
  }, [examId])

  /* ── Live countdown; auto-submits at zero ── */
  useEffect(() => {
    if (phase !== 'taking') return
    const iv = setInterval(() => {
      setTimeLeftMs(prev => {
        const next = prev - 1000
        if (next <= 0) { clearInterval(iv); void doSubmit(true); return 0 }
        return next
      })
    }, 1000)
    return () => clearInterval(iv)
  }, [phase, doSubmit])

  /* ── Resync with the server every 25s (drift + server-side suspension) ── */
  useEffect(() => {
    if (phase !== 'taking' || !examId) return
    const iv = setInterval(async () => {
      try {
        const s = await getExamStatus(examId)
        if (s.status !== 'in_progress') { finishedRef.current = true; setPhase('result'); return }
        setTimeLeftMs(s.timeRemainingMs)
      } catch { /* transient — keep local clock */ }
    }, 25_000)
    return () => clearInterval(iv)
  }, [phase, examId])

  /* ── Answer handling: local state + debounced server save ── */
  const setAnswer = useCallback((qid: string, value: string) => {
    setAnswers(prev => ({ ...prev, [qid]: value }))
    clearTimeout(saveTimers.current[qid])
    saveTimers.current[qid] = setTimeout(() => {
      saveExamAnswer(examId, qid, value).catch(() => {})
    }, 700)
  }, [examId])

  const flushSave = useCallback((qid: string) => {
    clearTimeout(saveTimers.current[qid])
    const val = answersRef.current[qid]
    if (val !== undefined) saveExamAnswer(examId, qid, val).catch(() => {})
  }, [examId])

  const isAnswered = (q: StudentExamQuestion) => (answers[q.id] ?? '').trim().length > 0
  const answeredCount = useMemo(() => questions.filter(isAnswered).length, [questions, answers])

  /* ─────────── Render ─────────── */
  if (isLoading || phase === 'loading') {
    return <CenterCard><Spinner size={26} /></CenterCard>
  }

  if (phase === 'none') {
    return (
      <CenterCard>
        <FileText size={34} style={{ color: 'var(--color-text-muted)' }} />
        <h1 className="mt-3 text-lg font-bold" style={{ color: 'var(--color-text-primary)' }}>No exam available</h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--color-text-muted)' }}>This course doesn’t have a published exam yet.</p>
        <BackLink href={backHref} />
      </CenterCard>
    )
  }

  if (phase === 'rules' && courseExam) {
    const ex = courseExam.exam
    return (
      <div className="mx-auto max-w-2xl px-4 py-8">
        <Link href={backHref} className="inline-flex items-center gap-1.5 text-sm mb-5" style={{ color: 'var(--color-text-muted)' }}>
          <ArrowLeft size={15} /> Back to course
        </Link>
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border p-7" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg-surface)' }}>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)', fontFamily: 'Bricolage Grotesque, sans-serif' }}>{ex.title}</h1>
          <div className="mt-3 flex flex-wrap gap-2">
            <Chip icon={<FileText size={13} />} label={`${ex.questionCount} question${ex.questionCount === 1 ? '' : 's'}`} />
            <Chip icon={<Clock size={13} />} label={`${ex.durationMinutes} min`} />
          </div>

          {ex.instructions && (
            <p className="mt-5 whitespace-pre-wrap text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>{ex.instructions}</p>
          )}

          <div className="mt-6 rounded-xl p-4" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.22)' }}>
            <div className="flex items-center gap-2 mb-2">
              <ShieldAlert size={15} style={{ color: '#B45309' }} />
              <p className="text-sm font-bold" style={{ color: '#B45309' }}>Before you begin</p>
            </div>
            <ul className="space-y-1 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
              <li>• The timer starts as soon as you begin and <b>cannot be paused</b>.</li>
              <li>• You have <b>one attempt</b> — the exam submits automatically when time runs out.</li>
              {ex.antiCheat.tabSwitchSuspend && <li>• Leaving the exam tab repeatedly ({ex.maxViolations}×) will <b>suspend</b> your attempt.</li>}
              {ex.antiCheat.screenshotSuspend && <li>• Screenshot attempts are logged and may suspend your attempt.</li>}
            </ul>
          </div>

          {startError && <p className="mt-4 text-sm" style={{ color: '#EF4444' }}>{startError}</p>}

          <button onClick={() => begin(ex.id)} disabled={starting}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-bold text-white disabled:opacity-60"
            style={{ background: 'var(--color-primary)' }}>
            {starting ? <Spinner size={15} /> : <ChevronRight size={16} />} Start exam
          </button>
        </motion.div>
      </div>
    )
  }

  if (phase === 'taking') {
    const q = questions[current]
    const warn = timeLeftMs < 60_000
    const isLast = current === questions.length - 1
    return (
      <div className="mx-auto max-w-2xl px-4 py-6">
        {/* Sticky header: timer + progress */}
        <div className="sticky top-0 z-10 -mx-4 mb-5 px-4 py-3 backdrop-blur"
          style={{ background: 'color-mix(in srgb, var(--color-bg-base, #fff) 88%, transparent)' }}>
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
              Question {current + 1} of {questions.length}
              <span className="ml-2" style={{ color: 'var(--color-text-muted)' }}>· {answeredCount} answered</span>
            </p>
            <div className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-bold tabular-nums"
              style={{ background: warn ? 'rgba(239,68,68,0.10)' : 'var(--color-bg-subtle)', color: warn ? '#EF4444' : 'var(--color-text-secondary)' }}>
              <Clock size={14} /> {fmtClock(timeLeftMs)}
            </div>
          </div>
          <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full" style={{ background: 'var(--color-bg-subtle)' }}>
            <div className="h-full rounded-full transition-all" style={{ width: `${((current + 1) / questions.length) * 100}%`, background: 'var(--color-primary)' }} />
          </div>
        </div>

        {q && (
          <AnimatePresence mode="wait">
            <motion.div key={q.id} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }}
              className="rounded-2xl border p-6" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg-surface)' }}>
              <div className="flex items-start justify-between gap-3">
                <p className="text-base font-semibold leading-relaxed" style={{ color: 'var(--color-text-primary)' }}>{q.text}</p>
                <span className="shrink-0 rounded-md px-2 py-0.5 text-[11px] font-bold" style={{ background: 'var(--color-bg-subtle)', color: 'var(--color-text-muted)' }}>
                  {q.maxMarks} mark{q.maxMarks === 1 ? '' : 's'}
                </span>
              </div>

              <div className="mt-5">
                <AnswerInput question={q} value={answers[q.id] ?? ''} onChange={v => setAnswer(q.id, v)} />
              </div>
            </motion.div>
          </AnimatePresence>
        )}

        {/* Nav */}
        <div className="mt-5 flex items-center justify-between gap-3">
          <button
            onClick={() => { if (q) flushSave(q.id); setCurrent(c => Math.max(0, c - 1)) }}
            disabled={current === 0}
            className="inline-flex items-center gap-1.5 rounded-xl border px-4 py-2.5 text-sm font-semibold disabled:opacity-40"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
            <ChevronLeft size={16} /> Previous
          </button>

          {isLast ? (
            <button onClick={() => { if (confirm('Submit your exam? You cannot make changes after this.')) void doSubmit(false) }}
              disabled={submitting}
              className="inline-flex items-center gap-2 rounded-xl px-6 py-2.5 text-sm font-bold text-white disabled:opacity-60"
              style={{ background: '#10B981' }}>
              {submitting ? <Spinner size={14} /> : <CheckCircle2 size={16} />} Submit exam
            </button>
          ) : (
            <button
              onClick={() => { if (q) flushSave(q.id); setCurrent(c => Math.min(questions.length - 1, c + 1)) }}
              disabled={q ? !isAnswered(q) : true}
              className="inline-flex items-center gap-1.5 rounded-xl px-5 py-2.5 text-sm font-bold text-white disabled:opacity-40"
              style={{ background: 'var(--color-primary)' }}>
              Next <ChevronRight size={16} />
            </button>
          )}
        </div>
        {q && !isAnswered(q) && !isLast && (
          <p className="mt-2 text-right text-xs" style={{ color: 'var(--color-text-muted)' }}>Answer this question to continue.</p>
        )}
      </div>
    )
  }

  /* phase === 'result' */
  return <ResultView examId={examId} backHref={backHref} />
}

/* ─── Answer inputs by type ─── */
function AnswerInput({ question: q, value, onChange }: {
  question: StudentExamQuestion; value: string; onChange: (v: string) => void
}) {
  if (q.type === 'mcq' || q.type === 'true_false') {
    const opts = q.type === 'true_false' ? ['True', 'False'] : q.choices
    return (
      <div className="space-y-2.5">
        {opts.map((opt, i) => {
          const selected = value === opt
          return (
            <button key={i} onClick={() => onChange(opt)}
              className="flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm transition-colors"
              style={{
                borderColor: selected ? 'var(--color-primary)' : 'var(--color-border)',
                background: selected ? 'rgba(0,87,184,0.06)' : 'transparent',
                color: 'var(--color-text-primary)',
              }}>
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border"
                style={{ borderColor: selected ? 'var(--color-primary)' : 'var(--color-border)' }}>
                {selected && <span className="h-2.5 w-2.5 rounded-full" style={{ background: 'var(--color-primary)' }} />}
              </span>
              {opt}
            </button>
          )
        })}
      </div>
    )
  }
  return (
    <textarea
      value={value} onChange={e => onChange(e.target.value)}
      rows={q.type === 'essay' ? 8 : 3}
      placeholder="Type your answer…"
      className="w-full rounded-xl border px-4 py-3 text-sm outline-none"
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg-surface)', color: 'var(--color-text-primary)' }}
    />
  )
}

/* ─── Result / submitted / suspended view ─── */
function ResultView({ examId, backHref }: { examId: string; backHref: string }) {
  const { data: result, isLoading } = useExamResult(examId, !!examId)

  if (isLoading || !result) return <CenterCard><Spinner size={26} /></CenterCard>

  if (result.status === 'suspended') {
    return (
      <CenterCard>
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl" style={{ background: 'rgba(239,68,68,0.10)' }}>
          <ShieldAlert size={30} style={{ color: '#EF4444' }} />
        </div>
        <h1 className="mt-4 text-xl font-bold" style={{ color: 'var(--color-text-primary)', fontFamily: 'Bricolage Grotesque, sans-serif' }}>Exam suspended</h1>
        <p className="mt-1 max-w-sm text-sm" style={{ color: 'var(--color-text-muted)' }}>
          Your attempt was suspended for breaking an exam rule. Please contact your instructor if you think this is a mistake.
        </p>
        <BackLink href={backHref} />
      </CenterCard>
    )
  }

  const graded = result.graded
  const pct = result.maxMarks && result.maxMarks > 0 && result.totalMarks != null
    ? Math.round((result.totalMarks / result.maxMarks) * 100) : null
  const passed = result.passed

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="rounded-2xl border p-7 text-center" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg-surface)' }}>
        {!graded ? (
          <>
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl" style={{ background: 'rgba(0,87,184,0.10)' }}>
              <Hourglass size={28} style={{ color: 'var(--color-primary)' }} />
            </div>
            <h1 className="mt-4 text-xl font-bold" style={{ color: 'var(--color-text-primary)', fontFamily: 'Bricolage Grotesque, sans-serif' }}>Exam submitted</h1>
            <p className="mt-1 text-sm" style={{ color: 'var(--color-text-muted)' }}>Your answers are in. Some questions need manual grading — your result will appear here once graded.</p>
          </>
        ) : (
          <>
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl"
              style={{ background: passed ? 'rgba(16,185,129,0.10)' : 'rgba(239,68,68,0.10)' }}>
              <Trophy size={28} style={{ color: passed ? '#10B981' : '#EF4444' }} />
            </div>
            <h1 className="mt-4 text-xl font-bold" style={{ color: 'var(--color-text-primary)', fontFamily: 'Bricolage Grotesque, sans-serif' }}>
              {passed ? 'You passed!' : 'Exam graded'}
            </h1>
            <p className="mt-1 text-3xl font-extrabold tabular-nums" style={{ color: passed ? '#10B981' : '#EF4444' }}>
              {result.totalMarks} / {result.maxMarks}{pct != null && <span className="ml-2 text-base font-bold" style={{ color: 'var(--color-text-muted)' }}>({pct}%)</span>}
            </p>
            <p className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>Pass mark: {result.passPercent}%</p>
          </>
        )}
      </div>

      {/* Per-question review */}
      <div className="mt-5 space-y-3">
        {result.questions.map((qq, i) => {
          const correct = graded && qq.marksAwarded != null && qq.maxMarks > 0 && qq.marksAwarded >= qq.maxMarks
          return (
            <div key={qq.id} className="rounded-xl border p-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg-surface)' }}>
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                  <span className="mr-2" style={{ color: 'var(--color-text-muted)' }}>Q{i + 1}.</span>{qq.text}
                </p>
                {graded && qq.marksAwarded != null && (
                  <span className="shrink-0 inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-bold"
                    style={{ background: correct ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)', color: correct ? '#10B981' : '#EF4444' }}>
                    {correct ? <CheckCircle2 size={12} /> : <XCircle size={12} />}{qq.marksAwarded}/{qq.maxMarks}
                  </span>
                )}
              </div>
              <p className="mt-2 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                <span style={{ color: 'var(--color-text-muted)' }}>Your answer: </span>{qq.yourAnswer || <em style={{ color: 'var(--color-text-muted)' }}>— left blank —</em>}
              </p>
              {qq.feedback && (
                <p className="mt-2 rounded-lg px-3 py-2 text-xs" style={{ background: 'var(--color-bg-subtle)', color: 'var(--color-text-secondary)' }}>
                  <b>Feedback:</b> {qq.feedback}
                </p>
              )}
              {qq.explanation && (
                <p className="mt-2 text-xs" style={{ color: 'var(--color-text-muted)' }}><b>Explanation:</b> {qq.explanation}</p>
              )}
            </div>
          )
        })}
      </div>

      <div className="mt-6 text-center"><BackLink href={backHref} /></div>
    </div>
  )
}

/* ─── Small shared bits ─── */
function CenterCard({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4 text-center">{children}</div>
}
function BackLink({ href }: { href: string }) {
  return (
    <Link href={href} className="mt-5 inline-flex items-center gap-1.5 rounded-xl border px-4 py-2 text-sm font-semibold"
      style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
      <ArrowLeft size={15} /> Back to course
    </Link>
  )
}
function Chip({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold"
      style={{ background: 'var(--color-bg-subtle)', color: 'var(--color-text-secondary)' }}>
      {icon}{label}
    </span>
  )
}
