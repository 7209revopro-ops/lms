'use client'

import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Link from 'next/link'
import {
  BookOpen, Play, Search, CheckCircle2,
} from 'lucide-react'
import { useMyEnrollments, type MyEnrollment } from '@/lib/api/enrollments'
import type { Course } from '@/types/index'
import { StreakWidget } from '@/components/ui/StreakWidget'
import Spinner from '@/components/ui/Spinner'
import { titleCase } from '@/lib/titleCase'

const STATUS_TABS = ['All Status', 'Not Started', 'In Progress', 'Completed'] as const
type StatusTab = typeof STATUS_TABS[number]

const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.06 } } }
const fadeUp  = { hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0, transition: { type: 'spring' as const, stiffness: 280, damping: 26 } } }

/* When backend populates courseId, it's the full Course object */
function asCourse(e: MyEnrollment): Course | null {
  return typeof e.courseId === 'object' && e.courseId !== null ? e.courseId : null
}

function bucketOf(e: MyEnrollment): 'not_started' | 'in_progress' | 'completed' {
  if (e.status === 'completed' || e.progressPercent >= 100) return 'completed'
  if (e.progressPercent > 0) return 'in_progress'
  return 'not_started'
}

export default function MyLearningPage() {
  const [activeTab, setActiveTab] = useState<StatusTab>('All Status')
  const [search, setSearch] = useState('')

  const { data: enrollments, isLoading } = useMyEnrollments()

  const continuing = useMemo(
    () => (enrollments ?? []).filter(e => bucketOf(e) === 'in_progress').slice(0, 4),
    [enrollments],
  )

  const filtered = useMemo(() => {
    return (enrollments ?? []).filter(e => {
      const course = asCourse(e)
      if (!course) return false
      const bucket = bucketOf(e)
      const matchTab = activeTab === 'All Status'
        || (activeTab === 'Not Started' && bucket === 'not_started')
        || (activeTab === 'In Progress' && bucket === 'in_progress')
        || (activeTab === 'Completed'   && bucket === 'completed')
      const matchSearch = course.title.toLowerCase().includes(search.toLowerCase())
      return matchTab && matchSearch
    })
  }, [enrollments, activeTab, search])

  if (isLoading) {
    return (
      <div className="flex h-[60vh] items-center justify-center gap-3">
        <Spinner size={20} />
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Loading your library…</p>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* ── Streak widget ───────────────────────────── */}
      <StreakWidget />

      {/* ── Continue Learning ───────────────────────── */}
      {continuing.length > 0 && (
        <motion.section variants={stagger} initial="hidden" animate="show">
          <motion.h2 variants={fadeUp} className="mb-5 text-[22px] font-bold tracking-tight"
            style={{ color: 'var(--color-text-primary)' }}>
            Continue Learning
          </motion.h2>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {continuing.map(e => <ContinueCard key={e.id} enrollment={e} />)}
          </div>
        </motion.section>
      )}

      {/* ── All Materials ───────────────────────────── */}
      <section>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2.5 text-[22px] font-bold tracking-tight" style={{ color: 'var(--color-text-primary)' }}>
            All Materials
            <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full px-2 text-xs font-bold tabular-nums"
              style={{ background: 'var(--color-bg-subtle)', color: 'var(--color-text-secondary)' }}>
              {enrollments?.length ?? 0}
            </span>
          </h2>

          <div className="flex items-center gap-2 flex-1 sm:flex-none">
            <div className="relative flex-1 sm:flex-none">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-muted)' }} />
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search Materials…"
                className="h-11 w-full rounded-xl pl-9 pr-4 text-sm outline-none transition-shadow focus:shadow-[0_0_0_3px_rgba(0,87,184,0.10)] sm:w-56 lg:h-10"
                style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }} />
            </div>
          </div>
        </div>

        {/* Segmented control: shrink-to-fit rather than a full-width strip,
            which was stretching four short labels across the whole column. */}
        {/* Scrolls horizontally when the four chips outgrow a narrow screen,
            rather than wrapping to a second row or squashing the labels. */}
        <div className="mb-6 inline-flex max-w-full items-center gap-1 overflow-x-auto overscroll-x-contain rounded-xl p-1 scrollbar-none"
          style={{ background: 'var(--color-bg-subtle)' }}>
          {STATUS_TABS.map(tab => (
            <motion.button key={tab} onClick={() => setActiveTab(tab)}
              /* 44px on touch (the minimum tap target), 36px from `sm` up
                 where a cursor does not need the extra margin. */
              className="relative h-11 flex-shrink-0 whitespace-nowrap rounded-lg px-4 text-sm font-semibold transition-colors lg:h-9"
              style={{ color: activeTab === tab ? 'var(--color-text-primary)' : 'var(--color-text-muted)' }}>
              {activeTab === tab && (
                <motion.div layoutId="my-learning-tab"
                  className="absolute inset-0 rounded-lg bg-[var(--color-bg-surface)]"
                  style={{ boxShadow: '0 1px 3px rgba(13,15,26,0.10)' }}
                  transition={{ type: 'spring', stiffness: 500, damping: 35 }} />
              )}
              <span className="relative z-10">{tab}</span>
            </motion.button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          {filtered.length === 0 ? (
            <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center py-20 gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-3xl"
                style={{ background: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)' }}>
                <BookOpen size={22} style={{ color: 'var(--color-text-muted)' }} />
              </div>
              <p className="text-base font-bold" style={{ color: 'var(--color-text-primary)' }}>
                {(enrollments?.length ?? 0) === 0 ? "You haven't enrolled yet" : 'No materials match'}
              </p>
              <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                {(enrollments?.length ?? 0) === 0
                  ? 'Browse the catalogue and pick something that sparks your interest.'
                  : 'Try a different filter or search term.'}
              </p>
              {(enrollments?.length ?? 0) === 0 && (
                <Link href="/courses" className="mt-1 rounded-xl px-5 py-2 text-sm font-semibold transition-colors hover:opacity-90"
                  style={{ background: 'rgba(0,87,184,0.10)', color: 'var(--color-primary)' }}>
                  Browse courses
                </Link>
              )}
            </motion.div>
          ) : (
            <motion.div key="grid"
              variants={stagger} initial="hidden" animate="show"
              /* Capped at 3. At xl:grid-cols-4 a two-course library left two
                 empty tracks and shrank each card to a thumbnail — the dead
                 zone was the grid, not the page. */
              className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {filtered.map(e => <EnrollmentCard key={e.id} enrollment={e} />)}
            </motion.div>
          )}
        </AnimatePresence>
      </section>
    </div>
  )
}

/* ─── Cards ─────────────────────────────────────── */

function ContinueCard({ enrollment }: { enrollment: MyEnrollment }) {
  const course = asCourse(enrollment)
  if (!course) return null
  const href = enrollment.lastLessonId
    ? `/learn/${course.slug}/${enrollment.lastLessonId}`
    : `/courses/${course.slug}`
  return (
    <motion.div variants={fadeUp}
      whileHover={{ y: -4, boxShadow: '0 20px 48px rgba(0,0,0,0.10)' }}
      className="group overflow-hidden rounded-2xl bg-[var(--color-bg-surface)] transition-all"
      style={{ border: '1px solid var(--color-border)', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
      <div className="flex flex-col gap-4 p-4 sm:flex-row">
        <div className="relative h-40 w-full flex-shrink-0 overflow-hidden rounded-xl sm:h-28 sm:w-32">
          {course.thumbnailUrl
            ? <img src={course.thumbnailUrl} alt={course.title} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
            : <div className="flex h-full w-full items-center justify-center" style={{ background: 'var(--color-bg-subtle)' }}>
                <BookOpen size={26} style={{ color: 'var(--color-text-muted)' }} />
              </div>}
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ background: 'rgba(17,24,39,0.4)' }}>
            <div className="flex h-10 w-10 items-center justify-center rounded-full"
              style={{ background: 'rgba(0,87,184,0.92)', boxShadow: '0 6px 16px rgba(0,87,184,0.4)' }}>
              <Play size={14} fill="white" color="white" />
            </div>
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <span className="inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] font-semibold"
            style={{ background: 'var(--color-primary-light)', color: '#2563EB' }}>Course</span>
          <h3 className="mt-2 line-clamp-2 text-[15px] font-bold leading-snug" style={{ color: 'var(--color-text-primary)' }}>
            {titleCase(course.title)}
          </h3>
          <div className="mt-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                Progress: <span className="font-bold" style={{ color: 'var(--color-text-primary)' }}>{enrollment.progressPercent}%</span>
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: 'var(--color-bg-subtle)' }}>
              <motion.div className="h-full rounded-full" style={{ background: 'var(--color-success)' }}
                initial={{ width: 0 }} animate={{ width: `${enrollment.progressPercent}%` }}
                transition={{ duration: 0.8, ease: 'easeOut' }} />
            </div>
          </div>
          <Link href={href}>
            <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
              className="mt-3 inline-flex min-h-[44px] items-center rounded-xl px-4 text-[13px] font-bold text-white sm:min-h-0 sm:py-1.5 sm:text-xs"
              style={{ background: 'var(--color-text-primary)' }}>
              Continue
            </motion.button>
          </Link>
        </div>
      </div>
    </motion.div>
  )
}

/* One place for the three end-states a card can be in, so the label, the
   colour and the emphasis can never disagree with each other. */
const CARD_ACTION = {
  not_started: { label: 'Start',    primary: true  },
  in_progress: { label: 'Continue', primary: false },
  completed:   { label: 'Review',   primary: false },
} as const

function EnrollmentCard({ enrollment }: { enrollment: MyEnrollment }) {
  const course = asCourse(enrollment)
  if (!course) return null
  const bucket = bucketOf(enrollment)
  const isDone = bucket === 'completed'
  const inProg = bucket === 'in_progress'
  const action = CARD_ACTION[bucket]
  const playHref = enrollment.lastLessonId
    ? `/learn/${course.slug}/${enrollment.lastLessonId}`
    : `/courses/${course.slug}`

  return (
    <motion.div
      variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 280, damping: 26 } } }}
      whileHover={{ y: -4 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      className="group flex flex-col overflow-hidden rounded-2xl bg-[var(--color-bg-surface)]"
      /* Soft, layered shadow rather than a 1px border: depth without a line. */
      style={{ boxShadow: '0 1px 2px rgba(13,15,26,0.04), 0 8px 24px -12px rgba(13,15,26,0.10)' }}>
      <Link href={playHref} className="flex flex-1 flex-col">

        {/* Thumbnail */}
        <div className="relative aspect-[16/9] overflow-hidden" style={{ background: 'var(--color-bg-subtle)' }}>
          {course.thumbnailUrl
            ? <img src={course.thumbnailUrl} alt=""
                className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" />
            : <div className="flex h-full w-full items-center justify-center">
                {/* strokeWidth matches the global lucide set — the placeholder
                    used to render heavier than every other icon on the page. */}
                <BookOpen size={30} strokeWidth={1.75} style={{ color: 'var(--color-text-muted)' }} />
              </div>}

          <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-200 group-hover:opacity-100"
            style={{ background: 'rgba(13,15,26,0.32)' }}>
            <div className="flex h-12 w-12 items-center justify-center rounded-full"
              style={{ background: 'var(--color-primary)', boxShadow: '0 8px 20px rgba(0,87,184,0.42)' }}>
              <Play size={15} fill="white" color="white" />
            </div>
          </div>

          {isDone && (
            <div className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full"
              style={{ background: 'var(--color-success)', boxShadow: '0 2px 8px rgba(14,204,142,0.40)' }}>
              <CheckCircle2 size={15} strokeWidth={2} color="white" />
            </div>
          )}
        </div>

        {/* Body */}
        <div className="flex flex-1 flex-col p-4">
          <span className="inline-flex w-fit items-center rounded-md px-2 py-0.5 text-[11px] font-semibold tracking-wide"
            style={{ background: 'var(--color-primary-light)', color: 'var(--color-primary)' }}>
            Course
          </span>

          <h3 className="mt-2.5 line-clamp-2 text-[15px] font-bold leading-snug"
            style={{ color: 'var(--color-text-primary)' }}>
            {titleCase(course.title)}
          </h3>

          {/* Pushes the footer down so every card in a row ends level, whatever
              the title length. */}
          <div className="flex-1" />

          <div className="mt-4 flex items-center justify-between gap-3 pt-3.5"
            style={{ borderTop: '1px solid var(--color-border)' }}>
            {inProg ? (
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full" style={{ background: 'var(--color-bg-subtle)' }}>
                  <div className="h-full rounded-full"
                    style={{ background: 'var(--color-success)', width: `${enrollment.progressPercent}%` }} />
                </div>
                <span className="text-xs font-bold tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>
                  {enrollment.progressPercent}%
                </span>
              </div>
            ) : isDone ? (
              <span className="text-xs font-semibold" style={{ color: 'var(--color-success)' }}>Completed</span>
            ) : (
              <span className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>Not Started</span>
            )}

            <span
              className="flex h-11 flex-shrink-0 items-center rounded-xl px-4 text-[13px] font-bold transition-all group-hover:brightness-110 lg:h-9"
              style={action.primary
                ? { background: 'var(--color-primary)', color: '#fff', boxShadow: '0 2px 8px rgba(0,87,184,0.28)' }
                : isDone
                  ? { background: 'var(--color-bg-subtle)', color: 'var(--color-text-secondary)' }
                  : { background: 'var(--color-text-primary)', color: 'var(--color-text-inverse)' }}>
              {action.label}
            </span>
          </div>
        </div>
      </Link>
    </motion.div>
  )
}
