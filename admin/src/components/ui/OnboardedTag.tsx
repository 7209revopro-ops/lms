'use client'
/* ─────────────────────────────────────────────────────
   Whether CS Portal onboarded a student — their welcome went — as it
   last told us (the user, 2026-10-13: "in the students section the onboarded
   or not"). Green with the day when onboarded, amber when they are there and
   not yet, nothing for a student who is not in CS Portal ("—" in a
   table cell).
───────────────────────────────────────────────────── */
import { CircleCheck, Clock } from 'lucide-react'
import type { TetraCs } from '@/lib/api/tetraCs'

const day = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Dubai' }) : '')

/** "Onboarded", "Not onboarded", or "" when not in CS Portal. */
export function onboardedLabel(cs?: TetraCs | null): string {
  if (!cs?.code) return ''
  return cs.onboarded ? 'Onboarded' : 'Not onboarded'
}

export function OnboardedTag({ cs, variant = 'chip' }: { cs?: TetraCs | null; variant?: 'chip' | 'cell' }) {
  if (!cs?.code) {
    return variant === 'cell'
      ? <span className="text-xs" style={{ color: 'rgba(255,255,255,0.25)' }} title="Not in CS Portal">—</span>
      : null
  }
  const on = cs.onboarded === true
  const color = on ? '#4ADE80' : '#FBBF24'
  const Icon = on ? CircleCheck : Clock
  const when = on ? day(cs.onboardedAt) : ''
  return (
    <span title={on ? `Onboarded in CS Portal${when ? ` on ${when}` : ''}` : 'In CS Portal, not onboarded yet'}
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10px] font-semibold"
      style={{ background: `${color}14`, color, border: `1px solid ${color}38` }}>
      <Icon size={10} strokeWidth={2.4} />
      {on ? `Onboarded${when ? ` · ${when}` : ''}` : 'Not onboarded'}
    </span>
  )
}
