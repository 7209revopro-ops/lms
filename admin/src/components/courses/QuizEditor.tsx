'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Trash2, Save, ChevronDown, ChevronUp, GripVertical, Check, AlertTriangle } from 'lucide-react'
import {
  useAdminQuiz, useUpsertQuiz, useDeleteQuiz,
  type QuizQuestionDraft, type QuestionType,
} from '@/lib/api/outline'
import { useToast } from '@/store/ui.store'
import Spinner from '@/components/ui/Spinner'

/* ─── Empty question factory ─────────────────────── */
function emptyQuestion(type: QuestionType = 'mcq'): QuizQuestionDraft {
  return {
    text:          '',
    type,
    choices:       type === 'mcq' ? ['', '', '', ''] : type === 'true_false' ? ['True', 'False'] : [],
    correctAnswer: type === 'true_false' ? '0' : '',
    points:        1,
  }
}

interface Props {
  lessonId: string
  onClose:  () => void
}

export function QuizEditor({ lessonId, onClose }: Props) {
  const { data: existing, isLoading } = useAdminQuiz(lessonId)
  const upsert  = useUpsertQuiz(lessonId)
  const delQuiz = useDeleteQuiz(lessonId)
  const toast   = useToast()

  const [passPercent, setPassPercent] = useState<number>(() => existing?.passPercent ?? 70)
  const [timeLimit,   setTimeLimit]   = useState<string>(() => existing?.timeLimit ? String(existing.timeLimit) : '')
  const [questions,   setQuestions]   = useState<QuizQuestionDraft[]>(() =>
    existing?.questions?.map(q => ({
      text:          q.text,
      type:          q.type,
      choices:       q.choices,
      correctAnswer: q.correctAnswer,
      points:        q.points,
      explanation:   q.explanation,
    })) ?? [emptyQuestion()]
  )

  /* Sync once data arrives (first render is before fetch completes) */
  const [synced, setSynced] = useState(false)
  if (!isLoading && !synced && existing) {
    setPassPercent(existing.passPercent)
    setTimeLimit(existing.timeLimit ? String(existing.timeLimit) : '')
    setQuestions(existing.questions.map(q => ({
      text: q.text, type: q.type, choices: q.choices,
      correctAnswer: q.correctAnswer, points: q.points, explanation: q.explanation,
    })))
    setSynced(true)
  }

  const [expandedIdx, setExpandedIdx] = useState<number>(0)

  function addQuestion(type: QuestionType = 'mcq') {
    setQuestions(prev => [...prev, emptyQuestion(type)])
    setExpandedIdx(questions.length)
  }

  function removeQuestion(i: number) {
    setQuestions(prev => prev.filter((_, idx) => idx !== i))
    if (expandedIdx >= questions.length - 1) setExpandedIdx(Math.max(0, expandedIdx - 1))
  }

  function updateQ(i: number, patch: Partial<QuizQuestionDraft>) {
    setQuestions(prev => prev.map((q, idx) => idx === i ? { ...q, ...patch } : q))
  }

  function moveQuestion(i: number, dir: -1 | 1) {
    const j = i + dir
    if (j < 0 || j >= questions.length) return
    setQuestions(prev => {
      const next = [...prev]
      ;[next[i], next[j]] = [next[j]!, next[i]!]
      return next
    })
    setExpandedIdx(j)
  }

  async function handleSave() {
    const invalid = questions.findIndex(q => !q.text.trim())
    if (invalid !== -1) {
      setExpandedIdx(invalid)
      toast.error('Empty question', `Question ${invalid + 1} has no text`)
      return
    }
    try {
      await upsert.mutateAsync({
        passPercent,
        timeLimit: timeLimit ? parseInt(timeLimit, 10) : undefined,
        questions,
      })
      toast.success('Quiz saved', `${questions.length} question${questions.length !== 1 ? 's' : ''}`)
      onClose()
    } catch (err: any) {
      toast.error('Save failed', err?.response?.data?.error?.message)
    }
  }

  async function handleDelete() {
    if (!existing) { onClose(); return }
    try {
      await delQuiz.mutateAsync()
      toast.success('Quiz deleted')
      onClose()
    } catch (err: any) {
      toast.error('Delete failed', err?.response?.data?.error?.message)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm" style={{ color: 'rgba(255,255,255,0.45)' }}>
        <Spinner size={14} />Loading quiz…
      </div>
    )
  }

  return (
    <div className="space-y-4 rounded-2xl p-4" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)' }}>

      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-white">Quiz Editor</h3>
        <div className="flex items-center gap-2">
          {existing && (
            <button onClick={handleDelete} disabled={delQuiz.isPending}
              className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors hover:bg-red-500/10"
              style={{ color: '#EF4444', border: '1px solid rgba(239,68,68,0.2)' }}>
              <Trash2 size={12} />Delete quiz
            </button>
          )}
          <button onClick={onClose}
            className="rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors hover:bg-white/[0.08]"
            style={{ color: 'rgba(255,255,255,0.5)', border: '1px solid rgba(255,255,255,0.08)' }}>
            Cancel
          </button>
          <button onClick={handleSave} disabled={upsert.isPending}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold text-white transition-all disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg, #0057b8, #003d80)' }}>
            {upsert.isPending ? <Spinner size={12} /> : <Save size={12} />}
            Save quiz
          </button>
        </div>
      </div>

      {/* Settings row */}
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.4)' }}>
            Pass threshold (%)
          </span>
          <input
            type="number" min={0} max={100} value={passPercent}
            onChange={e => setPassPercent(Number(e.target.value))}
            className="w-full rounded-xl px-3 py-2 text-sm text-white outline-none transition-colors focus:ring-1"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}
          />
        </label>
        <label className="space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.4)' }}>
            Time limit (mins, optional)
          </span>
          <input
            type="number" min={1} placeholder="No limit" value={timeLimit}
            onChange={e => setTimeLimit(e.target.value)}
            className="w-full rounded-xl px-3 py-2 text-sm text-white outline-none transition-colors focus:ring-1"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}
          />
        </label>
      </div>

      {/* Questions list */}
      <div className="space-y-2">
        {questions.map((q, i) => (
          <QuestionCard
            key={i}
            index={i}
            total={questions.length}
            question={q}
            expanded={expandedIdx === i}
            onToggle={() => setExpandedIdx(prev => prev === i ? -1 : i)}
            onUpdate={patch => updateQ(i, patch)}
            onRemove={() => removeQuestion(i)}
            onMoveUp={() => moveQuestion(i, -1)}
            onMoveDown={() => moveQuestion(i, 1)}
          />
        ))}
      </div>

      {/* Add question buttons */}
      <div className="flex items-center gap-2 pt-1">
        <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.3)' }}>Add:</span>
        {(['mcq', 'true_false', 'short'] as QuestionType[]).map(t => (
          <button key={t} onClick={() => addQuestion(t)}
            className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors hover:bg-white/[0.08]"
            style={{ color: 'rgba(255,255,255,0.5)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <Plus size={10} />
            {t === 'mcq' ? 'Multiple choice' : t === 'true_false' ? 'True/False' : 'Short answer'}
          </button>
        ))}
      </div>
    </div>
  )
}

/* ─── Question card ───────────────────────────────── */
interface QProps {
  index:    number
  total:    number
  question: QuizQuestionDraft
  expanded: boolean
  onToggle: () => void
  onUpdate: (patch: Partial<QuizQuestionDraft>) => void
  onRemove: () => void
  onMoveUp:   () => void
  onMoveDown: () => void
}

function QuestionCard({ index, total, question: q, expanded, onToggle, onUpdate, onRemove, onMoveUp, onMoveDown }: QProps) {
  const isEmpty = !q.text.trim()

  return (
    <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${isEmpty && expanded ? 'rgba(239,68,68,0.3)' : 'rgba(255,255,255,0.07)'}` }}>
      {/* Row header */}
      <div className="flex items-center gap-2 px-3 py-2.5"
        style={{ background: expanded ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.02)', cursor: 'pointer' }}
        onClick={onToggle}>
        <GripVertical size={12} style={{ color: 'rgba(255,255,255,0.2)' }} />
        <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
          style={{ background: 'rgba(0,87,184,0.15)', color: '#0057b8' }}>
          {index + 1}
        </span>
        <span className="flex-1 truncate text-xs" style={{ color: q.text ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.3)' }}>
          {q.text || `Question ${index + 1} — ${q.type}`}
        </span>
        {isEmpty && <AlertTriangle size={11} style={{ color: '#EF4444' }} />}
        <div className="flex items-center gap-0.5" onClick={e => e.stopPropagation()}>
          <button onClick={onMoveUp} disabled={index === 0}
            className="rounded p-0.5 transition-colors hover:bg-white/[0.08] disabled:opacity-20"
            style={{ color: 'rgba(255,255,255,0.4)' }}><ChevronUp size={12} /></button>
          <button onClick={onMoveDown} disabled={index === total - 1}
            className="rounded p-0.5 transition-colors hover:bg-white/[0.08] disabled:opacity-20"
            style={{ color: 'rgba(255,255,255,0.4)' }}><ChevronDown size={12} /></button>
          <button onClick={onRemove} className="rounded p-0.5 transition-colors hover:bg-red-500/10"
            style={{ color: 'rgba(239,68,68,0.5)' }}><Trash2 size={12} /></button>
        </div>
        {expanded ? <ChevronUp size={12} style={{ color: 'rgba(255,255,255,0.3)' }} /> : <ChevronDown size={12} style={{ color: 'rgba(255,255,255,0.3)' }} />}
      </div>

      {/* Expanded body */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }}
            className="overflow-hidden">
            <div className="space-y-3 border-t p-3" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>

              {/* Question text */}
              <label className="block space-y-1">
                <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.4)' }}>Question</span>
                <textarea rows={2} value={q.text}
                  onChange={e => onUpdate({ text: e.target.value })}
                  placeholder="Enter question text…"
                  className="w-full resize-none rounded-xl px-3 py-2 text-sm text-white outline-none"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}
                />
              </label>

              {/* Choices — MCQ */}
              {q.type === 'mcq' && (
                <div className="space-y-2">
                  <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.4)' }}>
                    Choices (click radio to mark correct)
                  </span>
                  {q.choices.map((c, ci) => (
                    <div key={ci} className="flex items-center gap-2">
                      <button
                        onClick={() => onUpdate({ correctAnswer: String(ci) })}
                        className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full transition-all"
                        style={{
                          background: q.correctAnswer === String(ci) ? '#22C55E' : 'transparent',
                          border: `2px solid ${q.correctAnswer === String(ci) ? '#22C55E' : 'rgba(255,255,255,0.2)'}`,
                        }}>
                        {q.correctAnswer === String(ci) && <Check size={9} className="text-white" />}
                      </button>
                      <input value={c}
                        onChange={e => {
                          const choices = [...q.choices]
                          choices[ci] = e.target.value
                          onUpdate({ choices })
                        }}
                        placeholder={`Choice ${ci + 1}`}
                        className="flex-1 rounded-xl px-3 py-1.5 text-sm text-white outline-none"
                        style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
                      />
                    </div>
                  ))}
                  <button onClick={() => onUpdate({ choices: [...q.choices, ''] })}
                    className="flex items-center gap-1 text-[11px] transition-opacity hover:opacity-70"
                    style={{ color: '#0057b8' }}>
                    <Plus size={10} />Add choice
                  </button>
                </div>
              )}

              {/* True/False */}
              {q.type === 'true_false' && (
                <div className="flex items-center gap-3">
                  <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.4)' }}>Correct:</span>
                  {[['0', 'True'], ['1', 'False']].map(([val, label]) => (
                    <button key={val} onClick={() => onUpdate({ correctAnswer: val })}
                      className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors"
                      style={q.correctAnswer === val
                        ? { background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.4)', color: '#22C55E' }
                        : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.5)' }}>
                      {q.correctAnswer === val && <Check size={10} />}
                      {label}
                    </button>
                  ))}
                </div>
              )}

              {/* Short answer */}
              {q.type === 'short' && (
                <label className="block space-y-1">
                  <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.4)' }}>Expected answer (case-insensitive match)</span>
                  <input value={q.correctAnswer}
                    onChange={e => onUpdate({ correctAnswer: e.target.value })}
                    placeholder="Expected answer…"
                    className="w-full rounded-xl px-3 py-1.5 text-sm text-white outline-none"
                    style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}
                  />
                </label>
              )}

              {/* Points + explanation row */}
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1">
                  <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.4)' }}>Points</span>
                  <input type="number" min={1} value={q.points}
                    onChange={e => onUpdate({ points: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                    className="w-full rounded-xl px-3 py-1.5 text-sm text-white outline-none"
                    style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.4)' }}>Explanation (optional)</span>
                  <input value={q.explanation ?? ''}
                    onChange={e => onUpdate({ explanation: e.target.value })}
                    placeholder="Shown after submission…"
                    className="w-full rounded-xl px-3 py-1.5 text-sm text-white outline-none"
                    style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}
                  />
                </label>
              </div>

            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
