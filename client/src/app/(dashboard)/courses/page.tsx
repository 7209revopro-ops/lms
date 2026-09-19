'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Search, BookOpen, Star, Users, Clock, X,
  ChevronDown, SlidersHorizontal, Sparkles,
  Play, ShoppingCart, Check,
  LayoutGrid, TrendingUp, Megaphone, Cpu,
} from 'lucide-react'
import { useCourses } from '@/lib/api/courses'
import { useCategories } from '@/lib/api/categories'
import { useInstructors } from '@/lib/api/instructors'
import { AvatarImg } from '@/components/ui/AvatarImg'
import { useMyEnrollments, useEnroll } from '@/lib/api/enrollments'
import { useUIStore } from '@/store/ui.store'
import { FavoriteButton } from '@/components/courses/FavoriteButton'
import { useCartStore } from '@/store/cart.store'
import { Button, MotionButton } from '@/components/ui/button'
import type { Course } from '@/types/index'
import Spinner from '@/components/ui/Spinner'
import { useCheckoutCurrency, formatCoursePrice } from '@/lib/coursePrice'
import { titleCase } from '@/lib/titleCase'
import { SHOW_PRICING, SHOW_FREE_BADGE } from '@/lib/pricingVisibility'

const STATUS_TABS = ['All Status', 'Not Started', 'In Progress', 'Completed']
const SORTS = [
  { value: 'popular',  label: 'Most popular' },
  { value: 'rating',   label: 'Highest rated' },
  { value: 'newest',   label: 'Newest' },
  /* The two price sorts are appended only while prices are on screen —
     TEMPORARY, see lib/pricingVisibility.ts. */
  ...(SHOW_PRICING
    ? [{ value: 'price_lo', label: 'Price: Low → High' },
       { value: 'price_hi', label: 'Price: High → Low' }]
    : []),
]
const LEVELS = ['all', 'beginner', 'intermediate', 'advanced'] as const

type DurationKey = 'any' | 'lt1h' | '1to3' | '3to6' | 'gt6'
const DURATIONS: { key: DurationKey; label: string; min?: number; max?: number }[] = [
  { key: 'any',  label: 'Any length' },
  { key: 'lt1h', label: '< 1 hour',    max: 60 },
  { key: '1to3', label: '1 to 3 hours', min: 60,  max: 180 },
  { key: '3to6', label: '3 to 6 hours', min: 180, max: 360 },
  { key: 'gt6',  label: '> 6 hours',   min: 360 },
]

type PriceKey = 'any' | 'free' | 'lt30' | '30to100' | 'gt100'
const PRICES: { key: PriceKey; label: string; min?: number; max?: number; free?: boolean }[] = [
  { key: 'any',     label: 'Any price' },
  { key: 'free',    label: 'Free',      free: true },
  { key: 'lt30',    label: '$1 to $29',  min: 1,   max: 29 },
  { key: '30to100', label: '$30 to $99', min: 30,  max: 99 },
  { key: 'gt100',   label: '$100+',     min: 100 },
]

const CONTENT_TYPES = [
  { value: 'all',    label: 'All',           color: 'var(--color-text-muted)', bg: 'var(--color-bg-subtle)' },
  { value: 'course', label: 'Course',        color: '#2563EB', bg: 'var(--color-primary-light)' },
  { value: 'quiz',   label: 'Quiz',          color: '#D97706', bg: 'var(--color-primary-light)' },
  { value: 'path',   label: 'Learning Path', color: 'var(--color-success)', bg: '#ECFDF5' },
  { value: 'page',   label: 'Page',          color: '#7C3AED', bg: '#F5F3FF' },
]

const PROGRAM_FILTERS = [
  {
    id: 'all', label: 'All', icon: LayoutGrid,
    color: 'var(--color-text-secondary)',
    activeGrad: 'var(--color-text-secondary)',
    shadow: 'rgba(17,24,39,0.25)',
    ring: 'rgba(55,65,81,0.15)',
  },
  {
    id: '4x-trading', label: 'FOREX', icon: TrendingUp,
    color: 'var(--color-success)',
    activeGrad: '#10B981',
    shadow: 'rgba(16,185,129,0.35)',
    ring: 'rgba(16,185,129,0.15)',
  },
  {
    id: 'jura', label: 'JURA', icon: TrendingUp,
    color: '#8B5CF6',
    activeGrad: '#8B5CF6',
    shadow: 'rgba(139,92,246,0.35)',
    ring: 'rgba(139,92,246,0.15)',
  },
  {
    id: 'digital-marketing', label: 'Digital Marketing', icon: Megaphone,
    color: 'var(--color-primary)',
    activeGrad: '#0057b8',
    shadow: 'rgba(0,87,184,0.35)',
    ring: 'rgba(0,87,184,0.15)',
  },
  {
    id: 'ai', label: 'AI', icon: Cpu,
    color: '#8B5CF6',
    activeGrad: '#8B5CF6',
    shadow: 'rgba(139,92,246,0.35)',
    ring: 'rgba(139,92,246,0.15)',
  },
]

function fmt(mins: number) {
  const h = Math.floor(mins / 60); const m = mins % 60
  return h > 0 ? `${h}h ${m > 0 ? m + 'm' : ''}`.trim() : `${m}m`
}

const stagger  = { hidden: {}, show: { transition: { staggerChildren: 0.04 } } }
const cardAnim = { hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0, transition: { type: 'spring' as const, stiffness: 280, damping: 26 } } }

function TypeBadge({ type }: { type: string }) {
  const map: Record<string, { bg: string; color: string; dot: string }> = {
    'Course':        { bg: 'var(--color-primary-light)', color: '#2563EB', dot: '#3B82F6' },
    'Quiz':          { bg: 'var(--color-primary-light)', color: '#92400E', dot: '#F59E0B' },
    'Learning Path': { bg: '#F0FDF4', color: '#166534', dot: '#22C55E' },
    'Page':          { bg: '#FDF4FF', color: '#7E22CE', dot: '#A855F7' },
  }
  const s = map[type] ?? map['Course']
  return (
    <span className="inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[10px] font-semibold"
      style={{ background: s.bg, color: s.color }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.dot }} />
      {type}
    </span>
  )
}

export default function CoursesPage() {
  const { rightPanelOpen } = useUIStore()
  const [search,      setSearch]      = useState('')
  const [activeTab,   setActiveTab]   = useState('All Status')
  const [level,       setLevel]       = useState('all')
  const [category,    setCategory]    = useState('all')
  const [sort,        setSort]        = useState('popular')
  const [free,        setFree]        = useState(false)
  const [page,        setPage]        = useState(1)
  const [showSort,    setShowSort]    = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [contentType, setContentType] = useState('all')
  const [duration,    setDuration]    = useState<DurationKey>('any')
  const [priceRange,  setPriceRange]  = useState<PriceKey>('any')
  const [program,     setProgram]     = useState('all')
  const [instructor,  setInstructor]  = useState('')

  const lvl = level === 'all' ? '' : level
  const cat = category === 'all' ? '' : category
  const dur = DURATIONS.find(d => d.key === duration)
  const pr  = PRICES.find(p => p.key === priceRange)
  const effectiveFree = pr?.free ? true : free

  const { data, isLoading } = useCourses({
    page, per_page: 12, search, level: lvl, category: cat, sort,
    free:         effectiveFree,
    duration_min: dur?.min,
    duration_max: dur?.max,
    price_min:    pr?.min,
    price_max:    pr?.max,
    program:      program === 'all' ? undefined : program,
    instructor:   instructor || undefined,
  })
  const { data: categoriesData } = useCategories()
  const { data: instructors = [] } = useInstructors()
  const categories: string[] = ['all', ...(categoriesData?.map(c => c.slug) ?? [])]
  const categoryLabel = (slug: string) => slug === 'all'
    ? 'All categories'
    : categoriesData?.find(c => c.slug === slug)?.name ?? slug

  const total = data?.meta.total_count ?? 0
  const activeFilterCount =
    (level !== 'all' ? 1 : 0) +
    (category !== 'all' ? 1 : 0) +
    (free || pr?.free ? 1 : 0) +
    (duration !== 'any' ? 1 : 0) +
    (priceRange !== 'any' && !pr?.free ? 1 : 0) +
    (instructor ? 1 : 0)

  /* Responsive grid: no desktop sidebar, so more columns available */
  const gridCols = `grid-cols-1 sm:grid-cols-2 md:grid-cols-3 ${rightPanelOpen ? 'xl:grid-cols-3' : 'xl:grid-cols-4'}`

  return (
    <div>
      {/* ── Page header ───────────────────────────── */}
      <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 280, damping: 26 }} className="mb-5">
        <div className="flex items-center gap-2 mb-1">
          <Sparkles size={13} style={{ color: 'var(--color-primary)' }} />
          <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--color-primary)' }}>Catalogue</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)', fontFamily: 'Bricolage Grotesque, sans-serif' }}>
            All Materials
          </h1>
          <span className="inline-flex items-center justify-center rounded-lg px-2 py-0.5 text-sm font-bold"
            style={{ background: 'var(--color-bg-subtle)', color: 'var(--color-text-secondary)' }}>
            {total}
          </span>
        </div>
      </motion.div>

      {/* ── Program switch filters ───────────────── */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.04, type: 'spring', stiffness: 280, damping: 26 }}
        className="mb-4">
        <div className="flex items-center gap-2.5 overflow-x-auto scrollbar-none pb-0.5">
          {PROGRAM_FILTERS.map(p => {
            const Icon     = p.icon
            const isActive = program === p.id
            return (
              <MotionButton
                key={p.id}
                onClick={() => { setProgram(p.id); setPage(1) }}
                whileHover={{ y: -2, scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                variant="ghost"
                className="flex h-11 shrink-0 items-center gap-2 rounded-2xl px-4 text-sm font-semibold transition-all lg:h-auto lg:py-2.5"
                style={isActive ? {
                  background: p.activeGrad,
                  color: 'white',
                  boxShadow: `0 6px 20px ${p.shadow}`,
                  border: '1.5px solid transparent',
                } : {
                  background: 'var(--color-bg-surface)',
                  color: 'var(--color-text-muted)',
                  border: '1.5px solid var(--color-border)',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                }}
              >
                <Icon size={15} style={{ color: isActive ? 'white' : p.color }} />
                {p.label}
              </MotionButton>
            )
          })}
        </div>
      </motion.div>

      {/* ── Status tabs + controls ────────────────── */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05, type: 'spring', stiffness: 280, damping: 26 }}
        className="mb-5 flex flex-col gap-2.5">

        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
          {/* Status tabs */}
          {/* SHRINKABLE, because it can already scroll. Both children of this
              row were shrink-0, so from `sm` up the four status tabs (~400px)
              and the search/filter/sort cluster (320px) simply refused to fit
              a 700px screen and pushed the whole page to 770 - a horizontal
              scroll on the catalogue, which is the page people buy from. The
              tabs carry overflow-x-auto already, so letting them shrink costs
              nothing they were not prepared for; min-w-0 is what lets a flex
              child go below its content width at all. */}
          <div className="flex w-full min-w-0 items-center gap-1 overflow-x-auto rounded-2xl p-1 scrollbar-none self-start sm:w-auto"
            style={{ background: 'var(--color-bg-subtle)' }}>
            {STATUS_TABS.map(tab => (
              <MotionButton key={tab} onClick={() => setActiveTab(tab)}
                variant="ghost"
                size="sm"
                className="relative h-11 rounded-xl px-3 text-sm font-semibold transition-colors whitespace-nowrap lg:h-auto lg:py-1.5"
                style={{ color: activeTab === tab ? 'var(--color-text-primary)' : 'var(--color-text-muted)' }}>
                {activeTab === tab && (
                  <motion.div layoutId="status-pill"
                    className="absolute inset-0 rounded-xl bg-[var(--color-bg-surface)]"
                    style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.10)' }}
                    transition={{ type: 'spring', stiffness: 500, damping: 35 }} />
                )}
                <span className="relative z-10">{tab}</span>
              </MotionButton>
            ))}
          </div>

          {/* Controls */}
          <div className="flex shrink-0 items-center gap-2">
            {/* Search */}
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                style={{ color: 'var(--color-text-muted)' }} />
              <input value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}
                placeholder="Search…"
                className="h-11 w-full rounded-xl pl-9 pr-3 text-sm sm:w-36 sm:transition-all sm:focus:w-48 lg:h-auto lg:py-2"
                style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }} />
            </div>

            {/* Filter */}
            <MotionButton whileTap={{ scale: 0.96 }} onClick={() => setShowFilters(v => !v)}
              variant="outline"
              size="sm"
              className="relative flex h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-xl px-3 text-sm font-semibold lg:h-auto lg:min-w-0 lg:py-2"
              style={{ borderColor: showFilters ? '#0057b8' : 'var(--color-border)', color: showFilters ? '#0057b8' : 'var(--color-text-secondary)' }}>
              <SlidersHorizontal size={13} />
              <span className="hidden sm:inline">Filters</span>
              {activeFilterCount > 0 && (
                <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold"
                  style={{ background: 'var(--color-primary)', color: 'white' }}>
                  {activeFilterCount}
                </span>
              )}
            </MotionButton>

            {/* Sort */}
            <div className="relative shrink-0">
              <MotionButton whileTap={{ scale: 0.96 }} onClick={() => setShowSort(v => !v)}
                variant="outline"
                size="sm"
                className="flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-xl px-3 text-sm font-semibold lg:h-auto lg:min-w-0 lg:py-2"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
                <ChevronDown size={13} className={`transition-transform ${showSort ? 'rotate-180' : ''}`} />
                <span className="hidden sm:inline">Sort</span>
              </MotionButton>
              <AnimatePresence>
                {showSort && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowSort(false)} />
                    <motion.div initial={{ opacity: 0, y: -8, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -8, scale: 0.96 }} transition={{ type: 'spring', stiffness: 400, damping: 28 }}
                      className="absolute right-0 top-full mt-1 w-52 rounded-2xl p-1.5 z-50 bg-[var(--color-bg-surface)]"
                      style={{ border: '1px solid var(--color-border)', boxShadow: '0 16px 40px rgba(0,0,0,0.10)' }}>
                      {SORTS.map(s => (
                        <Button key={s.value} onClick={() => { setSort(s.value); setShowSort(false); setPage(1) }}
                          variant="ghost"
                          size="sm"
                          className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-sm h-auto"
                          style={{ color: sort === s.value ? '#0057b8' : 'var(--color-text-secondary)', fontWeight: sort === s.value ? 600 : 400 }}>
                          {s.label}
                          {sort === s.value && <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--color-primary)' }} />}
                        </Button>
                      ))}
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>

        {/* Expandable filters */}
        <AnimatePresence>
          {showFilters && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
              <div className="rounded-2xl bg-[var(--color-bg-surface)] p-4 space-y-3" style={{ border: '1px solid var(--color-border)' }}>
                {/* Type */}
                <div>
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>Type</p>
                  <div className="flex flex-wrap gap-2">
                    {CONTENT_TYPES.map(t => (
                      <Button key={t.value} onClick={() => setContentType(t.value)}
                        variant="ghost"
                        size="sm"
                        className="rounded-xl px-3 py-1.5 text-xs font-semibold h-auto transition-all"
                        style={contentType === t.value
                          ? { background: t.bg, color: t.color, border: `1px solid ${t.color}40` }
                          : { background: 'var(--color-bg-subtle)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)' }}>
                        {t.label}
                      </Button>
                    ))}
                  </div>
                </div>
                {/* Level */}
                <div>
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>Level</p>
                  <div className="flex flex-wrap gap-2">
                    {LEVELS.map(l => (
                      <Button key={l} onClick={() => { setLevel(l); setPage(1) }}
                        variant="ghost"
                        size="sm"
                        className="rounded-xl px-3 py-1.5 text-xs font-semibold capitalize h-auto transition-all"
                        style={level === l
                          ? { background: 'rgba(0,87,184,0.10)', color: 'var(--color-primary)', border: '1px solid rgba(0,87,184,0.28)' }
                          : { background: 'var(--color-bg-subtle)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)' }}>
                        {l === 'all' ? 'All levels' : l}
                      </Button>
                    ))}
                  </div>
                </div>
                {/* Category */}
                <div>
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>Category</p>
                  <div className="flex flex-wrap gap-2">
                    {categories.map(c => (
                      <Button key={c} onClick={() => { setCategory(c); setPage(1) }}
                        variant="ghost"
                        size="sm"
                        className="rounded-xl px-3 py-1.5 text-xs font-semibold h-auto transition-all"
                        style={category === c
                          ? { background: 'rgba(99,102,241,0.10)', color: '#4F46E5', border: '1px solid rgba(99,102,241,0.28)' }
                          : { background: 'var(--color-bg-subtle)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)' }}>
                        {categoryLabel(c)}
                      </Button>
                    ))}
                  </div>
                </div>
                {/* Duration */}
                <div>
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>Duration</p>
                  <div className="flex flex-wrap gap-2">
                    {DURATIONS.map(d => (
                      <Button key={d.key} onClick={() => { setDuration(d.key); setPage(1) }}
                        variant="ghost"
                        size="sm"
                        className="rounded-xl px-3 py-1.5 text-xs font-semibold h-auto transition-all"
                        style={duration === d.key
                          ? { background: 'rgba(59,130,246,0.10)', color: '#2563EB', border: '1px solid rgba(59,130,246,0.28)' }
                          : { background: 'var(--color-bg-subtle)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)' }}>
                        {d.label}
                      </Button>
                    ))}
                  </div>
                </div>
                {/* Price — TEMPORARY: hidden with the prices themselves. A
                    "$30 to $99" filter over cards that quote no figure asks the
                    student to sort by something they cannot see. See
                    lib/pricingVisibility.ts. */}
                <div style={SHOW_PRICING ? undefined : { display: 'none' }}>
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>Price</p>
                  <div className="flex flex-wrap gap-2">
                    {PRICES.map(p => (
                      <Button key={p.key} onClick={() => { setPriceRange(p.key); setPage(1) }}
                        variant="ghost"
                        size="sm"
                        className="rounded-xl px-3 py-1.5 text-xs font-semibold h-auto transition-all"
                        style={priceRange === p.key
                          ? { background: 'rgba(34,197,94,0.10)', color: 'var(--color-success)', border: '1px solid rgba(34,197,94,0.28)' }
                          : { background: 'var(--color-bg-subtle)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)' }}>
                        {p.label}
                      </Button>
                    ))}
                  </div>
                </div>
                {/* Instructor */}
                {instructors.length > 0 && (
                  <div>
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>Instructor</p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        onClick={() => { setInstructor(''); setPage(1) }}
                        variant="ghost" size="sm"
                        className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold h-auto transition-all"
                        style={!instructor
                          ? { background: 'rgba(0,87,184,0.10)', color: 'var(--color-primary)', border: '1px solid rgba(0,87,184,0.28)' }
                          : { background: 'var(--color-bg-subtle)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)' }}>
                        All instructors
                      </Button>
                      {instructors.map(ins => (
                        <Button
                          key={ins.id}
                          onClick={() => { setInstructor(instructor === ins.id ? '' : ins.id); setPage(1) }}
                          variant="ghost" size="sm"
                          className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold h-auto transition-all"
                          style={instructor === ins.id
                            ? { background: 'rgba(0,87,184,0.10)', color: 'var(--color-primary)', border: '1px solid rgba(0,87,184,0.28)' }
                            : { background: 'var(--color-bg-subtle)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)' }}>
                          <AvatarImg src={ins.avatarUrl} name={ins.name}
                            className="h-4 w-4 rounded-full object-cover flex-shrink-0"
                            fallbackClassName="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
                            fallbackStyle={{ background: 'var(--color-primary)' }} />
                          {ins.name}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}
                {/* Free toggle + clear */}
                <div className="flex items-center gap-3 pt-1" style={{ borderTop: '1px solid var(--color-border)' }}>
                  <Button onClick={() => { setFree(v => !v); setPage(1) }}
                    variant="ghost"
                    size="sm"
                    className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold h-auto transition-all"
                    style={free
                      ? { background: 'rgba(34,197,94,0.10)', color: 'var(--color-success)', border: '1px solid rgba(34,197,94,0.25)' }
                      : { background: 'var(--color-bg-subtle)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)' }}>
                    {free ? '✓ ' : ''}Free only
                  </Button>
                  <Button onClick={() => {
                    setLevel('all'); setCategory('all'); setFree(false)
                    setContentType('all'); setDuration('any'); setPriceRange('any')
                    setInstructor(''); setPage(1)
                  }}
                    variant="ghost"
                    size="sm"
                    className="flex items-center gap-1 text-xs font-semibold h-auto transition-colors hover:text-red-500"
                    style={{ color: 'var(--color-text-muted)' }}>
                    <X size={11} />Clear all
                  </Button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* ── Course grid ───────────────────────────── */}
      {isLoading ? (
        <div className={`grid gap-4 ${gridCols}`}>
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="overflow-hidden rounded-2xl bg-[var(--color-bg-surface)]" style={{ border: '1px solid var(--color-border)' }}>
              <div className="aspect-video animate-pulse" style={{ background: 'var(--color-bg-subtle)' }} />
              <div className="space-y-2.5 p-4">
                <div className="h-3.5 w-16 rounded animate-pulse" style={{ background: 'var(--color-primary-light)' }} />
                <div className="h-4 w-4/5 rounded animate-pulse" style={{ background: 'var(--color-bg-subtle)' }} />
                <div className="h-3 w-2/5 rounded animate-pulse" style={{ background: 'var(--color-bg-subtle)' }} />
                <div className="flex gap-2">
                  <div className="h-5 w-16 rounded-lg animate-pulse" style={{ background: 'var(--color-bg-subtle)' }} />
                  <div className="h-5 w-12 rounded-lg animate-pulse" style={{ background: 'var(--color-bg-subtle)' }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : data?.docs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-3xl"
            style={{ background: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)' }}>
            <BookOpen size={24} style={{ color: 'var(--color-text-muted)' }} />
          </div>
          <p className="text-base font-bold" style={{ color: 'var(--color-text-primary)' }}>No courses found</p>
          <p className="text-sm text-center" style={{ color: 'var(--color-text-muted)' }}>Try adjusting your filters or search query</p>
          <Button onClick={() => {
            setSearch(''); setLevel('all'); setCategory('all'); setFree(false)
            setDuration('any'); setPriceRange('any')
          }}
            variant="ghost"
            size="sm"
            className="mt-1 rounded-xl px-5 py-2 text-sm font-semibold h-auto transition-colors hover:opacity-90"
            style={{ background: 'rgba(0,87,184,0.10)', color: 'var(--color-primary)' }}>
            Clear filters
          </Button>
        </div>
      ) : (
        <motion.div variants={stagger} initial="hidden" animate="show"
          className={`grid gap-4 ${gridCols}`}>
          {data?.docs.map(course => (
            <motion.div key={course.id} variants={cardAnim}>
              <MaterialCard course={course} />
            </motion.div>
          ))}
        </motion.div>
      )}

      {/* ── Pagination ────────────────────────────── */}
      {data && data.meta.total_pages > 1 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}
          className="mt-8 flex items-center justify-center gap-2 flex-wrap">
          <Button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={!data.meta.has_prev}
            variant="outline"
            size="sm"
            className="h-11 rounded-xl px-4 text-sm font-semibold disabled:opacity-40 lg:h-auto lg:py-2"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
            Previous
          </Button>
          {Array.from({ length: Math.min(data.meta.total_pages, 7) }, (_, i) => i + 1).map(p => (
            <Button key={p} onClick={() => setPage(p)}
              variant="ghost"
              size="icon"
              className="h-11 w-11 rounded-xl text-sm font-semibold lg:h-9 lg:w-9"
              style={p === page
                ? { background: 'var(--color-text-primary)', color: 'var(--color-text-inverse)' }
                : { color: 'var(--color-text-muted)', background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)' }}>
              {p}
            </Button>
          ))}
          <Button onClick={() => setPage(p => p + 1)} disabled={!data.meta.has_next}
            variant="outline"
            size="sm"
            className="h-11 rounded-xl px-4 text-sm font-semibold disabled:opacity-40 lg:h-auto lg:py-2"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
            Next
          </Button>
        </motion.div>
      )}
    </div>
  )
}

/* ── Material card ────────────────────────────────────── */
function MaterialCard({ course }: { course: Course }) {
  /* A thumbnail URL that 404s is not the same as having no thumbnail: the
     <img> stays in the layout and paints its alt text across the tile, so a
     dead link showed the course name sprawled over a blank card. Falling back
     to the same placeholder the no-image case uses keeps the grid uniform
     whatever the CDN does. */
  const [thumbFailed, setThumbFailed] = useState(false)
  const showThumb = !!course.thumbnailUrl && !thumbFailed
  const router     = useRouter()
  const addToCart  = useCartStore(s => s.addItem)
  const isInCart   = useCartStore(s => s.isInCart)
  const inCart     = isInCart(course.id)
  const isFree     = course.isFree || !course.price || course.price === 0
  const currency   = useCheckoutCurrency()

  const { data: enrollments } = useMyEnrollments()
  const enroll = useEnroll()
  const isEnrolled = enrollments?.some(e => {
    const cid = typeof e.courseId === 'string' ? e.courseId : e.courseId?.id
    return cid === course.id
  }) ?? false

  /* Free → enroll (never cart). Paid → cart. Already enrolled → open course. */
  const handleAction = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    if (isEnrolled) {
      router.push(`/courses/${course.slug}`)
      return
    }

    if (isFree) {
      try {
        await enroll.mutateAsync(course.id)
        router.push(`/courses/${course.slug}`)
      } catch {
        /* error surfaced on the course detail page */
      }
      return
    }

    addToCart({
      id:             course.id,
      slug:           course.slug,
      title:          course.title,
      thumbnailUrl:   course.thumbnailUrl,
      price:          course.price,
      priceAED:       course.priceAED,
      priceINR:       course.priceINR,
      isFree:         course.isFree,
      instructorName: course.instructor?.name,
    })
  }

  return (
    <Link href={`/courses/${course.slug}`} className="block h-full">
      <motion.div
        whileHover={{ y: -3, boxShadow: '0 16px 40px rgba(0,0,0,0.09)' }}
        whileTap={{ scale: 0.99 }}
        transition={{ type: 'spring', stiffness: 350, damping: 28 }}
        className="group overflow-hidden rounded-2xl bg-[var(--color-bg-surface)] cursor-pointer h-full flex flex-col"
        style={{ border: '1px solid var(--color-border)', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>

        {/* ── Thumbnail ── */}
        <div className="relative aspect-video overflow-hidden flex-shrink-0">
          {showThumb
            ? <img src={course.thumbnailUrl} alt="" onError={() => setThumbFailed(true)}
                className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
            : <div className="flex h-full w-full items-center justify-center"
                style={{ background: 'var(--color-bg-subtle)' }}>
                {/* strokeWidth matches the global lucide set */}
                <BookOpen size={28} strokeWidth={1.75} style={{ color: 'var(--color-text-muted)' }} />
              </div>
          }

          {/* Dark overlay on hover */}
          <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center"
            style={{ background: 'rgba(13,15,26,0.30)' }}>
            <motion.div whileHover={{ scale: 1.1 }}
              className="flex h-10 w-10 items-center justify-center rounded-full"
              style={{ background: 'rgba(0,87,184,0.90)', boxShadow: '0 6px 18px rgba(0,87,184,0.40)' }}>
              <Play size={13} fill="white" color="white" />
            </motion.div>
          </div>

          {/* Top-left: materials count */}
          <div className="absolute left-2.5 top-2.5 flex gap-1.5">
            {course.durationMins > 0 && (
              <span className="rounded-lg px-2 py-0.5 text-[10px] font-bold"
                style={{ background: 'rgba(13,15,26,0.68)', color: 'white', backdropFilter: 'blur(6px)' }}>
                {fmt(course.durationMins)}
              </span>
            )}
          </div>

          {/* Top-right: save button */}
          <div className="absolute right-2.5 top-2.5">
            <FavoriteButton courseId={course.id} variant="icon" />
          </div>

          {/* Free badge — TEMPORARY: a "FREE" flash while every other card
              quotes nothing tells a student which courses cost money by
              omission, which is the fact being withheld. */}
          {SHOW_FREE_BADGE && isFree && (
            <span className="absolute bottom-2.5 left-2.5 rounded-lg px-2 py-0.5 text-[10px] font-bold"
              style={{ background: 'rgba(34,197,94,0.18)', color: '#15803D', border: '1px solid rgba(34,197,94,0.28)', backdropFilter: 'blur(4px)' }}>
              FREE
            </span>
          )}
        </div>

        {/* ── Content ── */}
        <div className="flex flex-1 flex-col gap-2 p-3.5">

          {/* Type + Top Rated */}
          <div className="flex items-center justify-between gap-1 flex-wrap">
            <TypeBadge type="Course" />
            {course.ratingAvg >= 4.5 && (
              <span className="text-[10px] font-semibold" style={{ color: 'var(--color-warning)' }}>✦ Top Rated</span>
            )}
          </div>

          {/* Title */}
          <h3 className="line-clamp-2 text-sm font-bold leading-snug" style={{ color: 'var(--color-text-primary)' }}>
            {titleCase(course.title)}
          </h3>

          {/* Instructor */}
          {course.instructor && (
            <p className="text-xs truncate" style={{ color: 'var(--color-text-muted)' }}>
              {course.instructor.name}
            </p>
          )}

          {/* Rating + enrolled */}
          <div className="flex items-center gap-2.5 text-xs flex-wrap">
            {course.ratingAvg > 0 && (
              <span className="flex items-center gap-1 font-semibold" style={{ color: 'var(--color-warning)' }}>
                <Star size={10} fill="#F59E0B" />{course.ratingAvg.toFixed(1)}
              </span>
            )}
            <span className="flex items-center gap-1" style={{ color: 'var(--color-text-muted)' }}>
              <Users size={10} />{course.enrolledCount.toLocaleString()}
            </span>
            {course.category && (
              <span className="rounded-md px-1.5 py-0.5 text-[10px] font-medium"
                style={{ background: 'var(--color-bg-subtle)', color: 'var(--color-text-muted)' }}>{course.category.name}</span>
            )}
          </div>

          {/* ── Footer: price + action ── */}
          <div className="mt-auto flex items-center justify-between gap-2 pt-3"
            style={{ borderTop: '1px solid var(--color-border)' }}>

            {/* Price — hidden while commerce is off; the level stays, so the
                card keeps its footer rather than collapsing. */}
            <div>
              {SHOW_PRICING && (isFree ? (
                <span className="text-sm font-bold" style={{ color: 'var(--color-success)' }}>Free</span>
              ) : (
                <span className="text-sm font-bold" style={{ color: 'var(--color-text-primary)' }}>
                  {formatCoursePrice(course, currency)}
                </span>
              ))}
              {course.level && (
                <p className="text-[10px] capitalize" style={{ color: 'var(--color-text-muted)' }}>{course.level}</p>
              )}
            </div>

            {/* Cart / Enroll button */}
            <MotionButton
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.96 }}
              onClick={handleAction}
              disabled={enroll.isPending}
              variant={(isEnrolled || (!isFree && inCart)) ? 'ghost' : 'default'}
              size="sm"
              className="flex h-11 items-center gap-1.5 rounded-xl px-3.5 text-[11px] font-bold whitespace-nowrap disabled:opacity-70 lg:h-auto lg:px-3 lg:py-1.5"
              style={(isEnrolled || (!isFree && inCart))
                ? { background: '#F0FDF4', color: 'var(--color-success)', border: '1px solid rgba(34,197,94,0.28)' }
                : isFree
                  ? { background: 'var(--color-success)', color: 'white', boxShadow: '0 2px 8px rgba(34,197,94,0.25)' }
                  : { background: 'var(--color-primary)', color: 'white', boxShadow: '0 2px 8px rgba(0,87,184,0.25)' }
              }>
              {isEnrolled
                ? <><Check size={10} />Enrolled</>
                : enroll.isPending
                  ? <><Spinner size={10} />Enrolling…</>
                  : isFree
                    /* "Enroll Free" beside "Add to Cart" says which courses
                       cost money just as plainly as the badge did — TEMPORARY,
                       see lib/pricingVisibility.ts. The action is unchanged;
                       only the word that quotes a price goes. */
                    ? <><Play size={10} fill="white" />{SHOW_FREE_BADGE ? 'Enroll Free' : 'Enroll'}</>
                    : inCart
                      ? <><Check size={10} />Added</>
                      : <><ShoppingCart size={10} />Add to Cart</>
              }
            </MotionButton>
          </div>
        </div>
      </motion.div>
    </Link>
  )
}
