import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ApiSuccess } from '@shared'
import { apiGet, http } from '../http'

/* The in-app notification feed — the website's bell (GET /notifications).
   Every push is also one of these, so the list is where a missed push is
   found again. */

export interface AppNotification {
  id: string
  kind: string
  title: string
  body?: string
  link?: string
  readAt?: string
  createdAt: string
}

export const notificationKeys = {
  list:   ['notifications', 'list'] as const,
  unread: ['notifications', 'unread'] as const,
}

const PER_PAGE = 30

export function useNotifications() {
  return useInfiniteQuery({
    queryKey: notificationKeys.list,
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const res = await http.get<ApiSuccess<{ items: AppNotification[]; unreadCount: number }> & { meta?: { has_next?: boolean } }>(
        '/notifications', { params: { page: pageParam, per_page: PER_PAGE } })
      return { items: res.data.data.items, hasNext: !!res.data.meta?.has_next, page: pageParam }
    },
    getNextPageParam: last => (last.hasNext ? last.page + 1 : undefined),
    staleTime: 10_000,
  })
}

export function useNotificationUnread(enabled: boolean) {
  return useQuery({
    queryKey: notificationKeys.unread,
    queryFn:  async () => (await apiGet<{ unreadCount: number }>('/notifications/unread-count')).unreadCount,
    refetchInterval: 30_000, staleTime: 10_000, enabled,
  })
}

export function useMarkRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string | 'all') => {
      if (id === 'all') await http.post('/notifications/read-all')
      else await http.post(`/notifications/${id}/read`)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })
}
