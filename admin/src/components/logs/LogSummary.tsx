'use client'
/* Sent / failed / pending — today and the last 7 days. Shared by the Email
   Logs and WhatsApp Logs pages. Clicking a number filters the list by it. */
import { CheckCircle2, XCircle, Clock } from 'lucide-react'

export interface StatusCounts { sent: number; failed: number; pending: number; total: number }
export interface LogSummaryData { today: StatusCounts; last7Days: StatusCounts }
type Status = 'sent' | 'failed' | 'pending'

const CELLS: Array<{ key: Status; label: string; color: string; icon: React.ElementType }> = [
  { key: 'sent',    label: 'Sent',    color: '#4ADE80', icon: CheckCircle2 },
  { key: 'failed',  label: 'Failed',  color: '#F87171', icon: XCircle },
  { key: 'pending', label: 'Pending', color: '#FACC15', icon: Clock },
]

export function LogSummary({ data, onPick }: { data?: LogSummaryData; onPick?: (s: Status) => void }) {
  const block = (title: string, c?: StatusCounts) => (
    <div className="flex-1 rounded-2xl p-4" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)', minWidth: 260 }}>
      <div className="flex items-baseline justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.4)' }}>{title}</p>
        <p className="text-[11px] tabular-nums" style={{ color: 'rgba(255,255,255,0.35)' }}>{c ? c.total.toLocaleString() : '—'} total</p>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {CELLS.map(({ key, label, color, icon: Icon }) => (
          <button key={key} type="button" onClick={() => onPick?.(key)}
            className="rounded-xl px-3 py-2 text-left transition-colors hover:bg-white/[0.05]"
            style={{ background: 'rgba(255,255,255,0.03)' }}>
            <span className="flex items-center gap-1 text-[10px] font-semibold" style={{ color }}><Icon size={10} />{label}</span>
            <span className="mt-0.5 block text-lg font-bold tabular-nums text-white">{c ? c[key].toLocaleString() : '—'}</span>
          </button>
        ))}
      </div>
    </div>
  )
  return <div className="flex flex-wrap gap-3">{block('Today', data?.today)}{block('Last 7 days', data?.last7Days)}</div>
}

/* From / until day pickers (YYYY-MM-DD, Dubai days on the server). */
export function DateRange({ from, until, onChange }: { from: string; until: string; onChange: (from: string, until: string) => void }) {
  const box = { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', colorScheme: 'dark' } as const
  return (
    <div className="flex items-center gap-1.5 text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>
      <input type="date" value={from} max={until || undefined} onChange={e => onChange(e.target.value, until)}
        className="rounded-xl px-2.5 py-1.5 text-xs text-white outline-none" style={box} aria-label="From" />
      <span>to</span>
      <input type="date" value={until} min={from || undefined} onChange={e => onChange(from, e.target.value)}
        className="rounded-xl px-2.5 py-1.5 text-xs text-white outline-none" style={box} aria-label="Until" />
    </div>
  )
}
