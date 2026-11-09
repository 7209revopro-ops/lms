'use client'
import { useState } from 'react'
import Link from 'next/link'
import { ArrowDown, ArrowUp, Gauge, Loader2, Lock, Wrench, X } from 'lucide-react'
import { kpiError, useAskKpiCorrection, useMyKpis, type KpiResult, type MentorMonth, type TeamMonth } from '@/lib/api/mentorKpis'

/* Mentor KPIs in the LMS admin (2026-11-09): the views the page and the dashboard card share. View only — the plan
   and every figure come from Root; a correction to a frozen month is asked for here and decided in Root. */

export const dubaiMonth = () => new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 7)
const addMonths = (m: string, n: number) => { const [y, mm] = m.split('-').map(Number); return new Date(Date.UTC(y, mm - 1 + n, 1)).toISOString().slice(0, 7) }
export const kpiMonths = () => { const out: string[] = []; for (let m = dubaiMonth(); m >= '2026-01' && out.length < 12; m = addMonths(m, -1)) out.push(m); return out }
export const monthLabel = (m: string) => new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${m}-01T00:00:00Z`))
export const when = (iso?: string | null) => (iso ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dubai', day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(iso)) : '—')
export const fmt = (v: number | null | undefined) => (v == null ? '—' : v.toFixed(1))
export const tone = (v: number | null | undefined) => (v == null ? 'rgba(255,255,255,0.35)' : v >= 85 ? '#34D399' : v >= 60 ? '#FBBF24' : '#F87171')
const value = (v: number | null, unit: string) => {
  if (v == null) return '—'
  const n = unit === 'AED' || unit === 'USD' ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : String(Math.round(v * 10) / 10)
  return unit === '%' ? `${n}%` : unit === 'AED' || unit === 'USD' ? `${unit} ${n}` : `${n} ${unit}`
}
const card = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }
const muted = { color: 'rgba(255,255,255,0.45)' }

export function KpiNotice({ data }: { data?: { closed?: true; missing?: true } }) {
  if (data?.closed) return <p className="rounded-xl px-4 py-3 text-sm" style={{ ...card, ...muted }}>Mentor KPIs aren&apos;t open yet. They appear here once they are opened from Root.</p>
  if (data?.missing) return <p className="rounded-xl px-4 py-3 text-sm" style={{ ...card, ...muted }}>No figures for this month — not in the month&apos;s Mentor Report, or no plan covered it.</p>
  return null
}

export function TeamTable({ data, onOpen }: { data: TeamMonth; onOpen: (email: string) => void }) {
  const cats = data.categories ?? []
  return (
    <div className="overflow-x-auto rounded-2xl" style={card}>
      <div className="px-4 py-3 text-sm font-semibold text-white">
        {data.mentors?.length ?? 0} mentors <span className="font-normal" style={muted}>{data.snapshot ? `· frozen, version ${data.snapshot.version}` : '· live'}</span>
      </div>
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="text-left text-xs" style={muted}>
            <th className="px-4 py-2 font-medium">Mentor</th><th className="px-4 py-2 font-medium">Points</th><th className="px-4 py-2 font-medium">Scored</th>
            {cats.map(c => <th key={c.key} className="px-4 py-2 font-medium">{c.name} {c.share}%</th>)}
          </tr>
        </thead>
        <tbody>
          {(data.mentors ?? []).map(m => (
            <tr key={m.email} onClick={() => onOpen(m.email)} className="cursor-pointer hover:bg-white/5" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <td className="px-4 py-2"><p className="font-medium text-white">{m.name}</p><p className="text-xs" style={muted}>{m.roleLabel}</p></td>
              <td className="px-4 py-2 font-semibold tabular-nums" style={{ color: tone(m.score) }}>{fmt(m.score)}</td>
              <td className="px-4 py-2 tabular-nums" style={muted}>{m.coverage}%</td>
              {cats.map(c => { const v = m.categories.find(x => x.key === c.key)?.score ?? null; return <td key={c.key} className="px-4 py-2 tabular-nums" style={{ color: tone(v) }}>{fmt(v)}</td> })}
            </tr>
          ))}
          {!data.mentors?.length && <tr><td colSpan={3 + cats.length} className="px-4 py-8 text-center" style={muted}>No mentors in this month&apos;s figures.</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

export function MentorMonthView({ data, month }: { data: MentorMonth; month: string }) {
  const [fixing, setFixing] = useState<KpiResult | null>(null)
  const m = data.mentor
  if (!m) return null
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-6 rounded-2xl p-5" style={card}>
        <div>
          <p className="text-lg font-semibold text-white">{m.name}</p>
          <p className="text-sm" style={muted}>{m.roleLabel}</p>
          <p className="mt-1 flex items-center gap-1 text-xs" style={muted}>
            {data.snapshot ? <><Lock className="h-3 w-3" />{monthLabel(month)} is frozen (version {data.snapshot.version})</> : `${monthLabel(month)} so far — ${data.elapsed ?? 0}% of the month gone`}
          </p>
        </div>
        <div className="flex-1" />
        <div className="text-right">
          <p className="text-4xl font-semibold tabular-nums" style={{ color: tone(m.score) }}>{fmt(m.score)}</p>
          <p className="text-xs" style={muted}>{m.coverage}% of the plan had data to score</p>
        </div>
        <div className="flex h-16 items-end gap-2">
          {(data.trend ?? []).map(t => (
            <div key={t.month} className="flex w-10 flex-col items-center gap-1">
              <div className="flex h-12 w-full items-end rounded" style={{ background: 'rgba(255,255,255,0.06)' }}>
                <div className="w-full rounded" style={{ height: `${t.score ?? 0}%`, background: tone(t.score) }} />
              </div>
              <span className="text-[10px]" style={muted}>{monthLabel(t.month).slice(0, 3)}</span>
            </div>
          ))}
        </div>
      </div>

      {m.categories.map(c => (
        <div key={c.key} className="space-y-3 rounded-2xl p-4" style={card}>
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            {c.name}<span className="font-normal" style={muted}>{c.weight}% of the points</span>
            <span className="flex-1" /><span className="tabular-nums" style={{ color: tone(c.score) }}>{fmt(c.score)}</span>
          </div>
          {c.subs.map(s => (
            <div key={s.key} className="space-y-1">
              <div className="flex items-center text-[11px] font-semibold uppercase tracking-wide" style={muted}>{s.name}<span className="flex-1" /><span className="tabular-nums" style={{ color: tone(s.score) }}>{fmt(s.score)}</span></div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <tbody>
                    {s.kpis.map(k => (
                      <tr key={k.metric} className="align-top" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                        <td className="py-1.5 pr-2">
                          <p className="text-white">{k.name}</p>
                          <p className="flex items-center gap-1 text-xs" style={muted}>
                            {k.direction === 'up' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}{k.direction === 'up' ? 'more is better' : 'fewer is better'}
                          </p>
                        </td>
                        <td className="py-1.5 pr-2 tabular-nums text-white">{value(k.value, k.unit)}</td>
                        <td className="py-1.5 pr-2 tabular-nums" style={muted}>
                          {k.target == null ? '—' : `of ${value(k.target, k.unit)}`}{k.targetFrom === 'mentor' ? ' (own)' : ''}
                          {k.effectiveTarget != null && k.target != null && k.effectiveTarget !== k.target && <span className="block text-xs">{value(k.effectiveTarget, k.unit)} so far</span>}
                        </td>
                        <td className="py-1.5 pr-2 tabular-nums" style={{ color: tone(k.score) }}>{k.mode === 'scored' ? fmt(k.score) : ''}</td>
                        <td className="py-1.5 text-xs" style={muted}>
                          {k.status === 'scored' ? '' : data.statusLabels?.[k.status] ?? k.status}
                          {k.corrected && <span className="block" style={{ color: '#93C5FD' }}>Corrected: {k.corrected.reason}</span>}
                          {data.snapshot && k.status !== 'not_available' && (
                            <button type="button" onClick={() => setFixing(k)} className="mt-0.5 inline-flex items-center gap-1 hover:text-white">
                              <Wrench className="h-3 w-3" />Ask for a correction
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      ))}

      {(data.corrections ?? []).length > 0 && (
        <div className="space-y-2 rounded-2xl p-4 text-sm" style={card}>
          <p className="font-semibold text-white">Corrections for {monthLabel(month)}</p>
          {data.corrections!.map(c => (
            <div key={c.id} className="pt-2" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <p className="text-white">{c.metricName}: {c.action === 'leave_out' ? 'leave it out' : `set to ${c.value}`} — <span style={{ color: c.status === 'approved' ? '#34D399' : c.status === 'rejected' ? '#F87171' : '#FBBF24' }}>
                {c.status === 'approved' ? 'approved' : c.status === 'rejected' ? 'rejected' : 'waiting for Root'}</span></p>
              <p className="text-xs" style={muted}>{c.reason}{c.decisionNote ? ` · ${c.decisionNote}` : ''}</p>
            </div>
          ))}
        </div>
      )}
      {fixing && <CorrectDialog k={fixing} month={month} email={m.email} onClose={() => setFixing(null)} />}
    </div>
  )
}

function CorrectDialog({ k, month, email, onClose }: { k: KpiResult; month: string; email: string; onClose: () => void }) {
  const ask = useAskKpiCorrection()
  const [action, setAction] = useState<'set_value' | 'leave_out'>('set_value')
  const [val, setVal] = useState(k.value == null ? '' : String(k.value))
  const [reason, setReason] = useState('')
  const [evidence, setEvidence] = useState('')
  const [err, setErr] = useState('')
  const field = { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff' }
  const submit = () => {
    if (action === 'set_value' && (val.trim() === '' || !Number.isFinite(Number(val)) || Number(val) < 0)) { setErr('Enter the right value (0 or more).'); return }
    if (!reason.trim()) { setErr("Say why it's wrong."); return }
    ask.mutate({ month, email, metric: k.metric, action, value: action === 'set_value' ? Number(val) : null, reason, evidence }, {
      onSuccess: r => { if (r?.closed) { setErr("Mentor KPIs aren't open right now."); return } onClose() },
      onError: e => setErr(kpiError(e, 'Not sent')),
    })
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }} role="dialog" aria-modal="true" aria-label={`Ask for a correction — ${k.name}`}>
      <div className="w-full max-w-md space-y-3 rounded-2xl p-5" style={{ background: '#0f1729', border: '1px solid rgba(255,255,255,0.1)' }}>
        <div className="flex items-start gap-2">
          <div className="flex-1">
            <p className="font-semibold text-white">Ask for a correction — {k.name}</p>
            <p className="text-xs" style={muted}>{monthLabel(month)} shows {value(k.value, k.unit)}. A root admin approves or rejects it in Root.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={muted}><X className="h-4 w-4" /></button>
        </div>
        <select value={action} onChange={e => { setAction(e.target.value as 'set_value' | 'leave_out'); setErr('') }} aria-label="Correction" className="h-9 w-full rounded-lg px-2 text-sm" style={field}>
          <option value="set_value">The right value is…</option>
          <option value="leave_out">Leave this KPI out of the month</option>
        </select>
        {action === 'set_value' && <input type="number" min={0} value={val} onChange={e => { setVal(e.target.value); setErr('') }} aria-label="The right value" className="h-9 w-full rounded-lg px-3 text-sm" style={field} />}
        <input value={reason} maxLength={500} onChange={e => { setReason(e.target.value); setErr('') }} placeholder="Why it's wrong" aria-label="Why" className="h-9 w-full rounded-lg px-3 text-sm" style={field} />
        <textarea value={evidence} maxLength={2000} rows={3} onChange={e => setEvidence(e.target.value)} placeholder="Evidence: what to check, links" aria-label="Evidence" className="w-full rounded-lg px-3 py-2 text-sm" style={field} />
        {err && <p className="text-sm" style={{ color: '#F87171' }}>{err}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm" style={{ ...field }}>Cancel</button>
          <button type="button" onClick={submit} disabled={ask.isPending} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50" style={{ background: '#0057b8' }}>
            {ask.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Send to Root'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** On an instructor's dashboard: this month's points, the weakest KPIs, the trend — and the way to all of it. No ranking. */
export function MyKpisCard() {
  const month = dubaiMonth()
  const q = useMyKpis(month, true)
  const d = q.data
  if (q.isLoading || q.isError || !d || d.closed || d.missing || !d.mentor) return null
  const weakest = d.mentor.categories.flatMap(c => c.subs.flatMap(s => s.kpis)).filter(k => k.mode === 'scored' && k.score != null)
    .sort((a, b) => (a.score ?? 0) - (b.score ?? 0)).slice(0, 3)
  return (
    <Link href="/mentor-kpis" className="block rounded-2xl p-5 transition-colors hover:bg-white/5" style={card}>
      <div className="flex flex-wrap items-center gap-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: 'rgba(0,87,184,0.18)', color: '#60A5FA' }}><Gauge className="h-5 w-5" /></div>
          <div>
            <p className="text-sm font-semibold text-white">My KPIs — {monthLabel(month)}</p>
            <p className="text-xs" style={muted}>Observation only{d.observationUntil ? ` until ${when(d.observationUntil)}` : ''} — not used for pay</p>
          </div>
        </div>
        <p className="text-3xl font-semibold tabular-nums" style={{ color: tone(d.mentor.score) }}>{fmt(d.mentor.score)}</p>
        <div className="min-w-[200px] flex-1 text-xs" style={muted}>
          {weakest.length ? <>To work on: {weakest.map(k => `${k.name} (${fmt(k.score)})`).join(' · ')}</> : 'Nothing scored yet this month.'}
        </div>
        <div className="flex h-10 items-end gap-1.5">
          {(d.trend ?? []).map(t => <div key={t.month} className="w-5 rounded" title={`${monthLabel(t.month)}: ${fmt(t.score)}`} style={{ height: `${Math.max(4, t.score ?? 0)}%`, background: tone(t.score) }} />)}
        </div>
      </div>
    </Link>
  )
}
