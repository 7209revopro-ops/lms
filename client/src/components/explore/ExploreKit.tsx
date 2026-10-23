'use client'
/* ─────────────────────────────────────────────────────────────
   Shared pieces of the public catalogue (/explore, 2026-10-18): the header,
   the academy switch (Dubai · AED / India · INR — each academy's own courses
   and the shared ones, priced in what its checkout charges), the course card
   and the "buy" links.

   Buying goes through the existing checkout: the signed-in course page
   (/courses/<slug>) already runs Abzer, Tabby, Tamara and Razorpay. A visitor
   with no account is sent to the quick sign-up, which returns them there
   (?from=, lib/safeRedirect.ts).
───────────────────────────────────────────────────────────── */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { ArrowUpRight, BookOpen, Clock, Layers } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/axios'
import { formatPrice } from '@/lib/formatPrice'
import type { Course } from '@/types'

export type Academy = 'dubai' | 'bangalore'
export const ACADEMIES: Record<Academy, { label: string; short: string; currency: 'AED' | 'INR' }> = {
  dubai:     { label: 'Dubai',  short: 'UAE',   currency: 'AED' },
  bangalore: { label: 'India',  short: 'India', currency: 'INR' },
}

export const PROGRAMS: Record<string, { label: string; color: string; glyph: string }> = {
  '4x-trading':        { label: 'Forex & Trading',   color: '#12924a', glyph: 'FX' },
  'digital-marketing': { label: 'Digital Marketing', color: '#0e7fc4', glyph: 'DM' },
  ai:                  { label: 'AI',                color: '#7c3aed', glyph: 'AI' },
  jura:                { label: 'Law & HR',          color: '#b7791f', glyph: 'HR' },
}
export const programOf = (p?: string) => PROGRAMS[p ?? ''] ?? { label: 'Course', color: '#0057b8', glyph: 'DI' }

/* ── The academy switch: remembered on this device; first guess from the visitor's clock. ── */
const KEY = 'explore-academy'
export function useAcademy(): [Academy, (a: Academy) => void] {
  const [a, setA] = useState<Academy>('dubai')
  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY)
      if (saved === 'dubai' || saved === 'bangalore') { setA(saved); return }
    } catch { /* private mode */ }
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? ''
    if (/Kolkata|Calcutta/.test(tz)) setA('bangalore')
  }, [])
  const set = (v: Academy) => { setA(v); try { localStorage.setItem(KEY, v) } catch { /* private mode */ } }
  return [a, set]
}

/** Signed in as a student? (Decides where Buy goes — no redirect when not.) */
export function useSignedIn(): boolean | null {
  const { data, isError, isLoading } = useQuery({
    queryKey: ['explore', 'me'],
    queryFn: async () => (await api.get('/auth/me')).data?.data?.user ?? null,
    /* A signed-out visitor answers 401: once per visit is enough. */
    retry: false, retryOnMount: false, refetchOnWindowFocus: false, refetchOnReconnect: false, staleTime: 10 * 60_000,
  })
  if (isLoading) return null
  return !isError && !!data
}

/** The price this academy's checkout charges, formatted; null for a free course. A paid course whose
    academy price is set to 0 is "on request" — never offered for sale at nothing. */
export function priceOf(c: Course, academy: Academy): string | null {
  if (c.isFree || !(c.price > 0)) return null
  if (onRequest(c, academy)) return 'On request'
  const cur = ACADEMIES[academy].currency
  const amount = cur === 'AED' ? c.priceAED : c.priceINR
  return amount != null ? formatPrice(amount, cur, 'en-US') : formatPrice(c.price, 'USD', 'en-US')
}
export function onRequest(c: Course, academy: Academy): boolean {
  if (c.isFree || !(c.price > 0)) return false
  const amount = ACADEMIES[academy].currency === 'AED' ? c.priceAED : c.priceINR
  return amount != null && !(amount > 0)
}

/** Where "Buy" / "Enrol" goes: the course's checkout, through sign-up when there is no account. */
export const checkoutPath = (slug: string) => `/courses/${slug}`
export const signUpHref = (slug: string) => `/register?from=${encodeURIComponent(checkoutPath(slug))}`
export const signInHref = (slug: string) => `/login?from=${encodeURIComponent(checkoutPath(slug))}`

export function ExploreHeader({ academy, onAcademy, signedIn, academyLocked }: {
  academy: Academy; onAcademy: (a: Academy) => void; signedIn: boolean | null; academyLocked?: boolean
}) {
  return (
    <header className="sticky top-0 z-40 border-b backdrop-blur-xl" style={{ borderColor: 'var(--xp-line)', background: 'rgba(246,245,241,0.82)' }}>
      <div className="mx-auto flex h-16 max-w-[1240px] items-center gap-3 px-4 sm:h-[72px] sm:px-6">
        <Link href="/explore" className="flex shrink-0 items-center gap-3" aria-label="Delta Institutions — all courses">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-email.png" alt="Delta Institutions" className="h-7 w-auto sm:h-8" />
        </Link>
        <span className="hidden h-5 w-px sm:block" style={{ background: 'var(--xp-line-2)' }} />
        <span className="hidden text-xs font-medium uppercase tracking-[0.18em] sm:block" style={{ color: 'var(--xp-muted)' }}>Courses</span>

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          {!academyLocked && <AcademySwitch value={academy} onChange={onAcademy} />}
          {signedIn ? (
            <Link href="/my-learning" className="rounded-full px-4 py-2 text-sm font-semibold text-white" style={{ background: 'var(--xp-blue)' }}>
              My learning
            </Link>
          ) : (
            <>
              <Link href="/login" className="hidden rounded-full px-3 py-2 text-sm font-medium sm:block" style={{ color: 'var(--xp-text-2)' }}>Sign in</Link>
              <Link href="/register" className="rounded-full px-4 py-2 text-sm font-semibold text-white" style={{ background: 'var(--xp-blue)' }}>
                Get started
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  )
}

export function AcademySwitch({ value, onChange }: { value: Academy; onChange: (a: Academy) => void }) {
  return (
    <div role="radiogroup" aria-label="Academy and currency" className="relative flex rounded-full border p-0.5"
      style={{ borderColor: 'var(--xp-line-2)', background: 'var(--xp-bg-2)' }}>
      {(Object.keys(ACADEMIES) as Academy[]).map(k => {
        const on = k === value
        return (
          <button key={k} role="radio" aria-checked={on} onClick={() => onChange(k)}
            className="relative z-10 rounded-full px-2.5 py-1.5 text-[11px] font-semibold sm:px-3.5 sm:text-xs"
            style={{ color: on ? 'var(--xp-text)' : 'var(--xp-muted)' }}>
            {on && <motion.span layoutId="xp-academy" className="absolute inset-0 -z-10 rounded-full" style={{ background: 'var(--xp-card)', boxShadow: '0 1px 2px rgba(11,22,48,.08), inset 0 0 0 1px var(--xp-line-2)' }} transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
            {ACADEMIES[k].short}<span className="xp-mono ml-1.5 opacity-60">{ACADEMIES[k].currency}</span>
          </button>
        )
      })}
    </div>
  )
}

/* A course with no thumbnail gets a drawn one: its programme's colour, a chart line, its initials. */
export function Thumb({ course, className = '' }: { course: Course; className?: string }) {
  const p = programOf(course.program)
  const [broken, setBroken] = useState(false)
  if (course.thumbnailUrl && !broken) {
    return (
      <div className={`xp-thumb relative overflow-hidden ${className}`} style={{ background: 'var(--xp-bg-2)' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={course.thumbnailUrl} alt="" loading="lazy" onError={() => setBroken(true)} className="h-full w-full object-cover" />
        <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, transparent 60%, rgba(11,22,48,0.25))' }} />
      </div>
    )
  }
  const seed = [...course.title].reduce((s, ch) => (s * 31 + ch.charCodeAt(0)) % 9973, 7)
  const pts = Array.from({ length: 12 }, (_, i) => {
    const y = 70 - ((Math.sin(seed + i * 1.3) + 1) * 18 + i * 2.6)
    return `${i * 30},${Math.max(8, Math.min(88, y)).toFixed(1)}`
  }).join(' ')
  return (
    <div className={`xp-thumb relative overflow-hidden ${className}`}
      style={{ background: `radial-gradient(120% 90% at 0% 0%, ${p.color}24, transparent 60%), var(--xp-bg-2)` }}>
      <svg viewBox="0 0 330 100" preserveAspectRatio="none" className="absolute inset-x-0 bottom-0 h-3/5 w-full" aria-hidden>
        <polyline points={pts} fill="none" stroke={p.color} strokeWidth="1.6" strokeOpacity="0.85" vectorEffect="non-scaling-stroke" />
        <polygon points={`0,100 ${pts} 330,100`} fill={p.color} fillOpacity="0.08" />
      </svg>
      <span className="xp-display absolute left-4 top-3 text-4xl font-extrabold" style={{ color: `${p.color}b3` }}>{p.glyph}</span>
    </div>
  )
}

export function CourseCard({ course, academy, index }: { course: Course; academy: Academy; index: number }) {
  const p = programOf(course.program)
  const price = priceOf(course, academy)
  const lessons = course.lessonCount ?? 0
  return (
    <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: Math.min(index, 8) * 0.05, ease: [0.2, 0.7, 0.2, 1] }}>
      <Link href={`/explore/${course.slug}`}
        className="xp-card group relative flex h-full flex-col overflow-hidden rounded-2xl border"
        style={{ borderColor: 'var(--xp-line)', background: 'var(--xp-card)' }}>
        <span className="xp-accent absolute inset-x-0 top-0 z-10 h-[2px]" style={{ background: p.color }} />
        <Thumb course={course} className="aspect-[16/9]" />
        <div className="flex flex-1 flex-col p-5">
          <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em]">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: p.color }} />
            <span style={{ color: p.color }}>{p.label}</span>
            {course.level && <span style={{ color: 'var(--xp-muted)' }}>· {course.level}</span>}
          </div>
          <h3 className="xp-display text-[19px] font-bold leading-snug text-[var(--xp-text)]">{course.title}</h3>
          {course.instructor?.name && !/admin/i.test(course.instructor.name) && <p className="mt-1.5 text-sm" style={{ color: 'var(--xp-text-2)' }}>with {course.instructor.name}</p>}
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-xs" style={{ color: 'var(--xp-muted)' }}>
            {lessons > 0 && <span className="inline-flex items-center gap-1.5"><BookOpen size={13} />{lessons} lessons</span>}
            {course.durationMins > 0 && <span className="inline-flex items-center gap-1.5"><Clock size={13} />{hours(course.durationMins)}</span>}
            {course.language && <span className="inline-flex items-center gap-1.5"><Layers size={13} />{course.language}</span>}
          </div>
          <div className="mt-auto flex items-end justify-between pt-5">
            <span className="xp-mono text-lg font-semibold" style={{ color: price ? 'var(--xp-text)' : 'var(--xp-up)' }}>{price ?? 'Free'}</span>
            <span className="inline-flex items-center gap-1 text-sm font-semibold transition-colors group-hover:text-[var(--xp-blue)]" style={{ color: 'var(--xp-text-2)' }}>
              View course<ArrowUpRight size={15} className="transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </span>
          </div>
        </div>
      </Link>
    </motion.div>
  )
}

export function hours(mins: number) {
  if (mins < 60) return `${mins} min`
  const h = Math.round(mins / 6) / 10
  return `${h % 1 === 0 ? h.toFixed(0) : h} h`
}

export function ExploreFooter() {
  return (
    <footer className="border-t" style={{ borderColor: 'var(--xp-line)' }}>
      <div className="mx-auto flex max-w-[1240px] flex-col items-start justify-between gap-4 px-4 py-10 text-sm sm:flex-row sm:items-center sm:px-6" style={{ color: 'var(--xp-muted)' }}>
        <span>© {new Date().getFullYear()} Delta Institutions</span>
        <div className="flex gap-5">
          <Link href="/explore" className="hover:text-[var(--xp-blue)]">All courses</Link>
          <Link href="/login" className="hover:text-[var(--xp-blue)]">Student sign in</Link>
        </div>
      </div>
    </footer>
  )
}
