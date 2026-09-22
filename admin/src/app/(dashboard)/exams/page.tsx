'use client'

import { useState } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { FileCheck2, Search, ChevronRight, BookOpen } from 'lucide-react'
import { useCourses } from '@/lib/api/courses'
import { PageHeader } from '@/components/ui/PageHeader'
import Spinner from '@/components/ui/Spinner'

export default function ExamsPage() {
  const [search, setSearch] = useState('')
  const { data, isLoading } = useCourses({ per_page: 100, search: search || undefined })
  const courses = data?.docs ?? []

  return (
    <div>
      <PageHeader
        title="Exams"
        subtitle="Build a timed, proctored exam for any course. One exam per course."
      />

      <div className="mb-5 relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: 'rgba(255,255,255,0.35)' }} />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search courses…"
          className="w-full rounded-xl py-2.5 pl-10 pr-4 text-sm text-white outline-none"
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
        />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20"><Spinner /></div>
      ) : courses.length === 0 ? (
        <div className="rounded-2xl px-6 py-16 text-center" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <BookOpen className="mx-auto h-10 w-10 mb-3" style={{ color: 'rgba(255,255,255,0.25)' }} />
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>No courses found.</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {courses.map((c, i) => (
            <motion.div
              key={c.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.02, 0.3) }}>
              <Link
                href={`/exams/${c.id}`}
                className="flex items-center gap-4 rounded-2xl px-4 py-3.5 transition-colors group"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                <div className="flex h-10 w-10 items-center justify-center rounded-xl shrink-0"
                  style={{ background: 'rgba(0,87,184,0.15)', color: '#4d9bff' }}>
                  <FileCheck2 className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-white">{c.title}</p>
                  <p className="truncate text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
                    {c.category?.name ?? 'Course'} · Manage exam
                  </p>
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
