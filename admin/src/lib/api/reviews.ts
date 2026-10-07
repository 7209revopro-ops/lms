'use client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/axios'
import type { PaginationMeta } from '@/types/index'
import type { TetraCs } from '@/lib/api/tetraCs'

export interface AdminReview {
  id:        string
  rating:    number
  comment?:  string
  createdAt: string
  userId:    string | { id: string; name: string; avatarUrl?: string; email?: string; tetraCs?: TetraCs | null }
  courseId:  string | { id: string; title: string; slug: string; thumbnailUrl?: string }
}

export const reviewKeys = {
  list: (params: object) => ['admin', 'reviews', params] as const,
}

export function useAdminReviews(params: { page?: number; per_page?: number } = {}) {
  return useQuery({
    queryKey: reviewKeys.list(params),
    queryFn: async () => {
      const res = await api.get<{ success: true; data: AdminReview[]; meta: PaginationMeta }>(
        '/admin/reviews',
        { params },
      )
      return { docs: res.data.data, meta: res.data.meta }
    },
    staleTime: 30_000,
  })
}

export function useDeleteReview() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => { await api.delete(`/admin/reviews/${id}`) },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'reviews'] })
      qc.invalidateQueries({ queryKey: ['admin', 'stats'] })
    },
  })
}
