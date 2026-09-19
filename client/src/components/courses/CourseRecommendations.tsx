'use client'

import { motion } from 'framer-motion'
import Link from 'next/link'
import { Star, Users, Clock, Sparkles } from 'lucide-react'
import { useCourseRecommendations } from '@/lib/api/recommendations'
import type { Course } from '@/types/index'
import { SHOW_PRICING } from '@/lib/pricingVisibility'

function fmt(mins: number) {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h > 0 ? `${h}h${m > 0 ? ` ${m}m` : ''}` : `${m}m`
}

function RecommendationCard({ course, i }: { course: Course; i: number }) {
  const levelColors: Record<string, string> = {
    beginner:     '#10B981',
    intermediate: '#F59E0B',
    advanced:     '#EF4444',
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: i * 0.06, type: 'spring', stiffness: 280, damping: 26 }}>
      <Link href={`/courses/${course.slug}`} className="group block">
        <div className="rounded-2xl overflow-hidden bg-[var(--color-bg-surface)] transition-all duration-200
          group-hover:shadow-md group-hover:-translate-y-0.5"
          style={{ border: '1px solid var(--color-border)' }}>

          {/* Thumbnail */}
          <div className="relative aspect-video overflow-hidden bg-[var(--color-bg-muted)]">
            {course.thumbnailUrl
              ? <img src={course.thumbnailUrl} alt={course.title}
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
              : <div className="h-full w-full flex items-center justify-center"
                  style={{ background: 'var(--color-primary-light)' }}>
                  <Sparkles size={24} style={{ color: 'var(--color-primary)', opacity: 0.4 }} />
                </div>
            }
            {/* Free badge */}
            {course.isFree && (
              <span className="absolute top-2 left-2 rounded-lg px-2 py-0.5 text-[10px] font-bold text-white"
                style={{ background: 'var(--color-success)' }}>
                FREE
              </span>
            )}
          </div>

          {/* Info */}
          <div className="p-3.5">
            <p className="text-sm font-semibold line-clamp-2 leading-snug mb-1.5" style={{ color: 'var(--color-text-primary)' }}>
              {course.title}
            </p>

            {course.instructor && (
              <p className="text-[11px] mb-2 truncate" style={{ color: 'var(--color-text-muted)' }}>
                {course.instructor.name}
              </p>
            )}

            <div className="flex items-center gap-2.5 flex-wrap">
              {/* Rating */}
              {course.ratingCount > 0 && (
                <div className="flex items-center gap-1">
                  <Star size={11} fill="#F59E0B" style={{ color: 'var(--color-warning)' }} />
                  <span className="text-[11px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                    {course.ratingAvg.toFixed(1)}
                  </span>
                </div>
              )}
              {/* Duration */}
              {course.durationMins > 0 && (
                <div className="flex items-center gap-1" style={{ color: 'var(--color-text-muted)' }}>
                  <Clock size={11} />
                  <span className="text-[11px]">{fmt(course.durationMins)}</span>
                </div>
              )}
              {/* Enrolled */}
              <div className="flex items-center gap-1" style={{ color: 'var(--color-text-muted)' }}>
                <Users size={11} />
                <span className="text-[11px]">{course.enrolledCount.toLocaleString()}</span>
              </div>
            </div>

            {/* Level + price row */}
            <div className="mt-2.5 flex items-center justify-between">
              {course.level && (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                  style={{
                    color: levelColors[course.level] ?? 'var(--color-text-muted)',
                    background: `${levelColors[course.level] ?? 'var(--color-text-muted)'}18`,
                  }}>
                  {course.level}
                </span>
              )}
              <span className="ml-auto text-sm font-bold" style={{ color: course.isFree ? '#10B981' : 'var(--color-text-primary)' }}>
                {SHOW_PRICING && (course.isFree ? 'Free' : `$${course.price.toFixed(2)}`)}
              </span>
            </div>
          </div>
        </div>
      </Link>
    </motion.div>
  )
}

export function CourseRecommendations({ slug }: { slug: string }) {
  const { data: courses, isLoading } = useCourseRecommendations(slug)

  if (isLoading || !courses || courses.length === 0) return null

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.4 }}
      className="mt-12">
      <div className="mb-4 flex items-center gap-2">
        <Sparkles size={16} style={{ color: 'var(--color-primary)' }} />
        <h2 className="text-base font-bold" style={{ color: 'var(--color-text-primary)', fontFamily: 'Bricolage Grotesque, sans-serif' }}>
          You might also like
        </h2>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {courses.slice(0, 4).map((course, i) => (
          <RecommendationCard key={course.id} course={course} i={i} />
        ))}
      </div>
    </motion.div>
  )
}
