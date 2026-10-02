'use client'
/* ─────────────────────────────────────────────────────
   Which sales CRM sold an enrolment.

   Finance enrols the students three CRMs sell — Delta's Sales CRM, the Remote
   CRM and Draw — and says which, so staff here see the same tag finance and
   Tetra Commission show. A fact about the sale, not about how the student got
   in: that is the enrolment's `source`, and these are all 'purchase'.

   THE COLOURS avoid the ones this panel already gives a meaning: violet is a
   cross-academy row, amber is Google Meet, green live, red destructive.
───────────────────────────────────────────────────── */
import { Store } from 'lucide-react'
import type { SalesCrm } from '@/lib/api/users'

export const SALES_CRM_META: Record<SalesCrm, { label: string; color: string }> = {
  delta:  { label: 'Sales CRM',  color: '#38BDF8' },
  remote: { label: 'Remote CRM', color: '#FB923C' },
  draw:   { label: 'Draw',       color: '#E879F9' },
}

export function SalesCrmBadge({ crm, size = 'sm' }: { crm?: SalesCrm | null; size?: 'sm' | 'md' }) {
  const m = crm ? SALES_CRM_META[crm] : undefined
  if (!m) return null
  const pad = size === 'md' ? 'px-2 py-1 text-[11px] gap-1.5' : 'px-1.5 py-0.5 text-[9px] gap-1'
  return (
    <span
      title={`Sold through the ${m.label}`}
      className={`inline-flex items-center whitespace-nowrap rounded-md font-semibold ${pad}`}
      style={{ background: `${m.color}1A`, color: m.color, border: `1px solid ${m.color}40` }}>
      <Store size={size === 'md' ? 11 : 9} strokeWidth={2.5} />
      {m.label}
    </span>
  )
}
