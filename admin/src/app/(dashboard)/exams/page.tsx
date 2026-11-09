'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'
import { FileCheck2, Search, ChevronRight, Plus } from 'lucide-react'
import { useQueryState } from '@/lib/useQueryState'
import { useExamList, type ExamSummary } from '@/lib/api/exams'
import { PageHeader } from '@/components/ui/PageHeader'
import Spinner from '@/components/ui/Spinner'

/* The Exams page (the user, 2026-11-09): only the courses that have an exam, each with how its attempts stand —
   submitted, passed, failed, waiting for a grade, started and not submitted. "Create exam" picks a course on its own
   page (/exams/new). */

const FILTERS = [['all', 'All'], ['with', 'Has submissions'], ['without', 'No submissions yet'], ['grading', 'Needs grading']] as const
type FilterKey = typeof FILTERS[number][0]

function Stat({ n, label, color }: { n: number; label: string; color: string }) {
  return (
    <span className="rounded-lg px-2 py-1 text-xs" style={{ background: 'rgba(255,255,255,0.04)', color: n ? color : 'rgba(255,255,255,0.35)' }}>
      <b className="font-semibold">{n}</b> {label}
    </span>
  )
}

export default function ExamsPage() {
  const [search, setSearch] = useQueryState('q', '', { history: 'replace' })
  const [filter, setFilter] = useQueryState('show', 'all', { history: 'replace' })
  const { data, isLoading } = useExamList()
  const needle = search.trim().toLowerCase()
  const keep = (e: ExamSummary) =>
    (!needle || e.courseTitle.toLowerCase().includes(needle) || e.title.toLowerCase().includes(needle))
    && (filter === 'all' || (filter === 'with' ? e.attempts.submitted > 0 : filter === 'without' ? e.attempts.submitted === 0 : e.attempts.needsGrading > 0))
  const exams = (data ?? []).filter(keep)

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader title="Exams" subtitle="The courses with an exam, and how their students did. One exam per course." />
        <Link href="/exams/new" className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold text-white" style={{ background: '#0057b8' }}>
          <Plus className="h-4 w-4" /> Create exam
        </Link>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: 'rgba(255,255,255,0.35)' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search exams or courses…"
            className="w-full rounded-xl py-2.5 pl-10 pr-4 text-sm text-white outline-none"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }} />
        </div>
        {FILTERS.map(([k, l]) => (
          <button key={k} type="button" onClick={() => setFilter(k)} className="rounded-full px-3 py-1.5 text-xs font-medium"
            style={filter === k ? { background: '#0057b8', color: '#fff' } : { background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.65)', border: '1px solid rgba(255,255,255,0.08)' }}>
            {l}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20"><Spinner /></div>
      ) : exams.length === 0 ? (
        <div className="rounded-2xl px-6 py-16 text-center" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <FileCheck2 className="mx-auto h-10 w-10 mb-3" style={{ color: 'rgba(255,255,255,0.25)' }} />
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>{(data ?? []).length ? 'No exam matches.' : 'No exams yet.'}</p>
          <Link href="/exams/new" className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold" style={{ color: '#4d9bff' }}><Plus className="h-4 w-4" />Create the first exam</Link>
        </div>
      ) : (
        <div className="grid gap-3">
          {exams.map((e, i) => (
            <motion.div key={e.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.02, 0.3) }}>
              <Link href={`/exams/${e.courseId}`} className="flex items-center gap-4 rounded-2xl px-4 py-3.5 transition-colors group"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                <div className="flex h-10 w-10 items-center justify-center rounded-xl shrink-0" style={{ background: 'rgba(0,87,184,0.15)', color: '#4d9bff' }}>
                  <FileCheck2 className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-semibold text-white">{e.courseTitle}</p>
                    <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                      style={e.isPublished ? { background: 'rgba(16,185,129,0.15)', color: '#34d399' } : { background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.55)' }}>
                      {e.isPublished ? 'Published' : 'Draft'}
                    </span>
                  </div>
                  <p className="truncate text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>
                    {e.title} · {e.questions} question{e.questions === 1 ? '' : 's'} · {e.durationMinutes} min · pass {e.passPercent}%
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    <Stat n={e.attempts.submitted} label="submitted" color="#93c5fd" />
                    <Stat n={e.attempts.passed} label="passed" color="#34d399" />
                    <Stat n={e.attempts.failed} label="failed" color="#f87171" />
                    <Stat n={e.attempts.needsGrading} label="to grade" color="#fbbf24" />
                    <Stat n={e.attempts.inProgress + e.attempts.suspended} label="started, not submitted" color="#c4b5fd" />
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5" style={{ color: 'rgba(255,255,255,0.3)' }} />
              </Link>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  )
}
