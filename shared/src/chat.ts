/* ─────────────────────────────────────────────────────────────
   Student ↔ instructor chat (plan.md §11) — types and the thread's merge
   rule, shared with the website's lib/api/chat.ts behaviour. Pure.
───────────────────────────────────────────────────────────── */

export interface ChatMessage {
  id: string
  senderRole: 'student' | 'instructor'
  body: string
  createdAt: string
  clientMsgId?: string
  /** Client-only: an optimistic bubble not yet acknowledged / one that failed. */
  pending?: boolean
  failed?: boolean
  /** Client-only: a refusal no retry can fix (403/404/409/422) — no "tap to retry". */
  fatal?: boolean
}

export interface ChatInstructor {
  id: string
  name: string
  avatarUrl?: string
  headline?: string
  programs: string[]
  conversation: null | {
    id: string
    lastMessageAt: string
    lastMessagePreview: string
    lastSenderRole: 'student' | 'instructor'
    unread: number
  }
}

export interface ChatPage { messages: ChatMessage[]; peerLastReadAt: string | null }

export const CHAT_PAGE = 50
export const CHAT_MAX_CHARS = 2000
export const THREAD_POLL_MS = 3_000
export const LIST_POLL_MS = 15_000

const unsent = (m: ChatMessage) => !!(m.pending || m.failed)

/**
 * Merge a page from the server into what is on screen.
 * The server re-sends a short window behind the cursor (a late commit must
 * not be skipped), so most polls repeat what is shown: then the SAME array is
 * returned and React skips the render. An optimistic bubble is replaced by
 * its acknowledged twin, matched on clientMsgId. Unsent bubbles stay last.
 */
export function mergeMessages(prev: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  if (incoming.length === 0) return prev
  const have = new Set(prev.filter(m => !unsent(m)).map(m => m.id))
  if (incoming.every(m => have.has(m.id))) return prev
  const byClient = new Set(incoming.filter(m => m.clientMsgId).map(m => m.clientMsgId!))
  const ids = new Set(incoming.map(m => m.id))
  const kept = prev.filter(m => !ids.has(m.id) && !(m.clientMsgId && byClient.has(m.clientMsgId)))
  return [...kept, ...incoming].sort((a, b) =>
    (unsent(a) ? 1 : 0) - (unsent(b) ? 1 : 0) || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
}

/** The newest message the server has acknowledged — the poll cursor. */
export function lastServerId(messages: ChatMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) if (!unsent(messages[i]!)) return messages[i]!.id
  return undefined
}

/** A refusal that a retry cannot fix (not a network error, 5xx or 429). */
export function isFatalSendError(status: number | undefined): boolean {
  return status !== undefined && [400, 403, 404, 409, 422].includes(status)
}

/** Seen (✓✓) when the instructor read at or after the message was sent. */
export function isSeen(m: ChatMessage, peerLastReadAt: string | null): boolean {
  return m.senderRole === 'student' && !unsent(m) && !!peerLastReadAt && new Date(peerLastReadAt) >= new Date(m.createdAt)
}

/** Sorted for the list: conversations with unread first, then most recent,
 *  then instructors never written to, by name. */
export function sortInstructors(list: ChatInstructor[]): ChatInstructor[] {
  return [...list].sort((a, b) => {
    const ua = a.conversation?.unread ?? 0, ub = b.conversation?.unread ?? 0
    if ((ua > 0) !== (ub > 0)) return ua > 0 ? -1 : 1
    const ta = a.conversation ? new Date(a.conversation.lastMessageAt).getTime() : 0
    const tb = b.conversation ? new Date(b.conversation.lastMessageAt).getTime() : 0
    if (ta !== tb) return tb - ta
    return a.name.localeCompare(b.name)
  })
}

/** Day label key for a separator between messages on different days. */
export function dayKey(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}
