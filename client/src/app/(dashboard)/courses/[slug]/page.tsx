'use client'

import { use, useMemo, useState, useEffect, Suspense } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, Star, Users, Clock, Globe, BookOpen,
  CheckCircle2, Play, Tag, AlertCircle, Zap,
  ShoppingCart, Tag as TagIcon, X, ChevronDown,
  Lock, Video, FileText, HelpCircle,
} from 'lucide-react'
import { useCourse } from '@/lib/api/courses'
import { useCourseProgress, useEnroll } from '@/lib/api/enrollments'
import { useRazorpayCheckout, useTabbyCheckout, useAbzerCheckout, useTamaraCheckout, useGatewayConfig, useValidateCoupon, useTabbyPrescore, useTamaraPrescore } from '@/lib/api/checkout'
import { TabbyProductPromo, TabbyCheckoutCard } from '@/components/payments/TabbyPromo'
import { TamaraProductWidget, TamaraCheckoutWidget } from '@/components/payments/TamaraWidget'
import { TabbyLogo } from '@/components/payments/TabbyLogo'
import { formatPrice } from '@/lib/formatPrice'
import { useCheckoutCurrency, coursePriceIn, discountedAmount } from '@/lib/coursePrice'
import { SHOW_PRICING } from '@/lib/pricingVisibility'
import { CertificateButton } from '@/components/learn/CertificateButton'
import { CourseReviews } from '@/components/courses/CourseReviews'
import { AINotesPanel } from '@/components/courses/AINotesPanel'
import { LiveClassesPanel } from '@/components/courses/LiveClassesPanel'
import { FavoriteButton } from '@/components/courses/FavoriteButton'
import { CourseRecommendations } from '@/components/courses/CourseRecommendations'
import Spinner from '@/components/ui/Spinner'
import { AvatarImg } from '@/components/ui/AvatarImg'

function fmt(mins: number) {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h > 0 ? `${h}h ${m > 0 ? m + 'm' : ''}`.trim() : `${m}m`
}

const LEVEL_COLOR: Record<string, { text: string; bg: string; border: string }> = {
  beginner:     { text: '#10B981', bg: 'rgba(16,185,129,0.10)',  border: 'rgba(16,185,129,0.25)'  },
  intermediate: { text: '#F59E0B', bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.25)'  },
  advanced:     { text: '#EF4444', bg: 'rgba(239,68,68,0.10)',  border: 'rgba(239,68,68,0.25)'   },
}

const whatYouLearn = [
  'Build real-world projects from scratch',
  'Master core concepts and best practices',
  'Understand industry-standard patterns',
  'Deploy and ship production-ready apps',
  'Get hands-on with guided exercises',
  'Access lifetime updates and new content',
]

/* ── Inner component: uses useSearchParams (must be inside Suspense) ── */
function CourseDetailInner({ slug }: { slug: string }) {
  const router = useRouter()
  const [checkoutStatus, setCheckoutStatus] = useState<string | null>(null)
  useEffect(() => {
    setCheckoutStatus(new URLSearchParams(window.location.search).get('checkout'))
  }, [])

  const { data, isLoading, isError } = useCourse(slug)
  const { data: progress } = useCourseProgress(slug)
  const enroll          = useEnroll()
  const { data: gatewayConfig } = useGatewayConfig()
  const isUAE           = gatewayConfig?.currency === 'AED'
  const checkoutCurrency = useCheckoutCurrency()
  const checkout        = useRazorpayCheckout()
  const tabbyCheckout   = useTabbyCheckout({ onError: msg => setEnrollError(msg) })
  const abzerCheckout   = useAbzerCheckout({ onError: msg => setEnrollError(msg) })
  const tamaraCheckout  = useTamaraCheckout({ onError: msg => setEnrollError(msg) })
  /* TEMPORARY — see lib/pricingVisibility.ts. Emptied at the SOURCE rather
     than hidden at each of the six places it reaches, because tabbyOffered and
     tamaraOffered feed the product promos, the checkout cards, the BNPL
     buttons and their pre-scoring queries. Cutting it here also stops the
     prescore requests firing for an option nobody can see. */
  const gateways        = SHOW_PRICING ? (gatewayConfig?.gateways ?? []) : []

  /* Tabby background pre-scoring — required by Tabby's QA before the option is
     shown, and the source of the AED figure the snippets must quote. */
  const tabbyOffered    = isUAE && gateways.includes('tabby')
  const { data: tabbyScore } = useTabbyPrescore(data?.course.id ?? '', tabbyOffered)
  const tabbyRejected   = tabbyScore?.available === false && !!tabbyScore?.message

  /* Tamara's own status-flow diagram models eligibility as the gate BEFORE a
     session exists — an ineligible customer has the option greyed out rather
     than being sent to the hosted page to be refused there. */
  const tamaraOffered   = isUAE && gateways.includes('tamara')
  const { data: tamaraScore } = useTamaraPrescore(data?.course.id ?? '', tamaraOffered)
  const tamaraRejected  = tamaraScore?.available === false
  const tamaraAmount    = tamaraScore?.amount ?? 0
  const tabbyAmount     = tabbyScore?.amount ?? 0

  const [enrollError,   setEnrollError]   = useState<string | null>(null)
  const [couponOpen,    setCouponOpen]     = useState(false)
  const [couponCode,    setCouponCode]     = useState('')
  const [appliedCoupon, setAppliedCoupon] = useState('')  // code that was confirmed

  /* Coupon validation — must be called unconditionally (Rules of Hooks).
     `data?.course.id ?? ''` ensures the hook is enabled only when id is known
     and the user has typed ≥2 chars. */
  const { data: couponInfo, isError: couponInvalid, isFetching: couponChecking } =
    useValidateCoupon(couponCode, data?.course.id ?? '')

  /* Group lessons under their section */
  const curriculum = useMemo(() => {
    if (!data) return []
    return data.sections.map(s => ({
      section: s.title,
      lessons: data.lessons.filter(l => l.sectionId === s.id),
    }))
  }, [data])

  if (isLoading) {
    return (
      <div className="flex h-[70vh] flex-col items-center justify-center gap-3">
        <Spinner size={30} />
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Loading course…</p>
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="flex h-[70vh] flex-col items-center justify-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-3xl"
          style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.18)' }}>
          <AlertCircle size={24} style={{ color: 'var(--color-danger)' }} />
        </div>
        <p className="text-base font-semibold" style={{ color: 'var(--color-text-primary)' }}>Course not found</p>
        <Link href="/courses" className="text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>
          ← Back to courses
        </Link>
      </div>
    )
  }

  const { course, lessons } = data
  const level = course.level ? LEVEL_COLOR[course.level] : null
  const totalLessons = lessons.length
  const isEnrolled   = progress?.isEnrolled ?? false
  const isPaid       = !course.isFree && course.price > 0

  /* Price in the student's checkout currency (AED for Middle-East residents
     via Abzer, INR otherwise) — the same amount the gateway will charge.
     Coupons apply in that display currency too: fixed coupons are minted per
     academy in the student's own currency. */
  const displayed       = coursePriceIn(course, checkoutCurrency)
  const discountedPrice = isPaid ? discountedAmount(displayed.amount, couponInfo) : displayed.amount

  const onEnroll = async () => {
    setEnrollError(null)
    try {
      await enroll.mutateAsync(course.id)
      const startLessonId = progress?.lastLessonId ?? lessons[0]?.id
      if (startLessonId) router.push(`/learn/${course.slug}/${startLessonId}`)
    } catch (err: any) {
      const msg = err?.response?.data?.error?.message
      setEnrollError(msg ?? 'Unable to enroll. Please try again.')
    }
  }

  const onCheckout = async () => {
    setEnrollError(null)
    if (isUAE) {
      abzerCheckout.mutate({ courseId: course.id, slug: course.slug, couponCode: couponCode || undefined })
      return
    }
    try {
      await checkout.mutateAsync({ courseId: course.id, couponCode: couponCode || undefined })
    } catch (err: any) {
      if (err?.message !== 'DISMISSED') {
        setEnrollError(err?.message ?? 'Unable to start checkout. Please try again.')
      }
    }
  }

  const continueLessonId = progress?.lastLessonId ?? lessons[0]?.id

  return (
    <div className="mx-auto max-w-5xl">
      {/* Back */}
      <motion.div initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 26 }} className="mb-6">
        <Link href="/courses" className="inline-flex items-center gap-1.5 text-sm transition-opacity hover:opacity-70"
          style={{ color: 'var(--color-text-muted)' }}>
          <ArrowLeft size={13} />Back to courses
        </Link>
      </motion.div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_340px]">
        {/* ── Left col ─────────────────────────────── */}
        <div>
          {/* Hero */}
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 26 }}>
            <div className="mb-3 flex items-center gap-2">
              {course.category && (
                <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--color-primary)' }}>
                  {course.category.name}
                </span>
              )}
              {course.level && level && (
                <>
                  <span style={{ color: 'var(--color-border)' }}>·</span>
                  <span className="rounded-lg px-2 py-0.5 text-[10px] font-bold capitalize"
                    style={{ background: level.bg, color: level.text, border: `1px solid ${level.border}` }}>
                    {course.level}
                  </span>
                </>
              )}
            </div>

            <h1 className="text-2xl sm:text-3xl font-bold leading-tight tracking-tight"
              style={{ color: 'var(--color-text-primary)', fontFamily: 'Bricolage Grotesque, sans-serif' }}>
              {course.title}
            </h1>

            <div className="mt-4 flex flex-wrap items-center gap-4">
              {course.ratingAvg > 0 && (
                <div className="flex items-center gap-1.5">
                  <div className="flex">
                    {[1,2,3,4,5].map(s => (
                      <Star key={s} size={14} fill={s <= Math.round(course.ratingAvg) ? '#F59E0B' : 'none'}
                        style={{ color: 'var(--color-warning)' }} />
                    ))}
                  </div>
                  <span className="text-sm font-bold" style={{ color: 'var(--color-warning)' }}>{course.ratingAvg.toFixed(1)}</span>
                  <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>({course.ratingCount.toLocaleString()} reviews)</span>
                </div>
              )}
              <div className="flex items-center gap-1.5 text-sm" style={{ color: 'var(--color-text-muted)' }}>
                <Users size={14} />{course.enrolledCount.toLocaleString()} students
              </div>
              {course.durationMins > 0 && (
                <div className="flex items-center gap-1.5 text-sm" style={{ color: 'var(--color-text-muted)' }}>
                  <Clock size={14} />{fmt(course.durationMins)} total
                </div>
              )}
              <div className="flex items-center gap-1.5 text-sm" style={{ color: 'var(--color-text-muted)' }}>
                <Globe size={14} />{course.language}
              </div>
            </div>

            {course.instructor && (
              <div className="mt-4 flex items-center gap-2.5">
                <div className="h-8 w-8 overflow-hidden rounded-full"
                  style={{ background: 'rgba(0,87,184,0.15)' }}>
                  <AvatarImg src={course.instructor.avatarUrl}
                    className="h-full w-full object-cover"
                    fallback={<div className="flex h-full w-full items-center justify-center text-xs font-bold"
                        style={{ color: 'var(--color-primary)' }}>
                        {course.instructor.name[0]}
                      </div>} />
                </div>
                <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                  Created by <span className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>{course.instructor.name}</span>
                </p>
              </div>
            )}
          </motion.div>

          {/* Thumbnail (mobile) */}
          {course.thumbnailUrl && (
            <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.06 }} className="mt-6 overflow-hidden rounded-2xl lg:hidden"
              style={{ border: '1px solid var(--color-border)' }}>
              <img src={course.thumbnailUrl} alt={course.title} className="w-full object-cover max-h-48 sm:max-h-60" />
            </motion.div>
          )}

          {/* Description */}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }} className="mt-8">
            <h2 className="mb-3 text-lg font-bold" style={{ color: 'var(--color-text-primary)', fontFamily: 'Bricolage Grotesque, sans-serif' }}>
              About this course
            </h2>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
              {course.description ?? 'No description available.'}
            </p>
          </motion.div>

          {/* What you'll learn */}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.14 }} className="mt-8 rounded-2xl p-5"
            style={{ background: 'var(--color-primary-light)', border: '1px solid rgba(0,87,184,0.14)' }}>
            <h2 className="mb-4 text-base font-bold" style={{ color: 'var(--color-text-primary)', fontFamily: 'Bricolage Grotesque, sans-serif' }}>
              What you&apos;ll learn
            </h2>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {whatYouLearn.map((item, i) => (
                <motion.div key={i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.18 + i * 0.04 }} className="flex items-start gap-2.5">
                  <CheckCircle2 size={15} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--color-success)' }} />
                  <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>{item}</p>
                </motion.div>
              ))}
            </div>
          </motion.div>

          {/* Curriculum */}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.18 }} className="mt-8">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-bold" style={{ color: 'var(--color-text-primary)', fontFamily: 'Bricolage Grotesque, sans-serif' }}>
                Course curriculum
              </h2>
              <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                {totalLessons} lessons · {lessons.filter(l => l.isFree).length} free preview
              </span>
            </div>
            <div className="space-y-2">
              {curriculum.map((s, i) => {
                const totalSecs = s.lessons.reduce((acc, l) => acc + l.durationMins, 0)
                return (
                  <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 + i * 0.04 }}
                    className="overflow-hidden rounded-xl bg-[var(--color-bg-surface)]"
                    style={{ border: '1px solid var(--color-border)' }}>
                    {/* Section header */}
                    <div className="flex items-center justify-between px-4 py-3"
                      style={{ background: 'var(--color-bg-inset)', borderBottom: s.lessons.length > 0 ? '1px solid var(--color-bg-muted)' : 'none' }}>
                      <div className="flex items-center gap-3">
                        <div className="flex h-7 w-7 items-center justify-center rounded-lg text-xs font-bold"
                          style={{ background: 'rgba(0,87,184,0.10)', color: 'var(--color-primary)' }}>{i + 1}</div>
                        <span className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>{s.section}</span>
                      </div>
                      <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                        <span>{s.lessons.length} lessons</span>
                        <span style={{ color: 'var(--color-border)' }}>·</span>
                        <span>{fmt(totalSecs)}</span>
                      </div>
                    </div>
                    {/* Lesson rows */}
                    {s.lessons.map((lesson, li) => {
                      const TypeIcon = lesson.type === 'video' ? Video
                        : lesson.type === 'quiz' ? HelpCircle : FileText
                      const canAccess = isEnrolled || lesson.isFree
                      return (
                        <div key={lesson.id}
                          className={`flex items-center gap-3 px-4 py-2.5 ${li < s.lessons.length - 1 ? 'border-b' : ''}`}
                          style={{ borderColor: 'var(--color-border)' }}>
                          {/* Icon */}
                          <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md"
                            style={{ background: canAccess ? 'rgba(0,87,184,0.08)' : 'rgba(156,163,175,0.10)' }}>
                            {canAccess
                              ? <TypeIcon size={11} style={{ color: 'var(--color-primary)' }} />
                              : <Lock size={10} style={{ color: 'var(--color-text-muted)' }} />}
                          </div>
                          {/* Title */}
                          <span className="flex-1 text-xs" style={{ color: canAccess ? 'var(--color-text-secondary)' : 'var(--color-text-muted)' }}>
                            {lesson.title}
                          </span>
                          {/* Right side */}
                          <div className="flex flex-shrink-0 items-center gap-2">
                            {lesson.isFree && !isEnrolled && (
                              <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                                style={{ background: 'rgba(16,185,129,0.10)', color: 'var(--color-success)' }}>
                                Preview
                              </span>
                            )}
                            <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                              {lesson.durationMins > 0 ? fmt(lesson.durationMins) : ''}
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </motion.div>
                )
              })}
            </div>
          </motion.div>

          {/* Tags */}
          {course.tags && course.tags.length > 0 && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}
              className="mt-8 flex flex-wrap items-center gap-2">
              <Tag size={13} style={{ color: 'var(--color-text-muted)' }} />
              {course.tags.map(t => (
                <span key={t} className="rounded-lg px-2.5 py-1 text-xs font-medium"
                  style={{ background: 'rgba(0,87,184,0.08)', color: 'var(--color-primary)', border: '1px solid rgba(0,87,184,0.16)' }}>
                  {t}
                </span>
              ))}
            </motion.div>
          )}

          {/* Live classes — only shows join buttons to enrolled students */}
          <LiveClassesPanel slug={course.slug} isEnrolled={isEnrolled} />

          {/* AI Study Notes */}
          <AINotesPanel slug={course.slug} />

          {/* Reviews */}
          <div className="mt-10">
            <CourseReviews
              courseId={course.id}
              slug={course.slug}
              canReview={isEnrolled}
              ratingAvg={course.ratingAvg}
              ratingCount={course.ratingCount}
            />
          </div>

          {/* Recommendations */}
          <CourseRecommendations slug={course.slug} />
        </div>

        {/* ── Right col — sticky CTA card ──────────── */}
        <div className="lg:relative">
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ delay: 0.08, type: 'spring', stiffness: 260, damping: 26 }}
            className="lg:sticky lg:top-[108px] overflow-hidden rounded-3xl bg-[var(--color-bg-surface)]"
            style={{ border: '1px solid var(--color-border)', boxShadow: '0 8px 32px rgba(13,15,26,0.10)' }}>

            {course.thumbnailUrl && (
              <div className="relative hidden overflow-hidden lg:block" style={{ height: 180 }}>
                <img src={course.thumbnailUrl} alt={course.title} className="h-full w-full object-cover" />
                <div className="absolute inset-0" style={{ background: 'rgba(13,15,26,0.40)' }} />
                <motion.div whileHover={{ scale: 1.1 }} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex h-14 w-14 cursor-pointer items-center justify-center rounded-full"
                  style={{ background: 'rgba(0,87,184,0.92)', backdropFilter: 'blur(8px)', boxShadow: '0 8px 24px rgba(0,87,184,0.45)' }}>
                  <Play size={18} fill="white" color="white" />
                </motion.div>
              </div>
            )}

            <div className="p-5">
              {/* ── Checkout result banners ─────────────── */}
              <AnimatePresence>
                {checkoutStatus === 'success' && (
                  <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
                    className="mb-4 rounded-xl px-4 py-3 text-sm font-semibold"
                    style={{ background: 'rgba(16,185,129,0.12)', color: 'var(--color-success)', border: '1px solid rgba(16,185,129,0.25)' }}>
                    🎉 Payment successful! You&apos;re enrolled.
                  </motion.div>
                )}
                {checkoutStatus === 'cancel' && (
                  <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
                    className="mb-4 rounded-xl px-4 py-3 text-sm font-semibold"
                    style={{ background: 'rgba(239,68,68,0.08)', color: 'var(--color-danger)', border: '1px solid rgba(239,68,68,0.18)' }}>
                    Payment cancelled. You were not charged.
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="mb-5 flex items-center gap-3">
                <div>
                  {!SHOW_PRICING ? null : isPaid && couponInfo ? (
                    <div className="flex items-baseline gap-2">
                      <p className="text-3xl font-bold" style={{ color: 'var(--color-text-primary)', fontFamily: 'Bricolage Grotesque, sans-serif' }}>
                        {formatPrice(discountedPrice, displayed.currency)}
                      </p>
                      <p className="text-sm line-through" style={{ color: 'var(--color-text-muted)' }}>
                        {formatPrice(displayed.amount, displayed.currency)}
                      </p>
                    </div>
                  ) : (
                    <p className="text-3xl font-bold" style={{ color: 'var(--color-text-primary)', fontFamily: 'Bricolage Grotesque, sans-serif' }}>
                      {course.isFree ? 'Free' : formatPrice(displayed.amount, displayed.currency)}
                    </p>
                  )}
                </div>
                {/* Product-page snippet. QA: shown for ALL items with no amount
                    limits of ours — Tabby decides eligibility, not us. */}
                {tabbyOffered && tabbyAmount > 0 && !isEnrolled && (
                  <TabbyProductPromo price={tabbyAmount} currency={tabbyScore?.currency ?? 'AED'} />
                )}
                {tamaraOffered && !tamaraRejected && tamaraAmount > 0 && !isEnrolled && (
                  <TamaraProductWidget price={tamaraAmount} />
                )}
                {isEnrolled && (
                  <span className="rounded-lg px-2 py-0.5 text-xs font-bold"
                    style={{ background: 'rgba(16,185,129,0.10)', color: 'var(--color-success)', border: '1px solid rgba(16,185,129,0.22)' }}>
                    Enrolled
                  </span>
                )}
              </div>

              {/* CTA */}
              {isEnrolled && continueLessonId ? (
                <Link href={`/learn/${course.slug}/${continueLessonId}`}>
                  <motion.button
                    whileHover={{ y: -2, boxShadow: '0 12px 32px rgba(0,87,184,0.40)' }}
                    whileTap={{ scale: 0.97 }}
                    className="flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-bold text-white transition-all"
                    style={{ background: 'var(--color-primary)', boxShadow: '0 6px 24px rgba(0,87,184,0.30)' }}>
                    <Play size={15} fill="white" />
                    Continue learning
                  </motion.button>
                </Link>
              ) : isPaid && !SHOW_PRICING ? (
                /* TEMPORARY — see lib/pricingVisibility.ts. With the gateways
                   hidden there is nothing for a Buy button to do, and a dead
                   button is worse than none: it invites a click that cannot
                   succeed. The enrolled path above is untouched, so anyone who
                   already owns the course still continues learning. */
                null
              ) : isPaid ? (
                <>
                  {/* Primary payment button */}
                  <motion.button
                    onClick={onCheckout}
                    disabled={checkout.isPending || abzerCheckout.isPending}
                    whileHover={{ y: -2, boxShadow: '0 12px 32px rgba(0,87,184,0.40)' }}
                    whileTap={{ scale: 0.97 }}
                    className="flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-bold text-white transition-all disabled:opacity-70"
                    style={{ background: 'var(--color-primary)', boxShadow: '0 6px 24px rgba(0,87,184,0.30)' }}>
                    {(checkout.isPending || abzerCheckout.isPending)
                      ? <><Spinner size={15} />Redirecting…</>
                      : isUAE
                        ? <><ShoppingCart size={15} />Pay with Abzer</>
                        : <><ShoppingCart size={15} />Buy for {formatPrice(discountedPrice, displayed.currency)}</>}
                  </motion.button>

                  {/* Tamara BNPL */}
                  {tamaraOffered && !tamaraRejected && (
                    <motion.button
                      onClick={() => { setEnrollError(null); tamaraCheckout.mutate({ courseId: course.id, slug: course.slug, couponCode: couponCode || undefined }) }}
                      disabled={tamaraCheckout.isPending || abzerCheckout.isPending}
                      whileHover={{ y: -1 }} whileTap={{ scale: 0.97 }}
                      className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-sm font-semibold transition-all disabled:opacity-70"
                      style={{ border: '1.5px solid #1EB59A', color: '#1EB59A' }}>
                      {tamaraCheckout.isPending
                        ? <><Spinner size={14} />Redirecting…</>
                        : <><ShoppingCart size={14} />Pay in 3 with Tamara</>}
                    </motion.button>
                  )}
                  {tamaraOffered && !tamaraRejected && tamaraAmount > 0 && (
                    <div className="mt-2">
                      <TamaraCheckoutWidget price={tamaraAmount} />
                    </div>
                  )}
                  {tamaraRejected && tamaraScore?.message && (
                    <p className="mt-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                      {tamaraScore.message}
                    </p>
                  )}

                  {/* Tabby BNPL. Shown unless Tabby's own pre-scoring declined
                      this customer — QA allows hiding on a decline, but requires
                      Tabby's wording whenever it is hidden for that reason. */}
                  {tabbyOffered && !tabbyRejected && (
                    <>
                      <motion.button
                        onClick={() => { setEnrollError(null); tabbyCheckout.mutate({ courseId: course.id, slug: course.slug, couponCode: couponCode || undefined }) }}
                        disabled={tabbyCheckout.isPending || abzerCheckout.isPending}
                        whileHover={{ y: -1 }} whileTap={{ scale: 0.97 }}
                        className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-sm font-semibold transition-all disabled:opacity-70"
                        style={{ border: '1.5px solid #3D1D8E', color: '#3D1D8E' }}>
                        {tabbyCheckout.isPending
                          ? <><Spinner size={14} />Redirecting…</>
                          : <>Pay in 4 with <TabbyLogo height={15} /></>}
                      </motion.button>
                      {/* TabbyCard sits under the payment method, per the
                          "Checkout snippet displays under Tabby payment method"
                          item on the QA checklist. */}
                      {tabbyAmount > 0 && (
                        <div className="mt-2">
                          <TabbyCheckoutCard price={tabbyAmount} currency={tabbyScore?.currency ?? 'AED'} />
                        </div>
                      )}
                    </>
                  )}

                  {tabbyRejected && (
                    <p className="mt-2 flex items-start gap-1.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                      <TabbyLogo height={12} className="mt-px flex-shrink-0" />
                      <span>{tabbyScore?.message}</span>
                    </p>
                  )}

                  {/* Coupon code accordion */}
                  <div className="mt-3">
                    <button onClick={() => setCouponOpen(o => !o)}
                      className="flex w-full items-center justify-between text-xs font-semibold transition-opacity hover:opacity-70"
                      style={{ color: 'var(--color-text-muted)' }}>
                      <span className="flex items-center gap-1">
                        <TagIcon size={11} />Have a promo code?
                      </span>
                      <ChevronDown size={12} className={`transition-transform ${couponOpen ? 'rotate-180' : ''}`} />
                    </button>
                    <AnimatePresence>
                      {couponOpen && (
                        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                          <div className="mt-2 flex gap-2">
                            <input
                              value={couponCode}
                              onChange={e => setCouponCode(e.target.value.toUpperCase())}
                              placeholder="PROMO10"
                              className="flex-1 rounded-xl px-3 py-2 text-xs outline-none"
                              style={{ background: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }}
                            />
                            {couponCode && (
                              <button onClick={() => setCouponCode('')}
                                className="flex h-9 w-9 items-center justify-center rounded-xl"
                                style={{ background: 'var(--color-bg-subtle)' }}>
                                <X size={12} style={{ color: 'var(--color-text-muted)' }} />
                              </button>
                            )}
                          </div>
                          <div className="mt-1 min-h-[16px]">
                            {couponChecking && (
                              <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>Checking…</p>
                            )}
                            {!couponChecking && couponInfo && (
                              <p className="text-[11px] font-semibold" style={{ color: 'var(--color-success)' }}>
                                ✓ {couponInfo.discountType === 'percent'
                                  ? `${couponInfo.discountValue}% off`
                                  : `$${couponInfo.discountValue} off`} applied
                              </p>
                            )}
                            {!couponChecking && couponCode.length >= 2 && couponInvalid && (
                              <p className="text-[11px]" style={{ color: 'var(--color-danger)' }}>Invalid or expired code</p>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </>
              ) : (
                <motion.button
                  onClick={onEnroll}
                  disabled={enroll.isPending}
                  whileHover={{ y: -2, boxShadow: '0 12px 32px rgba(0,87,184,0.40)' }}
                  whileTap={{ scale: 0.97 }}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-bold text-white transition-all disabled:opacity-70"
                  style={{ background: 'var(--color-primary)', boxShadow: '0 6px 24px rgba(0,87,184,0.30)' }}>
                  {enroll.isPending
                    ? <><Spinner size={15} />Enrolling…</>
                    : <><Zap size={15} fill="white" />Enroll for free</>}
                </motion.button>
              )}

              {enrollError && (
                <p className="mt-2.5 text-center text-xs" style={{ color: 'var(--color-danger)' }}>
                  {enrollError}
                </p>
              )}

              {!enrollError && (
                <p className="mt-2.5 text-center text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                  {isEnrolled
                    ? `${progress?.progressPercent ?? 0}% complete`
                    : isPaid
                      /* TEMPORARY — see lib/pricingVisibility.ts. A refund
                         promise is a statement about a purchase, and with
                         checkout hidden there is no purchase to refund. */
                      ? (SHOW_PRICING ? '30-day money-back guarantee' : 'Free preview included')
                      : 'Free preview included'}
                </p>
              )}

              {/* Certificate download — only when course is completed */}
              {progress?.status === 'completed' && progress.enrollmentId && (
                <div className="mt-4 flex justify-center">
                  <CertificateButton
                    enrollmentId={progress.enrollmentId}
                    courseTitle={course.title}
                  />
                </div>
              )}

              <div className="mt-3 flex justify-center">
                <FavoriteButton courseId={course.id} />
              </div>

              <div className="mt-5 space-y-3" style={{ borderTop: '1px solid var(--color-border)', paddingTop: 16 }}>
                {[
                  { icon: Clock,    label: 'Total duration', value: fmt(course.durationMins) },
                  { icon: BookOpen, label: 'Lectures',       value: `${totalLessons} lessons` },
                  { icon: Globe,    label: 'Language',       value: course.language },
                  { icon: Users,    label: 'Students',       value: course.enrolledCount.toLocaleString() },
                ].map(({ icon: Icon, label, value }) => (
                  <div key={label} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2" style={{ color: 'var(--color-text-muted)' }}>
                      <Icon size={13} />{label}
                    </div>
                    <span className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>{value}</span>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  )
}

/* ── Page shell: resolves dynamic params ── */
export default function CourseDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params)
  return <CourseDetailInner slug={slug} />
}
