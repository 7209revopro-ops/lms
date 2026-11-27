'use client'
import { useMutation, useQuery } from '@tanstack/react-query'
import { api, apiGet } from '@/lib/axios'

/* Class recordings.
 *
 * The LMS stores a recording ID, never a URL. A playback link is minted on
 * demand and expires, so a link that leaked out of an inbox or a screenshot
 * stops working — and every mint is audited, which is what makes "who watched
 * this class" an answerable question.
 */

export interface RecordingRow {
  id:             string
  title:          string
  scheduledStart: string
  endedAt:        string | null
  durationMins:   number
  recordingSecs:  number | null
  /** The classroom's recording, played through a minted link; null for the others. */
  cltRecordingId: number | null
  /** A Google Meet recording in Drive, or the in-app stream's — opened as it is (2026-11-18). Absent on a classroom one. */
  recordingUrl?:  string | null
  course:     { id: string; title: string } | null
  instructor: { id: string; name: string } | null
  section?:   { id: string; title: string } | null
  language?:  string
  organizationId: string | null
}

/* The page's filters (2026-11-27) — every one optional, kept in the address bar by the page. */
export interface RecordingFilters {
  search: string; courseId: string; sectionId: string; language: string; instructorId: string; from: string; to: string
}

export interface RecordingFilterChoices {
  courses: { id: string; title: string }[]
  instructors: { id: string; name: string }[]
  sections: { id: string; title: string }[]
  languages: string[]
}

export const recordingKeys = {
  all:     ['admin', 'recordings'] as const,
  list:    (p: { page: number } & RecordingFilters) => ['admin', 'recordings', p] as const,
  choices: (courseId: string) => ['admin', 'recordings', 'filters', courseId] as const,
}

const present = (f: RecordingFilters) =>
  Object.fromEntries(Object.entries(f).filter(([, v]) => v !== '')) as Partial<RecordingFilters>

/** One page of recordings and how many there are in all for these filters. */
export function useRecordings(page: number, filters: RecordingFilters) {
  return useQuery({
    queryKey: recordingKeys.list({ page, ...filters }),
    queryFn:  async () => {
      const res = await api.get<{ success: true; data: RecordingRow[]; meta?: { total_count?: number } }>('/admin/recordings', {
        params: { page, per_page: 20, ...present(filters) },
      })
      return { rows: res.data.data, total: res.data.meta?.total_count ?? null }
    },
    staleTime: 30_000,
  })
}

/** What the filters can offer: only courses, modules, mentors and languages that have a recording. */
export function useRecordingFilterChoices(courseId: string) {
  return useQuery({
    queryKey: recordingKeys.choices(courseId),
    queryFn:  () => apiGet<RecordingFilterChoices>('/admin/recordings/filters', courseId ? { courseId } : undefined),
    staleTime: 5 * 60_000,
  })
}

/** Mint a fresh playback link. Deliberately a mutation, not a query: it has a
 *  server-side effect (an audit entry) and must never be replayed from cache. */
export function useRecordingPlayback() {
  return useMutation({
    mutationFn: async (liveClassId: string) => {
      const res = await api.post<{ success: true; data: { url: string; expiresIn?: number } }>(
        `/admin/recordings/${liveClassId}/playback`,
      )
      return res.data.data
    },
  })
}
