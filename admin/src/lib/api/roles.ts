'use client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/axios'

/* ── Types ──────────────────────────────────────────────── */

export const PERMISSION_RESOURCES = [
  'users', 'courses', 'live-classes', 'bookings',
  'orders', 'categories', 'coupons', 'reviews', 'reports', 'roles', 'support',
] as const

export type PermissionResource = typeof PERMISSION_RESOURCES[number]

export interface ResourcePermission {
  resource:    PermissionResource
  create:      boolean
  read:        boolean
  update:      boolean
  delete:      boolean
  list:        boolean
  list_basic:  boolean
  impersonate: boolean
}

export interface Role {
  id:           string
  name:         string
  description?: string
  isSystem:     boolean
  permissions:  ResourcePermission[]
  createdAt:    string
  updatedAt:    string
}

/* ── Query keys ─────────────────────────────────────────── */

export const roleKeys = {
  all: ['admin', 'roles'] as const,
}

/* ── Hooks ──────────────────────────────────────────────── */

export function useRoles() {
  return useQuery({
    queryKey: roleKeys.all,
    queryFn: async () => {
      const res = await api.get<{ success: true; data: Role[] }>('/admin/roles')
      return res.data.data
    },
    staleTime: 30_000,
  })
}

export function useCreateRole() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (dto: { name: string; description?: string }) => {
      const res = await api.post<{ success: true; data: Role }>('/admin/roles', dto)
      return res.data.data
    },
    onSuccess: (newRole) => {
      qc.setQueryData<Role[]>(roleKeys.all, (old = []) => [...old, newRole])
      qc.invalidateQueries({ queryKey: roleKeys.all })
    },
  })
}

export function useUpdateRole() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...dto }: { id: string; name?: string; description?: string }) => {
      const res = await api.patch<{ success: true; data: Role }>(`/admin/roles/${id}`, dto)
      return res.data.data
    },
    onSuccess: (updated) => {
      qc.setQueryData<Role[]>(roleKeys.all, (old = []) =>
        old.map(r => r.id === updated.id ? updated : r),
      )
      qc.invalidateQueries({ queryKey: roleKeys.all })
    },
  })
}

export function useUpdatePermissions() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, permissions }: { id: string; permissions: Partial<ResourcePermission>[] }) => {
      const res = await api.patch<{ success: true; data: Role }>(
        `/admin/roles/${id}/permissions`, { permissions },
      )
      return res.data.data
    },
    onSuccess: (updated) => {
      qc.setQueryData<Role[]>(roleKeys.all, (old = []) =>
        old.map(r => r.id === updated.id ? updated : r),
      )
      qc.invalidateQueries({ queryKey: roleKeys.all })
    },
  })
}

export function useDeleteRole() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/admin/roles/${id}`)
      return id
    },
    onSuccess: (id) => {
      qc.setQueryData<Role[]>(roleKeys.all, (old = []) => old.filter(r => r.id !== id))
      qc.invalidateQueries({ queryKey: roleKeys.all })
      qc.invalidateQueries({ queryKey: ['admin', 'users'] })
    },
  })
}

export function useAssignRole() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ userId, roleId }: { userId: string; roleId: string | null }) => {
      const res = await api.patch<{ success: true; data: { userId: string; roleId: string | null } }>(
        `/admin/users/${userId}/assign-role`, { roleId },
      )
      return res.data.data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  })
}
