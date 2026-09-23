'use client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/axios'
import type { PaginationMeta } from '@/types/index'

export interface AdminAnnouncement {
  id:              string
  title:           string
  description:     string
  mediaUrl?:       string
  startDate:       string
  endDate:         string
  /** Absent = every academy. */
  organizationId?: string
  isActive:        boolean
  createdAt:       string
  updatedAt:       string
}

export interface AnnouncementDto {
  title:           string
  description:     string
  mediaUrl?:        string
  startDate:        string   // ISO
  endDate:          string   // ISO
  /** Only a super_admin's request may set this — null means "every academy",
      a real id targets one, and omitting it lets the server default to the
      caller's own academy (or the org switcher, for a super_admin). An
      admin's request has this key stripped before it reaches the API;
      see AnnouncementFormModal. */
  organizationId?:  string | null
}

export const announcementKeys = {
  list: (params: object) => ['admin', 'announcements', params] as const,
}

export function useAdminAnnouncements(params: { page?: number; per_page?: number } = {}) {
  return useQuery({
    queryKey: announcementKeys.list(params),
    queryFn: async () => {
      const res = await api.get<{ success: true; data: AdminAnnouncement[]; meta: PaginationMeta }>(
        '/admin/announcements',
        { params },
      )
      return { docs: res.data.data, meta: res.data.meta }
    },
    staleTime: 30_000,
  })
}

export function useCreateAnnouncement() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (dto: AnnouncementDto) => {
      const res = await api.post<{ success: true; data: AdminAnnouncement }>('/admin/announcements', dto)
      return res.data.data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'announcements'] }),
  })
}

export function useUpdateAnnouncement() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...dto }: { id: string } & Partial<AnnouncementDto> & { isActive?: boolean }) => {
      const res = await api.patch<{ success: true; data: AdminAnnouncement }>(`/admin/announcements/${id}`, dto)
      return res.data.data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'announcements'] }),
  })
}

export function useDeleteAnnouncement() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/admin/announcements/${id}`)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'announcements'] }),
  })
}
