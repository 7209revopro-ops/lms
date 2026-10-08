'use client'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost } from '@/lib/axios'

/* Mentor Calendar — every mentor's free hours, classes and booked sessions, and sessions booked from here
   (GET/POST /admin/mentor-calendar…, the same answer the portals' Mentor Calendar reads). */
export interface MentorSlot { dayOfWeek: number; startTime: string; endTime: string }
export interface MentorClass { id: string; title: string | null; startsAt: string; durationMins: number; status: string; booked: number; capacity: number; mine: boolean }
export interface MentorMeeting { id: string; title: string; kind: string; startsAt: string; durationMins: number; attendeeNames: string[]; bookedByEmail: string; inPerson: boolean; location: string }
export interface CalendarMentor { id: string; name: string; email: string; shared: boolean; slots: MentorSlot[]; classes: MentorClass[]; meetings: MentorMeeting[] }
export interface MentorCalendar { timezone: string; from: string; to: string; mentors: CalendarMentor[] }

export function useMentorCalendar(from: string, to: string) {
  return useQuery({
    queryKey: ['admin', 'mentor-calendar', from, to],
    queryFn: () => apiGet<MentorCalendar>(`/admin/mentor-calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
    staleTime: 30_000,
  })
}

export interface BookMeetingInput {
  mentorEmail: string; title: string; kind: 'staff' | 'student' | 'client'; scheduledStart: string; durationMins: number
  attendees: { name: string; email: string }[]; inPerson: boolean; location?: string; notes?: string
}
export function useBookMeeting() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: BookMeetingInput) => apiPost('/admin/mentor-calendar/meetings', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'mentor-calendar'] }),
  })
}
export function useCancelMeeting() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiPost(`/admin/mentor-calendar/meetings/${id}/cancel`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'mentor-calendar'] }),
  })
}
