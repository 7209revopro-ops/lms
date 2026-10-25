'use client'

import { useQueryState, setQueryParams } from '@/lib/useQueryState'
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Link from 'next/link'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, Edit2, Trash2, Globe, Archive,
  Users, Star, BookOpen, Clock, DollarSign,
  Tag, Play, Calendar, Award, AlertCircle,
  Layers, TrendingUp, Hash, Languages,
} from 'lucide-react'
import { useCourse, useUpdateCourse, useDeleteCourse } from '@/lib/api/courses'
import { useToast } from '@/store/ui.store'
import type { Course, CourseStatus } from '@/types/index'
import Spinner from '@/components/ui/Spinner'
import { CourseStudentsPanel } from '@/components/courses/CourseStudentsPanel'
import { useOrgCurrency, formatCoursePrice } from '@/lib/currency'

/* ── Helpers ──────────────────────────────────────────────────── */
function fmtDuration(mins: number) {
  if (!mins) return '—'
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h ? `${h}h${m > 0 ? ` ${m}m` : ''}` : `${m}m`
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  })
}

/* ── Configs ──────────────────────────────────────────────────── */
const STATUS_CONFIG: Record<CourseStatus, {
  label: string; bg: string; color: string; dot: string
}> = {
  published: { label: 'Published', bg: 'rgba(34,197,94,0.12)',   color: '#4ADE80', dot: '#4ADE80' },
  draft:     { label: 'Draft',     bg: 'rgba(234,179,8,0.12)',   color: '#FACC15', dot: '#FACC15' },
  archived:  { label: 'Archived',  bg: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.35)', dot: 'rgba(255,255,255,0.3)' },
}

const LEVEL_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  beginner:     { label: 'Beginner',     color: '#4ADE80', bg: 'rgba(74,222,128,0.1)'  },
  intermediate: { label: 'Intermediate', color: '#60A5FA', bg: 'rgba(96,165,250,0.1)'  },
  advanced:     { label: 'Advanced',     color: '#F87171', bg: 'rgba(248,113,113,0.1)' },
}

/* ── Stat Card ────────────────────────────────────────────────── */
function StatCard({ icon: Icon, label, value, color, sub, delay = 0, onClick, actionLabel }: {
  icon: React.ElementType; label: string; value: string | number
  color: string; sub?: string; delay?: number
  /** Makes the tile a real button. Only the tiles that lead somewhere get it,
      so a hover state never promises something that does not happen. */
  onClick?: () => void
  actionLabel?: string
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, type: 'spring', stiffness: 260, damping: 24 }}
      {...(onClick ? {
        role: 'button' as const,
        tabIndex: 0,
        onClick,
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() }
        },
        whileHover: { y: -2 },
      } : {})}
      className={`relative overflow-hidden rounded-2xl p-4${onClick ? ' cursor-pointer' : ''}`}
      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}
    >
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
          style={{ background: `${color}18` }}>
          <Icon size={16} style={{ color }} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider"
            style={{ color: 'rgba(255,255,255,0.3)' }}>
            {label}
          </p>
          <p className="mt-1 truncate text-xl font-bold text-white">{value}</p>
          {sub && (
            <p className="mt-0.5 text-[11px]" style={{ color: 'rgba(255,255,255,0.35)' }}>{sub}</p>
          )}
          {actionLabel && (
            <p className="mt-1 text-[11px] font-semibold" style={{ color }}>{actionLabel} →</p>
          )}
        </div>
      </div>
    </motion.div>
  )
}

/* ── Meta Row ─────────────────────────────────────────────────── */
function MetaRow({ icon: Icon, label, value, iconColor = 'rgba(255,255,255,0.4)', last }: {
  icon: React.ElementType; label: string; value: React.ReactNode
  iconColor?: string; last?: boolean
}) {
  return (
    <div className="flex items-center gap-3 py-2.5"
      style={{ borderBottom: last ? 'none' : '1px solid rgba(255,255,255,0.05)' }}>
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg"
        style={{ background: 'rgba(255,255,255,0.05)' }}>
        <Icon size={12} style={{ color: iconColor }} />
      </div>
      <div className="flex flex-1 items-center justify-between gap-4 min-w-0">
        <span className="text-xs font-medium shrink-0" style={{ color: 'rgba(255,255,255,0.35)' }}>
          {label}
        </span>
        <span className="text-right text-xs font-semibold text-white truncate">{value}</span>
      </div>
    </div>
  )
}

/* ── Main Component ───────────────────────────────────────────── */
export function CourseDetail({ id }: { id: string }) {
  const cur          = useOrgCurrency()
  const router       = useRouter()
  const toast        = useToast()
  const { data: course, isLoading, isError } = useCourse(id)
  const updateCourse = useUpdateCourse()
  const deleteCourse = useDeleteCourse()
  const [publishing,     setPublishing]     = useState(false)
  /* The students panel open or not, in the address bar — a link can open it (lib/useQueryState.ts). */
  const [studentsOpen,   setStudentsOpen]   = useQueryState('students', false)
  const [deleting,       setDeleting]       = useState(false)
  const [confirmDelete,  setConfirmDelete]  = useState(false)

  /* ── Loading ── */
  if (isLoading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Spinner size={28} />
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>Loading course…</p>
        </div>
      </div>
    )
  }

  /* ── Error ── */
  if (isError || !course) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl"
            style={{ background: 'rgba(239,68,68,0.12)' }}>
            <AlertCircle size={22} style={{ color: '#EF4444' }} />
          </div>
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>Course not found</p>
          <Link href="/courses" className="text-sm font-semibold" style={{ color: '#0057b8' }}>
            Back to courses
          </Link>
        </div>
      </div>
    )
  }

  const sc = STATUS_CONFIG[course.status]
  const lc = course.level ? LEVEL_CONFIG[course.level] : null

  /* ── Toggle publish / archive ── */
  async function toggleStatus() {
    const next = course!.status === 'published' ? 'archived' : 'published'
    setPublishing(true)
    try {
      await updateCourse.mutateAsync({ id, data: { status: next } })
      toast.success(`Course ${next === 'published' ? 'published' : 'archived'}`)
    } catch {
      toast.error('Failed to update status')
    } finally {
      setPublishing(false)
    }
  }

  /* ── Delete ── */
  async function handleDelete() {
    setDeleting(true)
    try {
      await deleteCourse.mutateAsync(id)
      toast.success('Course deleted')
      router.push('/courses')
    } catch {
      toast.error('Failed to delete course')
      setDeleting(false)
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">

      {/* ── Top nav bar ── */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 280, damping: 26 }}
        className="flex flex-wrap items-center justify-between gap-3"
      >
        <Link href="/courses"
          className="inline-flex items-center gap-1.5 text-sm transition-opacity hover:opacity-70"
          style={{ color: 'rgba(255,255,255,0.4)' }}>
          <ArrowLeft size={13} />Back to courses
        </Link>

        <div className="flex flex-wrap items-center gap-2">
          {/* Toggle publish / archive */}
          <motion.button
            whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
            onClick={toggleStatus}
            disabled={publishing}
            className="inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition-opacity disabled:opacity-50"
            style={{
              background: course.status === 'published' ? 'rgba(234,179,8,0.12)' : 'rgba(34,197,94,0.12)',
              color:      course.status === 'published' ? '#FACC15' : '#4ADE80',
              border:     `1px solid ${course.status === 'published' ? 'rgba(234,179,8,0.2)' : 'rgba(34,197,94,0.2)'}`,
            }}>
            {publishing
              ? <Spinner size={12} />
              : course.status === 'published' ? <Archive size={12} /> : <Globe size={12} />}
            {course.status === 'published' ? 'Archive' : 'Publish'}
          </motion.button>

          {/* Edit */}
          <Link href={`/courses/${id}/edit`}>
            <motion.div
              whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
              className="inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold cursor-pointer"
              style={{ background: 'rgba(0,87,184,0.15)', color: '#0057b8', border: '1px solid rgba(0,87,184,0.25)' }}>
              <Edit2 size={12} />Edit course
            </motion.div>
          </Link>

          {/* Delete */}
          <AnimatePresence mode="wait">
            {!confirmDelete ? (
              <motion.button
                key="del-btn"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                onClick={() => setConfirmDelete(true)}
                className="inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold"
                style={{ background: 'rgba(239,68,68,0.1)', color: '#F87171', border: '1px solid rgba(239,68,68,0.15)' }}>
                <Trash2 size={12} />Delete
              </motion.button>
            ) : (
              <motion.div
                key="del-confirm"
                initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
                className="flex items-center gap-1.5"
              >
                <span className="text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>Sure?</span>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="rounded-xl px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                  style={{ background: '#EF4444', color: '#fff' }}>
                  {deleting ? 'Deleting…' : 'Yes, delete'}
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="rounded-xl px-3 py-1.5 text-xs font-semibold"
                  style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.55)' }}>
                  Cancel
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>

      {/* ── Hero card ── */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05, type: 'spring', stiffness: 260, damping: 24 }}
        className="relative overflow-hidden rounded-3xl"
        style={{ border: '1px solid rgba(255,255,255,0.08)' }}
      >
        {/* Background: thumbnail or gradient */}
        {course.thumbnailUrl ? (
          <div className="relative h-56 w-full overflow-hidden">
            <Image src={course.thumbnailUrl} alt={course.title} fill className="object-cover" unoptimized />
            <div className="absolute inset-0"
              style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.25) 0%, rgba(10,10,20,0.92) 100%)' }} />
          </div>
        ) : (
          <div className="relative h-56 w-full flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, rgba(0,87,184,0.12) 0%, rgba(255,255,255,0.02) 100%)' }}>
            <BookOpen size={64} style={{ color: 'rgba(0,87,184,0.15)' }} />
          </div>
        )}

        {/* Overlay content */}
        <div className="absolute bottom-0 left-0 right-0 px-6 pb-6 pt-4">
          <div className="flex items-end justify-between gap-4 flex-wrap">
            <div className="flex-1 min-w-0">

              {/* Badges row */}
              <div className="mb-2.5 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold"
                  style={{ background: sc.bg, color: sc.color }}>
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: sc.dot }} />
                  {sc.label}
                </span>
                {lc && (
                  <span className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
                    style={{ background: lc.bg, color: lc.color }}>
                    {lc.label}
                  </span>
                )}
                {course.isFree && (
                  <span className="rounded-full px-2.5 py-1 text-[11px] font-bold"
                    style={{ background: 'rgba(0,87,184,0.22)', color: '#0057b8' }}>
                    FREE
                  </span>
                )}
                {course.category && (
                  <span className="rounded-full px-2.5 py-1 text-[11px]"
                    style={{ background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.6)' }}>
                    {course.category.name}
                  </span>
                )}
              </div>

              {/* Title */}
              <h1 className="text-2xl font-extrabold text-white leading-tight"
                style={{ fontFamily: 'Bricolage Grotesque, sans-serif', textShadow: '0 2px 10px rgba(0,0,0,0.6)' }}>
                {course.title}
              </h1>

              {/* Instructor */}
              {course.instructor && (
                <div className="mt-2 flex items-center gap-2">
                  <div className="h-5 w-5 rounded-full overflow-hidden flex items-center justify-center shrink-0"
                    style={{ background: 'rgba(0,87,184,0.35)' }}>
                    {course.instructor.avatarUrl ? (
                      <Image src={course.instructor.avatarUrl} alt={course.instructor.name}
                        width={20} height={20} className="object-cover" unoptimized />
                    ) : (
                      <span className="text-[9px] font-bold text-orange-300">
                        {course.instructor.name[0]}
                      </span>
                    )}
                  </div>
                  <span className="text-sm font-medium" style={{ color: 'rgba(255,255,255,0.7)' }}>
                    {course.instructor.name}
                  </span>
                </div>
              )}
            </div>

            {/* Price badge */}
            {!course.isFree && (
              <div className="shrink-0 rounded-2xl px-4 py-2.5 text-center backdrop-blur-sm"
                style={{ background: 'rgba(0,87,184,0.2)', border: '1px solid rgba(0,87,184,0.3)' }}>
                <p className="text-[10px] font-medium" style={{ color: 'rgba(255,255,255,0.5)' }}>Price</p>
                <p className="text-2xl font-bold text-white">{formatCoursePrice(course, cur)}</p>
              </div>
            )}
          </div>
        </div>
      </motion.div>

      {/* ── Stats row ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {/* The count was a dead number: it said how many, never who. It is the
            obvious place to ask the question, so it opens the roster. */}
        <StatCard
          icon={Users} label="Enrolled"
          value={course.enrolledCount.toLocaleString()}
          color="#0057b8" delay={0.08}
          onClick={() => setStudentsOpen(v => !v)}
          actionLabel={studentsOpen ? 'Hide students' : 'View students'}
        />
        <StatCard
          icon={Star} label="Rating"
          value={course.ratingAvg ? course.ratingAvg.toFixed(1) : '—'}
          sub={`${course.ratingCount} reviews`}
          color="#FACC15" delay={0.11}
        />
        <StatCard
          icon={BookOpen} label="Lessons"
          value={course.lessonCount ?? '—'}
          color="#60A5FA" delay={0.14}
        />
        <StatCard
          icon={Clock} label="Duration"
          value={fmtDuration(course.durationMins)}
          color="#A78BFA" delay={0.17}
        />
      </div>

      {/* Roster — opened from the Enrolled tile above. Full width rather than
          inside the 2-col body: it is a table, and a table squeezed into a
          third of the page is a table nobody reads. */}
      <AnimatePresence>
        {studentsOpen && (
          <CourseStudentsPanel courseId={course.id} onClose={() => setQueryParams({ students: null, sq: null, spage: null, ssource: null })} />
        )}
      </AnimatePresence>

      {/* ── Body: 2-col ── */}
      <div className="grid gap-4 lg:grid-cols-3">

        {/* ── Left column: description + tags + preview ── */}
        <div className="space-y-4 lg:col-span-2">

          {/* Description */}
          {course.description && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, type: 'spring', stiffness: 260, damping: 24 }}
              className="rounded-2xl p-5"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
            >
              <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-white">
                <div className="flex h-6 w-6 items-center justify-center rounded-lg"
                  style={{ background: 'rgba(0,87,184,0.15)' }}>
                  <Layers size={12} style={{ color: '#0057b8' }} />
                </div>
                About this course
              </h2>
              <p className="text-sm leading-relaxed whitespace-pre-wrap"
                style={{ color: 'rgba(255,255,255,0.5)' }}>
                {course.description}
              </p>
            </motion.div>
          )}

          {/* Tags */}
          {course.tags && course.tags.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.22, type: 'spring', stiffness: 260, damping: 24 }}
              className="rounded-2xl p-5"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
            >
              <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-white">
                <div className="flex h-6 w-6 items-center justify-center rounded-lg"
                  style={{ background: 'rgba(0,87,184,0.15)' }}>
                  <Tag size={12} style={{ color: '#0057b8' }} />
                </div>
                Tags
              </h2>
              <div className="flex flex-wrap gap-2">
                {course.tags.map(tag => (
                  <span key={tag}
                    className="rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap"
                    style={{
                      background: 'rgba(255,255,255,0.06)',
                      color: 'rgba(255,255,255,0.5)',
                      border: '1px solid rgba(255,255,255,0.08)',
                    }}>
                    #{tag}
                  </span>
                ))}
              </div>
            </motion.div>
          )}

          {/* Preview video */}
          {course.previewUrl && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.24, type: 'spring', stiffness: 260, damping: 24 }}
              className="overflow-hidden rounded-2xl"
              style={{ border: '1px solid rgba(255,255,255,0.07)' }}
            >
              <div className="flex items-center gap-2 px-5 py-3"
                style={{ background: 'rgba(255,255,255,0.03)' }}>
                <div className="flex h-6 w-6 items-center justify-center rounded-lg"
                  style={{ background: 'rgba(0,87,184,0.15)' }}>
                  <Play size={12} style={{ color: '#0057b8' }} />
                </div>
                <span className="text-sm font-bold text-white">Preview Video</span>
              </div>
              <video
                src={course.previewUrl}
                controls
                className="w-full"
                style={{ maxHeight: '280px', background: '#000' }}
              />
            </motion.div>
          )}

          {/* Edit CTA */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.26, type: 'spring', stiffness: 260, damping: 24 }}
          >
            <Link href={`/courses/${id}/edit`}>
              <div className="group flex items-center justify-between rounded-2xl p-5 transition-colors"
                style={{ background: 'rgba(0,87,184,0.06)', border: '1px solid rgba(0,87,184,0.12)' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(0,87,184,0.28)' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(0,87,184,0.12)' }}>
                <div>
                  <h3 className="text-sm font-bold" style={{ color: '#0057b8' }}>Edit this course</h3>
                  <p className="mt-0.5 text-xs" style={{ color: 'rgba(255,255,255,0.33)' }}>
                    Update content, curriculum, pricing and settings
                  </p>
                </div>
                <div className="flex h-9 w-9 items-center justify-center rounded-xl transition-transform group-hover:translate-x-0.5"
                  style={{ background: 'rgba(0,87,184,0.15)' }}>
                  <Edit2 size={15} style={{ color: '#0057b8' }} />
                </div>
              </div>
            </Link>
          </motion.div>
        </div>

        {/* ── Right column: meta info ── */}
        <motion.div
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.2, type: 'spring', stiffness: 260, damping: 24 }}
          className="space-y-4"
        >
          {/* Meta card */}
          <div className="rounded-2xl p-5"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <h2 className="mb-0.5 text-sm font-bold text-white">Course Info</h2>
            <p className="mb-4 text-[11px]" style={{ color: 'rgba(255,255,255,0.28)' }}>Metadata &amp; settings</p>

            <MetaRow icon={Hash}       label="Slug"     value={<code className="text-[10px] opacity-80">{course.slug}</code>} />
            <MetaRow icon={Languages}  label="Language" value={course.language} />
            {lc && (
              <MetaRow icon={Award} label="Level" value={
                <span className="rounded-full px-2.5 py-0.5 text-[10px] font-semibold"
                  style={{ background: lc.bg, color: lc.color }}>
                  {lc.label}
                </span>
              } />
            )}
            <MetaRow
              icon={DollarSign} label="Price"
              value={formatCoursePrice(course, cur)}
              iconColor={course.isFree ? '#4ADE80' : 'rgba(255,255,255,0.4)'}
            />
            <MetaRow
              icon={TrendingUp} label="Rating"
              value={`${course.ratingAvg ? course.ratingAvg.toFixed(1) : '—'} / 5`}
            />
            <MetaRow icon={Calendar} label="Created" value={fmtDate(course.createdAt)} />
            <MetaRow icon={Calendar} label="Updated" value={fmtDate(course.updatedAt)} last />
          </div>

          {/* Instructor card */}
          {course.instructor && (
            <div className="rounded-2xl p-4"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
              <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider"
                style={{ color: 'rgba(255,255,255,0.25)' }}>
                Instructor
              </p>
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full overflow-hidden flex items-center justify-center shrink-0"
                  style={{ background: 'rgba(0,87,184,0.22)', border: '1.5px solid rgba(0,87,184,0.25)' }}>
                  {course.instructor.avatarUrl ? (
                    <Image src={course.instructor.avatarUrl} alt={course.instructor.name}
                      width={40} height={40} className="object-cover" unoptimized />
                  ) : (
                    <span className="text-sm font-bold text-orange-300">
                      {course.instructor.name[0]}
                    </span>
                  )}
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">{course.instructor.name}</p>
                  {course.category && (
                    <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.35)' }}>
                      {course.category.name}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
        </motion.div>
      </div>
    </div>
  )
}
