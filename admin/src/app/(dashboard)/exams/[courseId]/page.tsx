'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft, Plus, Trash2, GripVertical, Save, ShieldAlert,
  ChevronUp, ChevronDown, Users, Loader2,
} from 'lucide-react'
import {
  useCourseExam, useSaveExam, useDeleteExam, useExamAttempts,
  type ExamQuestion, type ExamQuestionType, type ExamUpsertPayload, type ExamAntiCheat,
} from '@/lib/api/exams'
import { useCourse } from '@/lib/api/courses'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/button'
import Spinner from '@/components/ui/Spinner'
import { useToast } from '@/store/ui.store'
import { datetimeLocalToISO, isoToDatetimeLocal } from '@/lib/timezone'

/* ── Local editor state ─────────────────────────────
   A question with a stable client key so React keeps inputs focused while the
   list is reordered / filtered. `id` (when present) is the server _id we send
   back so saved student answers keep pointing at the right question. */
type EditQuestion = ExamQuestion & { _key: string }

let keySeq = 0
const newKey = () => `q_${Date.now()}_${keySeq++}`

const TYPE_LABEL: Record<ExamQuestionType, string> = {
  mcq:        'Multiple choice',
  true_false: 'True / False',
  short:      'Short answer',
  essay:      'Essay',
}

function blankQuestion(order: number): EditQuestion {
  return { _key: newKey(), text: '', type: 'mcq', choices: ['', ''], correctAnswer: '', order, maxMarks: 1 }
}

const DEFAULT_ANTICHEAT: ExamAntiCheat = {
  blockCopyPaste: true, blockRightClick: true, screenshotSuspend: true, tabSwitchSuspend: true,
}

/* Small dark-theme field wrappers */
const inputCls = 'w-full rounded-lg px-3 py-2 text-sm text-white outline-none'
const inputStyle = { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' } as const
const cardStyle = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' } as const
const labelCls = 'block text-xs font-semibold mb-1.5'
const labelStyle = { color: 'rgba(255,255,255,0.55)' } as const

export default function ExamBuilderPage() {
  const params = useParams()
  const courseId = String(params?.courseId ?? '')
  const toast = useToast()

  const { data: course } = useCourse(courseId)
  const { data: exam, isLoading } = useCourseExam(courseId)
  const save = useSaveExam(courseId)
  const del = useDeleteExam(courseId)
  const { data: attempts } = useExamAttempts(exam?.id)

  /* Form state */
  const [title, setTitle] = useState('')
  const [instructions, setInstructions] = useState('')
  const [durationMinutes, setDuration] = useState(70)
  const [passPercent, setPassPercent] = useState(50)
  const [maxViolations, setMaxViolations] = useState(4)
  const [availableFrom, setFrom] = useState('')   // datetime-local wall clock
  const [availableTo, setTo] = useState('')
  const [antiCheat, setAntiCheat] = useState<ExamAntiCheat>(DEFAULT_ANTICHEAT)
  const [isPublished, setPublished] = useState(false)
  const [questions, setQuestions] = useState<EditQuestion[]>([blankQuestion(0)])

  /* Hydrate from the server once the exam loads */
  useEffect(() => {
    if (!exam) return
    setTitle(exam.title)
    setInstructions(exam.instructions ?? '')
    setDuration(exam.durationMinutes)
    setPassPercent(exam.passPercent)
    setMaxViolations(exam.maxViolations)
    setFrom(exam.availableFrom ? isoToDatetimeLocal(exam.availableFrom) : '')
    setTo(exam.availableTo ? isoToDatetimeLocal(exam.availableTo) : '')
    setAntiCheat({ ...DEFAULT_ANTICHEAT, ...exam.antiCheat })
    setPublished(exam.isPublished)
    setQuestions(
      [...exam.questions]
        .sort((a, b) => a.order - b.order)
        .map(q => ({ ...q, _key: newKey(), choices: q.choices ?? [] })),
    )
  }, [exam])

  const totalMarks = useMemo(
    () => questions.reduce((s, q) => s + (Number(q.maxMarks) || 0), 0),
    [questions],
  )

  /* ── Question mutations ── */
  function patchQ(key: string, patch: Partial<EditQuestion>) {
    setQuestions(qs => qs.map(q => (q._key === key ? { ...q, ...patch } : q)))
  }
  function changeType(key: string, type: ExamQuestionType) {
    setQuestions(qs => qs.map(q => {
      if (q._key !== key) return q
      const next: EditQuestion = { ...q, type }
      if (type === 'mcq') { next.choices = q.choices.length >= 2 ? q.choices : ['', '']; }
      else if (type === 'true_false') { next.choices = ['True', 'False']; next.correctAnswer = q.correctAnswer === 'False' ? 'False' : 'True' }
      else { next.choices = []; next.correctAnswer = undefined }
      return next
    }))
  }
  function addQuestion() {
    setQuestions(qs => [...qs, blankQuestion(qs.length)])
  }
  function removeQuestion(key: string) {
    setQuestions(qs => qs.filter(q => q._key !== key).map((q, i) => ({ ...q, order: i })))
  }
  function move(key: string, dir: -1 | 1) {
    setQuestions(qs => {
      const idx = qs.findIndex(q => q._key === key)
      const j = idx + dir
      if (idx < 0 || j < 0 || j >= qs.length) return qs
      const copy = [...qs]
      ;[copy[idx], copy[j]] = [copy[j], copy[idx]]
      return copy.map((q, i) => ({ ...q, order: i }))
    })
  }
  function setChoice(key: string, ci: number, val: string) {
    setQuestions(qs => qs.map(q => {
      if (q._key !== key) return q
      const choices = [...q.choices]
      const prev = choices[ci]
      choices[ci] = val
      // keep correctAnswer pointing at the same option if it was this text
      const correctAnswer = q.correctAnswer === prev ? val : q.correctAnswer
      return { ...q, choices, correctAnswer }
    }))
  }
  function addChoice(key: string) {
    setQuestions(qs => qs.map(q => (q._key === key ? { ...q, choices: [...q.choices, ''] } : q)))
  }
  function removeChoice(key: string, ci: number) {
    setQuestions(qs => qs.map(q => {
      if (q._key !== key) return q
      const removed = q.choices[ci]
      const choices = q.choices.filter((_, i) => i !== ci)
      return { ...q, choices, correctAnswer: q.correctAnswer === removed ? '' : q.correctAnswer }
    }))
  }

  /* ── Client-side validation mirroring the backend ── */
  function validate(): string | null {
    if (!title.trim()) return 'Give the exam a title.'
    if (!questions.length) return 'Add at least one question.'
    for (const [i, q] of questions.entries()) {
      const where = `Question ${i + 1}`
      if (!q.text.trim()) return `${where}: write the question text.`
      if ((Number(q.maxMarks) || 0) < 0) return `${where}: marks cannot be negative.`
      if (q.type === 'mcq') {
        const choices = q.choices.map(c => c.trim()).filter(Boolean)
        if (choices.length < 2) return `${where}: add at least two choices.`
        if (!q.correctAnswer || !choices.includes(q.correctAnswer.trim())) return `${where}: mark which choice is correct.`
      }
      if (q.type === 'true_false' && q.correctAnswer !== 'True' && q.correctAnswer !== 'False') {
        return `${where}: choose True or False as the answer.`
      }
    }
    if (availableFrom && availableTo && new Date(datetimeLocalToISO(availableFrom)) >= new Date(datetimeLocalToISO(availableTo))) {
      return 'The exam must open before it closes.'
    }
    return null
  }

  async function onSave() {
    const err = validate()
    if (err) { toast.error('Check the exam', err); return }

    const payload: ExamUpsertPayload = {
      title: title.trim(),
      instructions: instructions.trim() || undefined,
      durationMinutes: Number(durationMinutes),
      passPercent: Number(passPercent),
      maxViolations: Number(maxViolations),
      availableFrom: availableFrom ? datetimeLocalToISO(availableFrom) : null,
      availableTo: availableTo ? datetimeLocalToISO(availableTo) : null,
      antiCheat,
      isPublished,
      questions: questions.map((q, i) => ({
        ...(q.id ? { id: q.id } : {}),
        text: q.text.trim(),
        type: q.type,
        choices: q.type === 'mcq' ? q.choices.map(c => c.trim()).filter(Boolean)
               : q.type === 'true_false' ? ['True', 'False'] : [],
        ...(q.type === 'mcq' || q.type === 'true_false' ? { correctAnswer: q.correctAnswer } : {}),
        order: i,
        maxMarks: Number(q.maxMarks) || 0,
        ...(q.explanation?.trim() ? { explanation: q.explanation.trim() } : {}),
      })),
    }

    try {
      await save.mutateAsync(payload)
      toast.success('Exam saved', isPublished ? 'It is published and visible to enrolled students.' : 'Saved as a draft (not yet published).')
    } catch (e: any) {
      toast.error('Could not save', e?.response?.data?.error?.message ?? 'Please try again.')
    }
  }

  async function onDelete() {
    if (!exam) return
    if (!confirm('Delete this exam? All student attempts and proctoring logs for it will also be removed. This cannot be undone.')) return
    try {
      await del.mutateAsync()
      toast.success('Exam deleted')
    } catch (e: any) {
      toast.error('Could not delete', e?.response?.data?.error?.message ?? 'Please try again.')
    }
  }

  if (isLoading) return <div className="flex justify-center py-24"><Spinner /></div>

  return (
    <div className="pb-16">
      <Link href="/exams" className="inline-flex items-center gap-1.5 text-sm mb-4" style={{ color: 'rgba(255,255,255,0.5)' }}>
        <ArrowLeft className="h-4 w-4" /> All exams
      </Link>

      <PageHeader
        title={course?.title ? `Exam · ${course.title}` : 'Exam'}
        subtitle={exam ? 'Editing the existing exam for this course.' : 'No exam yet — build one below.'}
        badge={exam ? { label: exam.isPublished ? 'Published' : 'Draft', color: exam.isPublished ? '#10b981' : '#f59e0b' } : undefined}
        actions={
          <div className="flex items-center gap-2">
            {exam && (
              <Button variant="ghost-danger" onClick={onDelete} disabled={del.isPending}>
                <Trash2 className="h-4 w-4" /> Delete
              </Button>
            )}
            <Button onClick={onSave} disabled={save.isPending}>
              {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {exam ? 'Save changes' : 'Create exam'}
            </Button>
          </div>
        }
      />

      {/* ── Settings ── */}
      <section className="rounded-2xl p-5 mb-5" style={cardStyle}>
        <h2 className="text-sm font-bold text-white mb-4">Settings</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={labelCls} style={labelStyle}>Title</label>
            <input className={inputCls} style={inputStyle} value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Final Assessment" />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls} style={labelStyle}>Instructions (shown before the exam)</label>
            <textarea className={inputCls} style={inputStyle} rows={3} value={instructions} onChange={e => setInstructions(e.target.value)} placeholder="Rules, what to expect…" />
          </div>
          <div>
            <label className={labelCls} style={labelStyle}>Duration (minutes)</label>
            <input type="number" min={1} className={inputCls} style={inputStyle} value={durationMinutes} onChange={e => setDuration(Number(e.target.value))} />
          </div>
          <div>
            <label className={labelCls} style={labelStyle}>Pass mark (%)</label>
            <input type="number" min={0} max={100} className={inputCls} style={inputStyle} value={passPercent} onChange={e => setPassPercent(Number(e.target.value))} />
          </div>
          <div>
            <label className={labelCls} style={labelStyle}>Opens (optional)</label>
            <input type="datetime-local" className={inputCls} style={inputStyle} value={availableFrom} onChange={e => setFrom(e.target.value)} />
          </div>
          <div>
            <label className={labelCls} style={labelStyle}>Closes (optional)</label>
            <input type="datetime-local" className={inputCls} style={inputStyle} value={availableTo} onChange={e => setTo(e.target.value)} />
          </div>
        </div>

        <label className="flex items-center gap-2.5 mt-5 cursor-pointer select-none">
          <input type="checkbox" checked={isPublished} onChange={e => setPublished(e.target.checked)} className="h-4 w-4 accent-[#0057b8]" />
          <span className="text-sm text-white">Published <span style={{ color: 'rgba(255,255,255,0.4)' }}>— enrolled students can take it</span></span>
        </label>
      </section>

      {/* ── Anti-cheat ── */}
      <section className="rounded-2xl p-5 mb-5" style={cardStyle}>
        <div className="flex items-center gap-2 mb-4">
          <ShieldAlert className="h-4 w-4" style={{ color: '#f59e0b' }} />
          <h2 className="text-sm font-bold text-white">Proctoring</h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Toggle label="Block copy / paste" checked={antiCheat.blockCopyPaste} onChange={v => setAntiCheat(a => ({ ...a, blockCopyPaste: v }))} />
          <Toggle label="Block right-click" checked={antiCheat.blockRightClick} onChange={v => setAntiCheat(a => ({ ...a, blockRightClick: v }))} />
          <Toggle label="Suspend on screenshot attempt" checked={antiCheat.screenshotSuspend} onChange={v => setAntiCheat(a => ({ ...a, screenshotSuspend: v }))} />
          <Toggle label="Suspend after too many tab-switches" checked={antiCheat.tabSwitchSuspend} onChange={v => setAntiCheat(a => ({ ...a, tabSwitchSuspend: v }))} />
        </div>
        {antiCheat.tabSwitchSuspend && (
          <div className="mt-4 max-w-xs">
            <label className={labelCls} style={labelStyle}>Auto-suspend after this many tab-switches</label>
            <input type="number" min={1} className={inputCls} style={inputStyle} value={maxViolations} onChange={e => setMaxViolations(Number(e.target.value))} />
          </div>
        )}
      </section>

      {/* ── Questions ── */}
      <section className="mb-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-white">
            Questions <span style={{ color: 'rgba(255,255,255,0.4)' }}>· {questions.length} · {totalMarks} marks</span>
          </h2>
          <Button variant="outline-primary" size="sm" onClick={addQuestion}><Plus className="h-4 w-4" /> Add question</Button>
        </div>

        <div className="grid gap-3">
          {questions.map((q, i) => (
            <div key={q._key} className="rounded-2xl p-4" style={cardStyle}>
              <div className="flex items-start gap-3">
                <div className="flex flex-col items-center pt-1">
                  <button onClick={() => move(q._key, -1)} disabled={i === 0} className="disabled:opacity-20" style={{ color: 'rgba(255,255,255,0.5)' }}><ChevronUp className="h-4 w-4" /></button>
                  <GripVertical className="h-4 w-4 my-0.5" style={{ color: 'rgba(255,255,255,0.2)' }} />
                  <button onClick={() => move(q._key, 1)} disabled={i === questions.length - 1} className="disabled:opacity-20" style={{ color: 'rgba(255,255,255,0.5)' }}><ChevronDown className="h-4 w-4" /></button>
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-bold" style={{ color: 'rgba(255,255,255,0.4)' }}>Q{i + 1}</span>
                    <select
                      value={q.type}
                      onChange={e => changeType(q._key, e.target.value as ExamQuestionType)}
                      className="rounded-lg px-2 py-1 text-xs text-white outline-none"
                      style={inputStyle}>
                      {(Object.keys(TYPE_LABEL) as ExamQuestionType[]).map(t => (
                        <option key={t} value={t} style={{ background: '#0D0F1A' }}>{TYPE_LABEL[t]}</option>
                      ))}
                    </select>
                    <div className="ml-auto flex items-center gap-2">
                      <label className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>Marks</label>
                      <input type="number" min={0} value={q.maxMarks} onChange={e => patchQ(q._key, { maxMarks: Number(e.target.value) })}
                        className="w-16 rounded-lg px-2 py-1 text-xs text-white outline-none" style={inputStyle} />
                      <button onClick={() => removeQuestion(q._key)} className="ml-1" style={{ color: '#ef4444' }}><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </div>

                  <textarea className={inputCls} style={inputStyle} rows={2} value={q.text} onChange={e => patchQ(q._key, { text: e.target.value })} placeholder="Question text…" />

                  {q.type === 'mcq' && (
                    <div className="mt-3 grid gap-2">
                      {q.choices.map((choice, ci) => (
                        <div key={ci} className="flex items-center gap-2">
                          <input
                            type="radio"
                            name={`correct_${q._key}`}
                            checked={!!choice && q.correctAnswer === choice}
                            onChange={() => patchQ(q._key, { correctAnswer: choice })}
                            className="h-4 w-4 accent-[#10b981] shrink-0"
                            title="Mark as correct answer"
                          />
                          <input className={inputCls} style={inputStyle} value={choice} onChange={e => setChoice(q._key, ci, e.target.value)} placeholder={`Choice ${ci + 1}`} />
                          <button onClick={() => removeChoice(q._key, ci)} disabled={q.choices.length <= 2} className="disabled:opacity-20 shrink-0" style={{ color: 'rgba(255,255,255,0.4)' }}><Trash2 className="h-4 w-4" /></button>
                        </div>
                      ))}
                      <button onClick={() => addChoice(q._key)} className="text-xs font-semibold text-left" style={{ color: '#4d9bff' }}>+ Add choice</button>
                      <p className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>Select the radio next to the correct choice.</p>
                    </div>
                  )}

                  {q.type === 'true_false' && (
                    <div className="mt-3 flex gap-4">
                      {(['True', 'False'] as const).map(v => (
                        <label key={v} className="flex items-center gap-2 text-sm text-white cursor-pointer">
                          <input type="radio" name={`tf_${q._key}`} checked={q.correctAnswer === v} onChange={() => patchQ(q._key, { correctAnswer: v })} className="h-4 w-4 accent-[#10b981]" />
                          {v}
                        </label>
                      ))}
                    </div>
                  )}

                  {(q.type === 'short' || q.type === 'essay') && (
                    <p className="mt-2 text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>Graded manually after submission.</p>
                  )}

                  <input className={`${inputCls} mt-3`} style={inputStyle} value={q.explanation ?? ''} onChange={e => patchQ(q._key, { explanation: e.target.value })} placeholder="Explanation shown after grading (optional)" />
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-3">
          <Button variant="outline-primary" size="sm" onClick={addQuestion}><Plus className="h-4 w-4" /> Add question</Button>
        </div>
      </section>

      {/* ── Attempts (read-only in this phase; grading comes later) ── */}
      {exam && (
        <section className="rounded-2xl p-5" style={cardStyle}>
          <div className="flex items-center gap-2 mb-4">
            <Users className="h-4 w-4" style={{ color: 'rgba(255,255,255,0.5)' }} />
            <h2 className="text-sm font-bold text-white">Attempts <span style={{ color: 'rgba(255,255,255,0.4)' }}>· {attempts?.length ?? 0}</span></h2>
          </div>
          {!attempts || attempts.length === 0 ? (
            <p className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>No student has started this exam yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ color: 'rgba(255,255,255,0.4)' }} className="text-left text-xs">
                    <th className="py-2 pr-4 font-semibold">Student</th>
                    <th className="py-2 pr-4 font-semibold">Status</th>
                    <th className="py-2 pr-4 font-semibold">Score</th>
                    <th className="py-2 pr-4 font-semibold">Violations</th>
                    <th className="py-2 font-semibold"></th>
                  </tr>
                </thead>
                <tbody>
                  {attempts.map(a => (
                    <tr key={a.attemptId} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                      <td className="py-2.5 pr-4">
                        <div className="text-white">{a.student.name}</div>
                        <div className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>{a.student.email}</div>
                      </td>
                      <td className="py-2.5 pr-4"><StatusPill status={a.status} graded={a.graded} /></td>
                      <td className="py-2.5 pr-4 text-white">
                        {a.maxMarks != null ? `${a.totalMarks ?? 0} / ${a.maxMarks}` : '—'}
                        {a.passed != null && <span className="ml-1.5 text-xs" style={{ color: a.passed ? '#10b981' : '#ef4444' }}>{a.passed ? 'Pass' : 'Fail'}</span>}
                      </td>
                      <td className="py-2.5 pr-4 text-white">{a.violations}</td>
                      <td className="py-2.5 text-right">
                        <Link href={`/exams/${courseId}/attempts/${a.attemptId}`} className="text-xs font-semibold" style={{ color: '#4d9bff' }}>
                          View
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2.5 cursor-pointer select-none rounded-lg px-3 py-2.5" style={cardStyle}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="h-4 w-4 accent-[#0057b8]" />
      <span className="text-sm text-white">{label}</span>
    </label>
  )
}

function StatusPill({ status, graded }: { status: string; graded: boolean }) {
  const map: Record<string, { label: string; color: string }> = {
    in_progress: { label: 'In progress', color: '#f59e0b' },
    submitted:   { label: graded ? 'Graded' : 'Submitted', color: graded ? '#10b981' : '#4d9bff' },
    suspended:   { label: 'Suspended', color: '#ef4444' },
  }
  const s = map[status] ?? { label: status, color: '#9ca3af' }
  return (
    <span className="rounded-md px-2 py-0.5 text-xs font-semibold" style={{ background: `${s.color}1a`, color: s.color }}>{s.label}</span>
  )
}
