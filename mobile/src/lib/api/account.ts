import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ApiSuccess, SessionTokens } from '@shared'
import { http, session } from '../http'
import { registerForPush } from '../push'

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

/** Name, job title and bio together — the website's Profile card. */
export async function updateProfile(p: { name: string; headline: string; bio: string }): Promise<void> {
  await http.patch('/auth/me', { name: p.name.trim(), headline: p.headline.trim(), bio: p.bio.trim() })
}

/* ── Password reset (website link) ─────────────────────────────
   The email carries a link to the website's reset page; the app only asks
   for it. The server answers the same whether or not the address exists. */
export async function requestPasswordReset(email: string): Promise<void> {
  await http.post('/auth/forgot-password', { email: email.trim().toLowerCase() })
}

/* ── Email address ───────────────────────────────────────── */
export async function resendVerification(): Promise<void> {
  await http.post('/auth/resend-verification')
}

/** Parks the new address and mails a confirmation link to it. */
export async function requestEmailChange(newEmail: string, currentPassword: string): Promise<string> {
  const res = await http.patch<ApiSuccess<{ pendingEmail: string }>>('/auth/me/email', { newEmail: newEmail.trim().toLowerCase(), currentPassword })
  return res.data.data.pendingEmail
}

export async function cancelEmailChange(): Promise<void> {
  await http.delete('/auth/me/email')
}

/* ── Two-step verification (authenticator app, TOTP) ──────── */
export async function startTwoFactorSetup(password: string): Promise<{ secret: string; otpauthUrl: string }> {
  return (await http.post<ApiSuccess<{ secret: string; otpauthUrl: string }>>('/auth/2fa/setup', { password })).data.data
}

export async function enableTwoFactor(code: string): Promise<void> {
  await http.post('/auth/2fa/enable', { code })
}

export async function disableTwoFactor(password: string): Promise<void> {
  await http.post('/auth/2fa/disable', { password })
}

/** Switches the account off (an admin can switch it back on); every session ends. */
export async function deactivateAccount(password: string): Promise<void> {
  await http.post('/auth/deactivate', { password })
}

/* ── Purchases ─────────────────────────────────────────────── */
export interface MyOrder {
  id: string
  courseId?: { title: string; slug: string; thumbnailUrl?: string } | null
  gateway: string
  /** Minor units (fils / paise / cents). */
  amount: number
  currency: string
  status: 'pending' | 'paid' | 'refunded' | 'cancelled' | string
  discountAmount?: number
  stripeInvoiceUrl?: string
  refundedAt?: string
  createdAt: string
}

export function useMyOrders() {
  return useQuery({
    queryKey: ['account', 'orders'],
    queryFn:  async () => (await http.get<ApiSuccess<MyOrder[]>>('/orders/me')).data.data,
    staleTime: 60_000,
  })
}

/** Changing the password signs out every other device; the server hands this
 *  phone a fresh session. */
export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const res = await http.patch<ApiSuccess<{ tokens?: SessionTokens }>>('/auth/me/password', { currentPassword, newPassword })
  const tokens = res.data.data?.tokens
  if (tokens) await session.set(tokens)
  /* Signing out everywhere also dropped this phone's push registration
     (server: revokeAllForUser) — register it again for the new session. */
  void registerForPush()
}

export async function requestDeleteCode(): Promise<void> {
  await http.post('/auth/account/delete-code')
}

export async function deleteAccount(proof: { password?: string; code?: string }): Promise<void> {
  await http.delete('/auth/account', { data: proof })
}

