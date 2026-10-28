'use client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/axios'

/* How a student meeting went (2026-10-27) — the signed-in mentor's meetings waiting for it, the form's lists, and
   filling one (backend meetingOutcome.service.ts). The same meeting may be filled in CS Portal: the first counts. */

export type OutcomeStage = 'interested' | 'follow_up' | 'meeting_with' | 'revision' | 'not_interested'
export interface PendingMeeting {
  id: string; title: string; category: string; startsAt: string; endsAt: string; durationMins: number
  inPerson: boolean; location: string; attendees: { name: string; email: string }[]; bookedByEmail: string
  /** What the last meeting with them said about the client — step 2 starts from it. */
  lastProfile: ClientProfile | null
}
export interface ClientProfile {
  experience: 'fresher' | 'beginner' | 'expert' | ''; years: number | string | null
  hadLosses: boolean | null; lossAmount: number | string | null; lossCurrency: string; lossHow: string[]
  country: string; familyInDubai: boolean | null; occupation: string
}
export interface OutcomeOptions {
  stages: OutcomeStage[]; followUpKinds: string[]; paymentModes: string[]; notInterestedReasons: string[]
  experience: string[]; lossWays: string[]; lossCurrencies: string[]
  courses: { id: string; title: string; modules: { id: string; title: string }[] }[]
  mentors: { id: string; name: string; email: string }[]
}
export interface OutcomeInput {
  stage: OutcomeStage; remark: string; concern: string; profile?: ClientProfile
  courseId?: string; paymentDate?: string; paymentMode?: string
  followUpKind?: string; followUpDate?: string
  withMentorEmail?: string; moduleId?: string; reason?: string
}

export function usePendingMeetingOutcomes(enabled: boolean) {
  return useQuery({
    queryKey: ['admin', 'meeting-outcomes', 'pending'],
    queryFn: async () => (await api.get<{ data: { meetings: PendingMeeting[] } }>('/admin/meeting-outcomes/pending')).data.data.meetings,
    enabled,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  })
}

export function useMeetingOutcomeOptions(enabled: boolean) {
  return useQuery({
    queryKey: ['admin', 'meeting-outcomes', 'options'],
    queryFn: async () => (await api.get<{ data: OutcomeOptions }>('/admin/meeting-outcomes/options')).data.data,
    enabled,
    staleTime: 10 * 60_000,
  })
}

export function useSaveMeetingOutcome() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...body }: OutcomeInput & { id: string }) => (await api.post(`/admin/meeting-outcomes/${id}`, body)).data,
    onSettled: () => qc.invalidateQueries({ queryKey: ['admin', 'meeting-outcomes', 'pending'] }),
  })
}
