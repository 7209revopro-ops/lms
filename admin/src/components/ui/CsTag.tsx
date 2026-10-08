'use client'
/* ─────────────────────────────────────────────────────
   A student's CS and CS team in Tetra Commission — "CS 2- AB · Falcons" —
   shown wherever the admin shows a student (the user, 2026-10-07: "show the cs
   name and team name … every student showing area"). "No CS yet" while they
   wait in Delta Open Students. Nothing for a student the commission portal
   has not told us about; a table cell says "—" instead.

   TEAL, which no other badge here uses: violet is a cross-academy row, amber
   Google Meet, green live, red destructive, and the sales CRM tags sky, orange
   and fuchsia.
───────────────────────────────────────────────────── */
import { Headset } from 'lucide-react'
import type { TetraCs } from '@/lib/api/tetraCs'

const COLOR = '#2DD4BF'

/** "CS 2- AB · Falcons", "No CS yet · Delta Open Students" — "" when there is nothing to say. */
export function csLabel(cs?: TetraCs | null): string {
  if (!cs || (!cs.name && !cs.team && !cs.open)) return ''
  const who = cs.open || !cs.name ? 'No CS yet' : cs.name
  return `${who}${cs.team ? ` · ${cs.team}` : ''}`
}

/** For a CSV export: the CS, and the team, each its own column. */
export const csName = (cs?: TetraCs | null) => (cs ? (cs.open || !cs.name ? (cs.team || cs.open ? 'No CS yet' : '') : cs.name) : '')
export const csTeam = (cs?: TetraCs | null) => cs?.team ?? ''

export function CsTag({ cs, variant = 'line', className = '' }: {
  cs?: TetraCs | null
  /** line: a small line under a name; cell: a table cell's text ("—" when none); chip: a compact pill. */
  variant?: 'line' | 'cell' | 'chip'
  className?: string
}) {
  const label = csLabel(cs)
  const title = label
    ? `CS in Tetra Commission: ${label}${cs?.code ? ` (${cs.code})` : ''}`
    : 'Not in Tetra Commission'
  if (!label) {
    return variant === 'cell'
      ? <span className={`text-xs ${className}`} style={{ color: 'rgba(255,255,255,0.25)' }} title={title}>—</span>
      : null
  }
  const muted = cs?.open || !cs?.name
  if (variant === 'chip') {
    return (
      <span title={title}
        className={`inline-flex max-w-full items-center gap-1 truncate whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${className}`}
        style={{ background: `${COLOR}14`, color: muted ? 'rgba(45,212,191,0.65)' : COLOR, border: `1px solid ${COLOR}38` }}>
        <Headset size={10} strokeWidth={2.4} className="flex-shrink-0" />
        <span className="truncate">{label}</span>
      </span>
    )
  }
  return (
    <span title={title}
      className={`inline-flex max-w-full items-center gap-1 ${variant === 'cell' ? 'text-xs' : 'text-[11px]'} ${className}`}
      style={{ color: muted ? 'rgba(45,212,191,0.6)' : COLOR }}>
      <Headset size={variant === 'cell' ? 12 : 11} strokeWidth={2.2} className="flex-shrink-0" />
      <span className="truncate">{label}</span>
    </span>
  )
}
