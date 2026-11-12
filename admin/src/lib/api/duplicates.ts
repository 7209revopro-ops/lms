'use client'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { api, apiGet, apiPost, apiDelete } from '@/lib/axios'

/* Duplicate student accounts — found by a shared phone number, merged into
   one by a super admin (backend services/accountMerge.service.ts). */

export type Confidence = 'high' | 'medium' | 'low'
export type Side = 'primary' | 'secondary'
export type PickGroup = 'name' | 'phone' | 'photo' | 'registration' | 'academy' | 'approval'
export type Picks = Partial<Record<PickGroup, Side>>

export interface DuplicateAccount {
  id: string; name: string; email: string; phone: string; avatarUrl?: string
  isActive: boolean; isVerified: boolean; enrollmentStatus?: string; signupType?: string
  organizationId?: string; lastLoginAt?: string; createdAt?: string
}
export interface DuplicateGroup { key: string; phone: string; confidence: Confidence; reasons: string[]; accounts: DuplicateAccount[]; dismissed?: boolean }

export interface CompareAccount extends DuplicateAccount {
  /** Addresses saved on this account from earlier merges. */
  secondaryEmails: string[]
  counts: Record<string, number>
  categories: string[]
  details: Record<PickGroup, string>
}
export interface CompareResult { accounts: CompareAccount[]; suggestedPrimaryId: string; countLabels: Record<string, string> }

export interface PlanItem { model: string; label: string; moved: number; dropped: number; kept: string[] }
export interface PreviewResult { items: PlanItem[]; picks: Picks; result: Record<PickGroup, string>; categories: string[] }

export interface MergeRecord {
  id: string; primaryId: string; secondaryId: string; primaryEmail: string; secondaryEmail: string
  /** The closed account's email was saved on the kept one as a secondary email. */
  keptSecondaryEmail?: boolean
  summary: { label: string; moved: number; dropped: number }[]
  status: 'running' | 'done' | 'failed' | 'undone'; error?: string; mergedByEmail?: string
  undoneAt?: string; undoNotes?: string[]; createdAt: string
  /** CS Portal (2026-11-12): merged here, or asked for by CS Portal; whether CS Portal followed. */
  origin?: 'lms' | 'cs_portal'
  csPortal?: { state: string; action?: string | null; error?: string | null; csFrom?: string | null } | null
  csPortalUndo?: { state: string; error?: string | null } | null
}

/** Who the two accounts are in CS Portal, and what merging them does there. */
export interface CsPortalStudent { id: string; code: string; name: string; cs: string; team: string; open: boolean; deposits: number }
export interface CsPortalPreview {
  linked: boolean
  action?: 'merge' | 'relink' | 'nothing'
  primary?: CsPortalStudent | null
  secondary?: CsPortalStudent | null
  sameCs?: boolean
  unavailable?: string
}

const KEYS = {
  all:     ['admin', 'duplicates'] as const,
  list:    (dismissed: boolean) => ['admin', 'duplicates', 'list', dismissed] as const,
  compare: (ids: string[]) => ['admin', 'duplicates', 'compare', ...ids] as const,
  preview: (p: string, s: string, picks: Picks) => ['admin', 'duplicates', 'preview', p, s, picks] as const,
  merges:  (page: number) => ['admin', 'duplicates', 'merges', page] as const,
}

export function useDuplicateGroups(dismissed = false) {
  return useQuery({
    queryKey: KEYS.list(dismissed),
    queryFn:  () => apiGet<{ groups: DuplicateGroup[]; dismissed: number }>('/admin/duplicates', dismissed ? { dismissed: '1' } : undefined),
    staleTime: 0,
  })
}

export function useCompareAccounts(ids: string[] | null) {
  return useQuery({
    queryKey: KEYS.compare(ids ?? []),
    queryFn:  () => apiGet<CompareResult>('/admin/duplicates/compare', { ids: (ids ?? []).join(',') }),
    enabled:  !!ids && ids.length === 2,
    /* Not refreshed under the admin while they are deciding — reopening the review reloads it. */
    staleTime: Infinity, refetchOnWindowFocus: false, gcTime: 0,
  })
}

export function useMergePreview(primaryId: string | null, secondaryId: string | null, picks: Picks) {
  return useQuery({
    queryKey: KEYS.preview(primaryId ?? '', secondaryId ?? '', picks),
    queryFn:  () => apiPost<PreviewResult>('/admin/duplicates/preview', { primaryId, secondaryId, picks }),
    enabled:  !!primaryId && !!secondaryId,
    placeholderData: keepPreviousData,
    staleTime: Infinity, refetchOnWindowFocus: false, gcTime: 0,
  })
}

export function useCsPortalPreview(primaryId: string | null, secondaryId: string | null) {
  return useQuery({
    queryKey: ['admin', 'duplicates', 'cs-portal', primaryId ?? '', secondaryId ?? ''] as const,
    queryFn:  () => apiPost<CsPortalPreview>('/admin/duplicates/cs-portal', { primaryId, secondaryId }),
    enabled:  !!primaryId && !!secondaryId,
    staleTime: Infinity, refetchOnWindowFocus: false, gcTime: 0,
  })
}

export function useMergeAccounts() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { primaryId: string; secondaryId: string; picks: Picks; confirmEmail: string; keepSecondaryEmail: boolean; csFrom?: Side; otherCsAsCommon?: boolean }) =>
      apiPost<{ mergeId: string; primaryId: string; secondaryEmail: string; keptSecondaryEmail: boolean; items: PlanItem[] }>('/admin/duplicates/merge', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.all })
      qc.invalidateQueries({ queryKey: ['admin', 'users'] })
    },
  })
}

export function useDismissGroup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (userIds: string[]) => apiPost<{ key: string }>('/admin/duplicates/dismiss', { userIds }),
    onSuccess:  () => qc.invalidateQueries({ queryKey: KEYS.all }),
  })
}

export function useUndismissGroup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (key: string) => apiDelete<{ key: string }>(`/admin/duplicates/dismiss/${encodeURIComponent(key)}`),
    onSuccess:  () => qc.invalidateQueries({ queryKey: KEYS.all }),
  })
}

export function useMergeHistory(page = 1) {
  return useQuery({
    queryKey: KEYS.merges(page),
    queryFn: async () => {
      const res = await api.get<{ success: true; data: MergeRecord[]; meta: { total_count: number; total_pages: number; page: number } }>(
        '/admin/duplicates/merges', { params: { page, per_page: 20 } })
      return res.data
    },
    staleTime: 0,
  })
}

export function useUndoMerge() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (mergeId: string) => apiPost<{ notes: string[] }>(`/admin/duplicates/merges/${mergeId}/undo`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.all })
      qc.invalidateQueries({ queryKey: ['admin', 'users'] })
    },
  })
}
