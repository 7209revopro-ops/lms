'use client'
/* ─────────────────────────────────────────────────────────────
   Meetings done in the LMS admin (the user, 2026-11-10) — the CS Portal's,
   for the mentor signed in here:
     Meeting commission — each Meeting mentor commission (the Junior / Senior /
       Sub-junior Mentor who held the meeting gets the Junior + Senior % of the
       course payment) with the payment and the meeting it came from — linked
       on the request, else their last Mentor Calendar meeting with the student
       before it, else "Not booked on the Mentor Calendar". A mentor their own,
       a Chief their team's.
     Meetings (a Chief) — the team's student meetings in these days, how each
       went, and Converted: an approved course payment linked to it, or naming
       its mentor as who held it, after it.
───────────────────────────────────────────────────────────── */
import { useMemo, useState } from 'react'
import { CalendarCheck, Download, Loader2, Search } from 'lucide-react'
import { csError, useMeetingCommissions, useMeetingsDone, type CommissionRow, type MeetingDoneRow } from '@/lib/api/csMeetings'
import { StageBadge, field, muted, when } from './MeetingRequestsUi'

export type Days = { from: string; to: string }
const PER_PAGE = 25
const aed = (n: number) => `AED ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const day = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('en-GB', { timeZone: 'Asia/Dubai', day: 'numeric', month: 'short', year: 'numeric' }) : '—')
const panel = { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)' }
const select = 'rounded-lg border border-white/10 bg-transparent px-3 py-2 text-sm text-white outline-none'
const STATUS: Record<string, [string, string, string]> = {
  accrued: ['Earned', 'rgba(251,191,36,0.14)', '#FBBF24'],
  pooled: ['Earned', 'rgba(251,191,36,0.14)', '#FBBF24'],
  released: ['Released', 'rgba(56,189,248,0.14)', '#7DD3FC'],
  paid: ['Paid', 'rgba(52,211,153,0.15)', '#34D399'],
  cancelled: ['Reversed', 'rgba(255,255,255,0.07)', 'rgba(255,255,255,0.5)'],
}
const statusLabel = (s: string) => STATUS[s]?.[0] ?? s

function download(name: string, head: string[], rows: unknown[][]) {
  const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const blob = new Blob(['﻿' + [head, ...rows].map(r => r.map(cell).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href)
}

function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  if (pages <= 1) return null
  const btn = 'rounded-lg px-3 py-1.5 text-xs disabled:opacity-30'
  return (
    <div className="flex items-center justify-end gap-2 text-xs" style={muted}>
      <button type="button" className={btn} style={{ background: 'rgba(255,255,255,0.05)' }} disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
      Page {page} of {pages}
      <button type="button" className={btn} style={{ background: 'rgba(255,255,255,0.05)' }} disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
    </div>
  )
}
const Notice = ({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'muted' | 'warn' }) => (
  <p className="rounded-xl px-4 py-8 text-center text-sm" style={tone === 'warn' ? { color: '#FBBF24', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)' } : { ...panel, ...muted }}>{children}</p>
)
const Loading = () => <p className="flex items-center justify-center gap-2 py-12 text-sm" style={muted}><Loader2 size={16} className="animate-spin" />Loading…</p>

export function MeetingCommissionTab({ days }: { days: Days }) {
  const [mentor, setMentor] = useState('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const { data, isLoading, isFetching, error } = useMeetingCommissions(days, mentor)
  const needle = search.trim().toLowerCase()
  const rows = useMemo(() => (data?.rows ?? []).filter(r => !needle
    || [r.student.name, r.student.code, r.course, r.mentor.name, r.txn_id].some(v => String(v ?? '').toLowerCase().includes(needle))), [data, needle])
  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE))
  const shown = rows.slice((Math.min(page, pages) - 1) * PER_PAGE, Math.min(page, pages) * PER_PAGE)
  const meetingText = (r: CommissionRow) => (r.meeting ? `${when(r.meeting.starts_at)}${r.meeting.how === 'calendar' ? ' (from the Mentor Calendar)' : ''}` : 'Not booked on the Mentor Calendar')
  const exportCsv = () => download(`meeting-commission-${days.from}-to-${days.to}.csv`,
    ['Payment raised', 'Student', 'Code', 'Course', 'Paid (AED)', 'Mentor', '%', 'Commission (AED)', 'Commission status', 'Meeting', 'Meeting stage', 'Payment ref'],
    rows.map(r => [day(r.requested_at), r.student.name, r.student.code, r.course, r.paid_aed, r.mentor.name, r.pct, r.commission_aed, statusLabel(r.status), meetingText(r), r.meeting?.stage ?? '', r.txn_id]))

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {data?.sees !== 'own' && (data?.mentors?.length ?? 0) > 0 && (
          <select className={select} value={mentor} onChange={e => { setMentor(e.target.value); setPage(1) }} aria-label="Mentor" style={{ colorScheme: 'dark' }}>
            <option value="all">Every mentor</option>
            {data!.mentors.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        )}
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={muted} />
          <input className={`${field} w-60 pl-8`} placeholder="Student, code, course, mentor" value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} />
        </div>
        <div className="flex-1" />
        <button type="button" disabled={!rows.length} onClick={exportCsv} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-sm text-white/80 disabled:opacity-40"><Download size={14} />Export</button>
      </div>

      {data?.totals && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-xl p-3" style={panel}><p className="text-xs" style={muted}>Meetings that earned commission</p><p className="text-lg font-semibold text-white">{data.totals.count}</p></div>
          <div className="rounded-xl p-3" style={panel}><p className="text-xs" style={muted}>Commission</p><p className="text-lg font-semibold text-white">{aed(data.totals.aed)}</p></div>
          {Object.entries(data.totals.by_status ?? {}).map(([s, v]) => (
            <div key={s} className="rounded-xl p-3" style={panel}><p className="text-xs" style={muted}>{statusLabel(s)}</p><p className="text-lg font-semibold text-white">{aed(v)}</p></div>
          ))}
        </div>
      )}

      <p className="flex items-center gap-2 text-xs" style={muted}>
        <CalendarCheck size={13} />
        The Meeting mentor's commission on each course payment raised in these days{data?.sees === 'own' ? ' — yours' : data?.sees === 'team' ? ' — your team’s' : ''}. Reversed ones are listed but not counted.
        {isFetching && !isLoading && <Loader2 size={12} className="animate-spin" />}
      </p>

      {isLoading ? <Loading />
        : error ? <Notice tone="warn">{csError(error, 'Could not load the commission')}</Notice>
        : !rows.length ? <Notice>No Meeting mentor commission for these days.</Notice>
        : (
          <>
            <div className="overflow-x-auto rounded-xl" style={panel}>
              <table className="w-full min-w-[860px] text-sm">
                <thead className="text-left text-[11px] uppercase tracking-wide" style={muted}>
                  <tr>{['Payment', 'Student', 'Course', 'Paid', 'Mentor', 'Commission', 'Status', 'The meeting'].map((h, i) => <th key={h} className={`px-3 py-2 font-semibold ${i === 3 || i === 5 ? 'text-right' : ''}`}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {shown.map(r => {
                    const st = STATUS[r.status] ?? STATUS['cancelled']!
                    return (
                      <tr key={r.id} className="border-t border-white/5 align-top text-white/85">
                        <td className="whitespace-nowrap px-3 py-2">{day(r.requested_at)}<div className="font-mono text-xs" style={muted}>{r.txn_id}</div></td>
                        <td className="px-3 py-2"><span className="font-semibold text-white">{r.student.name || 'Student'}</span><div className="font-mono text-xs" style={muted}>{r.student.code}</div></td>
                        <td className="px-3 py-2">{r.course || '—'}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right">{aed(r.paid_aed)}{r.payment_status && r.payment_status !== 'APPROVED' && <div className="text-xs text-rose-400">{r.payment_status.toLowerCase()}</div>}</td>
                        <td className="px-3 py-2">{r.mentor.name}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right font-semibold text-white">{aed(r.commission_aed)}<div className="text-xs font-normal" style={muted}>{r.pct}%</div></td>
                        <td className="px-3 py-2"><span className="whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: st[1], color: st[2] }}>{statusLabel(r.status)}</span></td>
                        <td className="px-3 py-2">
                          {r.meeting ? (
                            <>
                              <div className="whitespace-nowrap">{when(r.meeting.starts_at)}</div>
                              <div className="mt-0.5 flex flex-wrap items-center gap-1 text-xs" style={muted}>
                                {r.meeting.stage && <StageBadge stage={r.meeting.stage} />}
                                {r.meeting.how === 'calendar' && <span title="The request names no meeting — the mentor's last Mentor Calendar meeting with the student before the payment">from the calendar</span>}
                              </div>
                            </>
                          ) : <span className="text-xs" style={muted}>Not booked on the Mentor Calendar</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <Pager page={Math.min(page, pages)} pages={pages} onPage={setPage} />
          </>
        )}
    </div>
  )
}

const MEETING_STATUSES: Array<[string, string]> = [['held', 'Held (done + waiting)'], ['done', 'Done'], ['waiting', 'Waiting for the mentor'], ['converted', 'Converted'], ['upcoming', 'Upcoming'], ['cancelled', 'Cancelled'], ['all', 'All']]
const MEETING_STATUS_TEXT: Record<string, string> = { done: 'Done', waiting: 'Waiting for the mentor', upcoming: 'Upcoming', cancelled: 'Cancelled' }

/** A Chief: the team's student meetings, how each went, and Converted. */
export function TeamMeetingsTab({ days }: { days: Days }) {
  const [status, setStatus] = useState('held')
  const [mentor, setMentor] = useState('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const { data, isLoading, isFetching, error } = useMeetingsDone({ ...days, status, mentor }, true)
  const needle = search.trim().toLowerCase()
  const rows = useMemo(() => (data?.rows ?? []).filter(r => !needle
    || [r.student?.name, r.student?.code, r.attendee, r.title, r.mentor.name, r.student?.cs].some(v => String(v ?? '').toLowerCase().includes(needle))), [data, needle])
  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE))
  const shown = rows.slice((Math.min(page, pages) - 1) * PER_PAGE, Math.min(page, pages) * PER_PAGE)
  const converted = rows.filter(r => r.converted).length
  const exportCsv = () => download(`meetings-${days.from}-to-${days.to}.csv`,
    ['Meeting', 'Student', 'Code', 'CS', 'Mentor', 'Status', 'How it went', 'Converted', 'Payment (AED)'],
    rows.map((r: MeetingDoneRow) => [when(r.starts_at), r.student?.name ?? r.attendee, r.student?.code ?? '', r.student?.cs ?? '', r.mentor.name, MEETING_STATUS_TEXT[r.status] ?? r.status, r.stage, r.converted ? 'Yes' : '', r.payment?.aed ?? '']))
  const pick = (set: (v: string) => void) => (e: React.ChangeEvent<HTMLSelectElement>) => { set(e.target.value); setPage(1) }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select className={select} value={status} onChange={pick(setStatus)} aria-label="Status" style={{ colorScheme: 'dark' }}>
          {MEETING_STATUSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        {(data?.mentors?.length ?? 0) > 1 && (
          <select className={select} value={mentor} onChange={pick(setMentor)} aria-label="Mentor" style={{ colorScheme: 'dark' }}>
            <option value="all">Every mentor</option>
            {data!.mentors.map(m => <option key={m.email} value={m.email}>{m.name}</option>)}
          </select>
        )}
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={muted} />
          <input className={`${field} w-60 pl-8`} placeholder="Student, code, mentor, CS" value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} />
        </div>
        {isFetching && !isLoading && <Loader2 size={14} className="animate-spin" style={muted} />}
        <div className="flex-1" />
        <button type="button" disabled={!rows.length} onClick={exportCsv} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-sm text-white/80 disabled:opacity-40"><Download size={14} />Export</button>
      </div>
      {!isLoading && !error && rows.length > 0 && <p className="text-xs" style={muted}>{rows.length} meeting{rows.length === 1 ? '' : 's'} · {converted} converted</p>}
      {isLoading ? <Loading />
        : error ? <Notice tone="warn">{csError(error, 'Could not load the meetings')}</Notice>
        : !rows.length ? <Notice>No meetings for these days.</Notice>
        : (
          <>
            <div className="overflow-x-auto rounded-xl" style={panel}>
              <table className="w-full min-w-[860px] text-sm">
                <thead className="text-left text-[11px] uppercase tracking-wide" style={muted}>
                  <tr>{['When', 'Student', 'Mentor', 'Status', 'How it went', 'Payment'].map(h => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {shown.map(r => (
                    <tr key={r.id} className="border-t border-white/5 align-top text-white/85">
                      <td className="whitespace-nowrap px-3 py-2">{when(r.starts_at)}</td>
                      <td className="px-3 py-2">
                        <span className="font-semibold text-white">{r.student?.name || r.attendee}</span>
                        <div className="text-xs" style={muted}>{[r.student?.code, r.student?.cs && `CS ${r.student.cs}`].filter(Boolean).join(' · ')}</div>
                      </td>
                      <td className="px-3 py-2">{r.mentor.name}</td>
                      <td className="px-3 py-2 text-xs">
                        <div className="flex flex-wrap items-center gap-1">
                          <span>{MEETING_STATUS_TEXT[r.status] ?? r.status}</span>
                          {r.converted && <span className="whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: 'rgba(52,211,153,0.15)', color: '#34D399' }}>Converted</span>}
                        </div>
                        {r.status === 'cancelled' && (r.cs_status?.reason || r.cancel_reason) && <div style={muted}>{r.cs_status?.reason || r.cancel_reason}</div>}
                      </td>
                      <td className="px-3 py-2"><StageBadge stage={r.stage} title={r.summary} />{!r.stage && <span className="text-xs" style={muted}>—</span>}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs">{r.payment ? <>{aed(r.payment.aed)} <span style={muted}>· {r.payment.product} · {r.payment.status}</span></> : <span style={muted}>—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={Math.min(page, pages)} pages={pages} onPage={setPage} />
          </>
        )}
    </div>
  )
}
