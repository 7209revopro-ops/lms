'use client'

import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import {
  MessageCircle, Search, ArrowLeft, Send, Check, CheckCheck, Clock, AlertCircle, Lock, GraduationCap,
} from 'lucide-react'
import {
  useChatInstructors, useChatConversations, useChatThread,
  type ChatInstructor, type ChatMessage,
} from '@/lib/api/chat'
import { AvatarImg } from '@/components/ui/AvatarImg'
import { useCurrentUser } from '@/lib/api/user'
import Spinner from '@/components/ui/Spinner'

const PROGRAM: Record<string, string> = {
  '4x-trading': 'Forex', 'digital-marketing': 'Digital Marketing', 'ai': 'AI', 'jura': 'Jura',
}
const MAX = 2000

/* ── time helpers ───────────────────────────────────── */
function listTime(iso: string) {
  const d = new Date(iso), now = new Date()
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  const y = new Date(now); y.setDate(now.getDate() - 1)
  if (d.toDateString() === y.toDateString()) return 'Yesterday'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
function dayLabel(iso: string) {
  const d = new Date(iso), now = new Date()
  if (d.toDateString() === now.toDateString()) return 'Today'
  const y = new Date(now); y.setDate(now.getDate() - 1)
  if (d.toDateString() === y.toDateString()) return 'Yesterday'
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
}
const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
/* On a phone, Enter is a new line (as in WhatsApp) — the button sends. */
const enterSends = () => typeof window !== 'undefined' && !window.matchMedia?.('(pointer: coarse)').matches

/* One row of the left list — an instructor the student may write to, or a
   past conversation with one who no longer teaches their programme. */
interface Row {
  instructorId: string; name: string; avatarUrl?: string; programs: string[]
  conversationId: string | null; preview?: string; time?: string; unread: number
  mine?: boolean; readOnly: boolean
}

function Avatar({ name, url, size = 40 }: { name: string; url?: string; size?: number }) {
  return (
    <div className="flex shrink-0 items-center justify-center overflow-hidden rounded-full font-bold text-white"
      style={{ width: size, height: size, background: 'linear-gradient(135deg,#0057b8,#003d80)', fontSize: size * 0.4 }}>
      <AvatarImg src={url} name={name} className="h-full w-full object-cover" />
    </div>
  )
}

function ChatList({ rows, selected, onSelect, loading }: {
  rows: Row[]; selected: string | null; onSelect: (r: Row) => void; loading: boolean
}) {
  const [q, setQ] = useState('')
  const shown = useMemo(() => rows.filter(r => r.name.toLowerCase().includes(q.trim().toLowerCase())), [rows, q])
  return (
    <div className="flex h-full flex-col">
      <div className="p-3" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <div className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: 'var(--color-bg-inset)' }}>
          <Search size={14} style={{ color: 'var(--color-text-muted)' }} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search instructors"
            className="w-full bg-transparent text-sm outline-none" style={{ color: 'var(--color-text-primary)' }} />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading && <div className="flex justify-center py-10"><Spinner size={16} /></div>}
        {!loading && shown.length === 0 && (
          <p className="px-6 py-12 text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>
            {rows.length === 0 ? 'No instructors for your programme yet.' : 'No instructor matches that search.'}
          </p>
        )}
        {shown.map(r => {
          const active = selected === r.instructorId
          return (
            <button key={r.instructorId} onClick={() => onSelect(r)}
              className="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors"
              style={{ background: active ? 'rgba(0,87,184,0.08)' : 'transparent', borderBottom: '1px solid var(--color-border)' }}>
              <Avatar name={r.name} url={r.avatarUrl} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>{r.name}</span>
                  {r.time && <span className="shrink-0 text-[11px]" style={{ color: r.unread ? '#0057b8' : 'var(--color-text-muted)' }}>{listTime(r.time)}</span>}
                </div>
                <div className="mt-0.5 flex items-center justify-between gap-2">
                  <span className="truncate text-xs" style={{ color: 'var(--color-text-muted)', fontWeight: r.unread ? 600 : 400 }}>
                    {r.preview ? `${r.mine ? 'You: ' : ''}${r.preview}` : r.programs.map(p => PROGRAM[p] ?? p).join(' · ') || 'Instructor'}
                  </span>
                  {r.unread > 0 && (
                    <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[10px] font-bold text-white"
                      style={{ background: '#0057b8' }}>{r.unread > 99 ? '99+' : r.unread}</span>
                  )}
                  {r.readOnly && <Lock size={11} className="shrink-0" style={{ color: 'var(--color-text-muted)' }} />}
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function Ticks({ m, seen }: { m: ChatMessage; seen: boolean }) {
  if (m.failed)  return <AlertCircle size={12} style={{ color: '#EF4444' }} />
  if (m.pending) return <Clock size={11} style={{ opacity: 0.7 }} />
  return seen
    ? <CheckCheck size={13} style={{ color: '#7DD3FC' }} aria-label="Seen" />
    : <Check size={13} style={{ opacity: 0.8 }} aria-label="Sent" />
}

function Thread({ row, onBack, locked }: { row: Row; onBack: () => void; locked: string | null }) {
  const t = useChatThread(row.conversationId, row.instructorId)
  const [draft, setDraft]   = useState('')
  const [error, setError]   = useState<string | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const stick    = useRef(true)
  const area     = useRef<HTMLTextAreaElement>(null)
  /* Loading earlier messages prepends them: keep the reader's place by holding
     the distance from the bottom, not the distance from the top. */
  const fromBottom = useRef<number | null>(null)

  /* Follow new messages only while the reader is at the bottom — never yank
     someone who scrolled up to read history. */
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
  useEffect(() => { stick.current = true; setError(null); setDraft('') }, [row.instructorId])

  const resize = (el: HTMLTextAreaElement | null) => {
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`
  }
  const submit = async () => {
    const body = draft.trim()
    if (!body || body.length > MAX || row.readOnly || locked) return
    setDraft(''); setError(null); stick.current = true
    if (area.current) { area.current.value = ''; resize(area.current); area.current.focus() }
    const r = await t.send(body)
    if (!r.ok) setError(r.message ?? 'Message not sent. Tap it to retry.')
  }

  const peerRead = t.peerLastReadAt ? new Date(t.peerLastReadAt).getTime() : 0
  let lastDay = ''

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 px-3 py-2.5" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <button onClick={onBack} className="rounded-lg p-1.5 md:hidden" aria-label="Back to chats"
          style={{ color: 'var(--color-text-secondary)' }}><ArrowLeft size={18} /></button>
        <Avatar name={row.name} url={row.avatarUrl} size={36} />
        <div className="min-w-0">
          <p className="truncate text-sm font-bold" style={{ color: 'var(--color-text-primary)' }}>{row.name}</p>
          <p className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
            <GraduationCap size={11} />{row.programs.map(p => PROGRAM[p] ?? p).join(' · ') || 'Instructor'}
          </p>
        </div>
      </div>

      <div ref={scroller} onScroll={onScroll} className="flex-1 space-y-1 overflow-y-auto px-3 py-4 sm:px-6"
        style={{ background: 'var(--color-bg-inset)' }}>
        {t.hasMore && (
          <div className="mb-2 flex justify-center">
            <button onClick={() => {
              const el = scroller.current
              if (el) fromBottom.current = el.scrollHeight - el.scrollTop
              stick.current = false
              void t.loadOlder().catch(() => { fromBottom.current = null })
            }}
              className="rounded-full px-3 py-1 text-xs font-semibold" style={{ background: 'var(--color-bg-surface)', color: 'var(--color-text-secondary)' }}>
              Load earlier messages
            </button>
          </div>
        )}
        {t.loading && <div className="flex justify-center py-10"><Spinner size={16} /></div>}
        {!t.loading && t.messages.length === 0 && !locked && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <MessageCircle size={28} style={{ color: 'var(--color-text-muted)' }} />
            <p className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>Start a conversation</p>
            <p className="max-w-xs text-xs" style={{ color: 'var(--color-text-muted)' }}>
              Ask {row.name.split(' ')[0]} about a lesson, a class or an assignment. They’ll be notified.
            </p>
          </div>
        )}
        {t.messages.map(m => {
          const mine = m.senderRole === 'student'
          const day  = dayLabel(m.createdAt)
          const showDay = day !== lastDay
          lastDay = day
          const retryable = m.failed && !m.fatal
          return (
            <div key={m.clientMsgId ?? m.id}>
              {showDay && (
                <div className="my-3 flex justify-center">
                  <span className="rounded-full px-3 py-0.5 text-[11px] font-medium"
                    style={{ background: 'var(--color-bg-surface)', color: 'var(--color-text-muted)' }}>{day}</span>
                </div>
              )}
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.15 }}
                className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <button type="button" disabled={!retryable}
                  onClick={() => { if (retryable) { setError(null); void t.send(m.body, m) } }}
                  className="max-w-[80%] rounded-2xl px-3 py-2 text-left sm:max-w-[65%]"
                  style={mine
                    ? { background: m.failed ? 'rgba(239,68,68,0.85)' : '#0057b8', color: '#fff', borderBottomRightRadius: 6 }
                    : { background: 'var(--color-bg-surface)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border)', borderBottomLeftRadius: 6 }}>
                  <p className="whitespace-pre-wrap break-words text-sm leading-relaxed [overflow-wrap:anywhere]">{m.body}</p>
                  <span className="mt-0.5 flex items-center justify-end gap-1 text-[10px]" style={{ opacity: 0.75 }}>
                    {m.failed ? (retryable ? 'Not sent · tap to retry' : 'Not sent') : clock(m.createdAt)}
                    {mine && <Ticks m={m} seen={!m.pending && !m.failed && peerRead >= new Date(m.createdAt).getTime()} />}
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
            className="px-4 py-1.5 text-xs" style={{ color: '#EF4444', background: 'rgba(239,68,68,0.08)' }}>{error}</motion.p>
        )}
      </AnimatePresence>

      {row.readOnly || locked ? (
        <p className="flex items-center justify-center gap-2 px-4 py-3 text-center text-xs" style={{ color: 'var(--color-text-muted)', borderTop: '1px solid var(--color-border)' }}>
          <Lock size={12} className="shrink-0" />{locked ?? 'This instructor no longer teaches your programme — the chat is read-only.'}
        </p>
      ) : (
        <div className="flex items-end gap-2 px-3 py-2.5" style={{ borderTop: '1px solid var(--color-border)' }}>
          <textarea ref={area} value={draft} rows={1} maxLength={MAX}
            onChange={e => { setDraft(e.target.value); resize(e.target) }}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && enterSends()) { e.preventDefault(); void submit() } }}
            placeholder="Type a message"
            className="max-h-[140px] flex-1 resize-none rounded-2xl px-4 py-2.5 text-sm outline-none"
            style={{ background: 'var(--color-bg-inset)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border)' }} />
          <button onClick={() => void submit()} disabled={!draft.trim()} aria-label="Send"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white transition-opacity disabled:opacity-40"
            style={{ background: '#0057b8' }}>
            <Send size={16} />
          </button>
        </div>
      )}
      {!row.readOnly && !locked && draft.length > MAX - 200 && (
        <p className="px-4 pb-1 text-right text-[10px]" style={{ color: 'var(--color-text-muted)' }}>{draft.length}/{MAX}</p>
      )}
    </div>
  )
}

function MessagesInner() {
  const router = useRouter()
  const params = useSearchParams()
  const { data: instructors, isLoading } = useChatInstructors()
  const { data: conversations } = useChatConversations()
  const { data: me } = useCurrentUser()
  /* Viewers (pending / rejected / cancelled) may see who teaches their
     programme but not write — say so up front instead of failing on send. */
  const locked = me?.impersonation?.readOnly
    ? 'You are viewing this account read-only — messages cannot be sent as the student.'
    : me && me.enrollmentStatus && me.enrollmentStatus !== 'approved'
    ? (me.enrollmentStatus === 'pending'
        ? 'You can message instructors once your enrolment is approved.'
        : 'Messaging instructors needs an approved enrolment.')
    : null
  const [selected, setSelected] = useState<string | null>(params.get('i'))

  const rows: Row[] = useMemo(() => {
    const list: Row[] = (instructors ?? []).map((i: ChatInstructor) => ({
      instructorId: i.id, name: i.name, avatarUrl: i.avatarUrl, programs: i.programs,
      conversationId: i.conversation?.id ?? null, preview: i.conversation?.lastMessagePreview,
      time: i.conversation?.lastMessageAt, unread: i.conversation?.unread ?? 0,
      mine: i.conversation?.lastSenderRole === 'student', readOnly: false,
    }))
    const eligible = new Set(list.map(r => r.instructorId))
    for (const c of conversations ?? []) {
      if (!c.instructor || eligible.has(c.instructor.id)) continue
      list.push({
        instructorId: c.instructor.id, name: c.instructor.name, avatarUrl: c.instructor.avatarUrl, programs: [],
        conversationId: c.id, preview: c.lastMessagePreview, time: c.lastMessageAt, unread: c.unread,
        mine: c.lastSenderRole === 'student', readOnly: true,
      })
    }
    return list
  }, [instructors, conversations])

  /* Arriving from a bell notification: ?c=<conversation>. */
  useEffect(() => {
    const c = params.get('c')
    if (!c || selected) return
    const hit = rows.find(r => r.conversationId === c)
    if (hit) setSelected(hit.instructorId)
  }, [params, rows, selected])

  const active = rows.find(r => r.instructorId === selected) ?? null
  const pick = (r: Row) => {
    setSelected(r.instructorId)
    router.replace(`/messages?i=${r.instructorId}`, { scroll: false })
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-4">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)', fontFamily: 'Bricolage Grotesque, sans-serif' }}>Messages</h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--color-text-muted)' }}>Chat with the instructors of your programme.</p>
      </div>
      <div className="grid h-[calc(100dvh-14rem)] min-h-[460px] overflow-hidden rounded-2xl md:grid-cols-[320px_1fr]"
        style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)' }}>
        <div className={`${active ? 'hidden md:block' : 'block'} h-full min-h-0 md:border-r`} style={{ borderColor: 'var(--color-border)' }}>
          <ChatList rows={rows} selected={selected} onSelect={pick} loading={isLoading} />
        </div>
        <div className={`${active ? 'block' : 'hidden md:flex'} h-full min-h-0`}>
          {active ? (
            <Thread key={active.instructorId} row={active} locked={locked} onBack={() => { setSelected(null); router.replace('/messages', { scroll: false }) }} />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2" style={{ color: 'var(--color-text-muted)' }}>
              <MessageCircle size={32} />
              <p className="text-sm">Pick an instructor to start chatting</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function MessagesPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-20"><Spinner size={18} /></div>}>
      <MessagesInner />
    </Suspense>
  )
}
