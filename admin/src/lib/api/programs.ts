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
  mentor: ProgramPerson | null; students: ProgramPerson[]; createdByName: string; createdByEmail: string
  classes: { id: string; startsAt: string; status: string }[]; nextClassAt: string | null; missing?: string[]
}
export interface ProgramInput {
  title: string; description?: string; repeat: 'weekly' | 'monthly'; weekdays?: number[]; monthDay?: number | null
  startDate: string; endDate: string; time: string; durationMins: number; isOnline: boolean; location?: string
  instructorId?: string; students: string[]
}

const KEY = ['admin', 'programs']
export const usePrograms = () => useQuery({ queryKey: KEY, queryFn: () => apiGet<Program[]>('/admin/programs'), staleTime: 15_000 })
export const useProgramStudentSearch = (q: string) => useQuery({
  queryKey: [...KEY, 'students', q], enabled: q.trim().length >= 2,
  queryFn: () => apiGet<ProgramPerson[]>(`/admin/programs/students?q=${encodeURIComponent(q.trim())}`),
})

function useProgramMutation<I>(fn: (input: I) => Promise<Program>) {
  const qc = useQueryClient()
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: KEY }) })
}
export const useCreateProgram = () => useProgramMutation((input: ProgramInput) => apiPost<Program>('/admin/programs', input))
export const useChangeProgramStudents = () => useProgramMutation((v: { id: string; add?: string[]; remove?: string[] }) => apiPost<Program>(`/admin/programs/${v.id}/students`, { add: v.add, remove: v.remove }))
export const useRescheduleProgram = () => useProgramMutation((v: { id: string } & Partial<ProgramInput>) => apiPatch<Program>(`/admin/programs/${v.id}`, v))
export const useStopProgram = () => useProgramMutation((id: string) => apiPost<Program>(`/admin/programs/${id}/stop`))
