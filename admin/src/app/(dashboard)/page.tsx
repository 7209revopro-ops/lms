'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import {
  BookOpen, Users, GraduationCap, DollarSign,
  TrendingUp, Star, ArrowUpRight,
} from 'lucide-react'
import { StatCard } from '@/components/ui/StatCard'
import { EnrollmentsChart } from '@/components/analytics/EnrollmentsChart'
import { RevenueChart } from '@/components/analytics/RevenueChart'
import { TopCoursesWidget } from '@/components/analytics/TopCoursesWidget'
import { CompletionWidget } from '@/components/analytics/CompletionWidget'
import { useCourses } from '@/lib/api/courses'
import { useAdminStats } from '@/lib/api/stats'
import { useCurrentUser } from '@/lib/api/user'
import Link from 'next/link'
import Spinner from '@/components/ui/Spinner'
import { useOrgCurrency, formatCoursePrice } from '@/lib/currency'
import { getActiveTimeZone } from '@/lib/timezone'

/* The hour this greeting reads must come from the ACADEMY's clock, not the
   machine's. Two reasons, and the second is the one that bites:

     * the rest of this dashboard is shown in the active academy's zone
       (TimezoneScope in app/providers.tsx), so a greeting on the viewer's
       own clock could contradict every timestamp beside it; and
     * `new Date().getHours()` during render is evaluated once on the server,
       which runs in Asia/Dubai, and again in the browser. Land either side
       of a bucket boundary and the two disagree, React reports a hydration
       mismatch and throws the server HTML away.

   Reading it through the academy zone makes the value deterministic, and
   `useGreeting` below keeps it out of the first client render entirely. */
function timeGreeting(): string {
  const h = Number(new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', hour12: false, timeZone: getActiveTimeZone(),
  }).format(new Date()))
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

/** Empty on the server and on the first client render, so there is nothing
    for hydration to disagree about; filled immediately afterwards. */
function useGreeting(): string {
  const [greeting, setGreeting] = useState('')
  useEffect(() => { setGreeting(timeGreeting()) }, [])
  return greeting
}

export default function DashboardPage() {
  const cur = useOrgCurrency()
  const { data: coursesData, isError: coursesError, refetch: refetchCourses } =
    useCourses({ per_page: 5, status: 'published', sort: 'createdAt:desc' })
  const { data: stats, isLoading: statsLoading } = useAdminStats()
  const { data: currentUser } = useCurrentUser()
  const firstName = currentUser?.name?.split(' ')[0] ?? 'Admin'
  const greeting = useGreeting()

  /* Split a money value into a display number + suffix so StatCard's
     prefix/suffix props work (it expects `value: number`). */
  function splitCompact(n: number): { value: number; suffix: string } {
    if (n >= 1_000_000) return { value: Math.round((n / 1_000_000) * 10) / 10, suffix: 'M' }
    if (n >= 1_000)     return { value: Math.round((n / 1_000) * 10) / 10,     suffix: 'k' }
    return { value: Math.round(n), suffix: '' }
  }
  const rev = splitCompact(stats?.revenueEstimate ?? 0)

  const statCards = [
    { label: 'Total Courses',    value: stats?.totalCourses     ?? 0, change: 0, changeLabel: `${stats?.publishedCourses ?? 0} published · ${stats?.draftCourses ?? 0} drafts`, icon: BookOpen,      color: '#0057b8', prefix: '',  suffix: '',         delay: 0     },
    { label: 'Total Students',   value: stats?.totalStudents    ?? 0, change: 0, changeLabel: `${stats?.totalEnrollments ?? 0} active enrollments`,                            icon: Users,         color: '#2F6BFF', prefix: '',  suffix: '',         delay: 0.05  },
    { label: 'Instructors',      value: stats?.totalInstructors ?? 0, change: 0, changeLabel: 'Course authors',                                                                 icon: GraduationCap, color: '#A78BFA', prefix: '',  suffix: '',         delay: 0.1   },
    { label: 'Revenue (est.)',   value: rev.value,                     change: 0, changeLabel: 'Sum of paid course earnings',                                                   icon: DollarSign,    color: '#4ADE80', prefix: cur.symbol, suffix: rev.suffix, delay: 0.15  },
  ]

  return (
    <div className="space-y-8">
      {/* ── Welcome ─────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 24 }}>
        <h1 className="text-2xl font-bold text-white" style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}>
          {greeting ? `${greeting}, ` : ''}{firstName} 👋
        </h1>
        <p className="mt-1 text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>
          Here&apos;s what&apos;s happening with Delta Institutions today.
        </p>
      </motion.div>

      {/* ── Stat cards ──────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {statsLoading
          ? Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-[110px] rounded-2xl animate-pulse"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }} />
            ))
          : statCards.map(s => <StatCard key={s.label} {...s} />)
        }
      </div>

      {/* ── Analytics row ──────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2"><EnrollmentsChart /></div>
        <CompletionWidget />
      </div>

      {/* ── Revenue chart ──────────────────────────── */}
      <RevenueChart />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-3"><TopCoursesWidget /></div>
      </div>

      {/* ── Bottom grid ─────────────────────────────── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* Recent courses ─ 3/5 */}
        <motion.div
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, type: 'spring', stiffness: 240, damping: 24 }}
          className="col-span-5 lg:col-span-3 rounded-2xl overflow-hidden"
          style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <h2 className="text-sm font-semibold text-white">Recent Courses</h2>
            <Link href="/courses" className="flex items-center gap-1 text-xs font-semibold transition-opacity hover:opacity-70" style={{ color: '#0057b8' }}>
              View all <ArrowUpRight size={12} />
            </Link>
          </div>
          <div className="">
            {/* `!coursesData` is true both while loading AND after the query
                has given up, so a failed fetch left this panel spinning for
                ever on a query React Query had already stopped retrying. */}
            {!coursesData && coursesError && (
              <div className="flex flex-col items-center gap-2 px-5 py-8 text-sm">
                <p className="font-semibold text-white">Could not load recent courses</p>
                <button type="button" onClick={() => void refetchCourses()}
                  className="mt-1 inline-flex min-h-[44px] items-center rounded-xl px-4 text-xs font-semibold sm:min-h-0 sm:py-2"
                  style={{ background: 'rgba(0,87,184,0.14)', border: '1px solid rgba(0,87,184,0.35)', color: '#60A5FA' }}>
                  Try again
                </button>
              </div>
            )}
            {!coursesData && !coursesError && (
              <div className="flex items-center justify-center gap-2 px-5 py-10 text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>
                <Spinner size={14} />Loading…
              </div>
            )}
            {coursesData?.docs.length === 0 && (
              <p className="px-5 py-8 text-center text-sm" style={{ color: 'rgba(255,255,255,0.35)' }}>
                No published courses yet.
              </p>
            )}
            {coursesData?.docs.map((c, i) => (
              <motion.div key={c.id}
                initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.25 + i * 0.04 }}
                className="flex border-b border-[#e5e7eb17] items-center gap-3 px-5 py-3.5 transition-colors hover:bg-white/[0.03]">
                <div className="relative h-10 w-16 flex-shrink-0 overflow-hidden rounded-xl"
                  style={{ background: 'rgba(255,255,255,0.06)' }}>
                  {c.thumbnailUrl && <img src={c.thumbnailUrl} alt="" className="h-full w-full object-cover" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-white">{c.title}</p>
                  <div className="mt-0.5 flex items-center gap-2">
                    <span className="flex items-center gap-1 text-[11px]" style={{ color: 'rgba(255,255,255,0.35)' }}>
                      <Users size={10} />{c.enrolledCount.toLocaleString()}
                    </span>
                    {c.ratingAvg > 0 && (
                      <span className="flex items-center gap-1 text-[11px]" style={{ color: '#FACC15' }}>
                        <Star size={10} fill="#FACC15" />{c.ratingAvg.toFixed(1)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-semibold text-white">
                    {formatCoursePrice(c, cur)}
                  </p>
                  <span className="text-[10px] font-semibold"
                    style={{ color: c.status === 'published' ? '#4ADE80' : '#FACC15' }}>
                    {c.status}
                  </span>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* Platform snapshot ─ 2/5 */}
        <motion.div
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25, type: 'spring', stiffness: 240, damping: 24 }}
          className="col-span-5 lg:col-span-2 rounded-2xl overflow-hidden"
          style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <h2 className="text-sm font-semibold text-white">Platform Snapshot</h2>
          </div>
          <div className="px-5 py-3 space-y-0">
            {[
              { label: 'Total enrollments', value: stats?.totalEnrollments,  color: '#4ADE80' },
              { label: 'Reviews submitted', value: stats?.totalReviews,      color: '#FACC15' },
              { label: 'Published courses', value: stats?.publishedCourses,  color: '#2F6BFF' },
              { label: 'Draft courses',     value: stats?.draftCourses,      color: '#0057b8' },
              { label: 'Instructors',       value: stats?.totalInstructors,  color: '#A78BFA' },
            ].map((row, i) => (
              <motion.div key={row.label}
                initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3 + i * 0.05 }}
                className="flex items-center justify-between py-3"
                style={{ borderBottom: i < 4 ? '1px solid rgba(255,255,255,0.05)' : 'none' }}>
                <div className="flex items-center gap-2.5">
                  <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ background: row.color }} />
                  <p className="text-xs" style={{ color: 'rgba(255,255,255,0.65)' }}>{row.label}</p>
                </div>
                <p className="text-sm font-bold text-white tabular-nums">
                  {statsLoading || row.value === undefined ? '—' : row.value.toLocaleString()}
                </p>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>

      {/* ── Quick actions ────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.35, type: 'spring', stiffness: 240, damping: 24 }}
        className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: 'Add Course',      href: '/courses/new',  icon: BookOpen,   color: '#0057b8' },
          { label: 'View Students',   href: '/students',     icon: Users,      color: '#2F6BFF' },
          { label: 'Categories',      href: '/categories',   icon: TrendingUp, color: '#4ADE80' },
          { label: 'Reviews Queue',   href: '/reviews',      icon: Star,       color: '#FACC15' },
        ].map((a, i) => {
          const Icon = a.icon
          return (
            <Link key={a.href} href={a.href}>
              <motion.div
                /* The delay belongs INSIDE animate. As a sibling `transition`
                   prop it becomes the default for whileHover and whileTap too,
                   so the fourth tile waited 520ms before showing any press
                   feedback - by which time the Link had already navigated and
                   the tap read as dead. */
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0, transition: { delay: 0.4 + i * 0.04 } }}
                whileHover={{ y: -3, boxShadow: `0 12px 32px rgba(0,0,0,0.3)` }}
                whileTap={{ scale: 0.97 }}
                className="flex cursor-pointer items-center gap-3 rounded-2xl p-4 transition-colors"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                <div className="flex h-9 w-9 items-center justify-center rounded-xl"
                  style={{ background: `${a.color}18`, border: `1px solid ${a.color}28` }}>
                  <Icon size={16} style={{ color: a.color }} strokeWidth={1.8} />
                </div>
                <span className="text-sm font-semibold text-white">{a.label}</span>
              </motion.div>
            </Link>
          )
        })}
      </motion.div>
    </div>
  )
}
