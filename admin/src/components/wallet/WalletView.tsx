'use client'

import { useState, type CSSProperties, type ElementType, type ReactNode } from 'react'
import { AlertTriangle, Banknote, Coins, Landmark, ReceiptText, CalendarDays, Info } from 'lucide-react'
import type { Wallet, WalletCommission, WalletDay, WalletItemGroup, WalletPayment, WalletStatus } from '@/types/wallet'

/*
 * The wallet (2026-11-04): what the month has earned, a day at a time, what came off and why, commission, the rest of
 * the payslip, and what finance has paid. Every figure comes from the server (the HRMS); this only lays them out —
 * the same layout and words as the HRMS and the sales CRMs, in this dashboard's dark colours.
 */

const MUTED = 'rgba(255,255,255,0.4)'
const SOFT = 'rgba(255,255,255,0.65)'
const GREEN = '#4ADE80'
const RED = '#F87171'
const AMBER = '#FBBF24'
const PANEL: CSSProperties = { background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)' }
const ROW_LINE = '1px solid rgba(255,255,255,0.05)'

const money = (n: number, c: string) => `${c} ${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const signed = (n: number, c: string) => `${n < 0 ? '−' : '+'}${money(n, c)}`
const dayName = (key: string) =>
  new Date(`${key}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', timeZone: 'UTC' })
const fullDay = (key: string | null) =>
  key ? new Date(`${key}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—'
const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : null)

const HEADLINE: Record<WalletStatus, { label: string; color: string }> = {
  in_progress: { label: 'Earned so far this month', color: '#60A5FA' },
  awaiting_payroll: { label: 'Earned — waiting for payroll', color: '#A78BFA' },
  payslip: { label: 'Still to be paid', color: AMBER },
  part_paid: { label: 'Still to be paid · part paid', color: AMBER },
  paid: { label: 'Paid in full', color: GREEN },
  paused: { label: 'Pay stopped for this month', color: MUTED },
}

function Headline({ w }: { w: Wallet }) {
  const h = HEADLINE[w.status]
  const c = w.currency
  const figure = w.status === 'paid' ? w.totals.paid : w.status === 'in_progress' || w.status === 'awaiting_payroll' ? w.totals.net : w.totals.balance
  const sub =
    w.status === 'paused' ? (w.muted?.reason ? `HR: ${w.muted.reason}` : "HR has stopped this month's pay.")
    : w.status === 'paid' ? `Finance paid ${money(w.totals.paid, c)} for this month.`
    : w.status === 'part_paid' ? `Finance has paid ${money(w.totals.paid, c)} of ${money(w.totals.net, c)}.`
    : w.status === 'payslip' ? "Your payslip is out — finance hasn't paid it yet."
    : w.status === 'awaiting_payroll' ? 'The month is over. Figures can still change until HR issues the payslip.'
    : `Up to today. The rest of the month adds ${money(w.salary.perDay, c)} a day.`
  return (
    <div className="rounded-2xl px-4 py-3" style={{ background: `${h.color}14`, border: `1px solid ${h.color}33` }}>
      <p className="text-xs font-medium" style={{ color: h.color }}>{h.label}</p>
      <p className="text-2xl font-bold tracking-tight md:text-3xl" style={{ color: h.color }}>{w.status === 'paused' ? '—' : money(figure, c)}</p>
      <p className="text-xs" style={{ color: SOFT }}>{sub}</p>
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-xl px-3 py-2.5" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
      <p className="text-xs" style={{ color: MUTED }}>{label}</p>
      <p className="text-base font-semibold tabular-nums md:text-lg" style={{ color: color ?? '#fff' }}>{value}</p>
    </div>
  )
}

function Section({ title, sub, icon: Icon, children }: { title: string; sub?: string; icon: ElementType; children: ReactNode }) {
  return (
    <div className="rounded-2xl overflow-hidden" style={PANEL}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <p className="flex items-center gap-2 text-sm font-semibold text-white"><Icon size={15} style={{ color: '#60A5FA' }} />{title}</p>
        {sub && <p className="text-xs" style={{ color: MUTED }}>{sub}</p>}
      </div>
      <div className="px-5 py-1">{children}</div>
    </div>
  )
}

function DayRow({ d, c, last }: { d: WalletDay; c: string; last: boolean }) {
  const inT = time(d.checkIn), outT = time(d.checkOut)
  const off = d.deductions.reduce((s, x) => s + x.amount, 0)
  const muted = !d.counted || d.kind === 'not_employed'
  return (
    <div className="grid grid-cols-[3.75rem_minmax(0,1fr)_auto] items-start gap-3 py-2.5 text-sm"
      style={{ borderBottom: last ? 'none' : ROW_LINE, opacity: muted ? 0.55 : 1 }}>
      <p className="text-xs font-medium" style={{ color: MUTED }}>{dayName(d.date)}</p>
      <div className="min-w-0">
        <p className="font-medium text-white">
          {d.label}
          {(inT || outT) && <span className="font-normal" style={{ color: MUTED }}> · in {inT ?? '—'}{outT ? ` · out ${outT}` : ''}</span>}
        </p>
        {d.deductions.map((x, i) => <p key={i} className="text-xs" style={{ color: RED }}>{x.reason}</p>)}
        {d.note && <p className="text-xs" style={{ color: MUTED }}>{d.note}</p>}
      </div>
      <div className="text-right tabular-nums">
        <p className="text-sm" style={{ color: d.credit > 0 && d.counted ? GREEN : MUTED }}>{d.kind === 'not_employed' ? '—' : `+${money(d.credit, c)}`}</p>
        {off > 0 && <p className="text-xs" style={{ color: RED }}>−{money(off, c)}</p>}
      </div>
    </div>
  )
}

function SalaryDays({ w }: { w: Wallet }) {
  const [all, setAll] = useState(false)
  const c = w.currency
  // Newest first: today's line on top. Days still to come sit at the end.
  const past = w.days.filter(d => d.counted).reverse()
  const future = w.days.filter(d => !d.counted)
  const shown = all ? [...past, ...future] : past.slice(0, 10)
  const lost = w.days.filter(d => d.counted).flatMap(d => d.deductions).reduce((s, x) => s + x.days, 0)
  const sub = [`${money(w.salary.perDay, c)} a day (salary ÷ 30)`, lost ? `${lost} day${lost === 1 ? '' : 's'} lost` : null].filter(Boolean).join(' · ')
  return (
    <Section title="Salary, day by day" sub={sub} icon={CalendarDays}>
      {w.salary.employedShare < 1 && (
        <p className="pt-2 text-xs" style={{ color: MUTED }}>Part of the month — you were employed for {Math.round(w.salary.employedShare * 30)} of its 30 paid days.</p>
      )}
      {shown.map((d, i) => <DayRow key={d.date} d={d} c={c} last={i === shown.length - 1 && !w.reconcile.length} />)}
      {w.reconcile.map((r, i) => (
        <div key={`r${i}`} className="flex items-start justify-between gap-3 py-2.5 text-sm" style={{ borderTop: ROW_LINE }}>
          <div>
            <p className="font-medium text-white">{r.kind === 'lop' ? 'Loss of pay' : r.kind === 'late' ? 'Late penalty' : 'Early-out penalty'}</p>
            <p className="text-xs" style={{ color: MUTED }}>{r.reason}</p>
          </div>
          <p className="tabular-nums" style={{ color: r.amount > 0 ? RED : GREEN }}>{r.amount > 0 ? '−' : '+'}{money(r.amount, c)}</p>
        </div>
      ))}
      {(past.length > 10 || future.length > 0) && (
        <button type="button" onClick={() => setAll(v => !v)} className="mb-2 mt-1 text-xs font-semibold hover:underline" style={{ color: '#60A5FA' }}>
          {all ? 'Show fewer days' : `Show all ${w.days.length} days${future.length ? ` (${future.length} still to come)` : ''}`}
        </button>
      )}
    </Section>
  )
}

const STEPS: Array<{ key: WalletCommission['state']; label: string }> = [
  { key: 'earned', label: 'Earned' }, { key: 'approved', label: 'Approved by finance' }, { key: 'on_payroll', label: 'On payroll' }, { key: 'paid', label: 'Paid' },
]

function CommissionRows({ w }: { w: Wallet }) {
  if (!w.commission.length && !w.finance.crmError) return null
  return (
    <Section title="Commission" sub="from finance" icon={Coins}>
      {w.finance.crmError && (
        <p className="pt-2 text-xs" style={{ color: AMBER }}>The sales CRMs&apos; commission couldn&apos;t be read just now: {w.finance.crmError}</p>
      )}
      {w.commission.map((c, i) => {
        const at = STEPS.findIndex(s => s.key === c.state)
        // A commission paid by receipt never rides on payroll — that step is not shown for it.
        const steps = STEPS.filter(s => s.key !== 'on_payroll' || c.state === 'on_payroll' || /payroll/.test(c.note ?? ''))
        return (
          <div key={i} className="flex flex-wrap items-start justify-between gap-3 py-2.5 text-sm" style={{ borderBottom: i < w.commission.length - 1 ? ROW_LINE : 'none' }}>
            <div className="min-w-0">
              <p className="font-medium text-white">{c.name}</p>
              {c.detail && <p className="text-xs" style={{ color: MUTED }}>{c.detail}</p>}
              <div className="mt-1.5 flex flex-wrap gap-1">
                {steps.map(s => {
                  const done = STEPS.findIndex(x => x.key === s.key) <= at
                  return (
                    <span key={s.key} className="rounded-md px-1.5 py-0.5 text-[11px]"
                      style={done
                        ? { background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.25)', color: GREEN }
                        : { border: '1px solid rgba(255,255,255,0.1)', color: MUTED }}>
                      {s.label}
                    </span>
                  )
                })}
              </div>
              {c.note && <p className="mt-1 text-xs" style={{ color: MUTED }}>{c.note}</p>}
            </div>
            <p className="tabular-nums" style={{ color: c.inBalance ? GREEN : MUTED }}>{money(c.amount, c.currency)}</p>
          </div>
        )
      })}
    </Section>
  )
}

const GROUP: Record<WalletItemGroup, string> = {
  commission: 'Commission', slab: 'Salary slab', finance: 'Finance', reimbursement: 'Reimbursement', overtime: 'Overtime',
  one_time: 'One-time', paid_separately: 'Paid separately', loan: 'Loan', advance: 'Salary advance', structure: 'Salary structure',
}

function OtherItems({ w }: { w: Wallet }) {
  // Commission counted here rather than on a payslip is already a row under Commission, amount and all.
  const items = w.items.filter(it => !(it.group === 'commission' && w.commission.some(c => c.inBalance && c.name === it.label)))
  if (!items.length) return null
  const c = w.currency
  return (
    <Section title="Everything else this month" icon={ReceiptText}>
      {items.map((it, i) => (
        <div key={i} className="flex items-start justify-between gap-3 py-2.5 text-sm"
          style={{ borderBottom: i < items.length - 1 ? ROW_LINE : 'none', opacity: it.counted ? 1 : 0.55 }}>
          <div className="min-w-0">
            <p className="font-medium text-white">
              {it.label}{' '}
              <span className="ml-1 rounded-md px-1.5 py-0.5 text-[11px] font-normal" style={{ border: '1px solid rgba(255,255,255,0.1)', color: MUTED }}>{GROUP[it.group]}</span>
            </p>
            {it.note && <p className="text-xs" style={{ color: MUTED }}>{it.note}</p>}
          </div>
          <p className="tabular-nums" style={{ color: it.direction === 'credit' ? GREEN : RED, textDecoration: it.counted ? 'none' : 'line-through' }}>
            {signed(it.direction === 'credit' ? it.amount : -it.amount, c)}
          </p>
        </div>
      ))}
    </Section>
  )
}

function PaymentRow({ p, c, last }: { p: WalletPayment; c: string; last: boolean }) {
  const Icon = /cash/i.test(p.method) ? Banknote : Landmark
  return (
    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)_auto] items-start gap-3 py-2.5 text-sm" style={{ borderBottom: last ? 'none' : ROW_LINE, opacity: p.reversed ? 0.55 : 1 }}>
      <p className="text-xs font-medium" style={{ color: MUTED }}>{fullDay(p.date)}</p>
      <div className="min-w-0">
        <p className="font-medium text-white"><Icon size={13} className="mr-1 inline align-[-2px]" style={{ color: MUTED }} />{[p.method, p.account].filter(Boolean).join(' · ') || p.label}</p>
        <p className="text-xs" style={{ color: MUTED }}>{[p.label, p.reference && `Ref ${p.reference}`].filter(Boolean).join(' · ')}</p>
        {p.note && <p className="text-xs" style={{ color: p.reversed ? RED : MUTED }}>{p.note}</p>}
      </div>
      <p className="tabular-nums text-white" style={{ textDecoration: p.reversed ? 'line-through' : 'none' }}>{money(p.amount, c)}</p>
    </div>
  )
}

function Payments({ w }: { w: Wallet }) {
  const c = w.currency
  const owing = w.totals.balance > 0 && w.status !== 'in_progress' && w.status !== 'paused'
  if (!w.payments.length && !owing) return null
  return (
    <Section title="Payments from finance" sub={w.finance.runNumbers.length ? `Payroll ${w.finance.runNumbers.join(', ')}` : undefined} icon={Landmark}>
      {w.payments.map((p, i) => <PaymentRow key={i} p={p} c={c} last={i === w.payments.length - 1 && !owing} />)}
      {owing && (
        <div className="grid grid-cols-[5.5rem_minmax(0,1fr)_auto] items-start gap-3 py-2.5 text-sm" style={{ color: AMBER }}>
          <p className="text-xs font-medium">—</p>
          <p className="font-medium">Not paid yet</p>
          <p className="tabular-nums">{money(w.totals.balance, c)}</p>
        </div>
      )}
    </Section>
  )
}

function Notice({ icon: Icon, children }: { icon: ElementType; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-xl px-3 py-2 text-xs" style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)', color: AMBER }}>
      <Icon size={14} className="mt-0.5 shrink-0" /><span>{children}</span>
    </div>
  )
}

export function WalletView({ w }: { w: Wallet }) {
  const c = w.currency
  return (
    <div className="space-y-4">
      {!w.finance.connected && <Notice icon={AlertTriangle}>Finance couldn&apos;t be asked, so payments and commission may be missing. {w.finance.error}</Notice>}
      {w.finance.onHold && <Notice icon={Info}>Finance has your pay on hold: {w.finance.onHold}</Notice>}
      <Headline w={w} />
      <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
        <Stat label="Credited" value={`+${money(w.totals.credited, c)}`} color={GREEN} />
        <Stat label="Deducted" value={`−${money(w.totals.deducted, c)}`} color={RED} />
        <Stat label="Paid to you" value={money(w.totals.paid, c)} />
        <Stat label="Balance" value={`${w.totals.balance < 0 ? '−' : ''}${money(w.totals.balance, c)}`} />
      </div>
      <SalaryDays w={w} />
      <CommissionRows w={w} />
      <OtherItems w={w} />
      <Payments w={w} />
    </div>
  )
}
