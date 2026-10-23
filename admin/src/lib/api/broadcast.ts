'use client'
import { useQuery, useMutation } from '@tanstack/react-query'
import { api } from '@/lib/axios'

export type Audience = 'course' | 'session'
export interface SendableTemplate {
  name: string; label: string; body: string | null; params: string[]; defaults: string[]
  button: string | null; note: string | null
}
export interface BroadcastInput {
  audience: Audience; courseId?: string; liveClassId?: string; organizationId?: string; sectionId?: string
  whatsapp?: { template: string; values: string[] }
  email?: { subject: string; body: string }
}
export interface BroadcastPreview {
  total: number
  whatsapp: { willSend: number; noPhone: number } | null
  email: { willSend: number; noEmail: number } | null
  sample: { name: string; whatsapp: { label: string; text?: string; values: Array<{ name: string; value: string }>; button?: string } | null; email: { subject: string; body: string } | null } | null
  names: string[]
  course: string; class: string | null
}

export function useSendableTemplates(audience: Audience) {
  return useQuery({
    queryKey: ['admin', 'messages', 'templates', audience],
    queryFn: async () => (await api.get<{ success: true; data: SendableTemplate[] }>('/admin/messages/templates', { params: { audience } })).data.data,
    staleTime: 5 * 60_000,
  })
}

export const previewBroadcast = async (input: BroadcastInput) =>
  (await api.post<{ success: true; data: BroadcastPreview }>('/admin/messages/preview', input)).data.data

export function useSendBroadcast() {
  return useMutation({
    mutationFn: async (input: BroadcastInput) =>
      (await api.post<{ success: true; data: { total: number; whatsapp: number; email: number } }>('/admin/messages/send', input)).data.data,
  })
}
