'use client'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPatch, api } from '@/lib/axios'
import { ANNOUNCEMENT_DISMISS_PREFIX } from '@/lib/announcementDismiss'

export interface EnrollmentApplication {
  phone?:             string
  emergencyContact?:  string
  gender?:            string
  dateOfBirth?:       string
  nationality?:       string
  homeCountry?:       string
  occupation?:        string
  idType?:            string
  idNumber?:          string
  emiratesId?:        string
  countryAttendance?: string
  villa?:             string
  city?:              string
  addressCountry?:    string
  passportUrl?:       string
  idDocUrl?:          string
  photoUrl?:          string
  experienceLevel?:   string
  preferredStartDate?: string
  hearAboutUs?:       string
  referralName?:      string
  programs?:          string[]
  paymentMethod?:     string
}

/* Present only while a super admin is viewing this account through the
   client-portal impersonation flow. The cookie behind it is httpOnly, so the
   server reporting it here is the only way the UI can know. */
export interface ImpersonationState {
  actorEmail?: string
  readOnly:    boolean
}

export interface CurrentUser {
  id:             string
  name:           string
  email:          string
  /** An address requested but not yet confirmed. The account still signs
   *  in with `email` until the link sent here is clicked. */
  pendingEmail?:  string
  avatarUrl?:     string
  role:           'student' | 'instructor' | 'admin' | 'viewer'
  headline?:      string
  bio?:           string
  websiteUrl?:    string
  isVerified:     boolean
  isActive:       boolean
  signupType?:    'express' | 'full'
  category?:      '4x-trading' | 'digital-marketing' | 'ai' | 'jura'
  organizationId?: string
  enrollmentStatus?:            'pending' | 'approved' | 'cancelled' | 'rejected'
  enrollmentCancellationReason?: string
  rejectionReason?:             string
  fullRegistrationSubmittedAt?: string
  enrollmentApplication?:       EnrollmentApplication
  createdAt:      string
  updatedAt:      string
  impersonation?: ImpersonationState
}

export const userKeys = {
  me: ['auth', 'me'] as const,
}

/* GET /auth/me — the authenticated user behind the lms_at cookie. */
export function useCurrentUser() {
  return useQuery({
    queryKey: userKeys.me,
    queryFn:  async () => {
      const data = await apiGet<{ user: CurrentUser; impersonation?: ImpersonationState }>('/auth/me')
      /* Folded onto the user rather than fetched separately: the banner and
         every ordinary caller then share one request and one cache entry. */
      return Object.assign(data.user, { impersonation: data.impersonation })
    },
    retry: false,
    staleTime: 60_000,
  })
}

/* PATCH /auth/me — update name / headline / bio / avatarUrl / websiteUrl. */
export function useUpdateProfile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: Partial<Pick<CurrentUser, 'name' | 'headline' | 'bio' | 'avatarUrl' | 'websiteUrl'>>) => {
      const data = await apiPatch<{ user: CurrentUser }>('/auth/me', input)
      return data.user
    },
    onSuccess: (user) => {
      /* Update the cache directly so the UI reflects the change instantly. */
      qc.setQueryData<CurrentUser>(userKeys.me, user)
    },
  })
}

/* PATCH /auth/me/complete-registration — express users submit full enrollment form. */
export function useCompleteRegistration() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: EnrollmentApplication & { avatarUrl?: string }) => {
      const data = await apiPatch<{ user: CurrentUser }>('/auth/me/complete-registration', input)
      return data.user
    },
    onSuccess: (user) => {
      qc.setQueryData<CurrentUser>(userKeys.me, user)
    },
  })
}

/* POST /checkout/abzer/verify-return — fulfill order after BillxPro redirect.
   Returns needsRegistration: true when the buyer is an express account. */
export function useVerifyAbzerReturn() {
  return useMutation({
    mutationFn: async (input: { orderId: string; transactionId?: string }) => {
      const res = await api.post<{ success: boolean; data: { needsRegistration: boolean } }>(
        '/checkout/abzer/verify-return',
        input,
      )
      return res.data.data
    },
  })
}

/* POST /auth/logout — server clears the cookies.

   Also clears every announcement's per-session dismissal flag. Those live in
   sessionStorage precisely so a NEW session re-shows a still-active
   announcement — but sessionStorage alone only clears when the tab closes,
   and a genuine sign-out-then-sign-in in the SAME tab is a new session in
   every sense that matters here except that one. Without this sweep, "log
   out, log back in" would leave an announcement silently dismissed. */
export function logout(): Promise<void> {
  if (typeof window !== 'undefined') {
    try {
      for (const key of Object.keys(sessionStorage)) {
        if (key.startsWith(ANNOUNCEMENT_DISMISS_PREFIX)) sessionStorage.removeItem(key)
      }
    } catch { /* storage blocked — nothing to clear */ }
  }
  return api.post('/auth/logout').then(() => {/* no-op */}).catch(() => {/* best-effort */})
}

/* PATCH /auth/me/password */
export function useChangePassword() {
  return useMutation({
    mutationFn: ({ currentPassword, newPassword }: { currentPassword: string; newPassword: string }) =>
      api.patch('/auth/me/password', { currentPassword, newPassword }),
  })
}

/* ── Changing the account's email address ──────────────
   Two calls, because nothing moves until a link sent to the NEW address comes
   back. The request only parks it; the student keeps signing in with the old
   one until they confirm, so a typo is harmless rather than a lockout. */
export function useRequestEmailChange() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ newEmail, currentPassword }: { newEmail: string; currentPassword: string }) =>
      api.patch('/auth/me/email', { newEmail, currentPassword }),
    /* Refresh the profile so the pending address appears without a reload. */
    onSuccess: () => { qc.invalidateQueries({ queryKey: userKeys.me }) },
  })
}

export function useCancelEmailChange() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.delete('/auth/me/email'),
    onSuccess: () => { qc.invalidateQueries({ queryKey: userKeys.me }) },
  })
}

/* POST /auth/confirm-email-change — opened from the mailbox, so it carries no
   session of its own. The token is the credential. */
export function confirmEmailChange(token: string): Promise<{ email: string }> {
  return api.post('/auth/confirm-email-change', { token }).then(r => r.data.data)
}

/* POST /auth/forgot-password — always succeeds visibly. */
export function forgotPassword(email: string): Promise<void> {
  return api.post('/auth/forgot-password', { email }).then(() => {/* no-op */})
}

/* POST /auth/reset-password */
export function resetPassword(token: string, password: string): Promise<void> {
  return api.post('/auth/reset-password', { token, password }).then(() => {/* no-op */})
}

/* POST /auth/verify-email */
export function verifyEmail(token: string): Promise<void> {
  return api.post('/auth/verify-email', { token }).then(() => {/* no-op */})
}

/* POST /auth/resend-verification (authenticated) */
export function resendVerification(): Promise<void> {
  return api.post('/auth/resend-verification').then(() => {/* no-op */})
}

/* ─── Active sessions ─────────────────────────────── */
export interface ActiveSession {
  id:          string
  userAgent?:  string
  ip?:         string
  lastUsedAt?: string
  createdAt:   string
  expiresAt:   string
  isCurrent:   boolean
}

export const sessionsKey = ['auth', 'sessions'] as const

export function useActiveSessions() {
  return useQuery({
    queryKey: sessionsKey,
    queryFn:  () => apiGet<ActiveSession[]>('/auth/sessions'),
    staleTime: 15_000,
  })
}

export function useRevokeSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await api.delete<{ success: true; data: { revokedCurrent: boolean } }>(`/auth/sessions/${id}`)
      return res.data.data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: sessionsKey }),
  })
}

/* ─── Account lifecycle ───────────────────────────── */

/* POST /auth/deactivate */
export function deactivateAccount(password: string): Promise<void> {
  return api.post('/auth/deactivate', { password }).then(() => {/* no-op */})
}

/* DELETE /auth/account */
export function deleteAccount(password: string): Promise<void> {
  return api.delete('/auth/account', { data: { password } }).then(() => {/* no-op */})
}
