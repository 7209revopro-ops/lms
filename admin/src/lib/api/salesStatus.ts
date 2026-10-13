'use client'
/* ─────────────────────────────────────────────────────
   Where a student stands in sales (the user, 2026-10-13) — for Enrollment
   Requests: which sales CRM has them as a lead (Root reads Delta, Banglore,
   Draw and Remote) and their enrolment in finance — not raised, waiting for
   approval, sent back, approved. One call for the rows on screen; the backend
   asks Root and finance and keeps the answers a minute
   (backend services/salesStatus.service.ts).
───────────────────────────────────────────────────── */
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/axios'

export interface CrmLeadMatch {
  crm:         string
  crmName:     string
  leadId:      string
  leadName:    string
  status:      string
  statusLabel: string
  assignedTo:  string
  matchedBy:   'email' | 'phone'
  createdAt:   string | null
}

export interface FinanceEnrolmentRequest {
  invoiceNumber:  string
  crm:            string
  closedBy:       string
  course:         string
  approval:       'pending' | 'approved' | 'returned'
  returnedReason: string
  at:             string
}

type Failed = { state: 'not_configured' | 'unavailable'; message: string }
export interface SalesStatus {
  crm:     ({ state: 'ok'; matches: CrmLeadMatch[] }) | Failed
  finance: ({ state: 'ok'; inFinance: boolean; requests: FinanceEnrolmentRequest[] }) | Failed
}

/** The finance request filter: the newest request's state, or none raised. */
export type FinanceRequestFilter = 'none' | 'pending' | 'returned' | 'approved'

export function useSalesStatus(ids: string[]) {
  const key = [...ids].sort()
  return useQuery({
    queryKey: ['admin', 'enrollment-requests', 'sales-status', key],
    enabled:  key.length > 0,
    queryFn:  async () => {
      const res = await api.post<{ success: true; data: Record<string, SalesStatus> }>(
        '/admin/enrollment-requests/sales-status',
        { ids: key.slice(0, 100) },
      )
      return res.data.data
    },
    staleTime: 60_000,
    retry: false,
  })
}
