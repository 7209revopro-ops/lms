'use client'

import { motion } from 'framer-motion'
import Link from 'next/link'
import { Crown, Star, Users, BookOpen, ArrowUpRight } from 'lucide-react'
import { useTopCourses } from '@/lib/api/stats'
import Spinner from '@/components/ui/Spinner'

export function TopCoursesWidget() {
  const { data, isLoading } = useTopCourses(5)
  const max = Math.max(1, ...(data?.map(c => c.enrolledCount) ?? []))

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl p-5"
      style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)' }}>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-1.5">
            <Crown size={13} style={{ color: '#F59E0B' }} />
            <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: '#F59E0B' }}>
              Top performers
            </span>
          </div>
          <h3 className="mt-0.5 text-sm font-bold text-white">Most enrolled courses</h3>
        </div>
        <Link href="/courses" className="flex items-center gap-1 text-xs font-semibold transition-opacity hover:opacity-70"
          style={{ color: 'rgba(255,255,255,0.5)' }}>
          All <ArrowUpRight size={11} />
        </Link>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-8 text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>
          <Spinner size={14} />Loading…
        </div>
      ) : !data || data.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8 text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
          <BookOpen size={20} style={{ color: 'rgba(255,255,255,0.2)' }} />
          No courses yet.
        </div>
      ) : (
        <div className="space-y-2.5">
          {data.map((c, i) => {
            const pct = (c.enrolledCount / max) * 100
            return (
              <Link key={c.id} href={`/courses/${c.id}/edit`}
                className="group block rounded-xl p-2.5 transition-colors hover:bg-white/[0.03]"
                style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="flex items-center gap-3">
                  <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg text-xs font-bold"
                    style={{
                      background: i === 0 ? 'rgba(245,158,11,0.15)' : 'rgba(255,255,255,0.05)',
                      color:      i === 0 ? '#F59E0B' : 'rgba(255,255,255,0.5)',
                    }}>
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-white">{c.title}</p>
                    <div className="mt-1 flex items-center gap-2">
                      <div className="h-1 flex-1 overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.05)' }}>
                        <motion.div className="h-full rounded-full"
                          initial={{ width: 0 }} animate={{ width: `${pct}%` }}
                          transition={{ duration: 0.7, ease: 'easeOut', delay: i * 0.05 }}
                          style={{ background: 'linear-gradient(90deg, #0057b8, #F59E0B)' }} />
                      </div>
                      <div className="flex items-center gap-2.5 text-[10px] flex-shrink-0" style={{ color: 'rgba(255,255,255,0.45)' }}>
                        <span className="inline-flex items-center gap-0.5">
                          <Users size={9} />{c.enrolledCount.toLocaleString()}
                        </span>
                        {c.ratingAvg > 0 && (
                          <span className="inline-flex items-center gap-0.5" style={{ color: '#F59E0B' }}>
                            <Star size={9} fill="#F59E0B" />{c.ratingAvg.toFixed(1)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </motion.div>
  )
}
