'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft, ShieldAlert, CheckCircle2, XCircle, Save, RotateCcw, Loader2,
  Activity, User, Eye, Copy, MousePointerClick, Camera, LogOut,
} from 'lucide-react'
import { useCourseExam, useAttemptDetail, useGradeAttempt, useResetAttempt, type GradeInput } from '@/lib/api/exams'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/button'
import Spinner from '@/components/ui/Spinner'
import { useToast } from '@/store/ui.store'

const cardStyle = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' } as const

function fmt(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' })
}

const EVENT_META: Record<string, { label: string; color: string; Icon: React.ElementType }> = {
  tab_switch:         { label: 'Left the exam tab',   color: '#f59e0b', Icon: LogOut },
  blur:               { label: 'Window lost focus',   color: '#f59e0b', Icon: Eye },
  visibility_hidden:  { label: 'Tab hidden',          color: '#f59e0b', Icon: Eye },
  paste:              { label: 'Paste blocked',       color: '#ef4444', Icon: Copy },
  copy:               { label: 'Copy blocked',        color: '#9ca3af', Icon: Copy },
  cut:                { label: 'Cut blocked',          color: '#9ca3af', Icon: Copy },
  right_click:        { label: 'Right-click blocked', color: '#9ca3af', Icon: MousePointerClick },
  screenshot:         { label: 'Screenshot attempt',  color: '#ef4444', Icon: Camera },
  printscreen:        { label: 'Screenshot attempt',  color: '#ef4444', Icon: Camera },
}

export default function AttemptDetailPage() {
  const params = useParams()
  const router = useRouter()
  const toast = useToast()
  const courseId = String(params?.courseId ?? '')
  const attemptId = String(params?.attemptId ?? '')

  const { data: exam } = useCourseExam(courseId)
  const { data, isLoading, isError } = useAttemptDetail(exam?.id, attemptId)
  const grade = useGradeAttempt(exam?.id ?? '', attemptId)
  const reset = useResetAttempt(exam?.id ?? '', attemptId)

  /* Editable marks/feedback, hydrated from the loaded attempt */
  const [marks, setMarks] = useState<Record<string, string>>({})
  const [feedback, setFeedback] = useState<Record<string, string>>({})
  useEffect(() => {
    if (!data) return
    const m: Record<string, string> = {}
    const f: Record<string, string> = {}
    for (const q of data.questions) {
      m[q.id] = q.marksAwarded != null ? String(q.marksAwarded) : ''
      f[q.id] = q.feedback ?? ''
    }
    setMarks(m); setFeedback(f)
  }, [data])

  const backHref = `/exams/${courseId}`

  async function onSaveGrades() {
    if (!data) return
    const grades: GradeInput[] = data.questions
      .filter(q => (marks[q.id] ?? '').trim() !== '')
      .map(q => ({
        questionId: q.id,
        marksAwarded: Math.max(0, Math.min(Number(marks[q.id]), q.maxMarks)),
        feedback: (feedback[q.id] ?? '').trim() || undefined,
      }))
    if (!grades.length) { toast.error('Nothing to save', 'Enter marks for at least one question.'); return }
    try {
      const res = await grade.mutateAsync(grades)
      toast.success('Grades saved', `${res.totalMarks}/${res.maxMarks} · ${res.passed ? 'Pass' : 'Fail'}`)
    } catch (e: any) {
      toast.error('Could not save', e?.response?.data?.error?.message ?? 'Please try again.')
    }
  }

  async function onReset() {
    if (!confirm('Reset this attempt? The student’s answers and proctoring log will be deleted and they can retake the exam. This cannot be undone.')) return
    try {
      await reset.mutateAsync()
      toast.success('Attempt reset', 'The student can take the exam again.')
      router.push(backHref)
    } catch (e: any) {
      toast.error('Could not reset', e?.response?.data?.error?.message ?? 'Please try again.')
    }
  }

  if (isLoading) return <div className="flex justify-center py-24"><Spinner /></div>
  if (isError || !data) {
    return (
      <div>
        <Link href={backHref} className="inline-flex items-center gap-1.5 text-sm mb-4" style={{ color: 'rgba(255,255,255,0.5)' }}>
          <ArrowLeft className="h-4 w-4" /> Back to exam
        </Link>
        <p className="text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>Attempt not found.</p>
      </div>
    )
  }

  const a = data.attempt
  const pct = a.maxMarks && a.maxMarks > 0 && a.totalMarks != null ? Math.round((a.totalMarks / a.maxMarks) * 100) : null

  return (
    <div className="pb-16">
      <Link href={backHref} className="inline-flex items-center gap-1.5 text-sm mb-4" style={{ color: 'rgba(255,255,255,0.5)' }}>
        <ArrowLeft className="h-4 w-4" /> Back to exam
      </Link>

      <PageHeader
        title={a.student.name}
        subtitle={a.student.email}
        badge={{
          label: a.status === 'suspended' ? 'Suspended' : a.status === 'submitted' ? (a.graded ? 'Graded' : 'Submitted') : 'In progress',
          color: a.status === 'suspended' ? '#ef4444' : a.status === 'submitted' ? (a.graded ? '#10b981' : '#4d9bff') : '#f59e0b',
        }}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="ghost-danger" onClick={onReset} disabled={reset.isPending}>
              <RotateCcw className="h-4 w-4" /> Reset
            </Button>
            <Button onClick={onSaveGrades} disabled={grade.isPending || a.status === 'in_progress'}>
              {grade.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save grades
            </Button>
          </div>
        }
      />

      {/* Summary */}
      <div className="grid gap-3 sm:grid-cols-4 mb-5">
        <Stat label="Score" value={a.maxMarks != null ? `${a.totalMarks ?? 0} / ${a.maxMarks}${pct != null ? ` · ${pct}%` : ''}` : '—'}
          sub={a.passed != null ? (a.passed ? 'Pass' : 'Fail') : undefined} subColor={a.passed ? '#10b981' : '#ef4444'} />
        <Stat label="Violations" value={String(a.violations)} subColor="#f59e0b" />
        <Stat label="Started" value={fmt(a.startedAt)} small />
        <Stat label="Submitted" value={fmt(a.submittedAt)} small />
      </div>

      {a.status === 'suspended' && a.suspendedReason && (
        <div className="mb-5 flex items-center gap-2 rounded-xl px-4 py-3" style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.25)' }}>
          <ShieldAlert className="h-4 w-4" style={{ color: '#ef4444' }} />
          <p className="text-sm" style={{ color: '#fca5a5' }}>{a.suspendedReason}</p>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        {/* Answers + grading */}
        <section className="rounded-2xl p-5" style={cardStyle}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-white">Answers &amp; grading</h2>
            <span className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>Pass mark {data.exam.passPercent}%</span>
          </div>
          <div className="space-y-3">
            {data.questions.map((q, i) => {
              const correct = q.autoGradable && q.correctAnswer != null && q.answer === q.correctAnswer
              return (
                <div key={q.id} className="rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-semibold text-white">
                      <span style={{ color: 'rgba(255,255,255,0.4)' }}>Q{i + 1}.</span> {q.text}
                    </p>
                    <span className="shrink-0 rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide"
                      style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.45)' }}>
                      {q.autoGradable ? 'Auto' : 'Manual'}
                    </span>
                  </div>

                  <p className="mt-2 text-sm" style={{ color: 'rgba(255,255,255,0.75)' }}>
                    <span style={{ color: 'rgba(255,255,255,0.4)' }}>Answer: </span>
                    {q.answer || <em style={{ color: 'rgba(255,255,255,0.35)' }}>— blank —</em>}
                  </p>

                  {q.autoGradable && (
                    <p className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold" style={{ color: correct ? '#10b981' : '#ef4444' }}>
                      {correct ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                      {correct ? 'Correct' : 'Incorrect'}
                      <span style={{ color: 'rgba(255,255,255,0.35)' }}>· key: {q.correctAnswer ?? '—'}</span>
                    </p>
                  )}

                  {/* Grade inputs */}
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2">
                      <label className="text-xs font-semibold" style={{ color: 'rgba(255,255,255,0.5)' }}>Marks</label>
                      <input
                        type="number" min={0} max={q.maxMarks}
                        value={marks[q.id] ?? ''}
                        onChange={e => setMarks(m => ({ ...m, [q.id]: e.target.value }))}
                        className="w-16 rounded-lg px-2 py-1 text-sm text-white outline-none"
                        style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }} />
                      <span className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>/ {q.maxMarks}</span>
                    </div>
                    <input
                      value={feedback[q.id] ?? ''}
                      onChange={e => setFeedback(f => ({ ...f, [q.id]: e.target.value }))}
                      placeholder="Feedback (optional)"
                      className="min-w-[180px] flex-1 rounded-lg px-3 py-1.5 text-sm text-white outline-none"
                      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }} />
                  </div>
                </div>
              )
            })}
          </div>
          <div className="mt-4 flex justify-end">
            <Button onClick={onSaveGrades} disabled={grade.isPending || a.status === 'in_progress'}>
              {grade.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save grades
            </Button>
          </div>
        </section>

        {/* Proctoring log */}
        <section className="rounded-2xl p-5 h-fit" style={cardStyle}>
          <div className="flex items-center gap-2 mb-4">
            <Activity className="h-4 w-4" style={{ color: 'rgba(255,255,255,0.5)' }} />
            <h2 className="text-sm font-bold text-white">Activity log <span style={{ color: 'rgba(255,255,255,0.4)' }}>· {data.logs.length}</span></h2>
          </div>
          {data.logs.length === 0 ? (
            <p className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>No proctoring events recorded.</p>
          ) : (
            <ol className="space-y-3">
              {data.logs.map((l, i) => {
                const m = EVENT_META[l.event] ?? { label: l.event, color: '#9ca3af', Icon: User }
                const Icon = m.Icon
                return (
                  <li key={i} className="flex gap-3">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ background: `${m.color}1a`, color: m.color }}>
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm text-white">{m.label}</p>
                      <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>{fmt(l.timestamp)}{l.detail ? ` · ${l.detail}` : ''}</p>
                    </div>
                  </li>
                )
              })}
            </ol>
          )}
        </section>
      </div>
    </div>
  )
}

function Stat({ label, value, sub, subColor, small }: { label: string; value: string; sub?: string; subColor?: string; small?: boolean }) {
  return (
    <div className="rounded-xl p-4" style={cardStyle}>
      <p className="text-xs font-semibold mb-1" style={{ color: 'rgba(255,255,255,0.45)' }}>{label}</p>
      <p className={`font-bold text-white ${small ? 'text-xs' : 'text-lg'}`}>{value}</p>
      {sub && <p className="text-xs font-semibold mt-0.5" style={{ color: subColor ?? 'rgba(255,255,255,0.5)' }}>{sub}</p>}
    </div>
  )
}
