'use client'

import { use } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import {
  ArrowLeft, AlertCircle, BookOpen, GraduationCap,
  Users, Star, Lock, CheckCircle2, ChevronRight,
} from 'lucide-react'
import { useLearningPath, type LearningPathCourse } from '@/lib/api/learningpaths'
import Spinner from '@/components/ui/Spinner'
import { AvatarImg } from '@/components/ui/AvatarImg'
import { SHOW_PRICING } from '@/lib/pricingVisibility'

function fmt(mins: number) {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h > 0 ? `${h}h ${m > 0 ? m + 'm' : ''}`.trim() : `${m}m`
}

function CourseCard({
  item,
  index,
  isPrerequisiteBlocked,
}: {
  item:                  LearningPathCourse
  index:                 number
  isPrerequisiteBlocked: boolean
}) {
  const course = typeof item.courseId === 'object' ? item.courseId : null
  if (!course) return null

  const href = `/courses/${course.slug}`

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04 }}
      className="flex items-start gap-4">
      {/* Step indicator */}
      <div className="flex-shrink-0 flex flex-col items-center">
        <div className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white"
          style={{ background: isPrerequisiteBlocked ? 'var(--color-border)' : '#0057b8' }}>
          {index + 1}
        </div>
        {index < 99 && (
          <div className="mt-1 w-px h-full min-h-[24px]" style={{ background: 'var(--color-border)' }} />
        )}
      </div>

      {/* Card */}
      <div className="flex-1 mb-4">
        <Link href={href}>
          <div className="group flex gap-3 overflow-hidden rounded-2xl bg-[var(--color-bg-surface)] p-4 transition-shadow hover:shadow-md"
            style={{ border: '1px solid var(--color-border)', opacity: isPrerequisiteBlocked ? 0.6 : 1 }}>
            {/* Thumbnail */}
            <div className="relative h-16 w-24 flex-shrink-0 overflow-hidden rounded-xl"
              style={{ background: 'var(--color-bg-page)' }}>
              {course.thumbnailUrl
                ? <img src={course.thumbnailUrl} alt={course.title} className="h-full w-full object-cover" />
                : <div className="flex h-full w-full items-center justify-center">
                    <BookOpen size={18} style={{ color: 'var(--color-text-muted)' }} />
                  </div>
              }
              {isPrerequisiteBlocked && (
                <div className="absolute inset-0 flex items-center justify-center rounded-xl"
                  style={{ background: 'rgba(255,255,255,0.7)' }}>
                  <Lock size={14} style={{ color: 'var(--color-text-muted)' }} />
                </div>
              )}
            </div>

            <div className="flex flex-1 flex-col min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold line-clamp-2 flex-1" style={{ color: 'var(--color-text-primary)' }}>
                  {course.title}
                </h3>
                {item.isPrerequisite && (
                  <span className="flex-shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold"
                    style={{ background: 'rgba(0,87,184,0.1)', color: 'var(--color-primary)' }}>
                    Prerequisite
                  </span>
                )}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                <span className="flex items-center gap-1">
                  <Users size={10} />{course.enrolledCount.toLocaleString()}
                </span>
                {course.ratingAvg > 0 && (
                  <span className="flex items-center gap-1">
                    <Star size={10} fill="#F59E0B" style={{ color: 'var(--color-warning)' }} />
                    {course.ratingAvg.toFixed(1)}
                  </span>
                )}
                <span>{fmt(course.durationMins)}</span>
                <span className="capitalize">{course.level}</span>
              </div>
              <div className="mt-auto pt-1.5 flex items-center justify-between">
                <span className="text-xs font-semibold" style={{ color: course.isFree ? '#22C55E' : 'var(--color-text-primary)' }}>
                  {SHOW_PRICING && (course.isFree ? 'Free' : `$${course.price}`)}
                </span>
                <ChevronRight size={13} style={{ color: 'var(--color-text-muted)' }}
                  className="transition-transform group-hover:translate-x-0.5" />
              </div>
            </div>
          </div>
        </Link>
      </div>
    </motion.div>
  )
}

export default function LearningPathDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params)
  const { data: path, isLoading, isError } = useLearningPath(slug)

  if (isLoading) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center gap-3">
        <Spinner size={28} />
      </div>
    )
  }

  if (isError || !path) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-3xl"
          style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.18)' }}>
          <AlertCircle size={24} style={{ color: 'var(--color-danger)' }} />
        </div>
        <p className="text-base font-semibold" style={{ color: 'var(--color-text-primary)' }}>Learning path not found</p>
        <Link href="/learning-paths" className="text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>
          ← Back to paths
        </Link>
      </div>
    )
  }

  const instructor = typeof path.instructorId === 'object' ? path.instructorId : null
  const sortedCourses = [...path.courses].sort((a, b) => a.order - b.order)

  /* Simple prereq check: if item N is a prerequisite, item N+1 is blocked */
  const blockedFrom = sortedCourses.findIndex((c, i) => {
    if (i === 0) return false
    return sortedCourses[i - 1]?.isPrerequisite
  })

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      {/* Back */}
      <Link href="/learning-paths" className="inline-flex items-center gap-1.5 text-sm transition-opacity hover:opacity-70"
        style={{ color: 'var(--color-text-muted)' }}>
        <ArrowLeft size={13} /> All learning paths
      </Link>

      {/* Hero */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
        className="overflow-hidden rounded-3xl"
        style={{ background: 'rgba(0,87,184,0.08)', border: '1px solid var(--color-border)' }}>
        <div className="flex flex-col gap-4 p-6 sm:flex-row sm:items-start">
          {/* Thumbnail */}
          {path.thumbnailUrl && (
            <div className="h-28 w-44 flex-shrink-0 overflow-hidden rounded-2xl">
              <img src={path.thumbnailUrl} alt={path.title} className="h-full w-full object-cover" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)', fontFamily: 'Bricolage Grotesque, sans-serif' }}>
              {path.title}
            </h1>
            {path.description && (
              <p className="mt-2 text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>{path.description}</p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-4 text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {instructor && (
                <span className="flex items-center gap-1.5">
                  <AvatarImg src={instructor.avatarUrl}
                    className="h-5 w-5 rounded-full object-cover"
                    fallback={<GraduationCap size={14} />} />
                  {instructor.name}
                </span>
              )}
              <span className="flex items-center gap-1"><BookOpen size={12} /> {sortedCourses.length} courses</span>
              <span className="flex items-center gap-1"><Users size={12} /> {path.enrolledCount.toLocaleString()} learners</span>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Courses',   value: sortedCourses.length },
          { label: 'Learners',  value: path.enrolledCount.toLocaleString() },
          { label: 'Prereqs',   value: sortedCourses.filter(c => c.isPrerequisite).length },
        ].map((s, i) => (
          <motion.div key={s.label}
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 + i * 0.04 }}
            className="rounded-2xl p-4 text-center"
            style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)' }}>
            <p className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>{s.value}</p>
            <p className="mt-0.5 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>{s.label}</p>
          </motion.div>
        ))}
      </div>

      {/* Prerequisite legend */}
      {sortedCourses.some(c => c.isPrerequisite) && (
        <div className="flex items-center gap-2 rounded-xl px-4 py-3 text-xs"
          style={{ background: 'rgba(0,87,184,0.06)', border: '1px solid rgba(0,87,184,0.15)', color: 'var(--color-primary)' }}>
          <Lock size={12} /> Prerequisite courses must be completed before advancing to the next step.
        </div>
      )}

      {/* Course list */}
      <div>
        <h2 className="mb-4 text-base font-bold" style={{ color: 'var(--color-text-primary)', fontFamily: 'Bricolage Grotesque, sans-serif' }}>
          Course Sequence
        </h2>
        <div>
          {sortedCourses.map((item, i) => (
            <CourseCard
              key={i}
              item={item}
              index={i}
              isPrerequisiteBlocked={blockedFrom > 0 && i >= blockedFrom}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
