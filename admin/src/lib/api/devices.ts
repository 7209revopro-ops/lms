'use client'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/axios'

export type DeviceStatus = 'pending' | 'approved' | 'revoked'

export interface DeviceView {
  id:         string
  userId:     string
  name:       string | null
  email:      string
  phone:      string | null
  status:     DeviceStatus
  isMain:     boolean
  label:      string | null
  ip:         string | null
  createdAt:  string
  approvedAt: string | null
  lastSeenAt: string | null
}

const KEYS = {
  list: (status: string) => ['admin', 'devices', status] as const,
}

/** All student devices (pending first), or one status. */
export function useDevices(status: DeviceStatus | 'all' = 'all') {
  return useQuery({
    queryKey: KEYS.list(status),
    queryFn: async () => {
      const params: Record<string, string> = {}
      if (status !== 'all') params['status'] = status
      const res = await api.get<{ success: true; data: DeviceView[] }>('/admin/devices', { params })
      return res.data.data
    },
    staleTime: 20_000,
  })
}

export function useApproveDevice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await api.patch(`/admin/devices/${id}/approve`, {})
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'devices'] }),
  })
}

export function useRevokeDevice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await api.patch(`/admin/devices/${id}/revoke`, {})
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'devices'] }),
  })
}

/* ─── The two-device limit can be switched off entirely ──────────────────
   Read by any admin so the page can say whether the queue it is showing
   enforces anything; written by a super admin only. */
export interface DeviceLimitState {
  enabled:       boolean
  updatedAt:     string | null
  updatedByName: string | null
}

/* NOT under ['admin','devices',...]: React Query invalidates by prefix, so a
   key nested under the device list would be invalidated — and refetched —
   every time the list is, which is exactly what the optimistic write below is
   avoiding. */
const LIMIT_KEY = ['admin', 'device-limit'] as const

export function useDeviceLimit() {
  return useQuery({
    queryKey: LIMIT_KEY,
    queryFn: async () => {
      const res = await api.get<{ success: true; data: DeviceLimitState }>('/admin/settings/device-limit')
      return res.data.data
    },
    staleTime: 20_000,
  })
}

export function useSetDeviceLimit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await api.patch<{ success: true; data: DeviceLimitState }>(
        '/admin/settings/device-limit', { enabled })
      return res.data.data
    },
    onSuccess: (data) => {
      /* Write the fresh state straight into the cache rather than only
         invalidating: the switch is the control the admin just operated, and
         a refetch round-trip would let it flick back to its old position for
         a moment. The device LIST is invalidated normally. */
      qc.setQueryData(LIMIT_KEY, data)
      qc.invalidateQueries({ queryKey: ['admin', 'devices'] })
    },
  })
}
