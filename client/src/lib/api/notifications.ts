'use client'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, apiGet } from '@/lib/axios'
import type { PaginationMeta } from '@/types/index'

export interface Notification {
  id:        string
  kind:      'enrollment' | 'lesson-complete' | 'course-complete' | 'review-posted' | 'live-class-scheduled' | 'achievement' | 'system'
  title:     string
  body?:     string
  link?:     string
  readAt?:   string
  createdAt: string
}

export interface NotificationList {
  items:       Notification[]
  unreadCount: number
}

export const notificationKeys = {
  list:   (p: object) => ['notifications', 'list', p] as const,
  unread: ['notifications', 'unread-count'] as const,
}

export function useNotifications(params: { page?: number; per_page?: number; unread?: boolean } = {}) {
  return useQuery({
    queryKey: notificationKeys.list(params),
    queryFn: async () => {
      const res = await api.get<{ success: true; data: NotificationList; meta: PaginationMeta }>(
        '/notifications', { params },
      )
      return { ...res.data.data, meta: res.data.meta }
    },
    staleTime: 15_000,
  })
}

export function useUnreadCount() {
  return useQuery({
    queryKey: notificationKeys.unread,
    queryFn:  () => apiGet<{ unreadCount: number }>('/notifications/unread-count').then(d => d.unreadCount),
    /* Poll every minute so the bell stays fresh */
    refetchInterval: 60_000,
    staleTime: 30_000,
  })
}

export function useMarkRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/read`).then(() => {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] })
    },
  })
}

export function useMarkAllRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post('/notifications/read-all').then(() => {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] })
    },
  })
}

/* New classes scheduled in the student's courses that they have not seen —
   the badge on Schedule (bottom bar + menu). Cleared by opening the Schedule. */
export const NEW_CLASS_KIND = 'live-class-scheduled'
export function useNewClassesCount() {
  return useQuery({
    queryKey: ['notifications', 'unread-count', NEW_CLASS_KIND],
    queryFn:  () => apiGet<{ unreadCount: number }>('/notifications/unread-count', { kind: NEW_CLASS_KIND }).then(d => d.unreadCount),
    refetchInterval: 60_000,
    staleTime: 30_000,
  })
}

/** Mark the new-class notices read (opening the Schedule). */
export function useClearNewClasses() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post('/notifications/read-all', undefined, { params: { kind: NEW_CLASS_KIND } }).then(() => {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['notifications'] }) },
  })
}
