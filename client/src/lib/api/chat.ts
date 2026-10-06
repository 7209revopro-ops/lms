'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost } from '@/lib/axios'

/* Student side of the chat — plan.md §11. Polling, not a socket (§11.3): an
   open thread asks only for messages after the newest it has, every 3 s, and
   stops while the tab is hidden. */

export interface ChatMessage {
  id:           string
  senderRole:   'student' | 'instructor'
  body:         string
  createdAt:    string
  clientMsgId?: string
  /** Client-only: optimistic bubble not yet acknowledged / failed to send. */
  pending?:     boolean
  failed?:      boolean
  /** Client-only: a refusal no retry can fix (403/404/409/422) — no "tap to retry". */
  fatal?:       boolean
}

export interface ChatInstructor {
  id: string; name: string; avatarUrl?: string; headline?: string; programs: string[]
  conversation: null | {
    id: string; lastMessageAt: string; lastMessagePreview: string
    lastSenderRole: 'student' | 'instructor'; unread: number
  }
}

export interface ChatConversation {
  id: string
  instructor: { id: string; name: string; avatarUrl?: string } | null
  lastMessageAt: string; lastMessagePreview: string
  lastSenderRole: 'student' | 'instructor'; unread: number
}

export const chatKeys = {
  instructors:   ['chat', 'instructors'] as const,
  conversations: ['chat', 'conversations'] as const,
  unread:        ['chat', 'unread'] as const,
}

const LIST_POLL   = 15_000
const THREAD_POLL = 3_000

export function useChatInstructors() {
  return useQuery({
    queryKey: chatKeys.instructors,
    queryFn:  () => apiGet<ChatInstructor[]>('/chat/instructors'),
    refetchInterval: LIST_POLL, refetchIntervalInBackground: false, staleTime: 5_000,
  })
}

export function useChatConversations() {
  return useQuery({
    queryKey: chatKeys.conversations,
    queryFn:  () => apiGet<ChatConversation[]>('/chat/conversations'),
    refetchInterval: LIST_POLL, refetchIntervalInBackground: false, staleTime: 5_000,
  })
}

export function useChatUnread(enabled = true) {
  return useQuery({
    queryKey: chatKeys.unread,
    queryFn:  async () => (await apiGet<{ count: number }>('/chat/unread-count')).count,
    refetchInterval: LIST_POLL, refetchIntervalInBackground: false, staleTime: 5_000,
    enabled,
    /* A viewer or a staff session has no chat — never retry a 4xx. */
    retry: (n, err: any) => !(err?.response?.status >= 400 && err?.response?.status < 500) && n < 1,
  })
}

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
  /* An optimistic bubble is replaced by its acknowledged twin, matched on clientMsgId. */
  const kept = prev.filter(m => !ids.has(m.id) && !(m.clientMsgId && byClient.has(m.clientMsgId)))
  return [...kept, ...incoming].sort((a, b) =>
    (a.pending || a.failed ? 1 : 0) - (b.pending || b.failed ? 1 : 0) || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
}
const isFatal = (err: any) => [400, 403, 404, 409, 422].includes(err?.response?.status)

/**
 * One open thread. `conversationId` is null for an instructor the student has
 * never written to — the first send creates the conversation.
 */
export function useChatThread(conversationId: string | null, instructorId: string | null) {
  const qc = useQueryClient()
  const [messages, setMessages]         = useState<ChatMessage[]>([])
  const [peerLastReadAt, setPeerRead]   = useState<string | null>(null)
  const [loading, setLoading]           = useState(false)
  const [hasMore, setHasMore]           = useState(false)
  const [convId, setConvId]             = useState<string | null>(conversationId)
  const convRef     = useRef<string | null>(conversationId)
  const messagesRef = useRef<ChatMessage[]>([])
  useEffect(() => { messagesRef.current = messages }, [messages])
  const lastServerId = () => [...messagesRef.current].reverse().find(m => !m.pending && !m.failed)?.id

  const markRead = useCallback(async (id: string) => {
    try {
      await apiPost(`/chat/conversations/${id}/read`)
      qc.invalidateQueries({ queryKey: chatKeys.unread })
      qc.invalidateQueries({ queryKey: chatKeys.instructors })
      qc.invalidateQueries({ queryKey: chatKeys.conversations })
    } catch { /* impersonation is read-only — reading must not error the view */ }
  }, [qc])

  /* Opening a thread: the latest page. */
  useEffect(() => {
    /* The conversation this thread's own first send just created, handed back
       by the page — not a different chat, so keep what is on screen. */
    if (conversationId && conversationId === convRef.current && messagesRef.current.length) return
    convRef.current = conversationId
    setConvId(conversationId)
    setMessages([]); setPeerRead(null); setHasMore(false)
    if (!conversationId) return
    let cancelled = false
    setLoading(true)
    apiGet<{ messages: ChatMessage[]; peerLastReadAt: string | null }>(`/chat/conversations/${conversationId}/messages`)
      .then(r => {
        if (cancelled) return
        setMessages(r.messages); setPeerRead(r.peerLastReadAt); setHasMore(r.messages.length >= 50)
        void markRead(conversationId)
      })
      .catch(() => { /* the poll retries the thread */ })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [conversationId, markRead])

  /* Polling: only what is new since the newest message on screen. */
  useEffect(() => {
    if (!convId) return
    const tick = async () => {
      if (document.visibilityState !== 'visible' || convRef.current !== convId) return
      const after = lastServerId()
      try {
        const r = await apiGet<{ messages: ChatMessage[]; peerLastReadAt: string | null }>(
          `/chat/conversations/${convId}/messages`, after ? { after } : undefined)
        if (convRef.current !== convId) return
        setPeerRead(r.peerLastReadAt)
        const have = new Set(messagesRef.current.map(m => m.id))
        const fresh = r.messages.filter(m => !have.has(m.id))
        if (fresh.length) {
          setMessages(prev => merge(prev, r.messages))
          if (fresh.some(m => m.senderRole === 'instructor')) void markRead(convId)
        }
      } catch { /* transient — the next tick retries */ }
    }
    const t = setInterval(tick, THREAD_POLL)
    const onVisible = () => { if (document.visibilityState === 'visible') void tick() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVisible) }
  }, [convId, markRead])

  const loadOlder = useCallback(async () => {
    const first = messagesRef.current.find(m => !m.pending && !m.failed)
    if (!convId || !first) return
    const r = await apiGet<{ messages: ChatMessage[] }>(`/chat/conversations/${convId}/messages`, { before: first.id })
    setHasMore(r.messages.length >= 50)
    setMessages(prev => merge(prev, r.messages))
  }, [convId])

  const send = useCallback(async (body: string, retryOf?: ChatMessage) => {
    const clientMsgId = retryOf?.clientMsgId ?? newClientId()
    const optimistic: ChatMessage = { id: `tmp-${clientMsgId}`, senderRole: 'student', body, createdAt: new Date().toISOString(), clientMsgId, pending: true }
    setMessages(prev => [...prev.filter(m => m.clientMsgId !== clientMsgId), optimistic])
    try {
      const r = await apiPost<{ conversationId: string; message: ChatMessage }>('/chat/messages', { instructorId, body, clientMsgId })
      if (!convRef.current) { convRef.current = r.conversationId; setConvId(r.conversationId) }
      setMessages(prev => merge(prev, [r.message]))
      qc.invalidateQueries({ queryKey: chatKeys.instructors })
      return { ok: true as const, conversationId: r.conversationId }
    } catch (err: any) {
      const fatal = isFatal(err)
      setMessages(prev => prev.map(m => m.clientMsgId === clientMsgId ? { ...m, pending: false, failed: true, fatal } : m))
      return { ok: false as const, message: err?.response?.data?.error?.message as string | undefined }
    }
  }, [instructorId, qc])

  return { messages, peerLastReadAt, loading, hasMore, loadOlder, send, conversationId: convId }
}
