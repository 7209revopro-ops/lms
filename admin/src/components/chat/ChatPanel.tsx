'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { MessageCircle, Search, ArrowLeft, Send, Check, CheckCheck, Clock, AlertCircle, Eye, Lock } from 'lucide-react'
import { useChatThread, type ChatConversation, type ChatMessage, type ConversationList } from '@/lib/api/chat'
import { AvatarImg } from '@/components/ui/AvatarImg'
import Spinner from '@/components/ui/Spinner'
import { CsTag } from '@/components/ui/CsTag'

/* The chat UI for both admin doors (plan.md §11.6):
     mode 'staff'     — an instructor's own inbox: students who wrote to them, reply
     mode 'oversight' — a super admin reading any conversation, read-only */

const MAX   = 2000
const muted = 'rgba(255,255,255,0.45)'
const line  = '1px solid rgba(255,255,255,0.07)'

/* Dates are bucketed in the ACADEMY's zone, like every time on this panel:
   toLocaleDateString is pinned to the active zone (lib/timezone.ts), while
   toDateString would use the operator's device and could split one academy
   day across two labels. en-CA gives a sortable YYYY-MM-DD key. */
const dayKey = (d: Date) => d.toLocaleDateString('en-CA')
function relDay(iso: string): 'today' | 'yesterday' | null {
  const d = new Date(iso)
  if (dayKey(d) === dayKey(new Date())) return 'today'
  if (dayKey(d) === dayKey(new Date(Date.now() - 86_400_000))) return 'yesterday'
  return null
}
function listTime(iso: string) {
  const r = relDay(iso)
  if (r === 'today') return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  if (r === 'yesterday') return 'Yesterday'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
function dayLabel(iso: string) {
  const r = relDay(iso)
  if (r === 'today') return 'Today'
  if (r === 'yesterday') return 'Yesterday'
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
}
const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
/* On a phone, Enter is a new line (as in WhatsApp) — the button sends. */
const enterSends = () => typeof window !== 'undefined' && !window.matchMedia?.('(pointer: coarse)').matches

function Avatar({ name, url, size = 40 }: { name?: string; url?: string; size?: number }) {
  return (
    <div className="flex shrink-0 items-center justify-center overflow-hidden rounded-full font-bold text-white"
      style={{ width: size, height: size, background: 'linear-gradient(135deg,#0057b8,#003d80)', fontSize: size * 0.4 }}>
      <AvatarImg src={url} name={name} className="h-full w-full object-cover" />
    </div>
  )
}

function Ticks({ m, seen }: { m: ChatMessage; seen: boolean }) {
  if (m.failed)  return <AlertCircle size={12} style={{ color: '#F87171' }} />
  if (m.pending) return <Clock size={11} style={{ opacity: 0.7 }} />
  return seen ? <CheckCheck size={13} style={{ color: '#7DD3FC' }} aria-label="Seen" /> : <Check size={13} style={{ opacity: 0.8 }} aria-label="Sent" />
}

function Thread({ conv, mode, onBack }: { conv: ChatConversation; mode: 'staff' | 'oversight'; onBack: () => void }) {
  const t = useChatThread(conv.id, mode)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const stick    = useRef(true)
  const area     = useRef<HTMLTextAreaElement>(null)
  /* Loading earlier messages prepends them: keep the reader's place by holding
     the distance from the bottom, not the distance from the top. */
  const fromBottom = useRef<number | null>(null)

  const onScroll = () => {
    const el = scroller.current
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    if (fromBottom.current !== null) { el.scrollTop = el.scrollHeight - fromBottom.current; fromBottom.current = null }
    else if (stick.current) el.scrollTop = el.scrollHeight
  }, [t.messages])
  useEffect(() => { stick.current = true; setError(null); setDraft('') }, [conv.id])

  const resize = (el: HTMLTextAreaElement | null) => {
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`
  }
  const submit = async () => {
    const body = draft.trim()
    if (!body || body.length > MAX || t.readOnlyReason) return
    setDraft(''); setError(null); stick.current = true
    if (area.current) { area.current.value = ''; resize(area.current); area.current.focus() }
    const r = await t.send(body)
    if (!r.ok) setError(('message' in r && r.message) || 'Message not sent. Tap it to retry.')
  }
  const older = () => {
    const el = scroller.current
    if (el) fromBottom.current = el.scrollHeight - el.scrollTop
    stick.current = false
    void t.loadOlder().catch(() => { fromBottom.current = null })
  }

  const peerRead = t.peerLastReadAt ? new Date(t.peerLastReadAt).getTime() : 0
  let lastDay = ''
  const title = mode === 'staff' ? conv.student?.name : `${conv.student?.name ?? 'Student'} ↔ ${conv.instructor?.name ?? 'Instructor'}`

  return (
    <div className="flex h-full w-full min-w-0 flex-col">
      <div className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: line }}>
        <button onClick={onBack} className="rounded-lg p-1.5 text-white/60 hover:bg-white/5 md:hidden" aria-label="Back"><ArrowLeft size={18} /></button>
        <Avatar name={conv.student?.name} url={conv.student?.avatarUrl} size={36} />
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-white">{title}</p>
          <p className="truncate text-[11px]" style={{ color: muted }}>{conv.student?.email ?? ''}</p>
          <CsTag cs={conv.student?.tetraCs} />
        </div>
        {mode === 'oversight' && (
          <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold"
            style={{ background: 'rgba(250,204,21,0.12)', color: '#FACC15' }}><Eye size={11} />Read-only</span>
        )}
      </div>

      <div ref={scroller} onScroll={onScroll} className="flex-1 space-y-1 overflow-y-auto px-4 py-4" style={{ background: 'rgba(0,0,0,0.18)' }}>
        {t.hasMore && (
          <div className="mb-2 flex justify-center">
            <button onClick={older}
              className="rounded-full px-3 py-1 text-xs font-semibold text-white/70" style={{ background: 'rgba(255,255,255,0.06)' }}>
              Load earlier messages
            </button>
          </div>
        )}
        {t.loading && <div className="flex justify-center py-10"><Spinner size={16} variant="muted" /></div>}
        {t.messages.map(m => {
          /* The instructor's side sits on the right, in both modes. */
          const right = m.senderRole === 'instructor'
          const day = dayLabel(m.createdAt)
          const showDay = day !== lastDay
          lastDay = day
          const retryable = m.failed && !m.fatal
          return (
            <div key={m.clientMsgId ?? m.id}>
              {showDay && (
                <div className="my-3 flex justify-center">
                  <span className="rounded-full px-3 py-0.5 text-[11px]" style={{ background: 'rgba(255,255,255,0.06)', color: muted }}>{day}</span>
                </div>
              )}
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.15 }}
                className={`flex ${right ? 'justify-end' : 'justify-start'}`}>
                <button type="button" disabled={!retryable}
                  onClick={() => { if (retryable) { setError(null); void t.send(m.body, m) } }}
                  className="max-w-[80%] rounded-2xl px-3 py-2 text-left sm:max-w-[65%]"
                  style={right
                    ? { background: m.failed ? 'rgba(239,68,68,0.8)' : '#0057b8', color: '#fff', borderBottomRightRadius: 6 }
                    : { background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.92)', borderBottomLeftRadius: 6 }}>
                  {mode === 'oversight' && (
                    <p className="mb-0.5 text-[10px] font-bold uppercase tracking-wide" style={{ opacity: 0.6 }}>
                      {right ? conv.instructor?.name ?? 'Instructor' : conv.student?.name ?? 'Student'}
                    </p>
                  )}
                  <p className="whitespace-pre-wrap break-words text-sm leading-relaxed [overflow-wrap:anywhere]">{m.body}</p>
                  <span className="mt-0.5 flex items-center justify-end gap-1 text-[10px]" style={{ opacity: 0.7 }}>
                    {m.failed ? (retryable ? 'Not sent · tap to retry' : 'Not sent') : clock(m.createdAt)}
                    {mode === 'staff' && right && <Ticks m={m} seen={!m.pending && !m.failed && peerRead >= new Date(m.createdAt).getTime()} />}
                  </span>
                </button>
              </motion.div>
            </div>
          )
        })}
      </div>

      <AnimatePresence>
        {error && (
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="px-4 py-1.5 text-xs" style={{ color: '#F87171', background: 'rgba(239,68,68,0.08)' }}>{error}</motion.p>
        )}
      </AnimatePresence>

      {mode === 'staff' && (t.readOnlyReason ? (
        <p className="flex items-center justify-center gap-2 px-4 py-3 text-center text-xs" style={{ color: muted, borderTop: line }}>
          <Lock size={12} className="shrink-0" />{t.readOnlyReason}
        </p>
      ) : (
        <>
          <div className="flex items-end gap-2 px-3 py-2.5" style={{ borderTop: line }}>
            <textarea ref={area} value={draft} rows={1} maxLength={MAX}
              onChange={e => { setDraft(e.target.value); resize(e.target) }}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && enterSends()) { e.preventDefault(); void submit() } }}
              placeholder={`Reply to ${conv.student?.name?.split(' ')[0] ?? 'the student'}`}
              className="max-h-[140px] flex-1 resize-none rounded-2xl px-4 py-2.5 text-sm text-white outline-none placeholder:text-white/30"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)' }} />
            <button onClick={() => void submit()} disabled={!draft.trim()} aria-label="Send"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white transition-opacity disabled:opacity-40"
              style={{ background: '#0057b8' }}><Send size={16} /></button>
          </div>
          {draft.length > MAX - 200 && (
            <p className="px-4 pb-1 text-right text-[10px]" style={{ color: muted }}>{draft.length}/{MAX}</p>
          )}
        </>
      ))}
    </div>
  )
}

export function ChatPanel({ list, mode, emptyText, search, onSearch }: {
  list: ConversationList; mode: 'staff' | 'oversight'; emptyText: string
  search: string; onSearch: (q: string) => void
}) {
  const router = useRouter()
  const params = useSearchParams()
  /* ?c=<conversation> — arriving from a toast or a shared link. */
  const [selected, setSelected] = useState<string | null>(params.get('c'))
  /* Hold the open conversation itself, so a search that filters it out of the
     list (or a page not yet loaded) does not close the thread under the reader. */
  const [held, setHeld] = useState<ChatConversation | null>(null)
  const fromList = list.conversations.find(c => c.id === selected) ?? null
  useEffect(() => { if (fromList) setHeld(fromList) }, [fromList])
  const active = fromList ?? (held?.id === selected ? held : null)

  /* A toast link while the page is already open changes only the query. */
  const linked = params.get('c')
  useEffect(() => { if (linked) setSelected(linked) }, [linked])

  const pick = (c: ChatConversation | null) => {
    setSelected(c?.id ?? null); setHeld(c)
    router.replace(c ? `?c=${c.id}` : '?', { scroll: false })
  }

  return (
    <div className="grid h-[calc(100dvh-13rem)] min-h-[460px] overflow-hidden rounded-2xl md:grid-cols-[340px_1fr]"
      style={{ background: 'rgba(255,255,255,0.025)', border: line }}>
      <div className={`${active ? 'hidden md:flex' : 'flex'} min-h-0 flex-col md:border-r`} style={{ borderColor: 'rgba(255,255,255,0.07)' }}>
        <div className="p-3" style={{ borderBottom: line }}>
          <div className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: 'rgba(255,255,255,0.05)' }}>
            <Search size={14} style={{ color: muted }} />
            <input value={search} onChange={e => onSearch(e.target.value)} placeholder={mode === 'staff' ? 'Search students' : 'Search students or instructors'}
              className="w-full bg-transparent text-sm text-white outline-none placeholder:text-white/30" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {list.isLoading && <div className="flex justify-center py-10"><Spinner size={16} variant="muted" /></div>}
          {list.isError && <p className="px-6 py-12 text-center text-sm" style={{ color: '#F87171' }}>Could not load conversations.</p>}
          {!list.isLoading && !list.isError && list.conversations.length === 0 && (
            <p className="px-6 py-12 text-center text-sm" style={{ color: muted }}>{search.trim() ? 'Nothing matches that search.' : emptyText}</p>
          )}
          {list.conversations.map(c => {
            const on = c.id === selected
            const unread = mode === 'staff' ? c.unread : 0
            return (
              <button key={c.id} onClick={() => pick(c)}
                className="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-white/[0.03]"
                style={{ background: on ? 'rgba(0,87,184,0.15)' : undefined, borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <Avatar name={c.student?.name} url={c.student?.avatarUrl} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-white">{c.student?.name ?? 'Student'}</span>
                    <span className="shrink-0 text-[11px]" style={{ color: unread ? '#60A5FA' : muted }}>{listTime(c.lastMessageAt)}</span>
                  </div>
                  {mode === 'oversight' && (
                    <p className="truncate text-[11px]" style={{ color: '#60A5FA' }}>with {c.instructor?.name ?? 'Instructor'}</p>
                  )}
                  <CsTag cs={c.student?.tetraCs} />
                  <div className="mt-0.5 flex items-center justify-between gap-2">
                    <span className="truncate text-xs" style={{ color: muted, fontWeight: unread ? 600 : 400 }}>
                      {c.lastSenderRole === 'instructor' ? (mode === 'staff' ? 'You: ' : 'Instructor: ') : ''}{c.lastMessagePreview}
                    </span>
                    {unread > 0 && (
                      <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[10px] font-bold text-white"
                        style={{ background: '#0057b8' }}>{unread > 99 ? '99+' : unread}</span>
                    )}
                  </div>
                </div>
              </button>
            )
          })}
          {list.hasMore && (
            <div className="flex justify-center py-3">
              <button onClick={list.loadMore} disabled={list.loadingMore}
                className="rounded-full px-3 py-1 text-xs font-semibold text-white/70 disabled:opacity-50" style={{ background: 'rgba(255,255,255,0.06)' }}>
                {list.loadingMore ? 'Loading…' : 'Load more conversations'}
              </button>
            </div>
          )}
        </div>
      </div>
      <div className={`${active ? 'flex' : 'hidden md:flex'} min-h-0 min-w-0`}>
        {active ? (
          <Thread key={active.id} conv={active} mode={mode} onBack={() => pick(null)} />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2" style={{ color: muted }}>
            <MessageCircle size={32} />
            <p className="text-sm">Select a conversation</p>
          </div>
        )}
      </div>
    </div>
  )
}
