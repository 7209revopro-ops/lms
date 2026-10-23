'use client'
/* ─────────────────────────────────────────────────────
   A student's place in sales, under their name on Enrollment Requests (the
   user, 2026-10-13): the sales CRM that has them as a lead — "Delta · Ria ·
   Follow-up" — and their enrolment in finance: not raised, waiting for
   approval, sent back (with why), approved (with the invoice). SKY for the
   CRM, as the sales CRM tags elsewhere; the finance line takes its state's
   colour.
───────────────────────────────────────────────────── */
import { AlertTriangle, BadgeCheck, Clock, FileX, Users } from 'lucide-react'
import Spinner from '@/components/ui/Spinner'
import type { SalesStatus } from '@/lib/api/salesStatus'

const SKY = '#38BDF8'
const muted = 'rgba(255,255,255,0.35)'

function Line({ color, Icon, children, title }: { color: string; Icon: typeof Users; children: React.ReactNode; title?: string }) {
  return (
    <p title={title} className="flex items-start gap-1 text-[11px] leading-snug" style={{ color }}>
      <Icon size={11} strokeWidth={2.4} className="mt-[2px] flex-shrink-0" />
      <span className="min-w-0">{children}</span>
    </p>
  )
}

export function SalesStatusTags({ status, loading }: { status?: SalesStatus; loading?: boolean }) {
  if (!status) {
    return loading
      ? <span className="inline-flex items-center gap-1.5 text-[11px]" style={{ color: muted }}><Spinner size={10} />Checking sales…</span>
      : <span className="text-xs" style={{ color: 'rgba(255,255,255,0.2)' }}>—</span>
  }
  const { crm, finance } = status
  return (
    <div className="space-y-1">
      {crm.state !== 'ok' ? (
        <Line color="#FBBF24" Icon={AlertTriangle} title={crm.message}>Couldn&apos;t check the sales CRMs</Line>
      ) : crm.matches.length === 0 ? (
        <Line color={muted} Icon={Users}>Not in any sales CRM</Line>
      ) : (
        crm.matches.slice(0, 2).map(m => (
          <Line key={`${m.crm}-${m.leadId}`} color={SKY} Icon={Users}
            title={`${m.crmName}: lead "${m.leadName}", ${m.statusLabel}${m.assignedTo ? `, with ${m.assignedTo}` : ', unassigned'} — matched by ${m.matchedBy}`}>
            <span className="font-semibold">{m.crmName}</span>
            {m.assignedTo ? ` · ${m.assignedTo}` : ' · unassigned'} · {m.statusLabel}
            {m.matchedBy === 'phone' && <span style={{ color: muted }}> (by phone)</span>}
          </Line>
        ))
      )}
      {crm.state === 'ok' && crm.matches.length > 2 && (
        <p className="text-[10px]" style={{ color: muted }}>+{crm.matches.length - 2} more lead{crm.matches.length - 2 === 1 ? '' : 's'}</p>
      )}

      {finance.state !== 'ok' ? (
        <Line color="#FBBF24" Icon={AlertTriangle} title={finance.message}>Couldn&apos;t check finance</Line>
      ) : finance.requests.length === 0 ? (
        <Line color={muted} Icon={FileX}>Finance request not raised{finance.inFinance ? ' (a customer there)' : ''}</Line>
      ) : (() => {
        const r = finance.requests[0]!
        const crmName = r.crm ? `${r.crm[0]!.toUpperCase()}${r.crm.slice(1)} CRM` : 'a CRM'
        const by = r.closedBy ? ` by ${r.closedBy}` : ''
        if (r.approval === 'approved') {
          return <Line color="#4ADE80" Icon={BadgeCheck} title={`${r.course} — closed in ${crmName}${by}`}>Finance approved · {r.invoiceNumber}</Line>
        }
        if (r.approval === 'returned') {
          return <Line color="#F87171" Icon={FileX} title={`${r.course} — closed in ${crmName}${by}`}>Finance sent back{r.returnedReason ? ` — ${r.returnedReason}` : ''}</Line>
        }
        return <Line color="#FBBF24" Icon={Clock} title={`${r.course} — closed in ${crmName}${by}`}>Finance approval pending · {r.invoiceNumber}</Line>
      })()}
    </div>
  )
}
