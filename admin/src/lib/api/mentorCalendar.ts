'use client'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost, apiDelete } from '@/lib/axios'

/* Mentor Calendar — every mentor's free hours, classes and booked sessions, and sessions booked from here
   (GET/POST /admin/mentor-calendar…, the same answer the portals' Mentor Calendar reads). */
export interface MentorSlot { dayOfWeek: number; startTime: string; endTime: string }
export interface MentorClass {
  id: string; title: string | null; startsAt: string; durationMins: number; status: string; booked: number; capacity: number; mine: boolean
  /** The course and module it is a class of — this academy's classes only; absent from an older server. */
  courseId?: string | null; course?: string | null; moduleId?: string | null; module?: string | null
}
export interface MentorMeeting { id: string; title: string; kind: string; startsAt: string; durationMins: number; attendeeNames: string[]; bookedByEmail: string; inPerson: boolean; location: string }
/* A mentor's time off (2026-10-23): nothing is booked with them inside it, from any portal. The reason only for the
   mentor and the admins — null for everyone else. */
export interface MentorTimeOff { id: string; mentorId: string; startsAt: string; endsAt: string; allDay: boolean; reason: string | null; createdByName: string }
export interface CalendarMentor {
  id: string; name: string; email: string; shared: boolean; slots: MentorSlot[]; classes: MentorClass[]; meetings: MentorMeeting[]
  /** Absent from an older server. */
  timeOff?: MentorTimeOff[]
}
export interface MentorCalendar { timezone: string; from: string; to: string; mentors: CalendarMentor[] }

export function useMentorCalendar(from: string, to: string) {
  return useQuery({
    queryKey: ['admin', 'mentor-calendar', from, to],
    queryFn: () => apiGet<MentorCalendar>(`/admin/mentor-calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
    staleTime: 30_000,
  })
}

/* One class with its Info — who booked, cancelled, joined and reviewed, and when it started and ended (2026-10-09). */
export interface ClassInfoStudent { name: string; status: string; bookedAt: string; cancelledAt: string; joinedAt: string; review: { rating: number; comment: string; at: string } | null }
export interface ClassInfoEvent { at: string; kind: string; who: string; rating?: number; comment?: string }
export interface MentorClassInfo {
  id: string; title: string; courseTitle: string; instructorName: string; startsAt: string; durationMins: number; status: string
  booked: number; capacity: number; timezone: string; students?: ClassInfoStudent[]; timeline?: ClassInfoEvent[]
  /** Its HRMS meeting pod (2026-10-18); absent from an older server. */
  pod?: { state: 'booked' | 'no_room' | 'error'; roomName?: string } | null
}
export function useMentorClass(id: string | null) {
  return useQuery({
    queryKey: ['admin', 'mentor-calendar', 'class', id],
    queryFn: () => apiGet<MentorClassInfo>(`/admin/mentor-calendar/classes/${encodeURIComponent(id!)}`),
    enabled: !!id,
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

/* ── Time off (2026-10-23) ─────────────────────────────────────────────────────────────────────────────────────────
   The caller's own (/admin/time-off/me), or — an admin — any mentor's (/admin/mentors/:id/time-off). Marking it tells
   back what was already booked inside it; nothing of that is cancelled. */
export interface TimeOffInput { startsAt: string; endsAt: string; allDay: boolean; reason?: string }
export interface AlreadyBooked { kind: 'class' | 'meeting'; id: string; title: string; startsAt: string; durationMins: number }
export interface TimeOffMarked { timeOff: MentorTimeOff; mentor: { id: string; name: string; email: string }; alreadyBooked: AlreadyBooked[] }

const timeOffBase = (mentorId: string | 'me') => (mentorId === 'me' ? '/admin/time-off/me' : `/admin/mentors/${mentorId}/time-off`)

export function useTimeOff(mentorId: string | 'me') {
  return useQuery({
    queryKey: ['admin', 'time-off', mentorId],
    queryFn: () => apiGet<MentorTimeOff[]>(timeOffBase(mentorId)),
    staleTime: 30_000,
  })
}
export function useMarkTimeOff() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ mentorId, ...input }: TimeOffInput & { mentorId: string | 'me' }) => apiPost<TimeOffMarked>(timeOffBase(mentorId), input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'mentor-calendar'] })
      qc.invalidateQueries({ queryKey: ['admin', 'time-off'] })
    },
  })
}
export function useRemoveTimeOff() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ mentorId, id }: { mentorId: string | 'me'; id: string }) => apiDelete(`${timeOffBase(mentorId)}/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'mentor-calendar'] })
      qc.invalidateQueries({ queryKey: ['admin', 'time-off'] })
    },
  })
}

/** An academy wall-clock date and time in `tz` as an instant — whatever zone the browser itself is in. */
export function wallInZone(date: string, time: string, tz: string): Date {
  const guess = new Date(`${date}T${time}:00Z`)
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(guess)
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value ?? 0)
  // What that instant reads as on the zone's clock, taken as if it were UTC: the difference is the zone's offset.
  const asIfUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'))
  return new Date(guess.getTime() - (asIfUtc - guess.getTime()))
}

/** "Fri 24 Oct, 14:00–18:00", "Fri 24 Oct (all day)", "Fri 24 – Sun 26 Oct". */
export function timeOffLabel(t: Pick<MentorTimeOff, 'startsAt' | 'endsAt' | 'allDay'>, tz: string): string {
  const day = (d: Date) => d.toLocaleDateString('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' })
  const hm = (d: Date) => d.toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false })
  const a = new Date(t.startsAt), b = new Date(t.endsAt)
  if (t.allDay) {
    const last = new Date(b.getTime() - 1)
    return day(a) === day(last) ? `${day(a)} (all day)` : `${day(a)} – ${day(last)}`
  }
  return day(a) === day(b) ? `${day(a)}, ${hm(a)}–${hm(b)}` : `${day(a)}, ${hm(a)} – ${day(b)}, ${hm(b)}`
}

/** What the LMS said when it refused — "HAFFIS is not available then …" — rather than axios's "status code 409". */
export const refusal = (e: unknown, fallback: string) =>
  String((e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? (e as Error)?.message ?? fallback)
