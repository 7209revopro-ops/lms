'use client'

import { useState } from 'react'
import { MessageSquare, ChevronDown, ChevronRight, ThumbsUp, CheckCircle2, Trash2, Send, PlusCircle } from 'lucide-react'
import {
  useThreads, useCreateThread, useUpvoteThread, useResolveThread, useDeleteThread,
  useComments, useCreateComment, useUpvoteComment, useDeleteComment,
  type DiscussionThread, type DiscussionComment, type DiscussionAuthor,
} from '@/lib/api/discussion'
import { useCurrentUser } from '@/lib/api/user'
import Spinner from '@/components/ui/Spinner'
import { AvatarImg } from '@/components/ui/AvatarImg'

function authorInfo(a: DiscussionAuthor | string): { id?: string; name: string; avatarUrl?: string; role: string; alsoTeaches?: boolean } {
  if (typeof a === 'string') return { id: a, name: 'User', avatarUrl: undefined, role: 'student' }
  return a
}

function Avatar({ author }: { author: DiscussionAuthor | string }) {
  const { name, avatarUrl } = authorInfo(author)
  return (
    <AvatarImg src={avatarUrl} className="h-6 w-6 rounded-full object-cover flex-shrink-0"
      fallback={
        <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
          style={{ background: 'var(--color-primary)' }}>
          {name.charAt(0).toUpperCase()}
        </div>
      } />
  )
}

function TimeAgo({ date }: { date: string }) {
  const diff = (Date.now() - new Date(date).getTime()) / 1000
  const label = diff < 60 ? 'just now'
    : diff < 3600 ? `${Math.floor(diff / 60)}m ago`
    : diff < 86400 ? `${Math.floor(diff / 3600)}h ago`
    : `${Math.floor(diff / 86400)}d ago`
  return <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>{label}</span>
}

/* ─── Comment list for a thread ─────────────────── */
function CommentList({ thread, lessonId }: { thread: DiscussionThread; lessonId: string }) {
  const { data: comments, isLoading } = useComments(thread.id)
  const { data: me } = useCurrentUser()
  const createComment  = useCreateComment(thread.id, lessonId)
  const upvoteComment  = useUpvoteComment(thread.id)
  const deleteComment  = useDeleteComment(thread.id, lessonId)
  const [body, setBody] = useState('')

  const submit = async () => {
    if (!body.trim()) return
    await createComment.mutateAsync({ body: body.trim() })
    setBody('')
  }

  return (
    <div className="border-t pt-3 mt-3" style={{ borderColor: 'var(--color-border)' }}>
      {isLoading && <div className="flex justify-center py-3"><Spinner size={14} variant="gray" /></div>}
      <div className="space-y-3">
        {comments?.map(c => {
          const auth = authorInfo(c.authorId)
          const isOwn = me?.id === (typeof c.authorId === 'string' ? c.authorId : auth.id ?? '')
          return (
            <div key={c.id} className="flex gap-2">
              <Avatar author={c.authorId} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] font-semibold" style={{ color: 'var(--color-text-secondary)' }}>{auth.name}</span>
                  {/* A mentor — an instructor, or a sub admin who also teaches (2026-11-20). */}
                  {(auth.role === 'instructor' || (auth.role === 'sub_admin' && auth.alsoTeaches === true)) && (
                    <span className="rounded-full px-1.5 py-0.5 text-[9px] font-bold"
                      style={{ background: 'rgba(0,87,184,0.12)', color: 'var(--color-primary)' }}>
                      Instructor
                    </span>
                  )}
                  {c.isInstructorAnswer && (
                    <span className="flex items-center gap-0.5 text-[9px] font-bold"
                      style={{ color: 'var(--color-success)' }}>
                      <CheckCircle2 size={10} /> Accepted
                    </span>
                  )}
                  <TimeAgo date={c.createdAt} />
                </div>
                <p className="mt-0.5 text-xs leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--color-text-secondary)' }}>{c.body}</p>
                <div className="mt-1 flex items-center gap-2">
                  <button onClick={() => upvoteComment.mutate(c.id)}
                    className="flex items-center gap-1 text-[10px] transition-colors hover:text-[#0057b8]"
                    style={{ color: 'var(--color-text-muted)' }}>
                    <ThumbsUp size={10} />{c.upvoteCount > 0 ? c.upvoteCount : ''}
                  </button>
                  {isOwn && (
                    <button onClick={() => deleteComment.mutate(c.id)}
                      className="flex items-center gap-1 text-[10px] transition-colors hover:text-red-500"
                      style={{ color: 'var(--color-text-muted)' }}>
                      <Trash2 size={10} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Reply input */}
      <div className="mt-3 flex gap-2">
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder="Write a reply…"
          rows={2}
          className="flex-1 resize-none rounded-xl px-3 py-2 text-xs outline-none"
          style={{ background: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }}
        />
        <button onClick={submit} disabled={!body.trim() || createComment.isPending}
          className="flex h-8 w-8 items-center justify-center rounded-xl transition-opacity disabled:opacity-40"
          style={{ background: 'var(--color-primary)' }}>
          {createComment.isPending
            ? <Spinner size={12} variant="white" />
            : <Send size={12} className="text-white" />}
        </button>
      </div>
    </div>
  )
}

/* ─── Single thread card ─────────────────────────── */
function ThreadCard({ thread, lessonId }: { thread: DiscussionThread; lessonId: string }) {
  const [expanded, setExpanded] = useState(false)
  const { data: me } = useCurrentUser()
  const upvote  = useUpvoteThread(lessonId)
  const resolve = useResolveThread(lessonId)
  const del     = useDeleteThread(lessonId)
  const auth = authorInfo(thread.authorId)
  const isOwn = me?.id === (typeof thread.authorId === 'string' ? thread.authorId : auth.id ?? '')

  return (
    <div className="rounded-xl p-3" style={{ background: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)' }}>
      <div className="flex items-start gap-2">
        <Avatar author={thread.authorId} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-semibold" style={{ color: 'var(--color-text-secondary)' }}>{auth.name}</span>
            {thread.isPinned && <span className="text-[9px] font-bold" style={{ color: 'var(--color-primary)' }}>📌 Pinned</span>}
            {thread.isResolved && <span className="text-[9px] font-bold" style={{ color: 'var(--color-success)' }}>✓ Resolved</span>}
            <TimeAgo date={thread.createdAt} />
          </div>
          {thread.title && (
            <p className="mt-0.5 text-xs font-semibold" style={{ color: 'var(--color-text-primary)' }}>{thread.title}</p>
          )}
          <p className="mt-0.5 text-xs leading-relaxed line-clamp-3" style={{ color: 'var(--color-text-secondary)' }}>{thread.body}</p>
          <div className="mt-2 flex items-center gap-3">
            <button onClick={() => upvote.mutate(thread.id)}
              className="flex items-center gap-1 text-[10px] transition-colors hover:text-[#0057b8]"
              style={{ color: 'var(--color-text-muted)' }}>
              <ThumbsUp size={10} />{thread.upvoteCount > 0 ? thread.upvoteCount : ''}
            </button>
            <button onClick={() => setExpanded(e => !e)}
              className="flex items-center gap-1 text-[10px] transition-colors hover:text-[#0057b8]"
              style={{ color: 'var(--color-text-muted)' }}>
              <MessageSquare size={10} />{thread.commentCount} {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
            </button>
            {(isOwn || me?.role === 'admin') && (
              <>
                <button onClick={() => resolve.mutate({ threadId: thread.id, isResolved: !thread.isResolved })}
                  className="text-[10px] transition-colors hover:text-green-600"
                  style={{ color: 'var(--color-text-muted)' }}>
                  {thread.isResolved ? 'Reopen' : 'Mark resolved'}
                </button>
                <button onClick={() => del.mutate(thread.id)}
                  className="text-[10px] transition-colors hover:text-red-500"
                  style={{ color: 'var(--color-text-muted)' }}>
                  Delete
                </button>
              </>
            )}
          </div>
        </div>
      </div>
      {expanded && <CommentList thread={thread} lessonId={lessonId} />}
    </div>
  )
}

/* ─── Main panel ─────────────────────────────────── */
export function DiscussionPanel({ lessonId }: { lessonId: string }) {
  const { data: threads, isLoading } = useThreads(lessonId)
  const createThread = useCreateThread(lessonId)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ title: '', body: '' })

  const submit = async () => {
    if (!form.body.trim()) return
    await createThread.mutateAsync({ title: form.title.trim() || undefined, body: form.body.trim() })
    setForm({ title: '', body: '' })
    setShowForm(false)
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>
          Questions & Answers
        </p>
        <button onClick={() => setShowForm(f => !f)}
          className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-white transition-opacity hover:opacity-80"
          style={{ background: 'var(--color-primary)' }}>
          <PlusCircle size={11} /> Ask
        </button>
      </div>

      {showForm && (
        <div className="rounded-xl p-3 space-y-2" style={{ background: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)' }}>
          <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            placeholder="Title (optional)"
            className="w-full rounded-lg px-3 py-1.5 text-xs outline-none"
            style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }} />
          <textarea value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
            placeholder="Describe your question…"
            rows={3}
            className="w-full resize-none rounded-lg px-3 py-1.5 text-xs outline-none"
            style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }} />
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowForm(false)} className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Cancel</button>
            <button onClick={submit} disabled={!form.body.trim() || createThread.isPending}
              className="rounded-lg px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
              style={{ background: 'var(--color-primary)' }}>
              {createThread.isPending ? 'Posting…' : 'Post'}
            </button>
          </div>
        </div>
      )}

      {isLoading
        ? <div className="flex justify-center py-8"><Spinner size={18} variant="gray" /></div>
        : threads?.length === 0
          ? (
            <div className="py-8 text-center">
              <MessageSquare size={24} className="mx-auto mb-2" style={{ color: 'var(--color-border)' }} />
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>No questions yet. Ask the first one!</p>
            </div>
          )
          : <div className="space-y-2">{threads?.map(t => <ThreadCard key={t.id} thread={t} lessonId={lessonId} />)}</div>
      }
    </div>
  )
}
