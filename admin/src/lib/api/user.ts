'use client'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, api } from '@/lib/axios'

/* ── Staff email-notification preferences ───────────────
   Opt-out model: a key that is absent means "send". The one exception is
   role-aware — sub_admin and support opt IN to the two admin alerts (they were
   never recipients before), which `effectiveEmailPref` below mirrors from the
   backend helper in backend/src/utils/emailPrefs.ts. */
export const STAFF_EMAIL_CATEGORIES = [
  'enrollmentRequest', 'deviceApproval', 'classScheduled', 'classReminder', 'assignmentSubmitted',
] as const
export type StaffEmailCategory = typeof STAFF_EMAIL_CATEGORIES[number]

export interface EmailPrefs {
  masterEnabled?: boolean
  categories?: Partial<Record<StaffEmailCategory, boolean>>
}

const ADMIN_ALERT_CATEGORIES = new Set<string>(['enrollmentRequest', 'deviceApproval'])
const OPT_IN_ROLES           = new Set<string>(['sub_admin', 'support'])

/** The category's own on/off value, ignoring the master switch (which the UI
    renders separately as a disabled state rather than flipping every row). */
export function effectiveEmailPref(
  user: { role?: string; emailPrefs?: EmailPrefs } | undefined,
  category: StaffEmailCategory,
): boolean {
  const explicit = user?.emailPrefs?.categories?.[category]
  if (typeof explicit === 'boolean') return explicit
  return !(ADMIN_ALERT_CATEGORIES.has(category) && OPT_IN_ROLES.has(user?.role ?? ''))
}

export interface CurrentAdmin {
  id:              string
  name:            string
  email:           string
  avatarUrl?:      string
  role:            'student' | 'instructor' | 'admin' | 'sub_admin' | 'support' | 'super_admin'
  organizationId?: string
  program?:        'ai' | 'digital_marketing' | 'forex' | 'jura'
  headline?:       string
  bio?:            string
  isVerified:      boolean
  isActive:        boolean
  emailPrefs?:     EmailPrefs
  createdAt:       string
  updatedAt:       string
}

export const userKeys = {
  me: ['auth', 'me'] as const,
}

export function useCurrentUser() {
  return useQuery({
    queryKey: userKeys.me,
    queryFn:  async () => {
      const data = await apiGet<{ user: CurrentAdmin }>('/admin/auth/me')
      return data.user
    },
    retry: false,
    staleTime: 60_000,
  })
}

/** Patch only the keys you want to change — the server merges, so toggling one
    category never clobbers the others. */
export function useUpdateEmailPrefs() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (patch: EmailPrefs) => {
      const res = await api.patch<{ data: EmailPrefs }>('/admin/auth/me/email-preferences', patch)
      return res.data?.data
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: userKeys.me }) },
  })
}

export function logout(): Promise<void> {
  return api.post('/admin/auth/logout').then(() => {/* no-op */}).catch(() => {/* best-effort */})
}
