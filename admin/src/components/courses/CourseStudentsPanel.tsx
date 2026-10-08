'use client'

import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Users, Search, CreditCard, Gift, ShieldCheck, Terminal, HelpCircle,
  Download, AlertTriangle, X,
} from 'lucide-react'
import { useCourseStudents, type EnrollmentSource } from '@/lib/api/courses'
import Spinner from '@/components/ui/Spinner'
import { SalesCrmBadge } from '@/components/ui/SalesCrmBadge'
import { CsTag, csName, csTeam } from '@/components/ui/CsTag'

/* ─────────────────────────────────────────────────────
   Who is on this course, and how they got here.

   The four sources are not decoration — they answer different questions an
   admin actually has. "Purchase" is revenue. "Admin" and "Script" are people
   who were let in, and are the ones worth auditing. "Free" is self-service.
   They are shown as a filter row with counts taken over the WHOLE course, not
   the current page, because a tab that counts only what is on screen is worse
   than no count.

   `unknown` is deliberately visible rather than hidden or folded into
   "admin". It means the enrolment pre-dates the source field and the answer
   is not recoverable — an admin grant and a bulk import wrote identical rows.
   Presenting that as a guess would be worse than presenting it as a gap.
───────────────────────────────────────────────────── */

const SOURCE_META: Record<EnrollmentSource, {
  label: string; icon: React.ElementType; color: string; hint: string
}> = {
  purchase: { label: 'Purchased', icon: CreditCard,  color: '#22C55E', hint: 'Paid through a payment gateway' },
  free:     { label: 'Free',      icon: Gift,        color: '#60A5FA', hint: 'Self-enrolled on a course with no price' },
  admin:    { label: 'By Admin',  icon: ShieldCheck, color: '#A78BFA', hint: 'Granted from the admin panel' },
  script:   { label: 'By Script', icon: Terminal,    color: '#FBBF24', hint: 'Written by a bulk-import script' },
  unknown:  { label: 'Unknown',   icon: HelpCircle,  color: '#94A3B8', hint: 'Pre-dates source tracking — not recoverable' },
}

const ORDER: EnrollmentSource[] = ['purchase', 'free', 'admin', 'script', 'unknown']

function SourceBadge({ source }: { source: EnrollmentSource }) {
  const m = SOURCE_META[source] ?? SOURCE_META.unknown
  const Icon = m.icon
  return (
    <span
      title={m.hint}
      className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-semibold whitespace-nowrap"
      style={{ background: `${m.color}1A`, color: m.color }}>
      <Icon size={11} strokeWidth={2} />{m.label}
    </span>
  )
}

export function CourseStudentsPanel({ courseId, onClose }: {
  courseId: string
  onClose?: () => void
}) {
  const [page,   setPage]   = useState(1)
  const [search, setSearch] = useState('')
  const [source, setSource] = useState<'all' | EnrollmentSource>('all')

  const { data, isLoading, isError } = useCourseStudents(courseId, {
    page, per_page: 25, search, source: source === 'all' ? undefined : source,
  })

  const total = data?.meta?.total_count ?? 0
  const bySource = data?.bySource ?? {}
  const allCount = useMemo(
    () => Object.values(bySource).reduce((a: number, b) => a + (b ?? 0), 0),
    [bySource],
  )

  /* Export what is on screen after filtering — the thing an admin reaches for
     next, and cheap enough to do client-side at this page size. */
  const exportCsv = () => {
    const rows = data?.rows ?? []
    if (!rows.length) return
    const head = ['Name', 'Email', 'Phone', 'CS', 'CS Team', 'Source', 'Status', 'Progress %', 'Enrolled']
    const body = rows.map(r => [
      r.student.name, r.student.email, r.student.phone ?? '',
      csName(r.student.tetraCs), csTeam(r.student.tetraCs),
      SOURCE_META[r.source]?.label ?? r.source, r.status,
      String(r.progressPercent ?? 0),
      new Date(r.enrolledAt).toISOString().slice(0, 10),
    ])
    const csv = [head, ...body]
      .map(line => line.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = Object.assign(document.createElement('a'), {
      href: url, download: `${data?.courseTitle ?? 'course'}-students.csv`,
    })
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 28 }}
      className="rounded-2xl p-5"
      style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)' }}>

      {/* Header */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl"
            style={{ background: 'rgba(0,87,184,0.14)' }}>
            <Users size={16} style={{ color: '#4D94FF' }} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">Students</h3>
            <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.40)' }}>
              {total} shown{allCount !== total ? ` of ${allCount}` : ''}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2"
              style={{ color: 'rgba(255,255,255,0.35)' }} />
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1) }}
              placeholder="Search name or email…"
              className="h-10 w-full rounded-xl pl-9 pr-3 text-sm outline-none sm:w-60"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.10)',
                color: 'white',
              }} />
          </div>
          <button
            type="button" onClick={exportCsv} disabled={!data?.rows?.length}
            className="flex h-10 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold transition-colors disabled:opacity-40"
            style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.75)' }}>
            <Download size={13} />CSV
          </button>
          {onClose && (
            <button type="button" onClick={onClose} aria-label="Close"
              className="flex h-10 w-10 items-center justify-center rounded-xl transition-colors"
              style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.55)' }}>
              <X size={15} />
            </button>
          )}
        </div>
      </div>

      {/* Source filter — counts span the whole course, not this page */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <FilterChip label="All" count={allCount} active={source === 'all'}
          onClick={() => { setSource('all'); setPage(1) }} color="#4D94FF" />
        {ORDER.filter(s => (bySource[s] ?? 0) > 0).map(s => (
          <FilterChip
            key={s}
            label={SOURCE_META[s].label}
            count={bySource[s] ?? 0}
            active={source === s}
            onClick={() => { setSource(s); setPage(1) }}
            color={SOURCE_META[s].color}
            icon={SOURCE_META[s].icon}
          />
        ))}
      </div>

      {/* Orphaned enrolments — the reason this list can be shorter than the
          course's enrolled count. Stated rather than silently swallowed. */}
      {!!data?.orphaned && (
        <div className="mb-4 flex items-start gap-2 rounded-xl px-3 py-2.5 text-[11px]"
          style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.20)', color: '#FBBF24' }}>
          <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
          <span>
            <strong>{data.orphaned}</strong> enrolment{data.orphaned === 1 ? '' : 's'} point at accounts that
            no longer exist, so they cannot be listed here — but they are still counted in this course&apos;s
            enrolled total.
          </span>
        </div>
      )}

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center gap-3 py-12">
          <Spinner size={18} />
          <span className="text-sm" style={{ color: 'rgba(255,255,255,0.45)' }}>Loading students…</span>
        </div>
      ) : isError ? (
        <p className="py-12 text-center text-sm" style={{ color: '#F87171' }}>
          Could not load the student list.
        </p>
      ) : !data?.rows?.length ? (
        <p className="py-12 text-center text-sm" style={{ color: 'rgba(255,255,255,0.40)' }}>
          {search || source !== 'all' ? 'No students match that filter.' : 'Nobody is enrolled yet.'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse">
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                {['Student', 'Source', 'Progress', 'Enrolled'].map(h => (
                  <th key={h} className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider"
                    style={{ color: 'rgba(255,255,255,0.35)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <AnimatePresence initial={false}>
                {data.rows.map(r => (
                  <motion.tr key={r._id}
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <td className="px-3 py-3">
                      <p className="text-sm font-semibold text-white">{r.student.name}</p>
                      <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.40)' }}>
                        {r.student.email}
                      </p>
                      <CsTag cs={r.student.tetraCs} />
                    </td>
                    <td className="px-3 py-3">
                      {/* How they got in, and — for a sale finance enrolled — which CRM sold it. */}
                      <div className="flex flex-wrap items-center gap-1">
                        <SourceBadge source={r.source} />
                        <SalesCrmBadge crm={r.salesCrm} />
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-16 overflow-hidden rounded-full"
                          style={{ background: 'rgba(255,255,255,0.08)' }}>
                          <div className="h-full rounded-full"
                            style={{ width: `${r.progressPercent ?? 0}%`, background: '#22C55E' }} />
                        </div>
                        <span className="text-[11px] tabular-nums" style={{ color: 'rgba(255,255,255,0.55)' }}>
                          {r.progressPercent ?? 0}%
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-[12px]" style={{ color: 'rgba(255,255,255,0.50)' }}>
                      {new Date(r.enrolledAt).toLocaleDateString()}
                    </td>
                  </motion.tr>
                ))}
              </AnimatePresence>
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {(data?.meta?.total_pages ?? 1) > 1 && (
        <div className="mt-4 flex items-center justify-center gap-2">
          <PageButton label="Previous" disabled={!data?.meta?.has_prev} onClick={() => setPage(p => p - 1)} />
          <span className="text-xs tabular-nums" style={{ color: 'rgba(255,255,255,0.45)' }}>
            {page} / {data?.meta?.total_pages}
          </span>
          <PageButton label="Next" disabled={!data?.meta?.has_next} onClick={() => setPage(p => p + 1)} />
        </div>
      )}
    </motion.section>
  )
}

function FilterChip({ label, count, active, onClick, color, icon: Icon }: {
  label: string; count: number; active: boolean; onClick: () => void
  color: string; icon?: React.ElementType
}) {
  return (
    <button type="button" onClick={onClick}
      className="flex h-9 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold transition-all"
      style={active
        ? { background: `${color}22`, color, border: `1px solid ${color}55` }
        : { background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.55)', border: '1px solid transparent' }}>
      {Icon && <Icon size={12} strokeWidth={2} />}
      {label}
      <span className="tabular-nums" style={{ opacity: 0.7 }}>{count}</span>
    </button>
  )
}

function PageButton({ label, disabled, onClick }: {
  label: string; disabled?: boolean; onClick: () => void
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className="h-9 rounded-xl px-3 text-xs font-semibold transition-colors disabled:opacity-35"
      style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.75)' }}>
      {label}
    </button>
  )
}
