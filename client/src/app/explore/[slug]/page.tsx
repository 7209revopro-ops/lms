'use client'
/* ─────────────────────────────────────────────────────────────
   /explore/<slug> — one course, public (2026-10-18): what it is, its full
   module list (titles only — no lesson content leaves the server for a visitor
   who has not enrolled; GET /courses/:slug strips it), the price for the
   chosen academy, and Buy → the course's checkout (through quick sign-up or
   sign-in when there is no session).
───────────────────────────────────────────────────────────── */
import { use, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowLeft, ArrowRight, BookOpen, Check, ChevronDown, Clock, FileText, Globe2, HelpCircle, Layers, PlayCircle, ShieldCheck, Signal, User,
} from 'lucide-react'
import { api } from '@/lib/axios'
import { GuestCheckout } from '@/components/explore/GuestCheckout'
import { TabbyProductPromo } from '@/components/payments/TabbyPromo'
import { TamaraProductWidget } from '@/components/payments/TamaraWidget'
import type { Course } from '@/types'
import type { CourseDetail, LessonOutline } from '@/lib/api/courses'
import {
  ExploreHeader, ExploreFooter, Thumb, useAcademy, useSignedIn, priceOf, onRequest, programOf, hours,
  checkoutPath, signUpHref, signInHref, ACADEMIES,
} from '@/components/explore/ExploreKit'

const LESSON_ICON = { video: PlayCircle, article: FileText, quiz: HelpCircle } as const

export default function ExploreCoursePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params)
  const [academy, setAcademy] = useAcademy()
  const signedIn = useSignedIn()
  const { data, isLoading, isError } = useQuery({
    queryKey: ['explore', 'course', slug],
    queryFn: async () => (await api.get<{ data: CourseDetail }>(`/courses/${encodeURIComponent(slug)}`)).data.data,
    retry: (n, err: any) => err?.response?.status !== 404 && n < 1,
    staleTime: 5 * 60_000,
  })

  return (
    <>
      <ExploreHeader academy={academy} onAcademy={setAcademy} signedIn={signedIn} />
      {isLoading && <div className="mx-auto h-[70vh] max-w-[1240px] animate-pulse px-4 py-16 sm:px-6"><div className="h-full rounded-3xl" style={{ background: 'var(--xp-card)' }} /></div>}
      {isError && (
        <div className="mx-auto max-w-[640px] px-4 py-24 text-center">
          <h1 className="xp-display text-3xl font-bold text-[var(--xp-text)]">This course isn&apos;t available</h1>
          <p className="mt-3" style={{ color: 'var(--xp-text-2)' }}>It may have been renamed or is not open for enrolment.</p>
          <Link href="/explore" className="mt-8 inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold text-white" style={{ background: 'var(--xp-blue)' }}>
            <ArrowLeft size={15} />All courses
          </Link>
        </div>
      )}
      {data && <CourseView detail={data} academy={academy} signedIn={signedIn} />}
      <ExploreFooter />
    </>
  )
}

function CourseView({ detail, academy, signedIn }: { detail: CourseDetail; academy: 'dubai' | 'bangalore'; signedIn: boolean | null }) {
  const { course, sections, lessons } = detail
  /* Buying with no account happens here (GuestCheckout); ?buy=1 — "back to checkout" from the return page — opens it. */
  const [buying, setBuying] = useState(false)
  useEffect(() => {
    if (signedIn === false && new URLSearchParams(window.location.search).get('buy') === '1') setBuying(true)
  }, [signedIn])
  const p = programOf(course.program)
  const price = priceOf(course, academy)

  const modules = useMemo(() => {
    const by = new Map<string, LessonOutline[]>()
    for (const l of lessons) by.set(l.sectionId, [...(by.get(l.sectionId) ?? []), l])
    return [...sections].sort((a, b) => a.order - b.order).map(s => ({
      ...s, lessons: (by.get(s.id) ?? []).sort((a, b) => a.order - b.order),
    }))
  }, [sections, lessons])
  const totalMins = lessons.reduce((s, l) => s + (l.durationMins ?? 0), 0) || course.durationMins
  /* A course owned by an admin account is not "taught by Super Admin" — no mentor line then. */
  const mentor = course.instructor?.name && !/admin/i.test(course.instructor.name) ? course.instructor.name : null
  useEffect(() => { document.title = `${course.title} | Delta Institutions` }, [course.title])

  return (
    <>
      {/* ── Head ─────────────────────────────────────── */}
      <section className="xp-grain relative overflow-hidden border-b" style={{ borderColor: 'var(--xp-line)' }}>
        <div className="xp-grid absolute inset-0" aria-hidden />
        <div className="absolute inset-0" aria-hidden style={{ background: `radial-gradient(700px 320px at 10% 0%, ${p.color}26, transparent 70%)` }} />
        <div className="relative mx-auto grid max-w-[1240px] gap-10 px-4 pb-12 pt-8 sm:px-6 lg:grid-cols-[1fr_380px] lg:pb-16 lg:pt-12">
          <div>
            <Link href="/explore" className="inline-flex items-center gap-1.5 text-sm font-medium hover:text-[var(--xp-blue)]" style={{ color: 'var(--xp-text-2)' }}>
              <ArrowLeft size={15} />All courses
            </Link>
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
              <p className="mt-8 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em]" style={{ color: p.color }}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: p.color }} />{p.label}
              </p>
              <h1 className="xp-display mt-3 max-w-[20ch] text-[38px] font-extrabold leading-[1.02] text-[var(--xp-text)] sm:text-[56px]">{course.title}</h1>
              {course.description && (
                <p className="mt-5 max-w-[62ch] whitespace-pre-line text-base leading-relaxed" style={{ color: 'var(--xp-text-2)' }}>{course.description}</p>
              )}
              <div className="mt-8 grid max-w-[640px] grid-cols-2 gap-px overflow-hidden rounded-2xl border sm:grid-cols-4"
                style={{ borderColor: 'var(--xp-line)', background: 'var(--xp-line)' }}>
                {[
                  [Layers, `${modules.length}`, 'modules'],
                  [BookOpen, `${lessons.length}`, 'lessons'],
                  totalMins ? [Clock, hours(totalMins), 'of content'] : [Clock, 'Live', 'with your mentor'],
                  [Signal, course.level ? course.level[0]!.toUpperCase() + course.level.slice(1) : 'All levels', 'level'],
                ].map(([Icon, v, l]) => {
                  const I = Icon as typeof Layers
                  return (
                    <div key={l as string} className="p-4" style={{ background: 'var(--xp-bg-2)' }}>
                      <I size={15} style={{ color: 'var(--xp-muted)' }} />
                      <p className="xp-mono mt-2 text-lg font-semibold text-[var(--xp-text)]">{v as string}</p>
                      <p className="text-[11px] uppercase tracking-[0.14em]" style={{ color: 'var(--xp-muted)' }}>{l as string}</p>
                    </div>
                  )
                })}
              </div>
              <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm" style={{ color: 'var(--xp-text-2)' }}>
                {mentor && <span className="inline-flex items-center gap-2"><User size={15} style={{ color: 'var(--xp-muted)' }} />Mentor: <b className="font-semibold text-[var(--xp-text)]">{mentor}</b></span>}
                {course.language && <span className="inline-flex items-center gap-2"><Globe2 size={15} style={{ color: 'var(--xp-muted)' }} />{course.language}</span>}
              </div>
            </motion.div>
          </div>

          <BuyCard course={course} academy={academy} price={price} signedIn={signedIn} onBuy={() => setBuying(true)} />
        </div>
      </section>

      {/* ── Syllabus ─────────────────────────────────── */}
      <section className="mx-auto max-w-[1240px] px-4 py-12 sm:px-6 sm:py-16">
        <div className="max-w-[820px]">
          <div className="mb-6 flex items-end justify-between gap-4">
            <h2 className="xp-display text-3xl font-bold text-[var(--xp-text)]">What you&apos;ll study</h2>
            <span className="xp-mono shrink-0 text-xs" style={{ color: 'var(--xp-muted)' }}>{modules.length} MODULES · {lessons.length} LESSONS</span>
          </div>
          {modules.length === 0
            ? <p style={{ color: 'var(--xp-text-2)' }}>The module list is being prepared.</p>
            : <div className="overflow-hidden rounded-2xl border" style={{ borderColor: 'var(--xp-line)' }}>
                {modules.map((m, i) => <ModuleRow key={m.id} index={i} title={m.title} lessons={m.lessons} accent={p.color} defaultOpen={i === 0} />)}
              </div>}
        </div>
      </section>

      {/* A bar that keeps Buy in reach on a phone once the card scrolls away. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t p-3 backdrop-blur-xl lg:hidden"
        style={{ borderColor: 'var(--xp-line)', background: 'rgba(246,245,241,0.92)', paddingBottom: 'calc(12px + env(safe-area-inset-bottom))' }}>
        <div className="mx-auto flex max-w-[640px] items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-xs" style={{ color: 'var(--xp-muted)' }}>{course.title}</p>
            <p className="xp-mono text-lg font-semibold text-[var(--xp-text)]">{price ?? 'Free'}</p>
          </div>
          {!onRequest(course, academy) && <BuyButton slug={course.slug} free={!price} signedIn={signedIn} onBuy={() => setBuying(true)} compact />}
        </div>
      </div>
      <div className="h-20 lg:hidden" />
      <GuestCheckout open={buying} onClose={() => setBuying(false)} slug={course.slug} academy={academy} />
    </>
  )
}

function BuyCard({ course, academy, price, signedIn, onBuy }: { course: Course; academy: 'dubai' | 'bangalore'; price: string | null; signedIn: boolean | null; onBuy: () => void }) {
  const aed = academy === 'dubai'
  return (
    <motion.aside initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55, delay: 0.1 }}
      className="h-fit overflow-hidden rounded-3xl border lg:sticky lg:top-24"
      style={{ borderColor: 'var(--xp-line-2)', background: 'var(--xp-card)', boxShadow: '0 30px 70px -36px rgba(11,22,48,.35)' }}>
      <Thumb course={course} className="aspect-[16/9]" />
      <div className="p-6">
        <p className="text-xs uppercase tracking-[0.16em]" style={{ color: 'var(--xp-muted)' }}>{price ? `Course fee · ${ACADEMIES[academy].currency}` : 'Free course'}</p>
        <p className="xp-mono mt-1 text-[34px] font-semibold leading-tight text-[var(--xp-text)]">{price ?? 'Free'}</p>
        {/* Tabby's and Tamara's product snippets — for every visitor on the UAE side, with no amount limit (their QA). */}
        {aed && price && !onRequest(course, academy) && course.priceAED != null && course.priceAED > 0 && (
          <div className="mt-3 space-y-2">
            <TabbyProductPromo price={course.priceAED} currency="AED" />
            <TamaraProductWidget price={course.priceAED} />
          </div>
        )}
        <div className="mt-5">
          {onRequest(course, academy)
            ? <p className="rounded-2xl p-4 text-sm" style={{ background: 'var(--xp-bg-2)', color: 'var(--xp-text-2)' }}>Enrolment for this course is through your Delta counsellor.</p>
            : <BuyButton slug={course.slug} free={!price} signedIn={signedIn} onBuy={onBuy} />}
        </div>
        {!signedIn && signedIn !== null && !onRequest(course, academy) && (
          <p className="mt-3 text-center text-sm" style={{ color: 'var(--xp-text-2)' }}>
            Already a student? <Link href={signInHref(course.slug)} className="font-semibold text-[var(--xp-text)] underline-offset-4 hover:underline">Sign in</Link>
          </p>
        )}
        <ul className="mt-6 space-y-2.5 border-t pt-5 text-sm" style={{ borderColor: 'var(--xp-line)', color: 'var(--xp-text-2)' }}>
          {['Full access to every module once enrolled', 'Live classes with your mentor', 'Learn on the web or the Delta app'].map(t => (
            <li key={t} className="flex gap-2.5"><Check size={16} className="mt-0.5 shrink-0" style={{ color: 'var(--xp-up)' }} />{t}</li>
          ))}
        </ul>
        {price && !onRequest(course, academy) && (
          <div className="mt-5 rounded-2xl p-4 text-xs leading-relaxed" style={{ background: 'var(--xp-bg-2)', color: 'var(--xp-text-2)' }}>
            <p className="mb-1.5 flex items-center gap-1.5 font-semibold text-[var(--xp-text)]"><ShieldCheck size={14} style={{ color: 'var(--xp-up)' }} />Secure checkout</p>
            {aed ? 'Pay by card, or split it with Tabby or Tamara where your order qualifies.' : 'Pay with UPI, cards or net banking through Razorpay.'}
          </div>
        )}
      </div>
    </motion.aside>
  )
}

/* Buy: signed in → the app's own checkout for the course (its four gateways); no account → the checkout
   right here (GuestCheckout), the account made once paid. A free course → the ordinary sign-up. */
function BuyButton({ slug, free, signedIn, onBuy, compact }: { slug: string; free: boolean; signedIn: boolean | null; onBuy: () => void; compact?: boolean }) {
  const label = free ? 'Enrol for free' : 'Buy now'
  const cls = `group inline-flex items-center justify-center gap-2 rounded-2xl font-semibold text-white transition-[filter,transform] hover:brightness-110 active:scale-[0.99] ${compact ? 'px-5 py-3 text-sm' : 'w-full px-6 py-4 text-base'}`
  const style = { background: 'linear-gradient(135deg, #0a6be0, #0057b8)', boxShadow: '0 12px 26px -12px rgba(0,87,184,.6)' }
  const inner = <>{label}<ArrowRight size={17} className="transition-transform group-hover:translate-x-0.5" /></>
  if (signedIn || free) return <Link href={signedIn ? checkoutPath(slug) : signUpHref(slug)} className={cls} style={style}>{inner}</Link>
  return <button type="button" onClick={onBuy} disabled={signedIn === null} className={`${cls} disabled:opacity-70`} style={style}>{inner}</button>
}

function ModuleRow({ index, title, lessons, accent, defaultOpen }: { index: number; title: string; lessons: LessonOutline[]; accent: string; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const mins = lessons.reduce((s, l) => s + (l.durationMins ?? 0), 0)
  return (
    <div className="border-b last:border-b-0" style={{ borderColor: 'var(--xp-line)', background: open ? 'var(--xp-card)' : 'var(--xp-bg-2)' }}>
      <button onClick={() => setOpen(v => !v)} aria-expanded={open} className="flex w-full items-center gap-4 px-5 py-4 text-left sm:px-6">
        <span className="xp-mono w-8 shrink-0 text-sm font-semibold" style={{ color: open ? accent : 'var(--xp-muted)' }}>{String(index + 1).padStart(2, '0')}</span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-[var(--xp-text)]">{title}</span>
          <span className="xp-mono mt-0.5 block text-[11px]" style={{ color: 'var(--xp-muted)' }}>
            {lessons.length} {lessons.length === 1 ? 'lesson' : 'lessons'}{mins ? ` · ${hours(mins)}` : ''}
          </span>
        </span>
        <ChevronDown size={18} className="shrink-0 transition-transform" style={{ color: 'var(--xp-muted)', transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>
      <AnimatePresence initial={false}>
        {open && lessons.length > 0 && (
          <motion.ul initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }} className="overflow-hidden">
            {lessons.map(l => {
              const I = LESSON_ICON[l.type] ?? PlayCircle
              return (
                <li key={l.id} className="flex items-center gap-3 px-5 py-2.5 pl-[68px] text-sm sm:px-6 sm:pl-[72px]" style={{ color: 'var(--xp-text-2)' }}>
                  <I size={15} className="shrink-0" style={{ color: 'var(--xp-muted)' }} />
                  <span className="min-w-0 flex-1 truncate">{l.title}</span>
                  {l.isFree && <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide" style={{ background: `${accent}22`, color: accent }}>Preview</span>}
                  {l.durationMins > 0 && <span className="xp-mono shrink-0 text-xs" style={{ color: 'var(--xp-muted)' }}>{l.durationMins}m</span>}
                </li>
              )
            })}
            <li className="h-2" />
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  )
}
