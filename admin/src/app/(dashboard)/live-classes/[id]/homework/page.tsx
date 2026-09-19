'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { motion } from 'framer-motion'
import { BookOpen, Plus, Trash2, Award, ChevronDown, ChevronUp } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, api } from '@/lib/axios'
import { datetimeLocalToISO } from '@/lib/timezone'
import Spinner from '@/components/ui/Spinner'

/* ── Types ────────────────────────────────────────────── */
interface Homework {
  id:          string
  liveClassId: string
  title:       string
  description: string
  dueDate?:    string
  assignedBy:  { id: string; name: string }
  createdAt:   string
}

interface Submission {
  id:             string
  homeworkId:     { id: string; title: string }
  userId:         { id: string; name: string; email: string }
  submissionText?: string
  submissionUrl?:  string
  grade?:          number
  feedback?:       string
  gradedAt?:       string
  gradedBy?:       { id: string; name: string }
  status:          'submitted' | 'graded' | 'returned'
  createdAt:       string
}

/* ── Hooks ────────────────────────────────────────────── */
function useHomework(liveClassId: string) {
  return useQuery({
    queryKey: ['admin', 'homework', liveClassId],
    queryFn:  () => apiGet<Homework[]>(`/admin/live-classes/${liveClassId}/homework`),
    enabled:  !!liveClassId,
    staleTime: 30_000,
  })
}

function useSubmissions(liveClassId: string) {
  return useQuery({
    queryKey: ['admin', 'homework-submissions', liveClassId],
    queryFn:  () => apiGet<Submission[]>(`/admin/live-classes/${liveClassId}/homework/submissions`),
    enabled:  !!liveClassId,
    staleTime: 30_000,
  })
}

/* ── Page ─────────────────────────────────────────────── */
export default function HomeworkPage() {
  const { id } = useParams<{ id: string }>()
  const qc     = useQueryClient()

  const homework    = useHomework(id)
  const submissions = useSubmissions(id)

  const [showCreate, setShowCreate] = useState(false)
  const [title,       setTitle]       = useState('')
  const [description, setDescription] = useState('')
  const [dueDate,     setDueDate]     = useState('')

  const [grades,    setGrades]    = useState<Record<string, { grade: string; feedback: string }>>({})
  const [expanded,  setExpanded]  = useState<string | null>(null)

  const createMutation = useMutation({
    mutationFn: (body: { title: string; description: string; dueDate?: string }) =>
      api.post(`/admin/live-classes/${id}/homework`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'homework', id] })
      setShowCreate(false)
      setTitle('')
      setDescription('')
      setDueDate('')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (hwId: string) => api.delete(`/admin/homework/${hwId}`),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['admin', 'homework', id] }),
  })

  const gradeMutation = useMutation({
    mutationFn: ({ subId, grade, feedback }: { subId: string; grade: number; feedback: string }) =>
      api.patch(`/admin/homework-submissions/${subId}/grade`, { grade: Number(grade), feedback }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'homework-submissions', id] }),
  })

  const homeworkList    = Array.isArray(homework.data)    ? homework.data    : []
  const submissionList  = Array.isArray(submissions.data) ? submissions.data : []

  const inputBase = 'w-full rounded-xl border border-[#E4E7ED] bg-white px-3 py-2 text-sm outline-none focus:border-[#0057b8] focus:ring-2 focus:ring-blue-100'

  return (
    <div>
      <div className="mb-6">
        <PageHeader
          title="Session Homework"
          subtitle="Assign and grade homework for this live class"
          badge={{ label: 'Homework', color: '#0057b8' }}
        />
      </div>

      {/* Create homework */}
      <div className="mb-6">
        {!showCreate ? (
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
            style={{ background: 'linear-gradient(135deg,#0057b8,#003d80)' }}>
            <Plus size={15} />New Homework
          </button>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl bg-white p-5" style={{ border: '1px solid #E4E7ED' }}>
            <h3 className="text-sm font-bold mb-4" style={{ color: '#0D0F1A' }}>Create Homework</h3>
            <div className="space-y-3">
              <input className={inputBase} placeholder="Title *" value={title} onChange={e => setTitle(e.target.value)} />
              <textarea className={inputBase} rows={3} placeholder="Description (optional)" value={description} onChange={e => setDescription(e.target.value)} />
              <div>
                <label className="text-xs font-semibold mb-1 block" style={{ color: '#6B7280' }}>Due Date (optional)</label>
                <input type="datetime-local" className={inputBase} value={dueDate} onChange={e => setDueDate(e.target.value)} />
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  disabled={!title.trim() || createMutation.isPending}
                  /* datetimeLocalToISO, not `new Date(dueDate)`. A
                     datetime-local value is a naive wall-clock string, and
                     `new Date()` resolves it in the DEVICE zone — so a Dubai
                     deadline typed as 6:00 PM on an IST laptop was stored as
                     12:30 UTC. The list below renders through the patched
                     Intl, i.e. the academy zone, so the deadline you had just
                     typed came straight back as 4:30 PM. The helper reads the
                     digits as academy wall-clock instead, which is the same
                     clock the display uses, so the round-trip holds. */
                  onClick={() => createMutation.mutate({ title, description, dueDate: dueDate ? datetimeLocalToISO(dueDate) : undefined })}
                  className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg,#0057b8,#003d80)' }}>
                  {createMutation.isPending ? <Spinner size={14} /> : <Plus size={14} />}
                  Create
                </button>
                <button onClick={() => setShowCreate(false)}
                  className="rounded-xl border border-[#E4E7ED] px-4 py-2 text-sm" style={{ color: '#6B7280' }}>
                  Cancel
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </div>

      {/* Homework list */}
      <section className="mb-8">
        <div className="flex items-center gap-2 mb-4">
          <BookOpen size={16} style={{ color: '#0057b8' }} />
          <h2 className="text-base font-bold" style={{ color: '#0D0F1A', fontFamily: 'Bricolage Grotesque, sans-serif' }}>
            Assignments
          </h2>
          <span className="rounded-full px-2 py-0.5 text-[10px] font-bold"
            style={{ background: 'rgba(0,87,184,0.10)', color: '#0057b8' }}>
            {homeworkList.length}
          </span>
        </div>

        {homework.isLoading ? (
          <div className="flex h-20 items-center justify-center gap-2 text-sm" style={{ color: '#9CA3AF' }}>
            <Spinner size={15} /><span>Loading…</span>
          </div>
        ) : homeworkList.length === 0 ? (
          <p className="text-sm py-6 text-center" style={{ color: '#9CA3AF' }}>No homework assigned yet</p>
        ) : (
          <div className="space-y-3">
            {homeworkList.map((hw, i) => (
              <motion.div key={hw.id || (hw as any)._id}
                initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                className="rounded-2xl bg-white p-4" style={{ border: '1px solid #E4E7ED' }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold" style={{ color: '#0D0F1A' }}>{hw.title}</p>
                    {hw.description && (
                      <p className="mt-1 text-xs" style={{ color: '#6B7280' }}>{hw.description}</p>
                    )}
                    {hw.dueDate && (
                      <p className="mt-1 text-[11px]" style={{ color: '#9CA3AF' }}>
                        Due: {new Date(hw.dueDate).toLocaleString()}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => { if (confirm('Delete this homework?')) deleteMutation.mutate(hw.id) }}
                    className="rounded-xl p-1.5 transition-colors hover:bg-red-50" style={{ color: '#EF4444' }}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </section>

      {/* Submissions */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <Award size={16} style={{ color: '#0057b8' }} />
          <h2 className="text-base font-bold" style={{ color: '#0D0F1A', fontFamily: 'Bricolage Grotesque, sans-serif' }}>
            Submissions
          </h2>
          <span className="rounded-full px-2 py-0.5 text-[10px] font-bold"
            style={{ background: 'rgba(0,87,184,0.10)', color: '#0057b8' }}>
            {submissionList.length}
          </span>
        </div>

        {submissions.isLoading ? (
          <div className="flex h-20 items-center justify-center gap-2 text-sm" style={{ color: '#9CA3AF' }}>
            <Spinner size={15} /><span>Loading…</span>
          </div>
        ) : submissionList.length === 0 ? (
          <p className="text-sm py-6 text-center" style={{ color: '#9CA3AF' }}>No submissions yet</p>
        ) : (
          <div className="space-y-3">
            {submissionList.map((sub, i) => {
              const isOpen = expanded === sub.id
              const g = grades[sub.id] ?? { grade: String(sub.grade ?? ''), feedback: sub.feedback ?? '' }
              return (
                <motion.div key={sub.id || (sub as any)._id}
                  initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className="rounded-2xl bg-white overflow-hidden" style={{ border: '1px solid #E4E7ED' }}>
                  <div className="flex items-center justify-between gap-3 p-4 cursor-pointer hover:bg-gray-50"
                    onClick={() => setExpanded(isOpen ? null : sub.id)}>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold" style={{ color: '#0D0F1A' }}>{sub.userId.name}</p>
                      <p className="text-xs" style={{ color: '#9CA3AF' }}>{sub.userId.email}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                        style={{
                          background: sub.status === 'graded' ? 'rgba(16,185,129,0.10)' : 'rgba(0,87,184,0.10)',
                          color: sub.status === 'graded' ? '#10B981' : '#0057b8',
                        }}>
                        {sub.grade !== undefined ? `${sub.status} · ${sub.grade}/100` : sub.status}
                      </span>
                      {isOpen ? <ChevronUp size={14} style={{ color: '#9CA3AF' }} /> : <ChevronDown size={14} style={{ color: '#9CA3AF' }} />}
                    </div>
                  </div>

                  {isOpen && (
                    <div className="px-4 pb-4 border-t border-[#F3F4F6]">
                      {sub.submissionText && (
                        <div className="mt-3 rounded-xl bg-gray-50 p-3">
                          <p className="text-xs font-semibold mb-1" style={{ color: '#6B7280' }}>Submission</p>
                          <p className="text-sm" style={{ color: '#374151', whiteSpace: 'pre-wrap' }}>{sub.submissionText}</p>
                        </div>
                      )}
                      {sub.submissionUrl && (
                        <div className="mt-2">
                          <a href={sub.submissionUrl} target="_blank" rel="noreferrer"
                            className="text-xs font-semibold" style={{ color: '#0057b8' }}>
                            View submission &rarr;
                          </a>
                        </div>
                      )}
                      <div className="mt-4 space-y-2">
                        <p className="text-xs font-bold" style={{ color: '#0D0F1A' }}>Grade</p>
                        <input
                          type="number" min={0} max={100}
                          className="w-24 rounded-xl border border-[#E4E7ED] px-3 py-1.5 text-sm outline-none focus:border-[#0057b8]"
                          placeholder="0–100"
                          value={g.grade}
                          onChange={e => setGrades(prev => ({ ...prev, [sub.id]: { ...g, grade: e.target.value } }))}
                        />
                        <textarea
                          className="w-full rounded-xl border border-[#E4E7ED] px-3 py-2 text-sm outline-none focus:border-[#0057b8]"
                          rows={2} placeholder="Feedback (optional)"
                          value={g.feedback}
                          onChange={e => setGrades(prev => ({ ...prev, [sub.id]: { ...g, feedback: e.target.value } }))}
                        />
                        <button
                          disabled={!g.grade || gradeMutation.isPending}
                          onClick={() => gradeMutation.mutate({ subId: sub.id, grade: Number(g.grade), feedback: g.feedback })}
                          className="flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
                          style={{ background: 'linear-gradient(135deg,#0057b8,#003d80)' }}>
                          {gradeMutation.isPending ? <Spinner size={12} /> : <Award size={12} />}
                          <span>Save Grade</span>
                        </button>
                      </div>
                    </div>
                  )}
                </motion.div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
