'use client'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/axios'
import type { PaginationMeta } from '@/types/index'

export type EmailLogStatus = 'pending' | 'sent' | 'failed'

export interface EmailLog {
  id:            string
  to:            string
  subject:       string
  text?:         string
  status:        EmailLogStatus
  attempts:      number
  nextAttemptAt: string
  lastError?:    string
  sentVia?:      string
  sentAt?:       string
  createdAt:     string
}

interface EmailLogFilter {
  page?:   number
  status?: EmailLogStatus | ''
  to?:     string
  /* Recipient or subject, partial. */
  q?:      string
  from?:   string
  until?:  string
}

export const emailLogKeys = {
  list: (f: EmailLogFilter) => ['admin', 'email-logs', f] as const,
}

export function useEmailLogs(filter: EmailLogFilter = {}) {
  const { page = 1, status, to, q, from, until } = filter
  return useQuery({
    queryKey: emailLogKeys.list(filter),
    queryFn: async () => {
      const params: Record<string, unknown> = { page, per_page: 25 }
      if (status) params['status'] = status
      if (to)     params['to']     = to
      if (q)      params['q']      = q
      if (from)   params['from']   = from
      if (until)  params['until']  = until
      const res = await api.get<{ success: true; data: EmailLog[]; meta: PaginationMeta }>(
        '/email-logs', { params },
      )
      return { docs: res.data.data, meta: res.data.meta }
    },
    /* Never retry a 4xx: a 403 here means "not super_admin," and that answer
       is identical a second time. The global default (retry once) is meant
       for a flaky network/5xx, and retrying a permission error anyway just
       adds a pointless extra round trip before the page can show it. */
    retry: (failureCount, error: unknown) => {
      const status = (error as { response?: { status?: number } })?.response?.status
      if (status && status >= 400 && status < 500) return false
      return failureCount < 1
    },
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  })
}

/** The full rendered HTML body — fetched only when a row is expanded. */
export async function fetchEmailLogHtml(id: string): Promise<string> {
  const res = await api.get<{ success: true; data: { html: string } }>(`/email-logs/${id}/html`)
  return res.data.data.html
}

/** Sent / failed / pending — today and the last 7 days. */
export function useEmailLogSummary() {
  return useQuery({
    queryKey: ['admin', 'email-logs', 'summary'],
    queryFn: async () => (await api.get<{ success: true; data: import('@/components/logs/LogSummary').LogSummaryData }>('/email-logs/summary')).data.data,
    staleTime: 30_000, retry: false,
  })
}
