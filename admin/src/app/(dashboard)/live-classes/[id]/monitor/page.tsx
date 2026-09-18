'use client'

import { use, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Radio, Square, ChevronLeft, Users, Clock,
  AlertCircle, Calendar, Tv2, CheckCircle2,
  Wifi, WifiOff, BookOpen, Monitor, Copy, Eye, EyeOff,
} from 'lucide-react'
import MuxPlayer from '@mux/mux-player-react'
import Spinner from '@/components/ui/Spinner'
import {
  useLiveClassById, useStartLiveStreamById, useEndLiveStreamById,
  useStreamCredentials, useRecreateLiveStream, isInteractiveRoom,
} from '@/lib/api/liveClasses'
import { ClassEntryPanel } from '@/components/live-classes/ClassEntryPanel'

/* ── Inline OBS credentials panel ─────────────────────── */
function ObsCredsInline({ liveId }: { liveId: string }) {
  const [open,      setOpen]      = useState(false)
  const [revealed,  setRevealed]  = useState(false)
  const [copiedUrl, setCopiedUrl] = useState(false)
  const [copiedKey, setCopiedKey] = useState(false)
  const { data, isFetching, refetch } = useStreamCredentials(liveId)

  const handleOpen = async () => {
    if (!open && !data) await refetch()
    setOpen(v => !v)
  }
  const copy = (text: string, which: 'url' | 'key') => {
    navigator.clipboard.writeText(text).catch(() => {})
    if (which === 'url') { setCopiedUrl(true); setTimeout(() => setCopiedUrl(false), 2000) }
    else                 { setCopiedKey(true); setTimeout(() => setCopiedKey(false), 2000) }
  }

  return (
    <div className="mt-2 space-y-1.5">
      <button
        onClick={handleOpen}
        className="flex items-center gap-1.5 text-xs font-semibold transition-opacity hover:opacity-70"
        style={{ color: '#0057b8' }}>
        {isFetching
          ? <Spinner size={11} />
          : open ? <EyeOff size={11} /> : <Eye size={11} />}
        {open ? 'Hide credentials' : 'Show stream credentials'}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="space-y-1.5 rounded-xl p-2.5"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>

              {/* RTMP URL */}
              <div className="flex items-center gap-1.5">
                <code className="flex-1 truncate rounded-lg px-2 py-1 text-[10px] font-mono text-white"
                  style={{ background: 'rgba(255,255,255,0.06)' }}>
                  rtmps://global-live.mux.com:443/app
                </code>
                <button onClick={() => copy('rtmps://global-live.mux.com:443/app', 'url')}
                  className="flex-shrink-0 rounded-lg p-1 transition-colors hover:bg-white/10">
                  {copiedUrl
                    ? <CheckCircle2 size={10} style={{ color: '#22C55E' }} />
                    : <Copy size={10} style={{ color: 'rgba(255,255,255,0.45)' }} />}
                </button>
              </div>

              {/* Stream key */}
              <div className="flex items-center gap-1.5">
                <code className="flex-1 truncate rounded-lg px-2 py-1 text-[10px] font-mono text-white"
                  style={{ background: 'rgba(255,255,255,0.06)' }}>
                  {!data ? '••••••••••••••••••••••' : revealed ? data.streamKey : '•'.repeat(Math.min(data.streamKey.length, 28))}
                </code>
                <button onClick={() => setRevealed(v => !v)}
                  className="flex-shrink-0 rounded-lg p-1 transition-colors hover:bg-white/10">
                  {revealed
                    ? <EyeOff size={10} style={{ color: 'rgba(255,255,255,0.45)' }} />
                    : <Eye    size={10} style={{ color: 'rgba(255,255,255,0.45)' }} />}
                </button>
                <button onClick={() => data && copy(data.streamKey, 'key')} disabled={!data}
                  className="flex-shrink-0 rounded-lg p-1 transition-colors hover:bg-white/10 disabled:opacity-30">
                  {copiedKey
                    ? <CheckCircle2 size={10} style={{ color: '#22C55E' }} />
                    : <Copy size={10} style={{ color: 'rgba(255,255,255,0.45)' }} />}
                </button>
              </div>

              <p className="text-[9px]" style={{ color: 'rgba(255,255,255,0.25)' }}>
                Keep the stream key private — anyone with it can broadcast to this session.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ── Elapsed timer ─────────────────────────────────────── */
function useElapsed(startedAt: string | undefined): string {
  const [secs, setSecs] = useState(0)

  useEffect(() => {
    if (!startedAt) { setSecs(0); return }
    const update = () => setSecs(Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)))
    update()
    const t = setInterval(update, 1000)
    return () => clearInterval(t)
  }, [startedAt])

  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/* ── Countdown to scheduled time ───────────────────────── */
function useCountdown(scheduledStart: string | undefined): string {
  const [label, setLabel] = useState('')
  useEffect(() => {
    if (!scheduledStart) return
    const update = () => {
      const diff = new Date(scheduledStart).getTime() - Date.now()
      if (diff <= 0) { setLabel('Now'); return }
      const s    = Math.floor(diff / 1000)
      const days = Math.floor(s / 86400)
      if (days >= 1) { setLabel(`in ${days}d ${Math.floor((s % 86400) / 3600)}h`); return }
      const hrs  = Math.floor(s / 3600)
      if (hrs >= 1) { setLabel(`in ${hrs}h ${Math.floor((s % 3600) / 60)}m`); return }
      const mins = Math.floor(s / 60)
      setLabel(`in ${mins}m ${s % 60}s`)
    }
    update()
    const t = setInterval(update, 1000)
    return () => clearInterval(t)
  }, [scheduledStart])
  return label
}

import { zoneOf, foreignZoneTag } from '@/lib/timezone'

function fmtDateTime(iso: string, tz?: string) {
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
    ...(tz ? { timeZone: tz } : {}),
  })
}

function fmtDuration(mins: number) {
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60), m = mins % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

/* ── Page ──────────────────────────────────────────────── */
export default function MonitorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id }   = use(params)
  const router   = useRouter()

  const { data: live, isLoading, isError } = useLiveClassById(id)
  const startMutation    = useStartLiveStreamById(id)
  const endMutation      = useEndLiveStreamById(id)
  const recreateMutation = useRecreateLiveStream(id)

  const elapsed  = useElapsed(live?.startedAt)
  const countdown = useCountdown(live?.scheduledStart)

  const [confirmEnd,    setConfirmEnd]    = useState(false)
  const [startError,    setStartError]    = useState<string | null>(null)
  const [recreateMsg,   setRecreateMsg]   = useState<string | null>(null)
  const [recreateCount, setRecreateCount] = useState(0)
  const prevStatus = useRef<string | undefined>(undefined)

  /* Auto-navigate back to course edit when stream ends */
  useEffect(() => {
    if (prevStatus.current === 'live' && live?.status === 'ended' && live.course?.id) {
      setTimeout(() => router.push(`/courses/${live.course!.id}/edit`), 3000)
    }
    prevStatus.current = live?.status
  }, [live?.status, live?.course?.id, router])

  /* ── Loading ── */
  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner size={28} />
      </div>
    )
  }

  /* ── Error ── */
  if (isError || !live) {
    return (
      <div className="mx-auto max-w-md py-20 text-center">
        <AlertCircle size={32} className="mx-auto mb-4" style={{ color: '#EF4444' }} />
        <p className="font-bold text-white">Live class not found</p>
        <Link href="/courses" className="mt-4 inline-block text-sm" style={{ color: '#0057b8' }}>
          ← Back to courses
        </Link>
      </div>
    )
  }

  const isScheduled = live.status === 'scheduled'
  const isLiveNow   = live.status === 'live'
  const isEnded     = live.status === 'ended'
  const isCancelled = live.status === 'cancelled'

  const courseHref = live.course?.id ? `/courses/${live.course.id}/edit` : '/courses'

  /* ── Interactive room (LiveKit) ──────────────────────────────────────
     Everything below this line is Mux: a stream key, an OBS server address,
     "Go Live Now". A CLT room has none of those — its media exists only
     inside the room — so this page was offering an instructor an OBS setup
     and an error, for a class that needed neither.

     Branched AFTER the ended/cancelled state on purpose: a finished class is
     better served by the recording screen below than by a join button that
     can only refuse. */
  if (!isEnded && !isCancelled && isInteractiveRoom(live)) {
    return (
      <div className="mx-auto max-w-6xl">
        <Link href={courseHref} className="mb-4 inline-flex items-center gap-1.5 text-xs font-semibold"
          style={{ color: 'rgba(255,255,255,0.45)' }}>
          <ChevronLeft size={14} />Back to course
        </Link>
        <ClassEntryPanel liveClassId={id} title={live.title} instructorId={live.instructorId} />
      </div>
    )
  }

  /* ── Session ended state ── */
  if (isEnded || isCancelled) {
    const endedAt   = live.endedAt ? new Date(live.endedAt) : null
    const startedAt = live.startedAt ? new Date(live.startedAt) : null
    const durationSecs = startedAt && endedAt
      ? Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000)
      : null
    const durationLabel = durationSecs
      ? durationSecs >= 3600
        ? `${Math.floor(durationSecs / 3600)}h ${Math.floor((durationSecs % 3600) / 60)}m`
        : `${Math.floor(durationSecs / 60)}m`
      : null

    return (
      <div className="mx-auto max-w-2xl py-16 text-center">
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}>
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-3xl"
            style={{ background: isEnded ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.08)', border: `1px solid ${isEnded ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.18)'}` }}>
            {isEnded ? <CheckCircle2 size={36} style={{ color: '#22C55E' }} /> : <AlertCircle size={36} style={{ color: '#EF4444' }} />}
          </div>

          <h1 className="text-2xl font-bold text-white" style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}>
            {isEnded ? 'Session ended' : 'Session cancelled'}
          </h1>
          <p className="mt-1 text-base" style={{ color: 'rgba(255,255,255,0.5)' }}>{live.title}</p>

          {isEnded && (
            <div className="mt-6 flex justify-center gap-8">
              {durationLabel && (
                <div className="text-center">
                  <p className="text-2xl font-bold text-white">{durationLabel}</p>
                  <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>Duration</p>
                </div>
              )}
              <div className="text-center">
                <p className="text-2xl font-bold text-white">{live.viewerCount ?? 0}</p>
                <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>Viewers</p>
              </div>
            </div>
          )}

          {isEnded && (
            <div className="mt-6 rounded-2xl p-4"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
              {live.recordingUrl ? (
                <>
                  <p className="mb-3 text-sm font-semibold" style={{ color: '#22C55E' }}>
                    ✅ Recording is ready
                  </p>
                  <div className="overflow-hidden rounded-xl bg-black">
                    <MuxPlayer
                      streamType="on-demand"
                      src={live.recordingUrl}
                      metadata={{ video_title: live.title }}
                      style={{ width: '100%', aspectRatio: '16/9' }}
                    />
                  </div>
                </>
              ) : (
                <p className="flex items-center justify-center gap-2 text-sm"
                  style={{ color: 'rgba(255,255,255,0.4)' }}>
                  <Spinner size={14} />
                  Recording is being processed — usually ready within 5 minutes
                </p>
              )}
            </div>
          )}

          <div className="mt-8 flex justify-center gap-3">
            <Link href={courseHref}
              className="rounded-xl px-5 py-2.5 text-sm font-semibold text-white"
              style={{ background: 'linear-gradient(135deg, #0057b8, #003d80)' }}>
              ← Back to course
            </Link>
          </div>

          {isEnded && prevStatus.current === 'live' && (
            <p className="mt-3 text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>
              Redirecting back to course in a moment…
            </p>
          )}
        </motion.div>
      </div>
    )
  }

  /* ── Scheduled state ── */
  if (isScheduled) {
    return (
      <div className="mx-auto max-w-2xl">
        {/* Back nav */}
        <Link href={courseHref}
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-semibold transition-opacity hover:opacity-70"
          style={{ color: 'rgba(255,255,255,0.4)' }}>
          <ChevronLeft size={14} />Back to course
        </Link>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl p-8 text-center"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>

          {/* Icon */}
          <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-3xl"
            style={{ background: 'rgba(0,87,184,0.12)', border: '1px solid rgba(0,87,184,0.25)' }}>
            <Tv2 size={36} style={{ color: '#0057b8' }} />
          </div>

          <h1 className="text-2xl font-bold text-white" style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}>
            {live.title}
          </h1>

          {live.course && (
            <p className="mt-1 text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>
              {live.course.title}
            </p>
          )}

          {/* Scheduled time */}
          <div className="mt-6 flex justify-center gap-6">
            <div className="text-center">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-white">
                <Calendar size={14} style={{ color: '#818CF8' }} />
                {fmtDateTime(live.scheduledStart, zoneOf(live.organizationSlug))}{foreignZoneTag(live.organizationSlug) && (
                  <span style={{ color: '#FBBF24' }}> {foreignZoneTag(live.organizationSlug)}</span>
                )}
              </p>
              <p className="mt-0.5 text-xs" style={{ color: '#0057b8' }}>{countdown}</p>
            </div>
            <div className="text-center">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-white">
                <Clock size={14} style={{ color: '#818CF8' }} />
                {fmtDuration(live.durationMins)}
              </p>
              <p className="mt-0.5 text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>duration</p>
            </div>
          </div>

          {/* Two streaming options */}
          <div className="mx-auto mt-6 w-full max-w-sm space-y-2">
            {/* Browser option */}
            <Link href={`/live-classes/${id}/studio`}
              className="flex items-start gap-3 rounded-xl px-4 py-3 transition-colors hover:brightness-110"
              style={{ background: 'rgba(0,87,184,0.09)', border: '1px solid rgba(0,87,184,0.22)' }}>
              <Monitor size={16} className="mt-0.5 flex-shrink-0" style={{ color: '#0057b8' }} />
              <div>
                <p className="text-sm font-semibold" style={{ color: '#0057b8' }}>Stream from Browser</p>
                <p className="mt-0.5 text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>
                  Use your webcam — no software needed. Best for small sessions.
                </p>
              </div>
            </Link>

            {/* OBS option */}
            <div className="rounded-xl px-4 py-3 text-left"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
              <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.3)' }}>
                OBS / Streaming software
              </p>
              <p className="mt-1.5 text-xs" style={{ color: 'rgba(255,255,255,0.55)' }}>
                Set server to{' '}
                <code className="rounded px-1 py-0.5 text-[10px]" style={{ background: 'rgba(255,255,255,0.08)', color: '#0057b8' }}>
                  rtmps://global-live.mux.com:443/app
                </code>
                {' '}and paste your stream key below.
              </p>
              <ObsCredsInline key={recreateCount} liveId={id} />
            </div>
          </div>

          {/* Error + Recreate option */}
          {startError && (
            <div className="mt-4 space-y-2">
              <p className="flex items-center justify-center gap-2 text-sm" style={{ color: '#F87171' }}>
                <AlertCircle size={14} />{startError}
              </p>
              {/* Show recreate button when stream key is disabled */}
              {startError.toLowerCase().includes('disabled') && (
                <div className="flex flex-col items-center gap-1">
                  <motion.button
                    whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                    onClick={async () => {
                      setStartError(null)
                      setRecreateMsg(null)
                      try {
                        await recreateMutation.mutateAsync()
                        setRecreateMsg('Stream key regenerated — click Go Live to try again.')
                        setRecreateCount(c => c + 1)   // remounts ObsCredsInline with fresh state
                      } catch (err: any) {
                        setStartError(
                          err?.response?.data?.error?.message
                          ?? err?.message
                          ?? 'Failed to recreate stream.',
                        )
                      }
                    }}
                    disabled={recreateMutation.isPending}
                    className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold text-white disabled:opacity-60 transition-all hover:brightness-110"
                    style={{ background: 'rgba(0,87,184,0.20)', border: '1px solid rgba(0,87,184,0.40)', color: '#0057b8' }}>
                    {recreateMutation.isPending
                      ? <><Spinner size={12} />Regenerating…</>
                      : <>↻ Regenerate stream key</>}
                  </motion.button>
                  <p className="text-[10px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
                    Creates a new Mux stream — update OBS with the new key after.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Success message after recreate */}
          {recreateMsg && !startError && (
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="mt-4 flex items-center justify-center gap-2 text-sm"
              style={{ color: '#22C55E' }}>
              <CheckCircle2 size={14} />{recreateMsg}
            </motion.p>
          )}

          {/* Go Live button */}
          <div className="mt-8">
            <motion.button
              whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
              onClick={async () => {
                setStartError(null)
                setRecreateMsg(null)
                try {
                  await startMutation.mutateAsync()
                } catch (err: any) {
                  setStartError(
                    err?.response?.data?.error?.message ?? 'Failed to start stream. Check your Mux credentials.',
                  )
                }
              }}
              disabled={startMutation.isPending}
              className="inline-flex items-center gap-2.5 rounded-2xl px-8 py-3.5 text-sm font-bold text-white disabled:opacity-60"
              style={{ background: 'linear-gradient(135deg, #EF4444, #DC2626)', boxShadow: '0 4px 20px rgba(239,68,68,0.35)' }}>
              {startMutation.isPending
                ? <><Spinner size={16} />Enabling stream…</>
                : <><Radio size={16} />Go Live Now</>}
            </motion.button>
            <p className="mt-2 text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>
              Then start streaming in OBS within 30 seconds
            </p>
          </div>
        </motion.div>
      </div>
    )
  }

  /* ── LIVE state ── */
  return (
    <div className="mx-auto max-w-6xl">
      {/* Back nav */}
      <Link href={courseHref}
        className="mb-5 inline-flex items-center gap-1.5 text-sm font-semibold transition-opacity hover:opacity-70"
        style={{ color: 'rgba(255,255,255,0.4)' }}>
        <ChevronLeft size={14} />Back to course
      </Link>

      {/* Live header bar */}
      <motion.div
        initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
        className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl px-5 py-3.5"
        style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.22)' }}>
        <div className="flex items-center gap-3">
          <motion.div
            animate={{ opacity: [1, 0.4, 1] }}
            transition={{ duration: 1.4, repeat: Infinity }}
            className="flex items-center gap-1.5 rounded-xl px-3 py-1 text-xs font-bold text-white"
            style={{ background: '#EF4444' }}>
            <span className="h-2 w-2 rounded-full bg-white" />LIVE
          </motion.div>
          <p className="text-sm font-bold text-white">{live.title}</p>
          {live.course && (
            <p className="hidden text-xs sm:block" style={{ color: 'rgba(255,255,255,0.4)' }}>
              {live.course.title}
            </p>
          )}
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="flex items-center gap-1.5 font-bold" style={{ color: '#EF4444' }}>
            <Clock size={13} />{elapsed}
          </span>
          <span className="flex items-center gap-1.5 font-semibold text-white">
            <Users size={13} style={{ color: 'rgba(255,255,255,0.5)' }} />
            {live.viewerCount.toLocaleString()} watching
          </span>
          <Link href={`/live-classes/${id}/studio`}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold transition-colors hover:bg-white/10"
            style={{ color: 'rgba(255,255,255,0.45)' }}>
            <Monitor size={11} />Studio
          </Link>
        </div>
      </motion.div>

      <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
        {/* ── Player ── */}
        <div>
          {live.playbackUrl ? (
            <div className="overflow-hidden rounded-2xl bg-black">
              <MuxPlayer
                streamType="live"
                src={live.playbackUrl}
                metadata={{ video_title: live.title, viewer_user_id: 'admin-monitor' }}
                autoPlay
                muted
                style={{ width: '100%', aspectRatio: '16/9' }}
              />
            </div>
          ) : (
            <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-2xl"
              style={{ background: '#0D0F1A', border: '1px solid rgba(255,255,255,0.06)' }}>
              <Spinner size={24} />
              <p className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>
                Waiting for OBS to connect…
              </p>
              <p className="text-xs" style={{ color: 'rgba(255,255,255,0.2)' }}>
                Start streaming in OBS to see the preview
              </p>
            </div>
          )}

          {/* Stream status row */}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-1.5 text-xs font-semibold"
              style={{ color: live.playbackUrl ? '#22C55E' : '#F59E0B' }}>
              {live.playbackUrl ? <Wifi size={12} /> : <WifiOff size={12} />}
              {live.playbackUrl ? 'Stream active — students can watch' : 'Waiting for OBS connection'}
            </span>
            <span className="text-xs" style={{ color: 'rgba(255,255,255,0.25)' }}>·</span>
            <span className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
              Auto-refreshes every 10s
            </span>
          </div>
        </div>

        {/* ── Right panel ── */}
        <div className="flex flex-col gap-4">

          {/* Stats card */}
          <div className="rounded-2xl p-4 space-y-3"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.3)' }}>
              Session stats
            </p>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl p-3 text-center"
                style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.15)' }}>
                <p className="text-xl font-bold text-white">{live.viewerCount.toLocaleString()}</p>
                <p className="text-[10px]" style={{ color: 'rgba(255,255,255,0.4)' }}>Watching</p>
              </div>
              <div className="rounded-xl p-3 text-center"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
                <p className="text-xl font-bold text-white">{elapsed}</p>
                <p className="text-[10px]" style={{ color: 'rgba(255,255,255,0.4)' }}>Elapsed</p>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span style={{ color: 'rgba(255,255,255,0.4)' }}>Duration</span>
                <span className="font-semibold text-white">{fmtDuration(live.durationMins)}</span>
              </div>
              {live.course && (
                <div className="flex items-center justify-between text-xs">
                  <span style={{ color: 'rgba(255,255,255,0.4)' }}>Course</span>
                  <span className="max-w-[140px] truncate font-semibold text-white">{live.course.title}</span>
                </div>
              )}
            </div>
          </div>

          {/* Recording notice */}
          <div className="flex items-start gap-2.5 rounded-xl p-3"
            style={{ background: 'rgba(34,197,94,0.07)', border: '1px solid rgba(34,197,94,0.15)' }}>
            <BookOpen size={13} className="mt-0.5 flex-shrink-0" style={{ color: '#22C55E' }} />
            <p className="text-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>
              Session is being recorded automatically. Students can watch the replay after you end the stream.
            </p>
          </div>

          {/* End stream */}
          <AnimatePresence mode="wait">
            {!confirmEnd ? (
              <motion.button key="end-btn"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                onClick={() => setConfirmEnd(true)}
                className="flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-sm font-bold text-white transition-all hover:brightness-110"
                style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.30)', color: '#F87171' }}>
                <Square size={14} />End stream
              </motion.button>
            ) : (
              <motion.div key="confirm"
                initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
                className="rounded-2xl p-4 text-center space-y-3"
                style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.28)' }}>
                <p className="text-sm font-semibold text-white">End this stream?</p>
                <p className="text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>
                  Students will see the recording once it processes (~5 min).
                </p>
                <div className="flex gap-2">
                  <button onClick={() => setConfirmEnd(false)}
                    className="flex-1 rounded-xl py-2 text-xs font-semibold transition-colors hover:bg-white/10"
                    style={{ color: 'rgba(255,255,255,0.5)' }}>
                    Keep going
                  </button>
                  <button
                    onClick={() => { endMutation.mutate(); setConfirmEnd(false) }}
                    disabled={endMutation.isPending}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold text-white disabled:opacity-60"
                    style={{ background: '#EF4444' }}>
                    {endMutation.isPending ? <Spinner size={11} /> : <Square size={11} />}
                    End now
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}
