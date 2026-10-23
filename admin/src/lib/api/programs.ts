'use client'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost, apiPatch } from '@/lib/axios'

/* Programs — a live class repeating weekly or monthly until an end date, for the picked students only
   (/admin/programs…, backend services/program.service.ts). */
export interface ProgramPerson { id: string; name: string; email: string }
export interface Program {
  id: string; title: string; description: string; status: 'active' | 'stopped'; source: 'lms' | 'portal'
  repeat: 'weekly' | 'monthly'; weekdays: number[]; monthDay: number | null; startDate: string; endDate: string
  time: string; timezone: string; durationMins: number; isOnline: boolean; location: string
  /** The shareable link — {student app}/p/{joinCode}: sign in, or a form for people without an LMS account. */
  joinCode?: string; joinUrl?: string
  mentor: ProgramPerson | null; coMentors?: ProgramPerson[]; meetingMode?: 'auto' | 'link' | 'app'; meetingUrl?: string; language?: string
  students: ProgramPerson[]; createdByName: string; createdByEmail: string
  classes: { id: string; startsAt: string; status: string }[]; nextClassAt: string | null; missing?: string[]
}
export interface ProgramInput {
  title: string; description?: string; repeat: 'weekly' | 'monthly'; weekdays?: number[]; monthDay?: number | null
  startDate: string; endDate: string; time: string; durationMins: number; isOnline: boolean; location?: string
  instructorId?: string; students: string[]
  /* Co-mentors (Meet co-hosts, see it, get the 10-minute WhatsApp); how it meets — a Meet room made per class,
     the admin's own Meet link, or the in-app stream. */
  coInstructorIds?: string[]; meetingMode?: 'auto' | 'link' | 'app'; meetingUrl?: string; language?: string
}

const KEY = ['admin', 'programs']
export const usePrograms = () => useQuery({ queryKey: KEY, queryFn: () => apiGet<Program[]>('/admin/programs'), staleTime: 15_000 })
export const useProgramStudentSearch = (q: string) => useQuery({
  queryKey: [...KEY, 'students', q], enabled: q.trim().length >= 2,
  queryFn: () => apiGet<ProgramPerson[]>(`/admin/programs/students?q=${encodeURIComponent(q.trim())}`),
})

/* The commission portal's teams and CS (each student's User.tetraCs), with counts — and a whole group's students. */
export interface ProgramAudiences { total: number; teams: { team: string; count: number }[]; cs: { name: string; team: string; count: number }[] }
export const useProgramAudiences = (enabled = true) => useQuery({
  queryKey: [...KEY, 'audiences'], enabled, staleTime: 60_000,
  queryFn: () => apiGet<ProgramAudiences>('/admin/programs/audiences'),
})
export const fetchProgramGroup = (pick: { team?: string; cs?: string; all?: boolean }) => {
  const q = new URLSearchParams()
  if (pick.team) q.set('team', pick.team)
  if (pick.cs) q.set('cs', pick.cs)
  if (pick.all) q.set('all', '1')
  return apiGet<ProgramPerson[]>(`/admin/programs/students?${q.toString()}`)
}

function useProgramMutation<I>(fn: (input: I) => Promise<Program>) {
  const qc = useQueryClient()
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: KEY }) })
}
export const useCreateProgram = () => useProgramMutation((input: ProgramInput) => apiPost<Program>('/admin/programs', input))
export const useChangeProgramStudents = () => useProgramMutation((v: { id: string; add?: string[]; remove?: string[] }) => apiPost<Program>(`/admin/programs/${v.id}/students`, { add: v.add, remove: v.remove }))
export const useRescheduleProgram = () => useProgramMutation((v: { id: string } & Partial<ProgramInput>) => apiPatch<Program>(`/admin/programs/${v.id}`, v))
export const useStopProgram = () => useProgramMutation((id: string) => apiPost<Program>(`/admin/programs/${id}/stop`))

/* Who filled in the programme link's form (people without an LMS account). */
export interface ProgramGuest { id: string; name: string; email: string; phone: string; joins: number; firstAt: string; lastJoinAt: string | null }
export const useProgramGuests = (id: string, enabled: boolean) => useQuery({
  queryKey: [...KEY, id, 'guests'], enabled, staleTime: 30_000,
  queryFn: () => apiGet<ProgramGuest[]>(`/admin/programs/${id}/guests`),
})
