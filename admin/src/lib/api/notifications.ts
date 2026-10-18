'use client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/axios'

/* The top-bar bell (2026-10-18): this admin user's own notifications —
   today a mentor's "new message from <student>". Same feed as the student
   app's bell, read through the admin session at /notifications/staff. */

export interface AdminNotification {
  _id: string; kind: string; title: string; body?: string; link?: string
  readAt?: string; createdAt: string
}
interface Feed { items: AdminNotification[]; unreadCount: number }

export const notificationKeys = { feed: ['admin', 'notifications', 'feed'] as const }

export function useAdminNotifications(enabled = true) {
  return useQuery({
    queryKey: notificationKeys.feed,
    enabled,
    queryFn: async () => (await api.get<{ data: Feed }>('/notifications/staff', { params: { per_page: 20 } })).data.data,
    refetchInterval: 30_000, refetchIntervalInBackground: false, staleTime: 10_000,
    retry: (n, err: any) => !(err?.response?.status >= 400 && err?.response?.status < 500) && n < 1,
  })
}

export function useMarkNotificationRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => { await api.post(`/notifications/staff/${id}/read`) },
    onSettled: () => qc.invalidateQueries({ queryKey: notificationKeys.feed }),
  })
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => { await api.post('/notifications/staff/read-all') },
    onSettled: () => qc.invalidateQueries({ queryKey: notificationKeys.feed }),
  })
}
