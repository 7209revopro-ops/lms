'use client'

import Link from 'next/link'
import { useState } from 'react'
import { ArrowLeft, BookOpen, ChevronRight, Search } from 'lucide-react'
import { useCourses } from '@/lib/api/courses'
import { useExamList } from '@/lib/api/exams'
import { PageHeader } from '@/components/ui/PageHeader'
import Spinner from '@/components/ui/Spinner'

/* Create exam (the user, 2026-11-09): pick the course — real courses only (no programmes' "Program: …" courses), and
   none that has an exam already; the exam builder (/exams/[courseId]) opens for it. */

export default function NewExamPage() {
  const [search, setSearch] = useState('')
  const courses = useCourses({ per_page: 200, search: search || undefined, programs: 'exclude' })
  const exams = useExamList()
  const taken = new Set((exams.data ?? []).map((e) => e.courseId))
  const list = (courses.data?.docs ?? []).filter((c) => !taken.has(c.id))

  return (
    <div>
      <Link href="/exams" className="mb-3 inline-flex items-center gap-1.5 text-sm" style={{ color: 'rgba(255,255,255,0.55)' }}><ArrowLeft className="h-4 w-4" />Exams</Link>
      <PageHeader title="Create exam" subtitle="Pick the course. Courses that have an exam already aren't listed." />
      <div className="mb-5 relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: 'rgba(255,255,255,0.35)' }} />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search courses…" autoFocus
          className="w-full rounded-xl py-2.5 pl-10 pr-4 text-sm text-white outline-none"
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }} />
      </div>
      {courses.isLoading || exams.isLoading ? (
        <div className="flex justify-center py-20"><Spinner /></div>
      ) : list.length === 0 ? (
        <div className="rounded-2xl px-6 py-16 text-center" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <BookOpen className="mx-auto h-10 w-10 mb-3" style={{ color: 'rgba(255,255,255,0.25)' }} />
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>{search ? 'No course matches.' : 'Every course has an exam already.'}</p>
        </div>
      ) : (
        <div className="grid gap-2">
          {list.map((c) => (
            <Link key={c.id} href={`/exams/${c.id}`} className="flex items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm text-white transition-colors"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
              <span className="truncate font-medium">{c.title}</span>
              <ChevronRight className="h-4 w-4 shrink-0" style={{ color: 'rgba(255,255,255,0.3)' }} />
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
