'use client'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/axios'
import type { PaginationMeta } from '@/types/index'
import type { LogSummaryData } from '@/components/logs/LogSummary'

export type WhatsAppLogStatus = 'pending' | 'sent' | 'failed'

export interface WhatsAppLog {
  id:           string
  to:           string
  templateName: string
  /** Friendly template name. */
  label:        string
  status:       WhatsAppLogStatus
  attempts:     number
  lastError?:   string
  sentAt?:      string
  createdAt:    string
  waMessageId?: string
  /** The message as the student read it, when the template's wording is known. */
  text?:        string
  values:       Array<{ name: string; value: string }>
  /** Where the button goes — a one-tap login is shown masked. */
  button?:      string
  person?:      { id: string; name?: string; email?: string; role?: string }
}

export interface WhatsAppLogFilter {
  page?: number; status?: WhatsAppLogStatus | ''; template?: string; q?: string; from?: string; until?: string
}

const noRetry4xx = (failureCount: number, error: unknown) => {
  const status = (error as { response?: { status?: number } })?.response?.status
  if (status && status >= 400 && status < 500) return false
  return failureCount < 1
}

export function useWhatsAppLogs(filter: WhatsAppLogFilter = {}) {
  return useQuery({
    queryKey: ['admin', 'whatsapp-logs', filter],
    queryFn: async () => {
      const params: Record<string, unknown> = { page: filter.page ?? 1, per_page: 25 }
      for (const k of ['status', 'template', 'q', 'from', 'until'] as const) if (filter[k]) params[k] = filter[k]
      const res = await api.get<{ success: true; data: WhatsAppLog[]; meta: PaginationMeta }>('/whatsapp-logs', { params })
      return { docs: res.data.data, meta: res.data.meta }
    },
    retry: noRetry4xx, staleTime: 30_000, placeholderData: (prev) => prev,
  })
}

export function useWhatsAppLogSummary() {
  return useQuery({
    queryKey: ['admin', 'whatsapp-logs', 'summary'],
    queryFn: async () => (await api.get<{ success: true; data: LogSummaryData }>('/whatsapp-logs/summary')).data.data,
    staleTime: 30_000, retry: false,
  })
}

export function useWhatsAppTemplates() {
  return useQuery({
    queryKey: ['admin', 'whatsapp-logs', 'templates'],
    queryFn: async () => (await api.get<{ success: true; data: Array<{ name: string; label: string }> }>('/whatsapp-logs/templates')).data.data,
    staleTime: 5 * 60_000, retry: false,
  })
}
