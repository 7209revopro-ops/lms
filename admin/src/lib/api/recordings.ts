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
  organizationId: string | null
}

export const recordingKeys = {
  all:  ['admin', 'recordings'] as const,
  list: (p: { page: number; search: string }) => ['admin', 'recordings', p] as const,
}

export function useRecordings(page: number, search: string) {
  return useQuery({
    queryKey: recordingKeys.list({ page, search }),
    queryFn:  () => apiGet<RecordingRow[]>('/admin/recordings', {
      page, per_page: 20, ...(search ? { search } : {}),
    }),
    staleTime: 30_000,
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
