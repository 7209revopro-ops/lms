'use client'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/axios'
import type { TetraCs } from '@/lib/api/tetraCs'

export type ExpressMemberStatus = 'all' | 'active' | 'blocked'

export interface ExpressMember {
  id:        string
  name:      string
  email:     string
  avatarUrl?: string
  country?:  string
  isActive:  boolean
  createdAt: string
  /** Their CS and CS team in Tetra Commission, where it has said. */
  tetraCs?:  TetraCs | null
}

export interface ExpressMembersResponse {
  success: true
  data:    ExpressMember[]
  meta: {
    total_count:  number
    total_pages:  number
    page:         number
    has_next:     boolean
    has_prev:     boolean
  }
}

const KEYS = {
  list: (status: ExpressMemberStatus, search?: string, page?: number) =>
    ['admin', 'express-members', status, search ?? '', page ?? 1] as const,
  count: () => ['admin', 'express-members', 'count'] as const,
}

export function useExpressMembers(
  status: ExpressMemberStatus = 'all',
  search = '',
  page   = 1,
  perPage = 20,
  enabled = true,
) {
  return useQuery({
    queryKey: KEYS.list(status, search, page),
    queryFn: async () => {
      const params: Record<string, string | number> = { status, page, per_page: perPage }
      if (search) params['search'] = search
      const res = await api.get<ExpressMembersResponse>('/admin/express-members', { params })
      return res.data
    },
    staleTime: 0,
    enabled,
  })
}

export function useExpressMembersCount() {
  return useQuery({
    queryKey: KEYS.count(),
    queryFn: async () => {
      const res = await api.get<ExpressMembersResponse>('/admin/express-members', {
        params: { status: 'all', per_page: 1, page: 1 },
      })
      return res.data.meta?.total_count ?? 0
    },
    staleTime: 60_000,
  })
}

export interface ExpressMembersStats {
  total:   number
  active:  number
  blocked: number
}

export function useExpressMembersStats(enabled = true) {
  return useQuery({
    queryKey: ['admin', 'express-members', 'stats'],
    queryFn: async () => {
      const [allRes, activeRes, blockedRes] = await Promise.all([
        api.get<ExpressMembersResponse>('/admin/express-members', { params: { status: 'all',     per_page: 1, page: 1 } }),
        api.get<ExpressMembersResponse>('/admin/express-members', { params: { status: 'active',  per_page: 1, page: 1 } }),
        api.get<ExpressMembersResponse>('/admin/express-members', { params: { status: 'blocked', per_page: 1, page: 1 } }),
      ])
      return {
        total:   allRes.data.meta?.total_count   ?? 0,
        active:  activeRes.data.meta?.total_count ?? 0,
        blocked: blockedRes.data.meta?.total_count ?? 0,
      } as ExpressMembersStats
    },
    staleTime: 0,
    enabled,
  })
}

export function useToggleExpressMember() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (userId: string) => {
      const res = await api.patch<{ success: true; data: { id: string; isActive: boolean } }>(
        `/admin/express-members/${userId}/block`,
      )
      return res.data.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'express-members'] })
    },
  })
}

export function useDeleteExpressMember() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (userId: string) => {
      await api.delete(`/admin/express-members/${userId}`)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'express-members'] })
    },
  })
}
