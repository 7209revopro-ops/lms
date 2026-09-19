'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Video, Plus, Trash2, Calendar, Clock, Link as LinkIcon,
  X, AlertCircle, CheckCircle2, Radio, Zap,
  ExternalLink, Tv2, Copy, Eye, EyeOff, PlayCircle, Square,
  BookOpen, Monitor, Pencil, Search, ChevronLeft, ChevronRight,
} from 'lucide-react'
import {
  useLiveClassesForCourse, useCreateLiveClass, useDeleteLiveClass,
  useUpdateLiveClass, useStartLiveStream, useEndLiveStream, useStreamCredentials,
  isInteractiveRoom,
  type LiveClass, type LiveClassType, type LiveClassStatus,
} from '@/lib/api/liveClasses'
import { useCourseOutline } from '@/lib/api/outline'
import { datetimeLocalToISO } from '@/lib/timezone'
import { useUsers } from '@/lib/api/users'
import { EditLiveClassModal } from '@/components/live-classes/EditLiveClassModal'
import {
  useAcademyView, SharedAcademiesChip, GuestReadOnlyNote,
} from '@/components/live-classes/CrossAcademy'
import Spinner from '@/components/ui/Spinner'

/* ── Helpers ──────────────────────────────────────────── */
function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

function fmtDuration(mins: number): string {
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

function statusColor(status: LiveClassStatus): string {
  switch (status) {
    case 'live':      return '#EF4444'
    case 'ended':     return '#22C55E'
    case 'cancelled': return 'rgba(255,255,255,0.35)'
    default:          return '#818CF8'
  }
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(() => {})
}

/* ── Stream credentials panel ─────────────────────────── */
function CredentialsPanel({ liveId }: { liveId: string }) {
  const [revealed, setRevealed] = useState(false)
  const [copiedKey, setCopiedKey] = useState(false)
  const { data, isFetching, refetch } = useStreamCredentials(liveId)

  const handleReveal = async () => {
    if (!data) await refetch()
    setRevealed(v => !v)
  }

  const handleCopyKey = () => {
    if (data?.streamKey) {
      copyToClipboard(data.streamKey)
      setCopiedKey(true)
      setTimeout(() => setCopiedKey(false), 2000)
    }
  }

  const inputStyle = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }

  return (
    <div className="mt-2.5 rounded-xl p-3 space-y-2.5" style={inputStyle}>
      <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.35)' }}>
        OBS / Streaming software
      </p>

      {/* RTMP URL — always shown */}
      <div className="space-y-1">
        <span className="text-[10px]" style={{ color: 'rgba(255,255,255,0.4)' }}>RTMP URL</span>
        <div className="flex items-center gap-2">
          <code className="flex-1 truncate rounded-lg px-2.5 py-1.5 text-[11px] font-mono text-white"
            style={{ background: 'rgba(255,255,255,0.06)' }}>
            rtmps://global-live.mux.com:443/app
          </code>
          <button
            onClick={() => copyToClipboard('rtmps://global-live.mux.com:443/app')}
            className="flex-shrink-0 rounded-lg p-1.5 transition-colors hover:bg-white/10"
            title="Copy RTMP URL">
            <Copy size={11} style={{ color: 'rgba(255,255,255,0.5)' }} />
          </button>
        </div>
      </div>

      {/* Stream key */}
      <div className="space-y-1">
        <span className="text-[10px]" style={{ color: 'rgba(255,255,255,0.4)' }}>Stream key</span>
        <div className="flex items-center gap-2">
          <code className="flex-1 truncate rounded-lg px-2.5 py-1.5 text-[11px] font-mono text-white"
            style={{ background: 'rgba(255,255,255,0.06)' }}>
            {isFetching
              ? 'Loading…'
              : !data
              ? '••••••••••••••••••••••••'
              : revealed
              ? data.streamKey
              : '•'.repeat(Math.min(data.streamKey.length, 32))}
          </code>
          <button onClick={handleReveal} className="flex-shrink-0 rounded-lg p-1.5 transition-colors hover:bg-white/10"
            title={revealed ? 'Hide key' : 'Show key'}>
            {isFetching
              ? <Spinner size={11} variant="muted" />
              : revealed
              ? <EyeOff size={11} style={{ color: 'rgba(255,255,255,0.5)' }} />
              : <Eye size={11} style={{ color: 'rgba(255,255,255,0.5)' }} />}
          </button>
          <button onClick={handleCopyKey} disabled={!data}
            className="flex-shrink-0 rounded-lg p-1.5 transition-colors hover:bg-white/10 disabled:opacity-30"
            title="Copy stream key">
            {copiedKey
              ? <CheckCircle2 size={11} style={{ color: '#22C55E' }} />
              : <Copy size={11} style={{ color: 'rgba(255,255,255,0.5)' }} />}
          </button>
        </div>
      </div>

      <p className="text-[10px]" style={{ color: 'rgba(255,255,255,0.25)' }}>
        Paste these into OBS → Settings → Stream. Keep the stream key private.
      </p>
    </div>
  )
}

/* ── Single live class row ────────────────────────────── */
function LiveRow({
  live, courseId,
}: {
  live:     LiveClass
  courseId: string
}) {
  const router          = useRouter()
  const [confirming,    setConfirming]    = useState<'cancel' | 'delete' | null>(null)
  const [showCreds,     setShowCreds]     = useState(false)
  const [startError,    setStartError]    = useState<string | null>(null)
  const [editOpen,      setEditOpen]      = useState(false)
  const updateMutation  = useUpdateLiveClass(courseId)
  const startMutation   = useStartLiveStream(courseId)
  const endMutation     = useEndLiveStream(courseId)
  const deleteMutation  = useDeleteLiveClass(courseId)

  /* A GUEST ACADEMY ADMINISTERS ITS SEATS, NOT THE CLASS.

     This row is reached through the guest's OWN course — a shared class is
     listed under every door it serves — and it used to draw the owner's full
     control set: Edit, Delete, Cancel, Go Live, End, OBS and the stream key.
     Every one of those routes funnels through #canManage, which compares the
     caller's academy against the HOST's, so all of them answered
     404 "Live class not found". The controls were not merely useless, they
     told a Bangalore admin that a Dubai session was theirs to cancel.

     Deliberate, and staying that way: only SEATS are shared. So the row goes
     read-only and says whose class it is instead. */
  const { isHost, hostLabel } = useAcademyView(live)

  const isInternal  = live.type === 'internal'
  /* A CLT room has no stream key and no OBS endpoint, so the Mux-only controls
     below must not be offered for one. Same two-signal test the studio, monitor
     and watch pages use, so every surface agrees about what a class is. */
  const isRoom      = isInteractiveRoom(live)
  const isMuxStream = isInternal && !isRoom
  const isLiveNow   = live.status === 'live'
  const isScheduled = live.status === 'scheduled'
  const isEnded     = live.status === 'ended'
  const isCancelled = live.status === 'cancelled'
  const borderColor = isLiveNow ? 'rgba(239,68,68,0.35)' : 'rgba(255,255,255,0.07)'

  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
      className="rounded-xl px-3 py-2.5"
      style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${borderColor}` }}>

      <div className="flex items-center gap-3">
        {/* Icon */}
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg"
          style={{ background: isLiveNow ? 'rgba(239,68,68,0.12)' : isInternal ? 'rgba(0,87,184,0.10)' : 'rgba(99,102,241,0.10)' }}>
          {isLiveNow
            ? <motion.div animate={{ opacity: [1, 0.4, 1] }} transition={{ duration: 1.4, repeat: Infinity }}>
                <Radio size={14} style={{ color: '#EF4444' }} />
              </motion.div>
            : isInternal
            ? <Tv2 size={14} style={{ color: isCancelled ? 'rgba(255,255,255,0.25)' : '#0057b8' }} />
            : <Calendar size={14} style={{ color: isCancelled ? 'rgba(255,255,255,0.25)' : '#818CF8' }} />}
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {/* Status badge */}
            {isLiveNow && (
              <motion.span animate={{ opacity: [1, 0.5, 1] }} transition={{ duration: 1.4, repeat: Infinity }}
                className="rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-white"
                style={{ background: '#EF4444' }}>● LIVE</motion.span>
            )}
            {isCancelled && (
              <span className="rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest"
                style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.4)' }}>Cancelled</span>
            )}
            {isEnded && (
              <span className="rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest"
                style={{ background: 'rgba(34,197,94,0.12)', color: '#22C55E' }}>Ended</span>
            )}
            {/* Type badge */}
            <span className="rounded-md px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-widest"
              style={{
                background: isInternal ? 'rgba(0,87,184,0.12)' : 'rgba(99,102,241,0.12)',
                color:      isInternal ? '#0057b8' : '#818CF8',
              }}>
              {isInternal ? 'In-App' : 'External'}
            </span>
            <SharedAcademiesChip live={live} />
            <p className={`truncate text-sm font-semibold ${isCancelled ? 'line-through opacity-50' : ''}`}
              style={{ color: 'white' }}>
              {live.title}
            </p>
          </div>

          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px]"
            style={{ color: 'rgba(255,255,255,0.4)' }}>
            <span className="flex items-center gap-1">
              <Calendar size={9} />{fmtDateTime(live.scheduledStart)}
            </span>
            <span style={{ color: 'rgba(255,255,255,0.15)' }}>·</span>
            <span className="flex items-center gap-1">
              <Clock size={9} />{fmtDuration(live.durationMins)}
            </span>
            {isLiveNow && live.viewerCount > 0 && (
              <span className="font-semibold" style={{ color: '#EF4444' }}>
                {live.viewerCount.toLocaleString()} watching
              </span>
            )}
            {isEnded && live.recordingUrl && (
              <span className="font-semibold" style={{ color: '#22C55E' }}>Recording ready</span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {/* Internal Mux only: Start stream → monitor page (OBS).
              A CLT room is started by walking into it, not by an encoder. */}
          {isHost && isMuxStream && isScheduled && (
            <button
              onClick={async () => {
                setStartError(null)
                try {
                  await startMutation.mutateAsync(live.id)
                  router.push(`/live-classes/${live.id}/monitor`)
                } catch (err: any) {
                  setStartError(err?.response?.data?.error?.message ?? 'Failed to start stream')
                }
              }}
              disabled={startMutation.isPending}
              title="Start with OBS"
              className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-[10px] font-bold text-white disabled:opacity-50 hover:brightness-110 transition-all"
              style={{ background: 'linear-gradient(135deg, #0057b8, #EF4444)' }}>
              {startMutation.isPending ? <Spinner size={9} /> : <PlayCircle size={9} />}
              OBS
            </button>
          )}

          {/* Internal: Stream from Browser → studio page */}
          {isHost && isInternal && isScheduled && (
            <button
              onClick={() => router.push(`/live-classes/${live.id}/studio`)}
              title="Stream from browser"
              className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-[10px] font-bold transition-all hover:brightness-110"
              style={{ background: 'rgba(0,87,184,0.15)', border: '1px solid rgba(0,87,184,0.30)', color: '#0057b8' }}>
              <Monitor size={9} />Browser
            </button>
          )}

          {/* Internal: Monitor button when already live */}
          {isHost && isInternal && isLiveNow && (
            <button
              onClick={() => router.push(`/live-classes/${live.id}/monitor`)}
              className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-[10px] font-bold text-white hover:brightness-110 transition-all"
              style={{ background: '#EF4444' }}>
              <Radio size={9} />Monitor
            </button>
          )}

          {/* Internal: End stream button */}
          {isHost && isInternal && isLiveNow && (
            confirming === 'cancel' ? (
              <button
                onClick={() => { endMutation.mutate(live.id); setConfirming(null) }}
                className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-[10px] font-bold text-white"
                style={{ background: '#EF4444' }}>
                <CheckCircle2 size={9} />Confirm end
              </button>
            ) : (
              <button
                onClick={() => setConfirming('cancel')}
                disabled={endMutation.isPending}
                className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-[10px] font-bold text-white disabled:opacity-50 hover:brightness-110 transition-all"
                style={{ background: 'rgba(239,68,68,0.80)' }}>
                {endMutation.isPending ? <Spinner size={9} /> : <Square size={9} />}
                End stream
              </button>
            )
          )}

          {/* Internal Mux only: OBS credentials — a CLT room has none */}
          {isHost && isMuxStream && (isScheduled || isLiveNow) && (
            <button
              onClick={() => setShowCreds(v => !v)}
              className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-[10px] font-semibold transition-colors hover:bg-white/10"
              style={{ color: 'rgba(255,255,255,0.6)' }}>
              <Zap size={9} />Creds
            </button>
          )}

          {/* Internal: Watch recording */}
          {isInternal && isEnded && live.recordingUrl && (
            <a href={live.recordingUrl} target="_blank" rel="noreferrer"
              className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-[10px] font-semibold transition-colors hover:bg-white/10"
              style={{ color: '#22C55E' }}>
              <BookOpen size={9} />Recording
            </a>
          )}

          {/* External: Go Live Now — sets status to live */}
          {isHost && !isInternal && isScheduled && (
            <button
              onClick={() => updateMutation.mutate({ id: live.id, data: { status: 'live', scheduledStart: new Date().toISOString() } })}
              disabled={updateMutation.isPending}
              title="Mark as live now"
              className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-[10px] font-bold text-white disabled:opacity-50 hover:brightness-110 transition-all"
              style={{ background: 'linear-gradient(135deg, #0057b8, #EF4444)' }}>
              {updateMutation.isPending ? <Spinner size={9} /> : <Zap size={9} />}
              Go Live
            </button>
          )}

          {/* External: Join button when live */}
          {!isInternal && isLiveNow && live.meetingUrl && (
            <a href={live.meetingUrl} target="_blank" rel="noreferrer"
              className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-[10px] font-bold text-white hover:brightness-110 transition-all"
              style={{ background: '#EF4444' }}>
              <ExternalLink size={9} />Join
            </a>
          )}

          {/* External: End session button when live */}
          {isHost && !isInternal && isLiveNow && (
            confirming === 'cancel' ? (
              <button
                onClick={() => { updateMutation.mutate({ id: live.id, data: { status: 'ended' } }); setConfirming(null) }}
                className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-[10px] font-bold text-white"
                style={{ background: '#EF4444' }}>
                <CheckCircle2 size={9} />Confirm end
              </button>
            ) : (
              <button
                onClick={() => setConfirming('cancel')}
                disabled={updateMutation.isPending}
                className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-[10px] font-bold text-white disabled:opacity-50 hover:brightness-110 transition-all"
                style={{ background: 'rgba(239,68,68,0.80)' }}>
                {updateMutation.isPending ? <Spinner size={9} /> : <Square size={9} />}
                End session
              </button>
            )
          )}

          {/* Cancel session (scheduled only) — sets status to cancelled */}
          {isHost && isScheduled && (
            confirming === 'cancel' ? (
              <button
                onClick={() => { updateMutation.mutate({ id: live.id, data: { status: 'cancelled' } }); setConfirming(null) }}
                className="rounded-lg px-2 py-1 text-[10px] font-semibold text-white"
                style={{ background: '#F59E0B' }}>Confirm cancel</button>
            ) : (
              <button onClick={() => setConfirming('cancel')}
                className="rounded-lg px-2 py-1 text-[10px] font-semibold transition-colors hover:bg-white/10"
                style={{ color: 'rgba(255,255,255,0.5)' }}>Cancel</button>
            )
          )}

          {/* Edit */}
          {isHost && (
            <button
              onClick={() => setEditOpen(true)}
              className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-white/10"
              style={{ color: 'rgba(255,255,255,0.45)' }}
              title="Edit session">
              <Pencil size={11} />
            </button>
          )}

          {/* Delete */}
          {isHost && (confirming === 'delete' ? (
            <button
              onClick={() => { deleteMutation.mutate(live.id); setConfirming(null) }}
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-semibold text-white"
              style={{ background: '#EF4444' }}>
              <CheckCircle2 size={9} />Confirm
            </button>
          ) : (
            <button onClick={() => setConfirming('delete')}
              className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-red-500/15"
              style={{ color: 'rgba(255,255,255,0.5)' }}>
              <Trash2 size={12} />
            </button>
          ))}

          {/* Nothing above renders for a guest academy, so say why. */}
          {!isHost && <GuestReadOnlyNote hostLabel={hostLabel} />}
        </div>
      </div>

      {/* Start error */}
      {startError && (
        <p className="mt-1.5 flex items-center gap-1.5 text-[11px]" style={{ color: '#F87171' }}>
          <AlertCircle size={10} />{startError}
        </p>
      )}

      {/* RTMP credentials panel (inline expand) */}
      <AnimatePresence>
        {showCreds && isInternal && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden">
            <CredentialsPanel liveId={live.id} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Edit modal */}
      <AnimatePresence>
        {editOpen && (
          <EditLiveClassModal
            live={live}
            onClose={() => setEditOpen(false)}
            onSuccess={() => setEditOpen(false)}
          />
        )}
      </AnimatePresence>
    </motion.div>
  )
}

/* ── Create form ──────────────────────────────────────── */
function CreateForm({
  courseId, pending, onSubmit, error,
}: {
  courseId: string
  pending:  boolean
  onSubmit: (data: {
    courseId:         string
    title:            string
    description?:     string
    scheduledStart:   string
    durationMins:     number
    sessionCapacity?: number
    type:             LiveClassType
    meetingUrl?:      string
    sectionId?:       string
    instructorId?:    string
  }) => Promise<void>
  error: string | null
}) {
  const [type,            setType]            = useState<LiveClassType>('external')
  const [title,           setTitle]           = useState('')
  const [description,     setDescription]     = useState('')
  const [start,           setStart]           = useState('')
  const [durationMins,    setDurationMins]    = useState(60)
  const [sessionCapacity, setSessionCapacity] = useState<number | ''>(500)
  const [meetingUrl,      setMeetingUrl]      = useState('')
  const [sectionId,       setSectionId]       = useState('')
  const [instructorId,    setInstructorId]    = useState('')

  const { data: outline } = useCourseOutline(courseId)
  const sections = outline?.sections ?? []

  const { data: instructorsData } = useUsers('instructor', { per_page: 200 })
  const instructors = instructorsData?.docs ?? []

  const handle = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title || !start) return
    if (type === 'external' && !meetingUrl) return
    const iso = datetimeLocalToISO(start)
    await onSubmit({
      courseId,
      title,
      description:     description || undefined,
      scheduledStart:  iso,
      durationMins,
      sessionCapacity: sessionCapacity !== '' ? sessionCapacity : undefined,
      type,
      meetingUrl:      type === 'external' ? meetingUrl : undefined,
      sectionId:       sectionId || undefined,
      instructorId:    instructorId || undefined,
    })
    setTitle(''); setDescription(''); setStart(''); setMeetingUrl('')
    setDurationMins(60); setSessionCapacity(500); setSectionId(''); setInstructorId('')
  }

  /* colorScheme: 'dark' — see the note in EditLiveClassModal. The
     datetime-local below is unusable without it: its picker button is drawn
     dark-on-dark. */
  const inputStyle = { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', colorScheme: 'dark' } as const
  const selStyle   = { background: '#1e2035', border: '1px solid rgba(255,255,255,0.12)', color: 'white', colorScheme: 'dark' } as const
  const base = 'w-full rounded-xl px-3 py-2 text-sm text-white outline-none placeholder:text-white/30'

  return (
    <motion.form onSubmit={handle}
      initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
      className="overflow-hidden">
      <div className="rounded-2xl p-4 space-y-3"
        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>

        {/* Type selector */}
        <div className="flex gap-2">
          {(['external', 'internal'] as const).map(t => (
            <button key={t} type="button" onClick={() => setType(t)}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-semibold transition-all"
              style={type === t
                ? { background: t === 'internal' ? 'rgba(0,87,184,0.20)' : 'rgba(99,102,241,0.20)',
                    color:      t === 'internal' ? '#0057b8' : '#818CF8',
                    border:     `1px solid ${t === 'internal' ? 'rgba(0,87,184,0.35)' : 'rgba(99,102,241,0.35)'}` }
                : { background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.45)',
                    border: '1px solid rgba(255,255,255,0.08)' }}>
              {t === 'internal' ? <Tv2 size={11} /> : <ExternalLink size={11} />}
              {t === 'internal' ? 'In-App Stream' : 'External Link'}
            </button>
          ))}
        </div>

        {/* Internal type hint */}
        {type === 'internal' && (
          <p className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-[11px]"
            style={{ background: 'rgba(0,87,184,0.08)', color: 'rgba(0,87,184,0.85)', border: '1px solid rgba(0,87,184,0.18)' }}>
            <Tv2 size={11} />
            RTMP credentials (for OBS) are generated after saving.
          </p>
        )}

        <input value={title} onChange={e => setTitle(e.target.value)} required minLength={3} maxLength={255}
          placeholder="Session title (e.g. Week 2 Q&A)"
          className={base} style={inputStyle} />

        <input value={description} onChange={e => setDescription(e.target.value)} maxLength={2000}
          placeholder="Short description (optional)"
          className={base} style={inputStyle} />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr_1fr]">
          <input value={start} onChange={e => setStart(e.target.value)} type="datetime-local" required
            className={base} style={inputStyle} />
          <input value={durationMins} onChange={e => setDurationMins(Number(e.target.value))}
            type="number" min={5} max={600} step={5}
            placeholder="Duration (mins)"
            className={base} style={inputStyle} />
          <input
            value={sessionCapacity}
            onChange={e => setSessionCapacity(e.target.value === '' ? '' : Number(e.target.value))}
            type="number" min={1} max={10000} step={1}
            placeholder="Max seats"
            className={base} style={inputStyle} />
        </div>

        {/* Module (Section) */}
        {sections.length > 0 && (
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-widest"
              style={{ color: 'rgba(255,255,255,0.35)' }}>Module (optional)</label>
            <select value={sectionId} onChange={e => setSectionId(e.target.value)}
              className={base} style={{ ...selStyle }}>
              <option value="">No specific module</option>
              {sections.map(s => (
                <option key={s.id} value={s.id}>{s.title}</option>
              ))}
            </select>
          </div>
        )}

        {/* Meeting URL — only for external */}
        {type === 'external' && (
          <div className="relative">
            <LinkIcon size={13} className="absolute left-3 top-1/2 -translate-y-1/2"
              style={{ color: 'rgba(255,255,255,0.4)' }} />
            <input value={meetingUrl} onChange={e => setMeetingUrl(e.target.value)} type="url" required maxLength={2048}
              placeholder="https://zoom.us/j/123456789"
              className={`${base} pl-9`} style={inputStyle} />
          </div>
        )}

        {/* Instructor */}
        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-widest"
            style={{ color: 'rgba(255,255,255,0.35)' }}>Instructor</label>
          <select value={instructorId} onChange={e => setInstructorId(e.target.value)}
            className={base} style={{ ...selStyle }}>
            <option value="">Default (you)</option>
            {instructors.map(i => (
              <option key={i.id} value={i.id}>{i.name}</option>
            ))}
          </select>
        </div>

        {error && (
          <p className="flex items-center gap-1.5 text-xs" style={{ color: '#F87171' }}>
            <AlertCircle size={11} />{error}
          </p>
        )}

        <div className="flex justify-end">
          <button type="submit" disabled={pending}
            className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg, #0057b8, #003d80)' }}>
            {pending
              ? <><Spinner size={11} />Scheduling…</>
              : <>Schedule session</>}
          </button>
        </div>
      </div>
    </motion.form>
  )
}

/* ── Section ──────────────────────────────────────────── */
interface Props { courseId: string }

const STATUS_FILTERS = [
  { key: 'all',       label: 'All' },
  { key: 'live',      label: 'Live' },
  { key: 'scheduled', label: 'Upcoming' },
  { key: 'ended',     label: 'Ended' },
  { key: 'cancelled', label: 'Cancelled' },
] as const

const PAGE_SIZE = 8

export function LiveClassesSection({ courseId }: Props) {
  const { data: items, isLoading }   = useLiveClassesForCourse(courseId)
  const createMutation               = useCreateLiveClass()
  const [showForm, setShowForm]      = useState(false)
  const [error,    setError]         = useState<string | null>(null)
  const [search,   setSearch]        = useState('')
  const [statusFilter, setStatusFilter] = useState<typeof STATUS_FILTERS[number]['key']>('all')
  const [page,     setPage]          = useState(1)

  const filtered = useMemo(() => {
    let list = items ?? []
    if (statusFilter !== 'all') list = list.filter(l => l.status === statusFilter)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(l => l.title.toLowerCase().includes(q))
    }
    return list
  }, [items, statusFilter, search])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage   = Math.min(page, totalPages)
  const paged      = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  const upcoming = paged.filter(l => l.status === 'scheduled' || l.status === 'live')
  const past     = paged.filter(l => l.status === 'ended' || l.status === 'cancelled')

  const handleSearchChange = (v: string) => { setSearch(v); setPage(1) }
  const handleStatusChange = (v: typeof STATUS_FILTERS[number]['key']) => { setStatusFilter(v); setPage(1) }

  return (
    <section className="mt-6 rounded-2xl p-5 space-y-4"
      style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)' }}>

      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Video size={14} style={{ color: '#0057b8' }} />
          <h3 className="text-base font-bold text-white" style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}>
            Live classes
          </h3>
          {items && (
            <span className="rounded-md px-1.5 py-0.5 text-[10px] font-bold"
              style={{ background: 'rgba(0,87,184,0.15)', color: '#0057b8' }}>
              {items.length}
            </span>
          )}
        </div>
        <button onClick={() => { setShowForm(v => !v); setError(null) }}
          className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold text-white"
          style={{ background: showForm ? 'rgba(255,255,255,0.06)' : 'linear-gradient(135deg, #0057b8, #003d80)' }}>
          {showForm ? <><X size={12} />Cancel</> : <><Plus size={12} />New session</>}
        </button>
      </div>

      {/* Search + status filter */}
      {(items?.length ?? 0) > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[160px]">
            <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
              style={{ color: 'rgba(255,255,255,0.3)' }} />
            <input
              value={search}
              onChange={e => handleSearchChange(e.target.value)}
              placeholder="Search sessions…"
              className="w-full rounded-xl py-1.5 pl-7 pr-7 text-xs text-white outline-none placeholder:text-white/25"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
            />
            {search && (
              <button onClick={() => handleSearchChange('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 transition-opacity hover:opacity-70"
                style={{ color: 'rgba(255,255,255,0.4)' }}>
                <X size={11} />
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1">
            {STATUS_FILTERS.map(f => (
              <button key={f.key} onClick={() => handleStatusChange(f.key)}
                className="rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-all"
                style={statusFilter === f.key
                  ? { background: 'rgba(0,87,184,0.18)', color: '#0057b8', border: '1px solid rgba(0,87,184,0.30)' }
                  : { background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.40)', border: '1px solid rgba(255,255,255,0.07)' }}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <AnimatePresence>
        {showForm && (
          <CreateForm
            courseId={courseId}
            pending={createMutation.isPending}
            error={error}
            onSubmit={async (data) => {
              setError(null)
              try {
                await createMutation.mutateAsync(data)
                setShowForm(false)
              } catch (err: any) {
                setError(
                  err?.response?.data?.error?.message
                  ?? err?.response?.data?.error?.details?.[0]?.message
                  ?? 'Could not schedule the session.'
                )
              }
            }} />
        )}
      </AnimatePresence>

      {isLoading && (
        <div className="flex items-center gap-2 text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
          <Spinner size={12} />Loading…
        </div>
      )}

      {!isLoading && filtered.length === 0 && !showForm && (
        <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
          {search || statusFilter !== 'all'
            ? 'No sessions match your filters.'
            : <>No live classes scheduled yet. Click <span className="text-white font-semibold">New session</span> to add one.</>}
        </p>
      )}

      {upcoming.length > 0 && (
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest"
            style={{ color: 'rgba(255,255,255,0.35)' }}>Upcoming & Live</p>
          <div className="space-y-2">
            {upcoming.map(l => <LiveRow key={l.id} live={l} courseId={courseId} />)}
          </div>
        </div>
      )}

      {past.length > 0 && (
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest"
            style={{ color: 'rgba(255,255,255,0.35)' }}>Past & Cancelled</p>
          <div className="space-y-2">
            {past.map(l => <LiveRow key={l.id} live={l} courseId={courseId} />)}
          </div>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-1">
          <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.35)' }}>
            {filtered.length} session{filtered.length !== 1 ? 's' : ''} · page {safePage} of {totalPages}
          </span>
          <div className="flex gap-1">
            <button
              disabled={safePage <= 1}
              onClick={() => setPage(p => Math.max(1, p - 1))}
              className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors disabled:opacity-30 hover:bg-white/10"
              style={{ color: 'rgba(255,255,255,0.6)' }}>
              <ChevronLeft size={13} />
            </button>
            <button
              disabled={safePage >= totalPages}
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors disabled:opacity-30 hover:bg-white/10"
              style={{ color: 'rgba(255,255,255,0.6)' }}>
              <ChevronRight size={13} />
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
