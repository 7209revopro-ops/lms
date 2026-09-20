'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Link from 'next/link'
import {
  Search, Plus, Edit2, Trash2, BookOpen, Star, Users,
  ChevronUp, ChevronDown, ChevronLeft, ChevronRight,
  CheckSquare, Square, Globe, Archive, Trash,
  LayoutGrid, List, TrendingUp, FileEdit, Clock, Eye,
} from 'lucide-react'
import { useCourses, useBulkCourses } from '@/lib/api/courses'
import { useAdminStats } from '@/lib/api/stats'
import { useUIStore } from '@/store/ui.store'
import type { Course, CourseStatus } from '@/types/index'
import { useOrgCurrency, formatCoursePrice } from '@/lib/currency'
import { useToast } from '@/store/ui.store'

/* ── Config ────────────────────────────────────────────────────── */
const STATUS_CONFIG: Record<CourseStatus, {
  label: string; bg: string; color: string; dot: string; glow: string
}> = {
  published: { label: 'Published', bg: 'rgba(34,197,94,0.12)',   color: '#4ADE80', dot: '#4ADE80', glow: 'rgba(74,222,128,0.4)'  },
  draft:     { label: 'Draft',     bg: 'rgba(234,179,8,0.12)',   color: '#FACC15', dot: '#FACC15', glow: 'rgba(250,204,21,0.4)'  },
  archived:  { label: 'Archived',  bg: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.35)', dot: 'rgba(255,255,255,0.3)', glow: 'rgba(255,255,255,0.1)' },
}

const LEVEL_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  beginner:     { label: 'Beginner',     color: '#4ADE80', bg: 'rgba(74,222,128,0.1)'  },
  intermediate: { label: 'Intermediate', color: '#60A5FA', bg: 'rgba(96,165,250,0.1)'  },
  advanced:     { label: 'Advanced',     color: '#F87171', bg: 'rgba(248,113,113,0.1)' },
}

type SortKey  = 'title' | 'enrolledCount' | 'ratingAvg' | 'price' | 'createdAt'
type ViewMode = 'table' | 'grid'

const skeletonCells = Array.from({ length: 5 })

/* ── Skeleton ────────────────────────────────────────────────── */
function SkeletonRow() {
  return (
    <tr>
      <td className="px-3 py-4"><div className="h-4 w-4 rounded animate-pulse" style={{ background: 'rgba(255,255,255,0.06)' }} /></td>
      {[44, 16, 12, 12, 10, 12, 8].map((w, i) => (
        <td key={i} className="px-4 py-4">
          <div className="h-4 rounded-lg animate-pulse" style={{ width: `${w}%`, background: 'rgba(255,255,255,0.06)' }} />
        </td>
      ))}
    </tr>
  )
}

function SkeletonCard() {
  return (
    <div className="overflow-hidden rounded-2xl animate-pulse" style={{ background: '#13151F', border: '1px solid rgba(255,255,255,0.07)' }}>
      <div className="aspect-video" style={{ background: 'rgba(255,255,255,0.04)' }} />
      <div className="p-4 space-y-3">
        <div className="h-3 w-16 rounded-md" style={{ background: 'rgba(255,255,255,0.06)' }} />
        <div className="h-4 w-4/5 rounded-lg" style={{ background: 'rgba(255,255,255,0.06)' }} />
        <div className="h-3 w-3/5 rounded-lg" style={{ background: 'rgba(255,255,255,0.06)' }} />
        <div className="flex justify-between pt-1">
          <div className="h-3 w-16 rounded-lg" style={{ background: 'rgba(255,255,255,0.06)' }} />
          <div className="h-3 w-10 rounded-lg" style={{ background: 'rgba(255,255,255,0.06)' }} />
        </div>
      </div>
    </div>
  )
}

/* ── Stat Card ───────────────────────────────────────────────── */
function StatCard({ label, value, icon: Icon, color, bg, delay }: {
  label: string; value?: number; icon: React.ElementType
  color: string; bg: string; delay: number
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, type: 'spring', stiffness: 300, damping: 28 }}
      className="relative overflow-hidden rounded-2xl p-4"
      style={{ background: '#13151F', border: '1px solid rgba(255,255,255,0.07)' }}>
      {/* Glow blob */}
      {/* <div className="pointer-events-none absolute -right-4 -top-4 h-16 w-16 rounded-full opacity-30 blur-xl" style={{ background: color }} /> */}
      <div className="relative">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: bg }}>
            <Icon size={16} style={{ color }} />
          </div>
          <TrendingUp size={11} style={{ color: 'rgba(255,255,255,0.18)' }} />
        </div>
        <div className="text-2xl font-bold tracking-tight text-white">
          {value != null ? value.toLocaleString() : <span className="animate-pulse text-white/20">—</span>}
        </div>
        <div className="mt-0.5 text-[11px]" style={{ color: 'rgba(255,255,255,0.38)' }}>{label}</div>
      </div>
    </motion.div>
  )
}

/* ── Bulk bar ────────────────────────────────────────────────── */
function BulkBar({ selected, onPublish, onArchive, onDelete, onClear, isPending }: {
  selected: number; onPublish: () => void; onArchive: () => void
  onDelete: () => void; onClear: () => void; isPending: boolean
}) {
  return (
    <AnimatePresence>
      {selected > 0 && (
        <motion.div
          initial={{ y: 72, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 72, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 420, damping: 34 }}
          /* Centred with auto margins, not with -translate-x-1/2: framer
             owns this element's transform for the slide-up, so the Tailwind
             translate never applied. The bar is 442px wide, so at 375px it
             ran from 187 to 629 - Archive, Delete and the clear-selection X
             were all past the right edge of a FIXED element, unreachable and
             undismissable, leaving an admin stuck with a bar they could
             neither use nor close. On desktop it was merely off-centre. */
          className="fixed inset-x-4 bottom-6 z-50 mx-auto flex w-fit flex-wrap items-center justify-center gap-2 rounded-2xl px-4 py-3 shadow-2xl"
          style={{ background: '#1A1B26', border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>
          <span className="mr-1 text-xs font-semibold" style={{ color: 'rgba(255,255,255,0.5)' }}>{selected} selected</span>
          <div className="mx-2 h-4 w-px" style={{ background: 'rgba(255,255,255,0.1)' }} />
          <button onClick={onPublish} disabled={isPending}
            className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-all hover:scale-105 disabled:opacity-50"
            style={{ background: 'rgba(74,222,128,0.12)', color: '#4ADE80' }}>
            <Globe size={12} /> Publish
          </button>
          <button onClick={onArchive} disabled={isPending}
            className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-all hover:scale-105 disabled:opacity-50"
            style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.5)' }}>
            <Archive size={12} /> Archive
          </button>
          <button onClick={onDelete} disabled={isPending}
            className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-all hover:scale-105 disabled:opacity-50"
            style={{ background: 'rgba(239,68,68,0.12)', color: '#F87171' }}>
            <Trash size={12} /> Delete
          </button>
          <div className="mx-2 h-4 w-px" style={{ background: 'rgba(255,255,255,0.1)' }} />
          <button onClick={onClear} className="text-xs transition-colors hover:text-white" style={{ color: 'rgba(255,255,255,0.28)' }}>✕</button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/* ── Course Card (grid view) ─────────────────────────────────── */
function CourseCard({ course, index, checked, onToggle, onDelete }: {
  course: Course; index: number; checked: boolean; onToggle: () => void; onDelete: () => void
}) {
  const st = STATUS_CONFIG[course.status]
  const lv = course.level ? LEVEL_CONFIG[course.level] : null
  const cur = useOrgCurrency()

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: index * 0.045, type: 'spring', stiffness: 280, damping: 26 }}
      className="group relative flex flex-col overflow-hidden rounded-2xl transition-all duration-300 hover:-translate-y-0.5"
      style={{
        background: '#13151F',
        border: checked ? '1px solid rgba(0,87,184,0.5)' : '1px solid rgba(255,255,255,0.07)',
        boxShadow: checked ? '0 0 0 3px rgba(0,87,184,0.12)' : 'none',
      }}>

      {/* Thumbnail */}
      <div className="relative aspect-video overflow-hidden flex-shrink-0">
        {course.thumbnailUrl ? (
          <img
            src={course.thumbnailUrl} alt={course.title}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center" style={{ background: 'linear-gradient(135deg, rgba(0,87,184,0.05), rgba(255,255,255,0.02))' }}>
            <BookOpen size={28} style={{ color: 'rgba(255,255,255,0.1)' }} />
          </div>
        )}
        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />

        {/* Status badge */}
        <div className="absolute right-2 top-2 flex items-center gap-1.5 rounded-lg px-2 py-1"
          style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.1)' }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: st.dot, boxShadow: `0 0 4px ${st.glow}` }} />
          <span className="text-[10px] font-semibold" style={{ color: st.color }}>{st.label}</span>
        </div>

        {/* Checkbox */}
        <button
          onClick={onToggle}
          className="absolute left-2 top-2 transition-opacity"
          style={{ opacity: checked ? 1 : 0 }}
          onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
          onMouseLeave={e => { if (!checked) e.currentTarget.style.opacity = '0' }}>
          {checked
            ? <CheckSquare size={17} style={{ color: '#0057b8', filter: 'drop-shadow(0 0 4px rgba(0,87,184,0.6))' }} />
            : <Square size={17} className="text-white opacity-80" />}
        </button>

        {/* Hover action overlay */}
        <div className="absolute inset-0 flex items-center justify-center gap-3 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
          <Link href={`/courses/${course.id}`}>
            <motion.button
              whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.95 }}
              className="flex h-9 w-9 items-center justify-center rounded-xl"
              style={{ background: 'rgba(255,255,255,0.18)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.25)' }}
              title="View">
              <Eye size={14} className="text-white" />
            </motion.button>
          </Link>
          <Link href={`/courses/${course.id}/edit`}>
            <motion.button
              whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.95 }}
              className="flex h-9 w-9 items-center justify-center rounded-xl"
              style={{ background: 'rgba(255,255,255,0.18)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.25)' }}>
              <Edit2 size={14} className="text-white" />
            </motion.button>
          </Link>
          <motion.button
            onClick={onDelete}
            whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.95 }}
            className="flex h-9 w-9 items-center justify-center rounded-xl"
            style={{ background: 'rgba(239,68,68,0.3)', backdropFilter: 'blur(8px)', border: '1px solid rgba(239,68,68,0.35)' }}>
            <Trash2 size={14} style={{ color: '#FCA5A5' }} />
          </motion.button>
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-col gap-2.5 p-3.5 flex-1">
        {/* Badges row */}
        <div className="flex flex-wrap items-center gap-1.5">
          {lv && (
            <span className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: lv.bg, color: lv.color }}>
              {lv.label}
            </span>
          )}
          {course.program && (
            <span className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold"
              style={{ background: PROGRAM_STYLE[course.program].bg, color: PROGRAM_STYLE[course.program].color }}>
              {PROGRAM_LABELS[course.program]}
            </span>
          )}
          {course.category && (
            <span className="truncate rounded-md px-1.5 py-0.5 text-[10px]"
              style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.4)' }}>
              {course.category.name}
            </span>
          )}
        </div>

        {/* Title */}
        <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-white">{course.title}</h3>

        {/* Instructor */}
        {course.instructor && (
          <div className="flex items-center gap-2">
            <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[9px] font-bold"
              style={{ background: 'rgba(0,87,184,0.18)', color: '#0057b8' }}>
              {course.instructor.name.charAt(0).toUpperCase()}
            </div>
            <span className="truncate text-[11px]" style={{ color: 'rgba(255,255,255,0.38)' }}>{course.instructor.name}</span>
          </div>
        )}

        {/* Footer */}
        <div className="mt-auto flex items-center justify-between pt-1">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1" style={{ color: 'rgba(255,255,255,0.38)' }}>
              <Users size={11} />
              <span className="text-[11px]">{course.enrolledCount.toLocaleString()}</span>
            </div>
            {course.ratingAvg > 0 && (
              <div className="flex items-center gap-1" style={{ color: '#FACC15' }}>
                <Star size={11} fill="#FACC15" />
                <span className="text-[11px] font-medium">{course.ratingAvg.toFixed(1)}</span>
              </div>
            )}
          </div>
          <span className="text-sm font-bold" style={{ color: course.isFree ? '#4ADE80' : 'white' }}>
            {formatCoursePrice(course, cur)}
          </span>
        </div>
      </div>
    </motion.div>
  )
}

/* ── Course Row (table view) ─────────────────────────────────── */
function CourseRow({ course, index, checked, onToggle, onDelete }: {
  course: Course; index: number; checked: boolean; onToggle: () => void; onDelete: () => void
}) {
  const st = STATUS_CONFIG[course.status]
  const lv = course.level ? LEVEL_CONFIG[course.level] : null
  const cur = useOrgCurrency()

  return (
    <motion.tr
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.035 }}
      className="group transition-colors duration-150"
      style={{
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        background: checked ? 'rgba(0,87,184,0.06)' : 'transparent',
      }}
      onMouseEnter={e => { if (!checked) e.currentTarget.style.background = 'rgba(255,255,255,0.022)' }}
      onMouseLeave={e => { if (!checked) e.currentTarget.style.background = 'transparent' }}>

      {/* Checkbox */}
      <td className="px-3 py-3.5 w-10">
        <button onClick={onToggle} className="flex items-center justify-center">
          {checked
            ? <CheckSquare size={15} style={{ color: '#0057b8' }} />
            : <Square size={15} style={{ color: 'rgba(255,255,255,0.2)' }}
                className="opacity-0 group-hover:opacity-100 transition-opacity" />}
        </button>
      </td>

      {/* Course info */}
      <td className="px-4 py-3.5">
        <div className="flex items-center gap-3">
          {/* Thumbnail */}
          <div className="relative h-12 w-20 flex-shrink-0 overflow-hidden rounded-xl"
            style={{ background: 'rgba(255,255,255,0.04)' }}>
            {course.thumbnailUrl
              ? <img src={course.thumbnailUrl} alt="" className="h-full w-full object-cover" />
              : <div className="flex h-full w-full items-center justify-center">
                  <BookOpen size={14} style={{ color: 'rgba(255,255,255,0.15)' }} />
                </div>}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white max-w-[220px]">{course.title}</p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {lv && (
                <span className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: lv.bg, color: lv.color }}>
                  {lv.label}
                </span>
              )}
              {course.instructor && (
                <span className="flex items-center gap-1 text-[10px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
                  <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full text-[8px] font-bold"
                    style={{ background: 'rgba(0,87,184,0.15)', color: '#0057b8' }}>
                    {course.instructor.name.charAt(0)}
                  </span>
                  {course.instructor.name}
                </span>
              )}
            </div>
          </div>
        </div>
      </td>

      {/* Program */}
      <td className="px-4 py-3.5">
        {course.program ? (
          <span className="inline-flex items-center rounded-lg px-2 py-1 text-[11px] font-semibold"
            style={{ background: PROGRAM_STYLE[course.program].bg, color: PROGRAM_STYLE[course.program].color }}>
            {PROGRAM_LABELS[course.program]}
          </span>
        ) : (
          <span className="text-xs" style={{ color: 'rgba(255,255,255,0.2)' }}>—</span>
        )}
      </td>

      {/* Status */}
      <td className="px-4 py-3.5">
        <span className="flex w-fit items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-semibold"
          style={{ background: st.bg, color: st.color }}>
          <span className="h-1.5 w-1.5 rounded-full flex-shrink-0"
            style={{ background: st.dot, boxShadow: `0 0 4px ${st.glow}` }} />
          {st.label}
        </span>
      </td>

      {/* Students */}
      <td className="px-4 py-3.5">
        <div className="flex items-center gap-1.5 text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>
          <Users size={12} />{course.enrolledCount.toLocaleString()}
        </div>
      </td>

      {/* Rating */}
      <td className="px-4 py-3.5">
        {course.ratingAvg > 0
          ? <div className="flex items-center gap-1" style={{ color: '#FACC15' }}>
              <Star size={12} fill="#FACC15" />
              <span className="text-sm font-medium">{course.ratingAvg.toFixed(1)}</span>
              <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.22)' }}>({course.ratingCount})</span>
            </div>
          : <span className="text-xs" style={{ color: 'rgba(255,255,255,0.2)' }}>—</span>}
      </td>

      {/* Price */}
      <td className="px-4 py-3.5">
        {course.isFree
          ? <span className="text-xs font-semibold" style={{ color: '#4ADE80' }}>Free</span>
          : <span className="text-sm font-semibold text-white">{formatCoursePrice(course, cur)}</span>}
      </td>

      {/* Created */}
      <td className="px-4 py-3.5">
        <div className="flex items-center gap-1.5 text-xs" style={{ color: 'rgba(255,255,255,0.28)' }}>
          <Clock size={11} />
          {new Date(course.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}
        </div>
      </td>

      {/* Actions */}
      <td className="px-4 py-3.5">
        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Link href={`/courses/${course.id}`}>
            <button className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-white/10"
              style={{ color: 'rgba(255,255,255,0.45)' }} title="View">
              <Eye size={13} />
            </button>
          </Link>
          <Link href={`/courses/${course.id}/edit`}>
            <button className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-white/10"
              style={{ color: 'rgba(255,255,255,0.45)' }} title="Edit">
              <Edit2 size={13} />
            </button>
          </Link>
          <button onClick={onDelete}
            className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-red-500/15"
            style={{ color: 'rgba(255,255,255,0.45)' }} title="Delete">
            <Trash2 size={13} />
          </button>
        </div>
      </td>
    </motion.tr>
  )
}

/* ── Main component ─────────────────────────────────────────── */
const PROGRAM_LABELS: Record<string, string> = {
  '4x-trading':        'FOREX Trading',
  'jura':              'JURA',
  'digital-marketing': 'Digital Marketing',
  'ai':                'AI',
}
const PROGRAM_STYLE: Record<string, { bg: string; color: string }> = {
  '4x-trading':        { bg: 'rgba(96,165,250,0.12)',  color: '#60A5FA' },
  'jura':              { bg: 'rgba(139,92,246,0.12)', color: '#8B5CF6' },
  'digital-marketing': { bg: 'rgba(52,211,153,0.12)',  color: '#34D399' },
  'ai':                { bg: 'rgba(167,139,250,0.12)', color: '#A78BFA' },
}

export function CourseTable() {
  const [search,   setSearch]   = useState('')
  const [status,   setStatus]   = useState<string>('all')
  const [program,  setProgram]  = useState<string>('')
  const [page,     setPage]     = useState(1)
  const [sortKey,  setSortKey]  = useState<SortKey>('createdAt')
  const [sortDir,  setSortDir]  = useState<'asc' | 'desc'>('desc')
  /* Cleared whenever the visible set changes - page, search, status or
     programme. It used to survive all four, so ticking five courses on page
     one, paging to two and ticking two more produced "Delete 7 course(s)?"
     and deleted five rows the admin could no longer see. A selection you
     cannot see is not a selection you can confirm. */
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [view,     setView]     = useState<ViewMode>('table')
  const toast = useToast()

  const { openDeleteModal } = useUIStore()
  const bulk  = useBulkCourses()
  const { data: stats } = useAdminStats()
  const { data, isLoading } = useCourses({
    page, per_page: view === 'grid' ? 12 : 8,
    search, status,
    program: program || undefined,
    sort: `${sortKey}:${sortDir}`,
  })

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const SortIcon = ({ col }: { col: SortKey }) =>
    sortKey === col
      ? sortDir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />
      : <ChevronDown size={11} style={{ opacity: 0.25 }} />

  const statusFilters = [
    { value: 'all', label: 'All' },
    { value: 'published', label: 'Published' },
    { value: 'draft', label: 'Draft' },
    { value: 'archived', label: 'Archived' },
  ]

  /* Selection helpers */
  const ids        = data?.docs.map(c => c.id) ?? []
  const allChecked  = ids.length > 0 && ids.every(id => selected.has(id))
  const someChecked = ids.some(id => selected.has(id))

  const toggleAll = () => {
    if (allChecked) setSelected(prev => { const n = new Set(prev); ids.forEach(id => n.delete(id)); return n })
    else setSelected(prev => new Set([...prev, ...ids]))
  }
  const toggleOne = (id: string) => {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  const runBulk = async (action: 'publish' | 'archive' | 'delete') => {
    if (action === 'delete' && !confirm(`Delete ${selected.size} course(s)? This cannot be undone.`)) return
    try {
      await bulk.mutateAsync({ ids: Array.from(selected), action })
      setSelected(new Set())
    } catch {
      /* mutateAsync rejects on a permission error, a course with enrolments,
         or a dropped connection. The selection was being cleared regardless
         and nothing was said, so a bulk delete that deleted nothing looked
         exactly like one that worked. Keep the selection so it can be
         retried, and say what happened. */
      toast.error(`Could not ${action} the selected courses`, 'Nothing was changed - the selection is still here.')
    }
  }

  const perPage = view === 'grid' ? 12 : 8

  return (
    <div>
      {/* ── Stats bar ─────────────────────────────────── */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Total Courses"  value={stats?.totalCourses}     icon={BookOpen} color="#0057b8" bg="rgba(0,87,184,0.12)"  delay={0}    />
        <StatCard label="Published"      value={stats?.publishedCourses} icon={Globe}    color="#4ADE80" bg="rgba(74,222,128,0.12)" delay={0.06} />
        <StatCard label="Draft"          value={stats?.draftCourses}     icon={FileEdit} color="#FACC15" bg="rgba(250,204,21,0.12)" delay={0.12} />
        <StatCard label="Total Students" value={stats?.totalStudents}    icon={Users}    color="#60A5FA" bg="rgba(96,165,250,0.12)" delay={0.18} />
      </div>

      {/* ── Toolbar ───────────────────────────────────── */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Search */}
        <div className="relative max-w-xs flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'rgba(255,255,255,0.28)' }} />
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); setSelected(new Set()) }}
            placeholder="Search courses…"
            className="w-full rounded-xl py-2 pl-9 pr-4 text-sm text-white outline-none transition-all placeholder:text-white/20"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
            onFocus={e => { e.currentTarget.style.border = '1px solid rgba(0,87,184,0.45)'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(0,87,184,0.09)' }}
            onBlur={e => { e.currentTarget.style.border = '1px solid rgba(255,255,255,0.08)'; e.currentTarget.style.boxShadow = 'none' }}
          />
        </div>

        <div className="flex items-center gap-2">
          {/* Status filter pills */}
          <div className="flex rounded-xl p-0.5" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
            {statusFilters.map(f => (
              <button key={f.value} onClick={() => { setStatus(f.value); setPage(1); setSelected(new Set()) }}
                className="rounded-lg px-3 py-1.5 text-xs font-semibold transition-all"
                style={status === f.value
                  ? { background: 'rgba(0,87,184,0.18)', color: '#0057b8' }
                  : { color: 'rgba(255,255,255,0.38)' }}>
                {f.label}
              </button>
            ))}
          </div>

          {/* Program filter */}
          <div className="flex items-center gap-1">
            {(['', '4x-trading', 'digital-marketing', 'ai', 'jura'] as const).map(p => (
              <button key={p || 'all'} onClick={() => { setProgram(p); setPage(1); setSelected(new Set()) }}
                className="rounded-xl px-3 py-1.5 text-xs font-semibold transition-all"
                style={program === p
                  ? { background: 'rgba(0,87,184,0.18)', color: '#0057b8', border: '1px solid rgba(0,87,184,0.4)' }
                  : { background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.38)', border: '1px solid rgba(255,255,255,0.07)' }}>
                {p === '' ? 'All' : PROGRAM_LABELS[p]}
              </button>
            ))}
          </div>

          {/* View toggle */}
          <div className="flex rounded-xl p-0.5" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <button onClick={() => setView('table')} title="Table view"
              className="flex h-7 w-7 items-center justify-center rounded-lg transition-all"
              style={view === 'table' ? { background: 'rgba(0,87,184,0.18)', color: '#0057b8' } : { color: 'rgba(255,255,255,0.35)' }}>
              <List size={13} />
            </button>
            <button onClick={() => setView('grid')} title="Grid view"
              className="flex h-7 w-7 items-center justify-center rounded-lg transition-all"
              style={view === 'grid' ? { background: 'rgba(0,87,184,0.18)', color: '#0057b8' } : { color: 'rgba(255,255,255,0.35)' }}>
              <LayoutGrid size={13} />
            </button>
          </div>

          {/* New course */}
          <Link href="/courses/new">
            <motion.button whileHover={{ y: -1, scale: 1.02 }} whileTap={{ scale: 0.97 }}
              className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold text-white"
              style={{ background: 'linear-gradient(135deg, #0057b8, #003d80)', boxShadow: '0 4px 14px rgba(0,87,184,0.3)' }}>
              <Plus size={13} /> New Course
            </motion.button>
          </Link>
        </div>
      </div>

      {/* ── Content ───────────────────────────────────── */}
      <AnimatePresence mode="wait">
        {view === 'table' ? (
          <motion.div key="table" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
            <div className="overflow-hidden rounded-2xl" style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[780px] border-collapse">
                  <thead>
                    <tr style={{ background: 'rgba(255,255,255,0.025)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                      {/* Select-all */}
                      <th className="px-3 py-3 w-10">
                        <button onClick={toggleAll} className="flex items-center justify-center" title={allChecked ? 'Deselect all' : 'Select all'}>
                          {allChecked
                            ? <CheckSquare size={15} style={{ color: '#0057b8' }} />
                            : someChecked
                              ? <CheckSquare size={15} style={{ color: 'rgba(0,87,184,0.4)' }} />
                              : <Square size={15} style={{ color: 'rgba(255,255,255,0.18)' }} />}
                        </button>
                      </th>
                      {[
                        { label: 'Course',   col: 'title'         as SortKey },
                        { label: 'Program' },
                        { label: 'Status' },
                        { label: 'Students', col: 'enrolledCount' as SortKey },
                        { label: 'Rating',   col: 'ratingAvg'     as SortKey },
                        { label: 'Price',    col: 'price'         as SortKey },
                        { label: 'Created',  col: 'createdAt'     as SortKey },
                        { label: '' },
                      ].map((h, i) => (
                        <th key={i} className="px-4 py-3 text-left"
                          style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.09em' }}>
                          {h.col
                            ? <button onClick={() => handleSort(h.col!)} className="flex items-center gap-1 transition-opacity hover:opacity-80">
                                {h.label} <SortIcon col={h.col} />
                              </button>
                            : h.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {isLoading
                      ? skeletonCells.map((_, i) => <SkeletonRow key={i} />)
                      : data?.docs.map((course, i) => (
                          <CourseRow
                            key={course.id} course={course} index={i}
                            checked={selected.has(course.id)}
                            onToggle={() => toggleOne(course.id)}
                            onDelete={() => openDeleteModal(course.id, course.title)}
                          />
                        ))}
                    {!isLoading && data?.docs.length === 0 && <EmptyState colSpan={8} />}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {data && data.meta.total_pages > 1 && (
                <Pagination
                  page={page} meta={data.meta} perPage={perPage}
                  onPrev={() => { setPage(p => Math.max(1, p - 1)); setSelected(new Set()) }}
                  onNext={() => { setPage(p => p + 1); setSelected(new Set()) }}
                  onPage={setPage}
                />
              )}
            </div>
          </motion.div>
        ) : (
          <motion.div key="grid" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
            {isLoading ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
              </div>
            ) : data?.docs.length === 0 ? (
              <div className="py-20"><EmptyStateInline /></div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {data?.docs.map((course, i) => (
                  <CourseCard
                    key={course.id} course={course} index={i}
                    checked={selected.has(course.id)}
                    onToggle={() => toggleOne(course.id)}
                    onDelete={() => openDeleteModal(course.id, course.title)}
                  />
                ))}
              </div>
            )}

            {/* Grid pagination */}
            {data && data.meta.total_pages > 1 && (
              <div className="mt-6">
                <Pagination
                  page={page} meta={data.meta} perPage={perPage}
                  onPrev={() => { setPage(p => Math.max(1, p - 1)); setSelected(new Set()) }}
                  onNext={() => { setPage(p => p + 1); setSelected(new Set()) }}
                  onPage={setPage}
                />
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating bulk bar */}
      <BulkBar
        selected={selected.size}
        onPublish={() => void runBulk('publish')}
        onArchive={() => void runBulk('archive')}
        onDelete={() => void runBulk('delete')}
        onClear={() => setSelected(new Set())}
        isPending={bulk.isPending}
      />
    </div>
  )
}

/* ── Pagination ──────────────────────────────────────────────── */
function Pagination({ page, meta, perPage, onPrev, onNext, onPage }: {
  page: number
  meta: { total_pages: number; total_count: number; has_prev: boolean; has_next: boolean }
  perPage: number
  onPrev: () => void; onNext: () => void; onPage: (p: number) => void
}) {
  const start = (page - 1) * perPage + 1
  const end   = Math.min(page * perPage, meta.total_count)

  /* Show at most 7 page buttons with ellipsis */
  const pages: (number | '…')[] = []
  const total = meta.total_pages
  if (total <= 7) {
    for (let i = 1; i <= total; i++) pages.push(i)
  } else {
    pages.push(1)
    if (page > 3) pages.push('…')
    for (let i = Math.max(2, page - 1); i <= Math.min(total - 1, page + 1); i++) pages.push(i)
    if (page < total - 2) pages.push('…')
    pages.push(total)
  }

  return (
    <div className="flex items-center justify-between px-4 py-3"
      style={{ borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.015)' }}>
      <p className="text-xs" style={{ color: 'rgba(255,255,255,0.28)' }}>
        Showing {start}–{end} of {meta.total_count.toLocaleString()}
      </p>
      <div className="flex items-center gap-1">
        <button onClick={onPrev} disabled={!meta.has_prev}
          className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors disabled:opacity-30"
          style={{ color: 'rgba(255,255,255,0.55)' }}>
          <ChevronLeft size={13} />
        </button>
        {pages.map((p, i) =>
          p === '…'
            ? <span key={`e${i}`} className="px-1 text-xs" style={{ color: 'rgba(255,255,255,0.25)' }}>…</span>
            : <button key={p} onClick={() => onPage(p)}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-xs font-semibold transition-all"
                style={p === page
                  ? { background: 'rgba(0,87,184,0.2)', color: '#0057b8', boxShadow: '0 0 0 1px rgba(0,87,184,0.3)' }
                  : { color: 'rgba(255,255,255,0.38)' }}>
                {p}
              </button>
        )}
        <button onClick={onNext} disabled={!meta.has_next}
          className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors disabled:opacity-30"
          style={{ color: 'rgba(255,255,255,0.55)' }}>
          <ChevronRight size={13} />
        </button>
      </div>
    </div>
  )
}

/* ── Empty states ────────────────────────────────────────────── */
function EmptyState({ colSpan }: { colSpan: number }) {
  return (
    <tr>
      <td colSpan={colSpan} className="py-20 text-center">
        <EmptyStateInline />
      </td>
    </tr>
  )
}

function EmptyStateInline() {
  return (
    <div className="flex flex-col items-center gap-3">
      <motion.div
        animate={{ scale: [1, 1.06, 1] }}
        transition={{ repeat: Infinity, duration: 2.5, ease: 'easeInOut' }}
        className="flex h-14 w-14 items-center justify-center rounded-2xl"
        style={{ background: 'rgba(0,87,184,0.08)', border: '1px solid rgba(0,87,184,0.15)' }}>
        <BookOpen size={22} style={{ color: 'rgba(0,87,184,0.5)' }} />
      </motion.div>
      <p className="text-sm font-medium" style={{ color: 'rgba(255,255,255,0.28)' }}>No courses found</p>
      <p className="text-xs" style={{ color: 'rgba(255,255,255,0.15)' }}>Try adjusting your filters or create a new course</p>
    </div>
  )
}
