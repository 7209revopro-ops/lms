'use client'
/* ─────────────────────────────────────────────────────────────
   Commission (the user, 2026-11-10: "the commission also they can see from
   the lms also same as the commission portal have") — the CS Portal's
   Commission report, for the instructor signed in here: every commission
   credit in the period, by the person it is paid to — their own level vs
   their pool shares, from bonuses vs deposits — by person, team or month.
   Every number opens the credits behind it. Whose: as on the CS Portal page —
   a Senior / Junior / Sub-junior Mentor their team's, a Chief their people's,
   an admin's account everyone's. Read only; USD there, AED here at 3.67.
───────────────────────────────────────────────────────────── */
import { useEffect, useMemo, useState } from 'react'
import { Download, Loader2, Search, X } from 'lucide-react'
import { useQueryState } from '@/lib/useQueryState'
import {
  AED_PER_USD, csError, useCommissionCredits, useCommissionReport, useReportFilterOptions,
  type CommissionAsk, type CommissionCredit, type CommissionPick, type CommissionReportRow,
} from '@/lib/api/csMeetings'
import { field, muted } from './MeetingRequestsUi'

const aed = (usd?: number) => `AED ${(Number(usd || 0) * AED_PER_USD).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const aedNumber = (usd?: number) => Math.round(Number(usd || 0) * AED_PER_USD * 100) / 100
const num = (n?: number) => Number(n || 0).toLocaleString('en-US')
const day = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { timeZone: 'Asia/Dubai', day: 'numeric', month: 'short', year: 'numeric' }) : '—')
const monthName = (m?: string) => { const [y, mm] = String(m ?? '').split('-').map(Number); return y && mm ? new Date(Date.UTC(y, mm - 1, 1)).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—' }
const panel = { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)' }
const select = 'rounded-lg border border-white/10 bg-transparent px-3 py-2 text-sm text-white outline-none'
const PERIODS: Array<[string, string]> = [['month', 'This month'], ['quarter', 'This quarter'], ['year', 'This year'], ['all', 'All time'], ['custom', 'From … to']]
const VIEWS: Array<['people' | 'teams' | 'months', string]> = [['people', 'By person'], ['teams', 'By team'], ['months', 'By month']]
const SCOPE_TEXT: Record<string, string> = { all: 'Everyone’s', location: 'Your location’s', team: 'Your team’s', own: 'Your own' }

function download(name: string, head: string[], rows: unknown[][]) {
  const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const blob = new Blob(['﻿' + [head, ...rows].map(r => r.map(cell).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href)
}

type Opened = CommissionPick & { title: string }

export function CommissionReportView() {
  const [period, setPeriod] = useQueryState('period', 'month')
  const [from, setFrom] = useQueryState('from', '', { history: 'replace' })
  const [to, setTo] = useQueryState('to', '', { history: 'replace' })
  const [location, setLocation] = useQueryState('location', 'all')
  const [team, setTeam] = useQueryState('team', 'all')
  const [cs, setCs] = useQueryState('person', 'all')
  const [view, setView] = useQueryState<'people' | 'teams' | 'months'>('view', 'people')
  const [opened, setOpened] = useState<Opened | null>(null)

  const custom = period === 'custom'
  const ready = !custom || (!!from && !!to)
  const params: CommissionAsk = {
    period, ...(custom ? { from, to } : {}),
    ...(location !== 'all' ? { location } : {}), ...(team !== 'all' ? { team } : {}), ...(cs !== 'all' ? { cs } : {}),
  }
  const filters = useReportFilterOptions(true)
  const report = useCommissionReport(params, ready)
  const d = report.data
  const scope = d?.scope ?? filters.data?.scope
  const people = useMemo(() => (filters.data?.people ?? []).filter(p => team === 'all' || p.team_id === team), [filters.data, team])
  const rows: CommissionReportRow[] = (d?.[view] ?? []) as CommissionReportRow[]

  const firstOf = (r: CommissionReportRow) => (view === 'months' ? monthName(r.month) : view === 'teams' ? r.team : r.name) || '—'
  const subOf = (r: CommissionReportRow) => (view === 'people' ? [r.team, r.location === 'bangalore' ? 'Bangalore' : null].filter(Boolean).join(' · ')
    : view === 'teams' ? (r.location === 'bangalore' ? 'Bangalore' : 'Dubai') : '')
  /** Which row a number is on, for the CS Portal: the total, a person, a team ("-" for none) or a month. */
  const pickOf = (r: CommissionReportRow | 'total'): Omit<CommissionPick, 'bucket'> => (r === 'total' ? { view: 'total', key: '' }
    : view === 'teams' ? { view: 'team', key: r.id || '-' } : view === 'months' ? { view: 'month', key: r.month ?? '' } : { view: 'person', key: r.id ?? '' })
  /** A number that opens the credits behind it — plain when there is nothing behind it. */
  const opener = (bucket: string, r: CommissionReportRow | 'total', label: string, children: React.ReactNode) => {
    const src = r === 'total' ? d?.total : r
    const n = Number((src as Record<string, unknown> | undefined)?.[bucket])
    if (!(n > 0)) return children
    const name = r === 'total' ? 'everyone' : firstOf(r)
    return (
      <button type="button" title="See the credits behind this number" onClick={() => setOpened({ bucket, ...pickOf(r), title: `${label} — ${name}` })}
        className="rounded underline decoration-white/30 decoration-dotted underline-offset-4 hover:bg-white/5 hover:decoration-solid">{children}</button>
    )
  }
  const amt = (count?: number, usd?: number) => (count ? `${aed(usd)} · ${num(count)}` : '—')
  const exportCsv = () => download(`commission-${view}.csv`,
    [view === 'months' ? 'Month' : view === 'teams' ? 'Team' : 'Person', ...(view === 'people' ? ['Team'] : []),
      'Total commission (AED)', 'Own (AED)', 'Own credits', 'Pool share (AED)', 'Pool credits', 'Bonus (AED)', 'Deposit (AED)', 'Credits', 'Students'],
    rows.map(r => [firstOf(r), ...(view === 'people' ? [r.team ?? ''] : []), aedNumber(r.usd), aedNumber(r.own_usd), r.own ?? 0, aedNumber(r.pool_usd), r.pool ?? 0,
      aedNumber(r.bonus_usd), aedNumber(r.deposit_usd), r.count ?? 0, r.students ?? 0]))

  const chip = (on: boolean) => `rounded-lg px-2.5 py-1.5 text-xs font-medium ${on ? 'bg-[#0057b8] text-white' : 'text-white/60 hover:bg-white/5'}`
  const cards = d ? [
    { label: 'Total commission', bucket: 'count', usd: d.total.usd, sub: `${num(d.total.count)} credits · ${num(d.people?.length)} ${d.people?.length === 1 ? 'person' : 'people'}` },
    { label: 'Own commission', bucket: 'own', usd: d.total.own_usd, sub: `${num(d.total.own)} credits at their position's level` },
    { label: 'Pool shares', bucket: 'pool', usd: d.total.pool_usd, sub: `${num(d.total.pool)} credits from Senior / Junior pools` },
    { label: 'From bonuses', bucket: 'bonus', usd: d.total.bonus_usd, sub: `${num(d.total.bonus)} credits` },
    { label: 'From deposits', bucket: 'deposit', usd: d.total.deposit_usd, sub: `${num(d.total.deposit)} credits` },
  ] : []

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-xl p-2" style={panel}>
        <div className="flex flex-wrap gap-0.5 rounded-lg border border-white/10 p-0.5" role="group" aria-label="Period">
          {PERIODS.map(([v, l]) => <button key={v} type="button" className={chip(period === v)} onClick={() => setPeriod(v)}>{l}</button>)}
        </div>
        {custom && (
          <>
            <input type="date" className={`${field} w-40`} value={from} onChange={e => setFrom(e.target.value)} aria-label="From" style={{ colorScheme: 'dark' }} />
            <span className="text-xs" style={muted}>to</span>
            <input type="date" className={`${field} w-40`} value={to} onChange={e => setTo(e.target.value)} aria-label="To" style={{ colorScheme: 'dark' }} />
          </>
        )}
        {scope === 'all' && (
          <select className={select} value={location} onChange={e => setLocation(e.target.value)} aria-label="Location" style={{ colorScheme: 'dark' }}>
            <option value="all">Both locations</option><option value="dubai">Dubai</option><option value="bangalore">Bangalore</option>
          </select>
        )}
        {(filters.data?.teams?.length ?? 0) > 1 && (
          <select className={select} value={team} onChange={e => { setTeam(e.target.value); setCs('all') }} aria-label="Team" style={{ colorScheme: 'dark' }}>
            <option value="all">Every team</option>
            {filters.data!.teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
        {people.length > 1 && (
          <select className={select} value={cs} onChange={e => setCs(e.target.value)} aria-label="Person" style={{ colorScheme: 'dark' }}>
            <option value="all">Everyone</option>
            {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        <div className="flex-1" />
        {report.isFetching && !report.isLoading && <Loader2 size={14} className="animate-spin" style={muted} />}
      </div>

      {scope && <p className="text-xs" style={muted}>{SCOPE_TEXT[scope] ?? ''} commission — a credit counts in the month its payment was raised, as on the CS Portal. Open any number for the credits behind it.</p>}

      {!ready ? <p className="rounded-xl px-4 py-8 text-center text-sm" style={{ ...panel, ...muted }}>Pick a from and a to date.</p>
        : report.isLoading ? <p className="flex items-center justify-center gap-2 py-12 text-sm" style={muted}><Loader2 size={16} className="animate-spin" />Loading…</p>
        : report.error ? <p className="rounded-xl px-4 py-8 text-center text-sm" style={{ color: '#FBBF24', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)' }}>{csError(report.error, 'Could not load the commission')}</p>
        : d && (
          <>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
              {cards.map(c => (
                <div key={c.label} className="rounded-xl p-3" style={panel}>
                  <p className="text-xs" style={muted}>{c.label}</p>
                  <p className="mt-0.5 text-lg font-semibold text-white">{opener(c.bucket, 'total', c.label, aed(c.usd))}</p>
                  <p className="mt-0.5 text-[11px]" style={muted}>{c.sub}</p>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex gap-0.5 rounded-lg border border-white/10 p-0.5" role="group" aria-label="View">
                {VIEWS.map(([v, l]) => <button key={v} type="button" className={chip(view === v)} onClick={() => setView(v)}>{l}</button>)}
              </div>
              <span className="text-xs" style={muted}>Highest commission first</span>
              <div className="flex-1" />
              <button type="button" disabled={!rows.length} onClick={exportCsv} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-sm text-white/80 disabled:opacity-40"><Download size={14} />Export</button>
            </div>

            {!rows.length ? <p className="rounded-xl px-4 py-8 text-center text-sm" style={{ ...panel, ...muted }}>No commission in this period.</p> : (
              <div className="overflow-x-auto rounded-xl" style={panel}>
                <table className="w-full min-w-[900px] text-sm">
                  <thead className="text-left text-[11px] uppercase tracking-wide" style={muted}>
                    <tr>
                      {[view === 'months' ? 'Month' : view === 'teams' ? 'Team' : 'Person', 'Total commission', 'Own', 'Pool share', 'Bonus', 'Deposit', 'Credits', 'Students'].map((h, i) => (
                        <th key={h} className={`px-3 py-2 font-semibold ${i ? 'text-right' : ''}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={`${r.id ?? r.month ?? i}`} className="border-t border-white/5 text-white/85">
                        <td className="px-3 py-2"><span className="font-semibold text-white">{firstOf(r)}</span>{subOf(r) && <div className="text-xs" style={muted}>{subOf(r)}</div>}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right font-semibold text-white">{opener('count', r, 'Total commission', aed(r.usd))}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right">{opener('own', r, 'Own', amt(r.own, r.own_usd))}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right">{opener('pool', r, 'Pool share', amt(r.pool, r.pool_usd))}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right">{opener('bonus', r, 'Bonus', amt(r.bonus, r.bonus_usd))}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right">{opener('deposit', r, 'Deposit', amt(r.deposit, r.deposit_usd))}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right">{opener('count', r, 'Credits', num(r.count))}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right">{num(r.students)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

      {opened && <CreditsDialog params={params} opened={opened} onClose={() => setOpened(null)} />}
    </div>
  )
}

/** The commission credits behind one number. */
function CreditsDialog({ params, opened, onClose }: { params: CommissionAsk; opened: Opened; onClose: () => void }) {
  const { title, ...pick } = opened
  const res = useCommissionCredits(params, pick)
  const [q, setQ] = useState('')
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  const all = res.data?.details
  const needle = q.trim().toLowerCase()
  const rows = useMemo(() => (all ?? []).filter((r: CommissionCredit) => !needle
    || [r.student_name, r.student_code, r.raised_by, r.team, r.course, r.position, r.pool, r.ref, r.initiator].some(v => String(v ?? '').toLowerCase().includes(needle))), [all, needle])
  const sum = rows.reduce((t, r) => t + (Number(r.usd) || 0), 0)
  const exportCsv = () => download('commission-credits.csv',
    ['Raised', 'Paid to', 'Team', 'Student', 'Code', 'Type', 'Course', 'Ref', 'Position', 'Pool', '%', 'Base (AED)', 'Commission (AED)', 'Raised by', 'Status'],
    rows.map(r => [day(r.at), r.raised_by, r.team, r.student_name, r.student_code, r.type === 'DEPOSIT' ? 'Deposit' : 'Bonus', r.course, r.ref, r.position, r.pool, r.pct, aedNumber(r.base_usd), aedNumber(r.usd), r.initiator, r.status]))

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 sm:items-center sm:p-4" onClick={onClose}>
      <div role="dialog" aria-label={title} className="relative max-h-[92dvh] w-full max-w-5xl space-y-3 overflow-y-auto rounded-t-2xl border border-white/10 bg-[#0d1117] p-5 sm:rounded-2xl" onClick={e => e.stopPropagation()}>
        <button type="button" onClick={onClose} aria-label="Close" className="absolute right-3 top-3 rounded-lg p-1.5 text-white/50 hover:bg-white/5"><X size={16} /></button>
        <div>
          <h2 className="pr-8 text-lg font-semibold text-white">{title}</h2>
          <p className="text-sm" style={muted}>{all ? `${num(rows.length)}${needle ? ` of ${num(all.length)}` : ''} credits · ${aed(sum)} commission` : 'The credits behind this number'}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={muted} />
            <input className={`${field} w-64 pl-8`} placeholder="Student, person, course, pool…" value={q} onChange={e => setQ(e.target.value)} />
          </div>
          <div className="flex-1" />
          <button type="button" disabled={!rows.length} onClick={exportCsv} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-sm text-white/80 disabled:opacity-40"><Download size={14} />Export</button>
        </div>
        {res.isLoading ? <p className="flex items-center justify-center gap-2 py-10 text-sm" style={muted}><Loader2 size={16} className="animate-spin" />Loading…</p>
          : res.error ? <p className="rounded-xl px-4 py-6 text-center text-sm" style={{ color: '#FBBF24', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)' }}>{csError(res.error, 'Could not load the credits')}</p>
          : !rows.length ? <p className="py-10 text-center text-sm" style={muted}>Nothing here.</p>
          : (
            <div className="max-h-[60vh] overflow-auto rounded-xl" style={panel}>
              <table className="w-full min-w-[860px] text-sm">
                <thead className="sticky top-0 bg-[#0d1117] text-left text-[11px] uppercase tracking-wide" style={muted}>
                  <tr>{['Raised', 'Paid to', 'Student', 'Course', 'Position', '%', 'Base', 'Commission', 'Raised by'].map(h => (
                    <th key={h} className={`whitespace-nowrap px-3 py-2 font-semibold ${['%', 'Base', 'Commission'].includes(h) ? 'text-right' : ''}`}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.id} className="border-t border-white/5 align-top text-white/85">
                      <td className="whitespace-nowrap px-3 py-2">{day(r.at)}</td>
                      <td className="px-3 py-2">{r.raised_by}<div className="text-xs" style={muted}>{r.team}</div></td>
                      <td className="px-3 py-2"><span className="font-semibold text-white">{r.student_name || '—'}</span>{r.student_code && <div className="font-mono text-xs" style={muted}>{r.student_code}</div>}</td>
                      <td className="whitespace-nowrap px-3 py-2">{[r.type === 'DEPOSIT' ? 'Deposit' : 'Bonus', r.course].filter(Boolean).join(' · ')}{r.ref && <div className="font-mono text-xs" style={muted}>{r.ref}</div>}</td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={r.pool ? { background: 'rgba(167,139,250,0.14)', color: '#C4B5FD' } : { background: 'rgba(52,211,153,0.14)', color: '#6EE7B7' }}>{r.position || '—'}{r.pool ? ' · pool' : ''}</span>
                        {r.pool && <div className="text-xs" style={muted}>{r.pool}</div>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">{r.pct}%</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">{aed(r.base_usd)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-semibold text-white">{aed(r.usd)}</td>
                      <td className="px-3 py-2">{r.initiator || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </div>
    </div>
  )
}
