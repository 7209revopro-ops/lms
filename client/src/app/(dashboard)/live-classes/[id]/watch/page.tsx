'use client'

import { use, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import {
  Radio, Clock, AlertCircle, Calendar, ChevronLeft,
  ExternalLink, BookOpen, Users, Tv2, Maximize2, Minimize2,
} from 'lucide-react'
import { useWatchAccess, isInteractiveRoom } from '@/lib/api/liveClasses'
import { useJoinClock } from '@/hooks/useJoinClock'
import { getJoinPhase } from '@/lib/joinWindow'
import JoinMeetButton from '@/components/live-classes/JoinMeetButton'
import MuxPlayer from '@mux/mux-player-react'
import { useCurrentUser } from '@/lib/api/user'
import { WatermarkOverlay } from '@/components/video/WatermarkOverlay'
import { SessionHomework } from '@/components/live-classes/SessionHomework'
import { SessionFeedback } from '@/components/live-classes/SessionFeedback'
import Spinner from '@/components/ui/Spinner'
import { ClassEntryPanel } from '@/components/live-classes/ClassEntryPanel'

/* ── Helpers ─────────────────────────────────────────── */
function StatusBadge({ status }: { status: string }) {
  if (status === 'live') {
    return (
      <motion.span
        animate={{ opacity: [1, 0.4, 1] }}
        transition={{ duration: 1.4, repeat: Infinity }}
        className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1 text-xs font-bold text-white"
        style={{ background: 'var(--color-danger)' }}>
        <span className="h-2 w-2 rounded-full bg-[var(--color-bg-surface)]" />
        LIVE NOW
      </motion.span>
    )
  }
  if (status === 'ended') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1 text-xs font-bold"
        style={{ background: 'rgba(34,197,94,0.12)', color: 'var(--color-success)', border: '1px solid rgba(34,197,94,0.25)' }}>
        <BookOpen size={11} />Recording
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1 text-xs font-semibold"
      style={{ background: 'var(--color-bg-subtle)', color: 'var(--color-text-muted)' }}>
      <Clock size={11} />Scheduled
    </span>
  )
}

/* ── Placeholder while stream hasn't started ─────────── */
/* Wraps the Mux player so the forensic watermark stays on screen in
   fullscreen: the browser fullscreens THIS wrapper (player + overlay
   together) via the toggle button, instead of the player element alone. */
function WatermarkedFrame({ children }: { children: React.ReactNode }) {
  const frameRef = useRef<HTMLDivElement>(null)
  const [isFs, setIsFs] = useState(false)

  useEffect(() => {
    const onChange = () => setIsFs(document.fullscreenElement === frameRef.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const toggle = () => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void frameRef.current?.requestFullscreen()
  }

  return (
    <div
      ref={frameRef}
      data-protected-content
      className={`relative overflow-hidden bg-black ${isFs ? 'flex h-full w-full items-center justify-center' : 'rounded-2xl'}`}>
      <div className="w-full">{children}</div>
      <WatermarkOverlay />
      <button
        onClick={toggle}
        aria-label={isFs ? 'Exit fullscreen' : 'Fullscreen'}
        title={isFs ? 'Exit fullscreen' : 'Fullscreen'}
        className="absolute right-2.5 top-2.5 z-50 flex h-8 w-8 items-center justify-center rounded-lg transition-opacity hover:opacity-100"
        style={{ background: 'rgba(0,0,0,0.55)', color: 'white', opacity: 0.65 }}>
        {isFs ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
      </button>
    </div>
  )
}

function ScheduledPlaceholder({ thumbnailUrl }: { thumbnailUrl?: string }) {
  return (
    <div className="flex aspect-video w-full flex-col items-center justify-center gap-4 rounded-2xl"
      style={{ background: thumbnailUrl ? undefined : 'var(--color-text-primary)', position: 'relative', overflow: 'hidden' }}>
      {thumbnailUrl && (
        <img src={thumbnailUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-20" />
      )}
      <div className="relative z-10 flex flex-col items-center gap-3 text-center px-6">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl"
          style={{ background: 'rgba(0,87,184,0.15)', border: '1px solid rgba(0,87,184,0.25)' }}>
          <Tv2 size={28} style={{ color: 'var(--color-primary)' }} />
        </div>
        <p className="text-lg font-bold text-white">Stream hasn&apos;t started yet</p>
        <p className="text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>
          This page will update automatically when the instructor goes live.
        </p>
      </div>
    </div>
  )
}

/* ── Page ────────────────────────────────────────────── */
export default function WatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id }   = use(params)
  const { data: user }   = useCurrentUser()
  const { data, isLoading, isError, error } = useWatchAccess(id)
  /* External classes only: the Join button appears on the start second from
     this clock, not from a refetch. Harmless for internal ones (30 s tick). */
  const now = useJoinClock(data ? [data] : undefined)

  /* ── Loading ── */
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Spinner size={24} />
      </div>
    )
  }

  /* ── Error states ── */
  if (isError) {
    const errCode = (error as any)?.response?.data?.error?.code
    const isNotEnrolled = errCode === 'NOT_ENROLLED'
    const isCancelled   = errCode === 'SESSION_CANCELLED'

    return (
      <div className="mx-auto max-w-xl py-20 text-center">
        <div className="flex h-16 w-16 mx-auto mb-4 items-center justify-center rounded-3xl"
          style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.18)' }}>
          <AlertCircle size={24} style={{ color: 'var(--color-danger)' }} />
        </div>
        <p className="text-lg font-bold" style={{ color: 'var(--color-text-primary)' }}>
          {isNotEnrolled ? 'Enrollment required'
           : isCancelled ? 'Session cancelled'
           : 'Something went wrong'}
        </p>
        <p className="mt-2 text-sm" style={{ color: 'var(--color-text-muted)' }}>
          {isNotEnrolled ? 'You must be enrolled in this course to watch the live class.'
           : isCancelled  ? 'This session was cancelled by the instructor.'
           : 'We couldn\'t load the stream. Please try again.'}
        </p>
        <Link href="/live-classes"
          className="mt-6 inline-flex items-center gap-2 text-sm font-semibold transition-opacity hover:opacity-70"
          style={{ color: 'var(--color-primary)' }}>
          <ChevronLeft size={14} />Back to Live Classes
        </Link>
      </div>
    )
  }

  if (!data) return null

  /* ── External type — Meet join panel + homework sidebar ──
     The URL is not in this payload. A booked student sees "Join opens at"
     until the start, the button from the start second for 20 minutes, then
     "Join link closed"; the link itself is fetched by the button on the
     click. A student without a seat gets a plain landing, not an error. */
  if (data.type === 'external') {
    const phase = getJoinPhase(data, now)
    /* The window's length comes from the two server instants, never from a
       literal: an academy can widen the grace with one env var and this copy
       has to follow it without a deploy. */
    const graceMin = data.joinOpensAt && data.joinClosesAt
      ? Math.round((new Date(data.joinClosesAt).getTime() - new Date(data.joinOpensAt).getTime()) / 60_000)
      : 20
    return (
      <div className="mx-auto max-w-5xl">
        <Link href="/live-classes"
          className="mb-5 inline-flex items-center gap-1.5 text-sm font-semibold transition-opacity hover:opacity-70"
          style={{ color: 'var(--color-text-muted)' }}>
          <ChevronLeft size={14} />Live Classes
        </Link>

        <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
          {/* ── Left: external join panel ── */}
          <div className="flex flex-col items-center justify-center rounded-2xl py-16 text-center"
            style={{ background: 'rgba(99,102,241,0.04)', border: '1px solid rgba(99,102,241,0.12)' }}>
            <div className="flex h-16 w-16 items-center justify-center rounded-3xl"
              style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.18)' }}>
              <ExternalLink size={24} style={{ color: '#6366F1' }} />
            </div>
            <p className="mt-4 text-lg font-bold" style={{ color: 'var(--color-text-primary)' }}>
              {data.isBooked ? data.title : 'You have not booked this session'}
            </p>
            <p className="mt-2 max-w-xs text-sm" style={{ color: 'var(--color-text-muted)' }}>
              {!data.isBooked
                ? 'This class runs on Google Meet and only students with a reserved seat can join. Reserve a seat from the class schedule.'
                : phase === 'open'
                ? 'This class runs on Google Meet. Click below to open it in a new tab.'
                : phase === 'closed'
                ? `The join link closes ${graceMin} minutes after the start. If you are still expecting to attend, contact your admin.`
                : data.status === 'cancelled' || data.status === 'ended'
                ? 'This session is no longer open to join.'
                : data.isOnline === false
                ? 'This is an in-person class — there is nothing to join online. Go to the room.'
                : `This class runs on Google Meet. The join button unlocks at the start time and stays open for ${graceMin} minutes.`}
            </p>
            <div className="mt-6 flex flex-col items-center gap-3">
              {data.isBooked ? (
                <JoinMeetButton
                  sessionId={id} now={now} size="lg" accent="#6366F1"
                  isBooked={data.isBooked} joinOpensAt={data.joinOpensAt} joinClosesAt={data.joinClosesAt}
                  type={data.type} isOnline={data.isOnline} status={data.status}
                  className="max-w-xs px-6" />
              ) : (
                <Link href="/class-bookings"
                  className="inline-flex items-center gap-2 rounded-2xl px-6 py-3 text-sm font-bold text-white"
                  style={{ background: '#6366F1', boxShadow: '0 4px 14px rgba(99,102,241,0.30)' }}>
                  <Calendar size={14} />Book a seat
                </Link>
              )}
              <StatusBadge status={data.status} />
            </div>
          </div>

          {/* ── Right: homework + info ── */}
          <div className="flex flex-col gap-4">
            <div className="rounded-2xl p-4"
              style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)' }}>
              <h2 className="text-sm font-bold" style={{ color: 'var(--color-text-primary)' }}>About this session</h2>
              <div className="mt-2 flex items-center gap-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                <BookOpen size={12} />
                <span>External · {data.status}</span>
              </div>
            </div>

            <SessionHomework sessionId={id} />

            {data.status === 'ended' && (
              <SessionFeedback sessionId={id} sessionTitle={data.title} />
            )}

            <Link href="/live-classes"
              className="flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-semibold transition-colors hover:opacity-70"
              style={{ background: 'var(--color-bg-subtle)', color: 'var(--color-text-secondary)' }}>
              <ChevronLeft size={13} />All live classes
            </Link>
          </div>
        </div>
      </div>
    )
  }

  /* ── Internal (Mux) ── */
  const isLiveNow  = data.status === 'live'
  const isEnded    = data.status === 'ended'
  const isScheduled = data.status === 'scheduled'

  /* Stream URL: live playback or recording */
  const streamUrl = isLiveNow
    ? data.playbackUrl
    : isEnded && data.recordingUrl
    ? data.recordingUrl
    : null

  return (
    <div className="mx-auto max-w-5xl">
      {/* Back nav */}
      <Link href="/live-classes"
        className="mb-5 inline-flex items-center gap-1.5 text-sm font-semibold transition-opacity hover:opacity-70"
        style={{ color: 'var(--color-text-muted)' }}>
        <ChevronLeft size={14} />Live Classes
      </Link>

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        {/* ── Left: player ── */}
        <div className="space-y-4">
          {/* Player or placeholder.
              An interactive room is a different engine: two-way WebRTC rather
              than a one-way stream, so it takes the LiveKit path and never
              touches Mux. It stays inside WatermarkedFrame, which is the whole
              reason the plan chose a native embed over an iframe — the
              forensic watermark has to ride over live video too. */}
          {isInteractiveRoom(data) ? (
            <WatermarkedFrame>
              <ClassEntryPanel liveClassId={id} />
            </WatermarkedFrame>
          ) : streamUrl ? (
            <WatermarkedFrame>
              <MuxPlayer
                streamType={isLiveNow ? 'live' : 'on-demand'}
                src={streamUrl}
                metadata={{
                  video_title: data.title ?? 'Live class',
                  viewer_user_id: user?.id ?? 'anonymous',
                }}
                autoPlay={isLiveNow}
                muted={false}
                /* Mux's own fullscreen button is hidden (CSS var below): the
                   player would fullscreen only its own element, dropping the
                   watermark. WatermarkedFrame provides the fullscreen toggle
                   for its wrapper instead, so the overlay rides along. */
                style={{ width: '100%', aspectRatio: '16/9', ['--fullscreen-button' as never]: 'none' }}
              />
            </WatermarkedFrame>
          ) : (
            <ScheduledPlaceholder thumbnailUrl={data.thumbnailUrl} />
          )}

          {/* Status bar */}
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge status={data.status} />

            {isLiveNow && data.viewerCount > 0 && (
              <span className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: 'var(--color-danger)' }}>
                <Users size={13} />{data.viewerCount.toLocaleString()} watching
              </span>
            )}

            {isScheduled && (
              <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                This page refreshes automatically when the stream starts.
              </span>
            )}

            {isEnded && !data.recordingUrl && (
              <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                Stream ended. Recording is being processed. Check back in a few minutes.
              </span>
            )}
          </div>
        </div>

        {/* ── Right: info panel (chat placeholder — Phase 2) ── */}
        <div className="flex flex-col gap-4">
          <div className="rounded-2xl p-4"
            style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)' }}>
            <h2 className="text-sm font-bold" style={{ color: 'var(--color-text-primary)' }}>About this session</h2>
            <p className="mt-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {isLiveNow
                ? 'You\'re watching live. The instructor can see the viewer count.'
                : isEnded
                ? data.recordingUrl
                  ? 'This session has ended. You\'re watching the recording.'
                  : 'This session has ended. The recording will be available shortly.'
                : 'This session hasn\'t started yet. Stay on this page. It will update automatically.'}
            </p>

            {/* Live chat coming soon notice */}
            {isLiveNow && (
              <div className="mt-4 rounded-xl p-3 text-center"
                style={{ background: 'var(--color-bg-subtle)', border: '1px dashed var(--color-border)' }}>
                <Radio size={16} className="mx-auto mb-1.5" style={{ color: 'var(--color-text-muted)' }} />
                <p className="text-xs font-semibold" style={{ color: 'var(--color-text-muted)' }}>Live chat</p>
                <p className="mt-0.5 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>Coming soon</p>
              </div>
            )}
          </div>

          <SessionHomework sessionId={id} />

          {/* Feedback — shown only after session has ended */}
          {isEnded && (
            <SessionFeedback sessionId={id} sessionTitle={data.title} />
          )}

          <Link href="/live-classes"
            className="flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-semibold transition-colors hover:opacity-70"
            style={{ background: 'var(--color-bg-subtle)', color: 'var(--color-text-secondary)' }}>
            <ChevronLeft size={13} />All live classes
          </Link>
        </div>
      </div>
    </div>
  )
}
