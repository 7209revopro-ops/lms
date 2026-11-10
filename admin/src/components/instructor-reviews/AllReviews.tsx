'use client'
/* ─────────────────────────────────────────────────────────────
   Instructor Reviews → All reviews (the user, 2026-11-10: "full review with
   filter … they can see their review and others review also"): every review
   of a mentor — their stars after a class, and the class feedback — newest
   first, by mentor ("My reviews" for an instructor), stars, kind, with words
   and a search, in the page's days and programme; the totals of what matches
   and an export (backend services/reviewFeed.service.ts).
───────────────────────────────────────────────────────────── */
import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Download, Loader2, MessageSquareQuote, Search, Star, UserRound } from 'lucide-react'
import { fetchReviewFeed, useReviewFeed, type InstructorLeaderboardRow, type ReviewFeedFilters, type ReviewRange } from '@/lib/api/instructorReviews'

export const PROGRAMS: Array<[string, string]> = [['4x-trading', 'Forex'], ['digital-marketing', 'Digital Marketing'], ['ai', 'AI'], ['jura', 'JURA'], ['cma', 'CMA']]
const PROGRAM_LABEL: Record<string, string> = Object.fromEntries(PROGRAMS)
const KIND: Record<string, string> = { mentor_rating: 'Mentor rating', class_feedback: 'Class feedback' }
const muted = { color: 'rgba(255,255,255,0.45)' }
const panel = { background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)' }
export const control = 'h-9 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm text-white outline-none'
const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' }) : '')
const day = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Dubai' }) : '')
const errText = (e: unknown) => String((e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? (e as Error)?.message ?? 'Could not load the reviews')

function Stars({ value, size = 13 }: { value: number; size?: number }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(n => <Star key={n} size={size} fill={n <= Math.round(value) ? '#FACC15' : 'transparent'} style={{ color: n <= Math.round(value) ? '#FACC15' : 'rgba(255,255,255,0.2)' }} />)}
    </span>
  )
}

export function AllReviews({ range, mentors, myId }: { range: ReviewRange; mentors: InstructorLeaderboardRow[]; myId: string | null }) {
  const [mine, setMine] = useState(false)
  const [instructor, setInstructor] = useState('')
  const [rating, setRating] = useState('')
  const [kind, setKind] = useState('')
  const [withComment, setWithComment] = useState(false)
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [exporting, setExporting] = useState(false)
  useEffect(() => { const t = setTimeout(() => setQ(search.trim()), 300); return () => clearTimeout(t) }, [search])
  const filters: ReviewFeedFilters = { ...range, instructor: mine && myId ? myId : instructor, rating, kind, withComment, q }
  const key = JSON.stringify(filters)
  useEffect(() => { setPage(1) }, [key])
  const { data, isLoading, isFetching, error } = useReviewFeed(filters, page)
  const reviews = data?.reviews ?? []
  const stats = data?.stats
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / (data?.perPage ?? 25)))
  const max = Math.max(1, ...Object.values(stats?.counts ?? {}))

  const exportCsv = async () => {
    setExporting(true)
    try {
      const all: NonNullable<typeof data>['reviews'] = []
      for (let p = 1; p <= 20; p++) {
        const got = await fetchReviewFeed(filters, p, 100)
        all.push(...got.reviews)
        if (all.length >= got.total || !got.reviews.length) break
      }
      const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
      const head = ['Left', 'Mentor', 'Stars', 'Kind', 'Student', 'Class', 'Class date', 'Programme', 'Words', 'On the class']
      const rows = all.map(v => [when(v.createdAt), v.instructor?.name, v.rating, KIND[v.kind], v.student?.name, v.class?.title, day(v.class?.scheduledStart), PROGRAM_LABEL[v.program] || v.program, v.comment, v.classComment])
      const blob = new Blob(['﻿' + [head, ...rows].map(r => r.map(cell).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob); a.download = `instructor-reviews${range.from ? `-${range.from}` : ''}${range.to ? `-to-${range.to}` : ''}.csv`; a.click(); URL.revokeObjectURL(a.href)
    } finally { setExporting(false) }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {myId && (
          <button type="button" onClick={() => setMine(v => !v)} aria-pressed={mine}
            className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium"
            style={mine ? { background: '#0057b8', color: '#fff', border: '1px solid #0057b8' } : { background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.8)', border: '1px solid rgba(255,255,255,0.1)' }}>
            <UserRound size={14} />My reviews
          </button>
        )}
        {!mine && (
          <select className={control} value={instructor} onChange={e => setInstructor(e.target.value)} aria-label="Mentor" style={{ colorScheme: 'dark' }}>
            <option value="">Every mentor</option>
            {mentors.map(m => <option key={m.instructorId} value={m.instructorId}>{m.name}</option>)}
          </select>
        )}
        <select className={control} value={rating} onChange={e => setRating(e.target.value)} aria-label="Stars" style={{ colorScheme: 'dark' }}>
          <option value="">Any stars</option>
          {[5, 4, 3, 2, 1].map(n => <option key={n} value={String(n)}>{n} star{n === 1 ? '' : 's'}</option>)}
          <option value="low">Low (1–2★)</option>
        </select>
        <select className={control} value={kind} onChange={e => setKind(e.target.value)} aria-label="Kind" style={{ colorScheme: 'dark' }}>
          <option value="">Mentor ratings + class feedback</option>
          <option value="mentor_rating">Mentor ratings</option>
          <option value="class_feedback">Class feedback</option>
        </select>
        <label className={`${control} inline-flex items-center gap-1.5`}>
          <input type="checkbox" checked={withComment} onChange={e => setWithComment(e.target.checked)} />With words
        </label>
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={muted} />
          <input className={`${control} w-56 pl-8 placeholder:text-white/30`} placeholder="Student, class or words" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="flex-1" />
        {isFetching && !isLoading && <Loader2 size={14} className="animate-spin" style={muted} />}
        <button type="button" disabled={!data?.total || exporting} onClick={exportCsv} className={`${control} inline-flex items-center gap-1.5 disabled:opacity-40`}>
          {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}Export
        </button>
      </div>

      {stats && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <div className="rounded-xl p-3" style={panel}><p className="text-xs" style={muted}>Reviews</p><p className="text-lg font-bold text-white">{stats.count}</p></div>
          <div className="rounded-xl p-3" style={panel}><p className="text-xs" style={muted}>Average</p><p className="flex items-center gap-1.5 text-lg font-bold text-white">{stats.average ?? '—'}{stats.average != null && <Star size={14} fill="#FACC15" style={{ color: '#FACC15' }} />}</p></div>
          <div className="rounded-xl p-3" style={panel}><p className="text-xs" style={muted}>Low (1–2★)</p><p className="text-lg font-bold" style={{ color: stats.low ? '#F87171' : '#fff' }}>{stats.low}</p></div>
          <div className="rounded-xl p-3" style={panel}><p className="text-xs" style={muted}>With words</p><p className="text-lg font-bold text-white">{stats.withComment}</p></div>
          <div className="col-span-2 rounded-xl p-3 sm:col-span-1" style={panel}>
            {(['5', '4', '3', '2', '1'] as const).map(k => (
              <div key={k} className="flex items-center gap-1.5 text-[10px]" style={muted}>
                <span className="w-2">{k}</span>
                <span className="h-1.5 w-20 overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}><span className="block h-full rounded-full" style={{ width: `${(stats.counts[k] / max) * 100}%`, background: Number(k) >= 4 ? '#4ADE80' : k === '3' ? '#FACC15' : '#F87171' }} /></span>
                <span>{stats.counts[k]}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {isLoading ? <div className="flex justify-center py-14"><Loader2 size={18} className="animate-spin" style={muted} /></div>
        : error ? <p className="rounded-xl px-4 py-3 text-sm" style={{ color: '#FBBF24', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)' }}>{errText(error)}</p>
        : !reviews.length ? <p className="rounded-2xl px-4 py-12 text-center text-sm" style={{ ...panel, ...muted }}>{mine ? 'No reviews of yours for these filters.' : 'No reviews for these filters.'}</p>
        : (
          <div className="space-y-2">
            {reviews.map(v => (
              <div key={v.id} className="rounded-xl p-3" style={panel}>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Stars value={v.rating} />
                  <span className="text-sm font-semibold text-white">{v.instructor?.name || 'A mentor'}</span>
                  <span className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold" style={v.kind === 'class_feedback' ? { background: 'rgba(56,189,248,0.14)', color: '#7DD3FC' } : { background: 'rgba(167,139,250,0.15)', color: '#C4B5FD' }}>{KIND[v.kind]}</span>
                  {v.program && <span className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)' }}>{PROGRAM_LABEL[v.program] || v.program}</span>}
                  <span className="ml-auto text-[11px]" style={muted}>{when(v.createdAt)}</span>
                </div>
                <p className="mt-0.5 text-xs" style={muted}>{v.student?.name || 'A student'}{v.class?.title ? ` · ${v.class.title}` : ''}{v.class?.scheduledStart ? ` · class ${day(v.class.scheduledStart)}` : ''}</p>
                {v.comment && (
                  <p className="mt-2 flex items-start gap-1.5 text-sm" style={{ color: 'rgba(255,255,255,0.8)' }}>
                    <MessageSquareQuote size={13} className="mt-0.5 shrink-0" style={{ color: 'rgba(255,255,255,0.3)' }} />{v.comment}
                  </p>
                )}
                {v.classComment && <p className="mt-1 text-xs" style={muted}>On the class: {v.classComment}</p>}
              </div>
            ))}
          </div>
        )}
      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-xs" style={muted}>
          <button type="button" disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="flex h-8 w-8 items-center justify-center rounded-xl disabled:opacity-30" style={{ background: 'rgba(255,255,255,0.05)' }}><ChevronLeft size={14} /></button>
          Page {page} of {pages}
          <button type="button" disabled={page >= pages} onClick={() => setPage(p => p + 1)} className="flex h-8 w-8 items-center justify-center rounded-xl disabled:opacity-30" style={{ background: 'rgba(255,255,255,0.05)' }}><ChevronRight size={14} /></button>
        </div>
      )}
    </div>
  )
}
