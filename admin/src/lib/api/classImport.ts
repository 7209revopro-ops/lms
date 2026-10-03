'use client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/axios'

/* Mirrors backend/src/services/classImport.service.ts */
export type ImportPlatform = 'meet' | 'inapp'
export type OccurrenceState = 'new' | 'exists' | 'conflict' | 'past'

export interface ImportSettings {
  courseId:        string
  startDate:       string
  weeks:           number
  capacity:        number
  language:        string
  titleLabel?:     string
  location?:       string
  room?:           string
  defaultPlatform: ImportPlatform
}

export interface RowOverride { include?: boolean; platform?: ImportPlatform; instructorId?: string }

export interface PreviewRow {
  rowNumber:    number
  sessionKey:   string
  sessionId:    string
  day:          string
  startLabel:   string
  endLabel:     string
  durationMins: number
  mentorName:   string
  instructor:   { id: string; name: string } | null
  /* 'staff': matched a staff account that is not an instructor — always flagged. */
  matchedBy:    'email' | 'exact' | 'first-name' | 'staff' | 'manual' | null
  /* Optional: a backend from before modules sends none of these, and the
     preview then simply has no module picker. */
  /** Batch + session number, e.g. "MBT 7" — a module pick applies to every row with it. */
  code?:        string
  /** The course the classes go into: the one that owns the module. */
  course?:      { id: string; title: string }
  /** The course module the classes go into; null = none (General sessions). */
  module?:      { id: string; title: string } | null
  moduleFrom?:  'sheet' | 'name' | 'none' | null
  title:        string
  mode:         'hybrid' | 'online' | 'offline'
  platform:     ImportPlatform | null
  location?:    string
  room?:        string
  status:       'ready' | 'warning' | 'error'
  messages:     string[]
  occurrences:  Array<{ dateKey: string; startISO: string; label: string; state: OccurrenceState; note?: string }>
  newCount:     number
  include:      boolean
}

export interface PreviewResult {
  course:      { id: string; title: string }
  /** Every course a row may go to — the chosen one first — with its modules. */
  courses?:    Array<{ id: string; title: string; modules: Array<{ id: string; title: string }> }>
  academy:     { slug: string | null; zone: string; tag: string }
  instructors: Array<{ id: string; name: string; email: string; role: string }>
  /** The course's modules, in course order — what the module picker offers. */
  modules?:    Array<{ id: string; title: string }>
  rows:        PreviewRow[]
  settingsErrors: string[]
  summary: {
    rows: number; ready: number; warnings: number; errors: number
    classes: number; meet: number; inapp: number; offline: number
    mentors: number; courses?: number; firstDate: string | null; lastDate: string | null
  }
}

export interface ImportJobStatus {
  id: string
  status: 'running' | 'completed' | 'interrupted' | 'undone'
  running: boolean
  fileName?: string
  courseId: string
  total: number; done: number; created: number; skipped: number; failed: number
  failures: Array<{ title: string; dateKey: string; error: string }>
  startedAt: string; finishedAt: string | null; undoneAt: string | null
}

export interface ImportJobListItem {
  id: string; status: ImportJobStatus['status']; fileName: string; course: string; courses?: number
  total: number; created: number; skipped: number; failed: number
  startedAt: string; finishedAt: string | null; undoneAt: string | null
}

export interface ImportPayload {
  settings:   ImportSettings
  rows:       Array<Record<string, string>>
  overrides?: Record<string, RowOverride>
  fileName?:  string
}

export const importKeys = {
  all:  ['admin', 'class-import'] as const,
  list: ['admin', 'class-import', 'list'] as const,
  job:  (id: string) => ['admin', 'class-import', 'job', id] as const,
}

/* Preview is a POST (it carries the whole sheet) but writes nothing. */
export function usePreviewImport() {
  return useMutation({
    mutationFn: async (p: ImportPayload) =>
      (await api.post<{ success: true; data: PreviewResult }>('/admin/live-classes/import/preview', p)).data.data,
  })
}

export function useStartImport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (p: ImportPayload) =>
      (await api.post<{ success: true; data: { jobId: string; total: number } }>('/admin/live-classes/import', p)).data.data,
    onSuccess: () => { void qc.invalidateQueries({ queryKey: importKeys.list }) },
  })
}

/* Polls while the import is running; stops once it settles. */
export function useImportJob(jobId: string | null) {
  return useQuery({
    queryKey: importKeys.job(jobId ?? ''),
    queryFn: async () =>
      (await api.get<{ success: true; data: ImportJobStatus }>(`/admin/live-classes/import/${jobId}`)).data.data,
    enabled: !!jobId,
    refetchInterval: (q) => (q.state.data?.running || q.state.data?.status === 'running' ? 1500 : false),
  })
}

export function useImportJobs() {
  return useQuery({
    queryKey: importKeys.list,
    queryFn: async () =>
      (await api.get<{ success: true; data: ImportJobListItem[] }>('/admin/live-classes/import')).data.data,
  })
}

export function useResumeImport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (jobId: string) =>
      (await api.post<{ success: true; data: ImportJobStatus }>(`/admin/live-classes/import/${jobId}/resume`)).data.data,
    onSuccess: (d) => {
      qc.setQueryData(importKeys.job(d.id), d)
      void qc.invalidateQueries({ queryKey: importKeys.all })
    },
  })
}

export function useUndoImport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (jobId: string) =>
      (await api.post<{ success: true; data: { deleted: number; kept: number } }>(`/admin/live-classes/import/${jobId}/undo`)).data.data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: importKeys.all })
      void qc.invalidateQueries({ queryKey: ['admin', 'live-classes'] })
    },
  })
}
