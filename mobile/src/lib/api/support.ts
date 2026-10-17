import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost } from '../http'

/* Help & support — the website's support tickets (/support): the student's
   requests, each a thread with the support team. */

export type SupportStatus = 'open' | 'pending' | 'resolved' | 'closed'
export type SupportCategory = 'technical' | 'billing' | 'course' | 'account' | 'other'
export const SUPPORT_CATEGORIES: SupportCategory[] = ['account', 'course', 'technical', 'billing', 'other']

export interface SupportMessage {
  _id?: string
  senderRole: 'student' | 'instructor' | 'admin'
  body: string
  createdAt: string
}

export interface SupportTicket {
  id: string
  subject: string
  category: SupportCategory
  status: SupportStatus
  messages: SupportMessage[]
  lastMessageAt: string
  userUnread: boolean
}

const keys = {
  mine: ['support', 'mine'] as const,
  one:  (id: string) => ['support', id] as const,
}

export function useMyTickets() {
  return useQuery({ queryKey: keys.mine, queryFn: () => apiGet<SupportTicket[]>('/support/me'), staleTime: 15_000 })
}

/** One request; opening it marks the team's reply read. Polls while open. */
export function useTicket(id: string) {
  const qc = useQueryClient()
  return useQuery({
    queryKey: keys.one(id),
    queryFn: async () => {
      const t = await apiGet<SupportTicket>(`/support/${id}`)
      void qc.invalidateQueries({ queryKey: keys.mine })
      return t
    },
    refetchInterval: 20_000,
  })
}

export function useCreateTicket() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { subject: string; category: SupportCategory; message: string }) => apiPost<SupportTicket>('/support', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.mine }),
  })
}

export function useReply(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: string) => apiPost<SupportTicket>(`/support/${id}/messages`, { body }),
    onSuccess: t => {
      qc.setQueryData(keys.one(id), t)
      void qc.invalidateQueries({ queryKey: keys.mine })
    },
  })
}
