'use client'
/* ─────────────────────────────────────────────────────────────
   /explore — every published course, public (2026-10-18). The academy switch
   shows that academy's own courses and the shared ones (GET /courses?academy=)
   priced in what its checkout charges; a signed-in student always sees their
   own academy's. Each card opens /explore/<slug>: the modules and Buy.
───────────────────────────────────────────────────────────── */
import { Suspense, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { Search, X } from 'lucide-react'
import { api } from '@/lib/axios'
import type { Course } from '@/types'
import {
  ExploreHeader, ExploreFooter, CourseCard, useAcademy, useSignedIn, priceOf, programOf, PROGRAMS, ACADEMIES, type Academy,
} from '@/components/explore/ExploreKit'

function useCatalogue(academy: Academy) {
  return useQuery({
    queryKey: ['explore', 'courses', academy],
    queryFn: async () => (await api.get<{ data: Course[] }>('/courses', { params: { per_page: 100, academy, sort: 'popular' } })).data.data,
    staleTime: 5 * 60_000,
  })
}

/* A link can lock the page to one programme (and academy) — for an ad or a counsellor's message:
   /explore?program=forex, &academy=dubai|bangalore. Short names accepted. */
const PROGRAM_ALIAS: Record<string, string> = {
  forex: '4x-trading', trading: '4x-trading', fx: '4x-trading', '4x-trading': '4x-trading',
  dm: 'digital-marketing', marketing: 'digital-marketing', 'digital-marketing': 'digital-marketing',
  ai: 'ai', law: 'jura', hr: 'jura', jura: 'jura',
}

function ExploreInner() {
  const params = useSearchParams()
  const lockedProgram = PROGRAM_ALIAS[(params.get('program') ?? params.get('category') ?? '').toLowerCase()] ?? null
  const lockedAcademy = params.get('academy') === 'dubai' || params.get('academy') === 'bangalore' ? params.get('academy') as Academy : null
  const [chosenAcademy, setAcademy] = useAcademy()
  const academy = lockedAcademy ?? chosenAcademy
  const signedIn = useSignedIn()
  const { data: courses, isLoading, isError, refetch } = useCatalogue(academy)
  const [chosenProgram, setProgram] = useState<string>('all')
  const program = lockedProgram ?? chosenProgram
  const [q, setQ] = useState('')

  /* Programmes in a fixed order, Forex first; a programme with no course here is not offered. */
  const programs = useMemo(() => {
    const counts = new Map<string, number>()
    for (const c of courses ?? []) counts.set(c.program ?? 'other', (counts.get(c.program ?? 'other') ?? 0) + 1)
    return [...Object.keys(PROGRAMS), 'other'].filter(p => counts.has(p)).map(p => ({ key: p, n: counts.get(p)! }))
  }, [courses])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (courses ?? [])
      .filter(c => program === 'all' || (c.program ?? 'other') === program)
      .filter(c => !needle || c.title.toLowerCase().includes(needle) || c.instructor?.name?.toLowerCase().includes(needle) || c.description?.toLowerCase().includes(needle))
  }, [courses, program, q])

  const totalLessons = (courses ?? []).reduce((s, c) => s + (c.lessonCount ?? 0), 0)

  return (
    <>
      <ExploreHeader academy={academy} onAcademy={setAcademy} signedIn={signedIn} academyLocked={!!lockedAcademy} />

      {/* ── Hero ─────────────────────────────────────── */}
      <section className="xp-grain relative overflow-hidden">
        <div className="xp-grid absolute inset-0" aria-hidden />
        <div className="xp-glow absolute inset-0" aria-hidden />
        <div className="relative mx-auto max-w-[1240px] px-4 pb-14 pt-14 sm:px-6 sm:pb-20 sm:pt-24">
          <motion.p initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
            className="xp-mono mb-5 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.2em]"
            style={{ borderColor: 'var(--xp-line-2)', color: 'var(--xp-text-2)' }}>
            <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: 'var(--xp-up)' }} />
            Enrolment open · {ACADEMIES[academy].label} academy
          </motion.p>
          <motion.h1 initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.05 }}
            className="xp-display max-w-[16ch] text-[44px] font-extrabold leading-[0.98] text-[var(--xp-text)] sm:text-[76px]">
            Learn it from the <span style={{ color: 'var(--xp-blue)' }}>desk</span>, not the textbook.
          </motion.h1>
          <motion.p initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.12 }}
            className="mt-6 max-w-[54ch] text-base leading-relaxed sm:text-lg" style={{ color: 'var(--xp-text-2)' }}>
            Every Delta Institutions programme — live mentor-led classes, recorded modules and practice — with the full
            syllabus laid out before you enrol.
          </motion.p>

          <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.2 }}
            className="mt-10 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
            <label className="flex w-full max-w-md items-center gap-3 rounded-2xl border px-4 py-3.5 focus-within:border-[var(--xp-blue)]"
              style={{ borderColor: 'var(--xp-line-2)', background: '#ffffff' }}>
              <Search size={18} style={{ color: 'var(--xp-muted)' }} />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search a course, topic or mentor"
                className="w-full border-0 bg-transparent p-0 text-[15px] text-[var(--xp-text)] shadow-none outline-none ring-0 placeholder:text-[var(--xp-muted)] focus:ring-0"
                style={{ background: 'transparent', color: 'var(--xp-text)', colorScheme: 'light', boxShadow: 'none' }} />
              {q && <button onClick={() => setQ('')} aria-label="Clear search" style={{ color: 'var(--xp-muted)' }}><X size={16} /></button>}
            </label>
            <dl className="flex gap-8 sm:gap-10">
              {[[courses?.length ?? '—', 'courses'], [totalLessons || '—', 'lessons'], [programs.length || '—', 'programmes']].map(([n, l]) => (
                <div key={l as string}>
                  <dt className="xp-mono text-2xl font-semibold text-[var(--xp-text)] sm:text-3xl">{n}</dt>
                  <dd className="mt-0.5 text-xs uppercase tracking-[0.16em]" style={{ color: 'var(--xp-muted)' }}>{l}</dd>
                </div>
              ))}
            </dl>
          </motion.div>
        </div>
      </section>

      {/* ── The quote board ──────────────────────────── */}
      {!!courses?.length && (
        <div className="xp-ticker overflow-hidden border-y py-3" style={{ borderColor: 'var(--xp-line)', background: 'var(--xp-bg-2)' }} aria-hidden>
          <div className="xp-ticker-track">
            {[0, 1].map(copy => (
              <div key={copy} className="flex shrink-0">
                {courses.map(c => (
                  <span key={`${copy}-${c.id}`} className="xp-mono flex items-center gap-2.5 whitespace-nowrap px-6 text-[13px]">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: programOf(c.program).color }} />
                    <span style={{ color: 'var(--xp-text-2)' }}>{c.title.toUpperCase()}</span>
                    <span style={{ color: priceOf(c, academy) ? 'var(--xp-text)' : 'var(--xp-up)' }}>{priceOf(c, academy) ?? 'FREE'}</span>
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Catalogue ────────────────────────────────── */}
      <main className="mx-auto max-w-[1240px] px-4 py-12 sm:px-6 sm:py-16">
        <div className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="xp-display text-3xl font-bold text-[var(--xp-text)] sm:text-4xl">{lockedProgram ? `${programOf(lockedProgram).label} courses` : 'All courses'}</h2>
            <p className="mt-2 text-sm" style={{ color: 'var(--xp-muted)' }}>
              Prices in {ACADEMIES[academy].currency} — what you pay at checkout{academy === 'dubai' ? ', with Tabby and Tamara instalments where offered' : ''}.
            </p>
          </div>
          {!lockedProgram && <div className="xp-noscroll -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0" role="tablist" aria-label="Programme">
            {[{ key: 'all', n: courses?.length ?? 0 }, ...programs].map(p => {
              const on = program === p.key
              const meta = p.key === 'all' ? { label: 'All', color: '#0057b8' } : programOf(p.key)
              return (
                <button key={p.key} role="tab" aria-selected={on} onClick={() => setProgram(p.key)}
                  className="xp-chip inline-flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium"
                  style={on
                    ? { borderColor: meta.color, background: `${meta.color}14`, color: 'var(--xp-text)' }
                    : { borderColor: 'var(--xp-line-2)', color: 'var(--xp-text-2)' }}>
                  {meta.label}<span className="xp-mono text-xs opacity-60">{p.n}</span>
                </button>
              )
            })}
          </div>}
        </div>

        {isLoading && (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="h-[380px] animate-pulse rounded-2xl border" style={{ borderColor: 'var(--xp-line)', background: 'var(--xp-card)' }} />
            ))}
          </div>
        )}
        {isError && (
          <div className="rounded-2xl border p-10 text-center" style={{ borderColor: 'var(--xp-line)', background: 'var(--xp-card)' }}>
            <p className="text-[var(--xp-text)]">We couldn&apos;t load the courses.</p>
            <button onClick={() => void refetch()} className="mt-4 rounded-full px-5 py-2 text-sm font-semibold text-white" style={{ background: 'var(--xp-blue)' }}>Try again</button>
          </div>
        )}
        {!isLoading && !isError && shown.length === 0 && (
          <p className="rounded-2xl border p-10 text-center" style={{ borderColor: 'var(--xp-line)', color: 'var(--xp-text-2)' }}>
            No course matches “{q}”.
          </p>
        )}
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((c, i) => <CourseCard key={c.id} course={c} academy={academy} index={i} />)}
        </div>
      </main>

      <ExploreFooter />
    </>
  )
}

export default function ExplorePage() {
  return <Suspense fallback={null}><ExploreInner /></Suspense>
}
