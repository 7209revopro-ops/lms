import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ApiSuccess, SessionTokens } from '@shared'
import { http, session } from '../http'

/* The signed-in student's own account: details, password, signed-in devices,
   and deleting the account (plan.md §13.4 B6). */

export interface SessionRow {
  id: string
  userAgent?: string
  ip?: string
  lastUsedAt?: string
  createdAt: string
  isCurrent: boolean
}

/* GET has no body, so the app names its own session with a header (the
   server's currentSessionToken). */
const current = () => {
  const t = session.refreshToken()
  return t ? { 'X-Refresh-Token': t } : undefined
}

export function useSessions() {
  return useQuery({
    queryKey: ['account', 'sessions'],
    queryFn:  async () => (await http.get<ApiSuccess<SessionRow[]>>('/auth/sessions', { headers: current() })).data.data,
    staleTime: 10_000,
  })
}

export function useRevokeSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) =>
      (await http.delete<ApiSuccess<{ revokedCurrent: boolean }>>(`/auth/sessions/${id}`, { headers: current() })).data.data,
    onSettled: () => qc.invalidateQueries({ queryKey: ['account', 'sessions'] }),
  })
}

export async function updateName(name: string): Promise<void> {
  await http.patch('/auth/me', { name: name.trim() })
}

/** Changing the password signs out every other device; the server hands this
 *  phone a fresh session. */
export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const res = await http.patch<ApiSuccess<{ tokens?: SessionTokens }>>('/auth/me/password', { currentPassword, newPassword })
  const tokens = res.data.data?.tokens
  if (tokens) await session.set(tokens)
}

export async function requestDeleteCode(): Promise<void> {
  await http.post('/auth/account/delete-code')
}

export async function deleteAccount(proof: { password?: string; code?: string }): Promise<void> {
  await http.delete('/auth/account', { data: proof })
}

