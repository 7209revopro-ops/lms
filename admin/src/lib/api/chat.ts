'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/axios'

/* Admin side of the chat — plan.md §11. Instructors reply to students who
   wrote to them; a super admin reads everything, read-only. Polling (§11.3):
   an open thread fetches only messages newer than the newest on screen. */

export interface ChatMessage {
  id: string; senderRole: 'student' | 'instructor'; body: string; createdAt: string
  clientMsgId?: string; pending?: boolean; failed?: boolean
  /** Client-only: a refusal no retry can fix (403/404/409/422) — no "tap to retry". */
  fatal?: boolean
}
export interface ChatPerson { id: string; name: string; avatarUrl?: string; email?: string }
export interface ChatConversation {
  id: string; student: ChatPerson | null; instructor: ChatPerson | null
  lastMessageAt: string; lastMessagePreview: string; lastSenderRole: 'student' | 'instructor'
  unread: number; studentUnread?: number; instructorUnread?: number
}
interface ConversationPage { items: ChatConversation[]; nextCursor: string | null }

export const chatKeys = {
  staffList:   ['admin', 'chat', 'staff', 'conversations'] as const,
  staffUnread: ['admin', 'chat', 'staff', 'unread'] as const,
  oversight:   ['admin', 'chat', 'oversight', 'conversations'] as const,
  oversightInstructors: ['admin', 'chat', 'oversight', 'instructors'] as const,
}

const LIST_POLL = 15_000
const get = async <T,>(url: string, params?: Record<string, unknown>) => (await api.get<{ data: T }>(url, { params })).data.data
const post = async <T,>(url: string, body?: unknown) => (await api.post<{ data: T }>(url, body)).data.data
const no4xxRetry = (n: number, err: any) => !(err?.response?.status >= 400 && err?.response?.status < 500) && n < 1

/* ── Conversation lists: cursor-paged, searched server-side ── */
function useConversationPages(door: 'staff' | 'oversight', params: { q?: string; instructorId?: string }, enabled: boolean) {
  const q = params.q?.trim() ?? ''
  const res = useInfiniteQuery({
    queryKey: door === 'staff' ? [...chatKeys.staffList, q] : [...chatKeys.oversight, params.instructorId ?? '', q],
    enabled,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => get<ConversationPage>(`/chat/${door}/conversations`, {
      ...(q ? { q } : {}), ...(params.instructorId ? { instructorId: params.instructorId } : {}), ...(pageParam ? { cursor: pageParam } : {}),
    }),
    getNextPageParam: last => last.nextCursor,
    refetchInterval: door === 'staff' ? LIST_POLL : 30_000, refetchIntervalInBackground: false,
    staleTime: door === 'staff' ? 5_000 : 10_000, retry: no4xxRetry,
  })
  return {
    conversations: res.data?.pages.flatMap(p => p.items) ?? [],
    firstPage: res.data?.pages[0]?.items,
    isLoading: res.isLoading, isError: res.isError,
    hasMore: !!res.hasNextPage, loadingMore: res.isFetchingNextPage,
    loadMore: () => { void res.fetchNextPage() },
  }
}
export type ConversationList = ReturnType<typeof useConversationPages>

/* ── Instructor ─────────────────────────────────────── */
export const useStaffConversations = (enabled = true, q = '') => useConversationPages('staff', { q }, enabled)
export function useStaffUnread(enabled: boolean) {
  return useQuery({
    queryKey: chatKeys.staffUnread, enabled,
    queryFn: async () => (await get<{ count: number }>('/chat/staff/unread-count')).count,
    refetchInterval: LIST_POLL, refetchIntervalInBackground: false, staleTime: 5_000, retry: no4xxRetry,
  })
}

/* ── Super admin ────────────────────────────────────── */
export const useOversightConversations = (instructorId: string, q = '') => useConversationPages('oversight', { instructorId, q }, true)
export function useOversightInstructors() {
  return useQuery({
    queryKey: chatKeys.oversightInstructors,
    queryFn: () => get<ChatPerson[]>('/chat/oversight/instructors'),
    staleTime: 60_000, retry: no4xxRetry,
  })
}

/* ── One thread ─────────────────────────────────────── */
const newClientId = () =>
  (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`).slice(0, 64)

/* The server re-sends a short window behind the cursor (a late commit must not
   be skipped), so most polls repeat what is on screen: hand back the SAME array
   then, and React skips the render. */
function merge(prev: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  if (incoming.length === 0) return prev
  const have = new Set(prev.filter(m => !m.pending && !m.failed).map(m => m.id))
  if (incoming.every(m => have.has(m.id))) return prev
  const byClient = new Map(incoming.filter(m => m.clientMsgId).map(m => [m.clientMsgId!, m]))
  const ids = new Set(incoming.map(m => m.id))
  const kept = prev.filter(m => !ids.has(m.id) && !(m.clientMsgId && byClient.has(m.clientMsgId)))
  return [...kept, ...incoming].sort((a, b) =>
    (a.pending || a.failed ? 1 : 0) - (b.pending || b.failed ? 1 : 0) || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
}
const isFatal = (err: any) => [400, 403, 404, 409, 422].includes(err?.response?.status)

/**
 * `mode: 'staff'` — the instructor's own conversation: polls every 3 s, marks
 * read, can send. `mode: 'oversight'` — a super admin reading: polls every
 * 10 s, never marks read, never sends.
 */
export function useChatThread(conversationId: string | null, mode: 'staff' | 'oversight') {
  const qc = useQueryClient()
  const base = mode === 'staff' ? '/chat/staff/conversations' : '/chat/oversight/conversations'
  const [messages, setMessages]       = useState<ChatMessage[]>([])
  const [peerLastReadAt, setPeerRead] = useState<string | null>(null)
  const [loading, setLoading]         = useState(false)
  const [hasMore, setHasMore]         = useState(false)
  const [readOnlyReason, setReadOnly] = useState<string | null>(null)
  const convRef     = useRef(conversationId)
  const messagesRef = useRef<ChatMessage[]>([])
  useEffect(() => { messagesRef.current = messages }, [messages])

  const markRead = useCallback(async (id: string) => {
    if (mode !== 'staff') return
    try {
      await post(`/chat/staff/conversations/${id}/read`)
      qc.invalidateQueries({ queryKey: chatKeys.staffUnread })
      qc.invalidateQueries({ queryKey: chatKeys.staffList })
    } catch { /* reading must never break the view */ }
  }, [mode, qc])

  useEffect(() => {
    convRef.current = conversationId
    setMessages([]); setPeerRead(null); setHasMore(false); setReadOnly(null)
    if (!conversationId) return
    let cancelled = false
    setLoading(true)
    get<{ messages: ChatMessage[]; peerLastReadAt?: string | null; canReply?: boolean; readOnlyReason?: string | null }>(`${base}/${conversationId}/messages`)
      .then(r => {
        if (cancelled) return
        setMessages(r.messages); setPeerRead(r.peerLastReadAt ?? null); setHasMore(r.messages.length >= 50)
        if (r.canReply === false) setReadOnly(r.readOnlyReason ?? 'This chat is read-only')
        void markRead(conversationId)
      })
      .catch(() => { /* the poll below retries the thread */ })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [conversationId, base, markRead])

  useEffect(() => {
    if (!conversationId) return
    const tick = async () => {
      if (document.visibilityState !== 'visible' || convRef.current !== conversationId) return
      const after = [...messagesRef.current].reverse().find(m => !m.pending && !m.failed)?.id
      try {
        const r = await get<{ messages: ChatMessage[]; peerLastReadAt?: string | null }>(
          `${base}/${conversationId}/messages`, after ? { after } : undefined)
        if (convRef.current !== conversationId) return
        setPeerRead(r.peerLastReadAt ?? null)
        const have = new Set(messagesRef.current.map(m => m.id))
        const fresh = r.messages.filter(m => !have.has(m.id))
        if (fresh.length) {
          setMessages(prev => merge(prev, r.messages))
          if (fresh.some(m => m.senderRole === 'student')) void markRead(conversationId)
        }
      } catch { /* the next tick retries */ }
    }
    const t = setInterval(tick, mode === 'staff' ? 3_000 : 10_000)
    const onVisible = () => { if (document.visibilityState === 'visible') void tick() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVisible) }
  }, [conversationId, base, mode, markRead])

  const loadOlder = useCallback(async () => {
    const first = messagesRef.current.find(m => !m.pending && !m.failed)
    if (!conversationId || !first) return
    const r = await get<{ messages: ChatMessage[] }>(`${base}/${conversationId}/messages`, { before: first.id })
    setHasMore(r.messages.length >= 50)
    setMessages(prev => merge(prev, r.messages))
  }, [conversationId, base])

  const send = useCallback(async (body: string, retryOf?: ChatMessage) => {
    if (mode !== 'staff' || !conversationId) return { ok: false as const }
    const clientMsgId = retryOf?.clientMsgId ?? newClientId()
    const optimistic: ChatMessage = { id: `tmp-${clientMsgId}`, senderRole: 'instructor', body, createdAt: new Date().toISOString(), clientMsgId, pending: true }
    setMessages(prev => [...prev.filter(m => m.clientMsgId !== clientMsgId), optimistic])
    try {
      const r = await post<{ message: ChatMessage }>(`/chat/staff/conversations/${conversationId}/messages`, { body, clientMsgId })
      setMessages(prev => merge(prev, [r.message]))
      qc.invalidateQueries({ queryKey: chatKeys.staffList })
      return { ok: true as const }
    } catch (err: any) {
      const fatal = isFatal(err)
      setMessages(prev => prev.map(m => m.clientMsgId === clientMsgId ? { ...m, pending: false, failed: true, fatal } : m))
      /* The student left / was deactivated meanwhile: lock the composer too. */
      if (err?.response?.status === 409) setReadOnly(err?.response?.data?.error?.message ?? 'This chat is read-only')
      return { ok: false as const, message: err?.response?.data?.error?.message as string | undefined }
    }
  }, [mode, conversationId, qc])

  return { messages, peerLastReadAt, loading, hasMore, loadOlder, send, readOnlyReason }
}
