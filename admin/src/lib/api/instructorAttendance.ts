'use client'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/axios'
import type { PaginationMeta } from '@/types/index'

export interface NoShowAlert {
  id:                 string
  title:              string
  scheduledStart:     string
  type:               'internal' | 'external'
  status:             'scheduled' | 'live' | 'ended' | 'cancelled'
  instructor:         { id: string; name: string; email: string } | null
  course:             { title: string } | null
  /** Set only if the mentor joined AFTER the alert already fired — a late
      join, not an unresolved miss. */
  instructorJoinedAt: string | null
}

interface NoShowFilter {
  page?: number
}

export const instructorAttendanceKeys = {
  list: (f: NoShowFilter) => ['admin', 'instructor-attendance', f] as const,
}

export function useNoShowAlerts(filter: NoShowFilter = {}) {
  const { page = 1 } = filter
  return useQuery({
    queryKey: instructorAttendanceKeys.list(filter),
    queryFn: async () => {
      const res = await api.get<{ success: true; data: NoShowAlert[]; meta: PaginationMeta }>(
        '/admin/live-classes/no-shows', { params: { page, per_page: 25 } },
      )
      return { docs: res.data.data, meta: res.data.meta }
    },
    /* Never retry a 4xx — a permission error reads the same a second later,
       and retrying it anyway is what turned a real 403 into a stuck "no
       entries found" the first time this exact pattern shipped (Email Logs,
       same session) instead of the actual error. */
    retry: (failureCount, error: unknown) => {
      const status = (error as { response?: { status?: number } })?.response?.status
      if (status && status >= 400 && status < 500) return false
      return failureCount < 1
    },
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  })
}
