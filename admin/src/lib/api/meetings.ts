'use client'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api } from '@/lib/axios'

/* Mentor meetings on the Bookings page (2026-10-24) — GET /admin/meetings. The 1:1 / group meetings
   booked with mentors from the commission portal or LMS admin's Mentor Calendar: participants, who
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
