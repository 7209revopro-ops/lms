import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as Crypto from 'expo-crypto'
import {
  CHAT_PAGE, LIST_POLL_MS, THREAD_POLL_MS, isFatalSendError, lastServerId, mergeMessages,
  type ChatInstructor, type ChatMessage, type ChatPage,
} from '@shared'
import { apiGet, apiPost } from '../http'

/* Student side of the chat — the website's model (plan.md §11.3): polling,
   not a socket. An open thread asks only for what is newer than the newest
   message on screen every 3 s; lists and the badge every 15 s. Nothing polls
   while the app is in the background. */

export const chatKeys = {
  instructors: ['chat', 'instructors'] as const,
  unread:      ['chat', 'unread'] as const,
}

const status = (err: unknown) => (err as { response?: { status?: number } })?.response?.status

export function useChatInstructors() {
  return useQuery({
    queryKey: chatKeys.instructors,
    queryFn:  () => apiGet<ChatInstructor[]>('/chat/instructors'),
    refetchInterval: LIST_POLL_MS, staleTime: 5_000,
    retry: (n, err) => !(status(err)! >= 400 && status(err)! < 500) && n < 1,
  })
}

/** Unread replies, for the Messages tab badge. A pending student has no
 *  chat (403) — that is "no badge", never an error or a retry loop. */
export function useChatUnread(enabled: boolean) {
  return useQuery({
    queryKey: chatKeys.unread,
    queryFn:  async () => (await apiGet<{ count: number }>('/chat/unread-count')).count,
    refetchInterval: LIST_POLL_MS, staleTime: 5_000, enabled,
    retry: (n, err) => !(status(err)! >= 400 && status(err)! < 500) && n < 1,
  })
}

/** True while the app is in the foreground. */
function useAppActive(): boolean {
  const [active, setActive] = useState(AppState.currentState === 'active')
  useEffect(() => {
    const sub = AppState.addEventListener('change', s => setActive(s === 'active'))
    return () => sub.remove()
  }, [])
  return active
}

/**
 * One open thread. `conversationId` is null for an instructor the student has
 * never written to — the first send creates the conversation.
 */
export function useChatThread(conversationId: string | null, instructorId: string) {
  const qc = useQueryClient()
  const active = useAppActive()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [peerLastReadAt, setPeerRead] = useState<string | null>(null)
  const [loading, setLoading] = useState(!!conversationId)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [hasMore, setHasMore] = useState(false)
  const [convId, setConvId] = useState<string | null>(conversationId)
  const messagesRef = useRef<ChatMessage[]>([])
  const update = useCallback((fn: (prev: ChatMessage[]) => ChatMessage[]) => {
    setMessages(prev => {
      const next = fn(prev)
      messagesRef.current = next
      return next
    })
  }, [])

  const markRead = useCallback(async (id: string) => {
    try {
      await apiPost(`/chat/conversations/${id}/read`)
      void qc.invalidateQueries({ queryKey: ['chat'] })
    } catch { /* reading must never break the view */ }
  }, [qc])

  /* Opening: the latest page. (Loading starts true; a retry sets it again.) */
  const open = useCallback(async () => {
    if (!conversationId) return
    try {
      const r = await apiGet<ChatPage>(`/chat/conversations/${conversationId}/messages`)
      /* Merge, never replace: a message sent while this page was loading keeps
         its bubble (and its "retry" if it failed). */
      update(prev => mergeMessages(prev, r.messages))
      setPeerRead(r.peerLastReadAt)
      setHasMore(r.messages.length >= CHAT_PAGE)
      void markRead(conversationId)
      setLoadError(null)
    } catch (err) {
      setLoadError(err)
    } finally {
      setLoading(false)
    }
  }, [conversationId, markRead, update])
  useEffect(() => {
    const id = setTimeout(() => { void open() }, 0)
    return () => clearTimeout(id)
  }, [open])

  /* Polling: only what is newer than the newest message on screen. */
  useEffect(() => {
    if (!convId || !active) return
    const tick = async () => {
      const after = lastServerId(messagesRef.current)
      try {
        const r = await apiGet<ChatPage>(`/chat/conversations/${convId}/messages`, after ? { after } : undefined)
        setPeerRead(r.peerLastReadAt)
        const have = new Set(messagesRef.current.map(m => m.id))
        const fresh = r.messages.filter(m => !have.has(m.id))
        if (fresh.length) {
          update(prev => mergeMessages(prev, r.messages))
          if (fresh.some(m => m.senderRole === 'instructor')) void markRead(convId)
        }
      } catch { /* transient — the next tick retries */ }
    }
    void tick()
    const t = setInterval(tick, THREAD_POLL_MS)
    return () => clearInterval(t)
  }, [convId, active, markRead, update])

  const loadOlder = useCallback(async () => {
    const first = messagesRef.current.find(m => !m.pending && !m.failed)
    if (!convId || !first) return
    const r = await apiGet<ChatPage>(`/chat/conversations/${convId}/messages`, { before: first.id })
    setHasMore(r.messages.length >= CHAT_PAGE)
    update(prev => mergeMessages(prev, r.messages))
  }, [convId, update])

  const send = useCallback(async (body: string, retryOf?: ChatMessage) => {
    /* The same id on a retry: the server returns the original instead of
       sending twice (plan.md §11.2 C7). */
    const clientMsgId = retryOf?.clientMsgId ?? Crypto.randomUUID()
    const optimistic: ChatMessage = { id: `tmp-${clientMsgId}`, senderRole: 'student', body, createdAt: new Date().toISOString(), clientMsgId, pending: true }
    update(prev => [...prev.filter(m => m.clientMsgId !== clientMsgId), optimistic])
    try {
      const r = await apiPost<{ conversationId: string; message: ChatMessage }>('/chat/messages', { instructorId, body, clientMsgId })
      setConvId(id => id ?? r.conversationId)
      update(prev => mergeMessages(prev, [r.message]))
      void qc.invalidateQueries({ queryKey: chatKeys.instructors })
      return true
    } catch (err) {
      const fatal = isFatalSendError(status(err))
      update(prev => prev.map(m => m.clientMsgId === clientMsgId ? { ...m, pending: false, failed: true, fatal } : m))
      return false
    }
  }, [instructorId, qc, update])

  const retryOpen = useCallback(() => { setLoading(true); setLoadError(null); void open() }, [open])

  return { messages, peerLastReadAt, loading, loadError, retryOpen, hasMore, loadOlder, send, conversationId: convId }
}
