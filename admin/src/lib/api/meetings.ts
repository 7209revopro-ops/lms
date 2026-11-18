'use client'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/axios'

/* Mentor meetings on the Bookings page (2026-10-24) — GET /admin/meetings. The 1:1 / group meetings
   booked with mentors from the CS Portal or LMS admin's Mentor Calendar: participants, who
   booked them and from where. A mentor gets their own; anyone else their academy's. */

export type MeetingBucket = 'all' | 'upcoming' | 'today' | 'portal' | 'completed' | 'cancelled'
export interface MentorMeetingRow {
  id: string; title: string; kind: 'staff' | 'student' | 'client'
  scheduledStart: string; durationMins: number
  mentor: { id: string; name: string; email: string; avatarUrl?: string } | null
  attendees: { name: string; email: string | null }[]
  bookedByEmail: string; bookedVia: 'portal' | 'lms'
  isOnline: boolean; meetingUrl: string | null; location: string | null; notes: string | null
  status: 'upcoming' | 'live' | 'completed' | 'cancelled'
}
export type MeetingStats = Record<MeetingBucket, number>
export interface MeetingParams {
  dateFrom?: string; dateTo?: string; instructorId?: string; bucket?: MeetingBucket; search?: string; page?: number; per_page?: number
}

export function useMentorMeetings(params: MeetingParams) {
  return useQuery({
    queryKey: ['admin', 'meetings', params],
    queryFn: async () => {
      const res = await api.get<{ data: { items: MentorMeetingRow[]; stats: MeetingStats }; meta?: { total_count: number; total_pages: number } }>(
        '/admin/meetings', { params: Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== '')) })
      return { ...res.data.data, meta: res.data.meta }
    },
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })
}

/* ── The Live Classes week / day calendar (2026-11-18) ─────────────────────────────────────────────────────────────
   Every meeting in a span, not a page of them: /admin/meetings answers 200 at a time, so this walks the pages (a week
   of an academy is a few dozen). Cancelled ones are left out — the calendar shows what still takes the hour. */
export function useMeetingsBetween(from: string, to: string, opts: { enabled: boolean }) {
  return useQuery({
    queryKey: ['admin', 'meetings', 'between', from, to],
    enabled: opts.enabled && !!from && !!to,
    queryFn: async () => {
      const out: MentorMeetingRow[] = []
      for (let page = 1; page <= 10; page++) {
        const res = await api.get<{ data: { items: MentorMeetingRow[] }; meta?: { total_pages: number } }>(
          '/admin/meetings', { params: { dateFrom: from, dateTo: to, per_page: 200, page } })
        out.push(...res.data.data.items)
        if (page >= (res.data.meta?.total_pages ?? 1)) break
      }
      return out.filter(m => m.status !== 'cancelled')
    },
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    refetchInterval: 60_000,
    /* No Bookings permission, or an older server: the classes still show — only the meetings are missing. */
    retry: false,
  })
}

/* One meeting as its editor sees it — GET /admin/mentor-calendar/meetings/:id. 404 when the caller may not change it
   (a mentor, a meeting somebody else booked). */
export interface MeetingDetail {
  id: string; title: string; kind: 'staff' | 'student' | 'client'; startsAt: string; durationMins: number
  meetingUrl: string; inPerson: boolean; location: string; notes: string
  mentorName: string; mentorEmail: string; bookedByEmail: string
  attendees: { name: string; email: string }[]; staff?: { name: string; email: string }[]
}
export function useMeetingDetail(id: string | null) {
  return useQuery({
    queryKey: ['admin', 'meetings', 'detail', id],
    enabled: !!id,
    queryFn: async () => (await api.get<{ data: MeetingDetail }>(`/admin/mentor-calendar/meetings/${encodeURIComponent(id!)}`)).data.data,
    retry: false,
  })
}

/* Move or change a meeting — PATCH /admin/mentor-calendar/meetings/:id. Unsaid fields stay as they are. A new time,
   title or place emails the mentor and everyone in it (portal.service.ts updateMentorMeetingForPortal). */
export interface MeetingChange {
  title?: string; scheduledStart?: string; durationMins?: number
  inPerson?: boolean; location?: string; meetingUrl?: string; notes?: string
}
export function useUpdateMeeting() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...change }: MeetingChange & { id: string }) =>
      (await api.patch<{ data: { notified: boolean; linkNote: string | null } }>(`/admin/mentor-calendar/meetings/${encodeURIComponent(id)}`, change)).data.data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'meetings'] })
      qc.invalidateQueries({ queryKey: ['admin', 'mentor-calendar'] })
      qc.invalidateQueries({ queryKey: ['mentor-meetings'] })
    },
  })
}
