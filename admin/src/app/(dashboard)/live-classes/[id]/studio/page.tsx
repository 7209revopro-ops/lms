'use client'

import { use, useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ChevronLeft, Radio, Square, AlertCircle,
  Camera, Mic, MicOff, VideoOff, Monitor, Wifi, WifiOff,
  Activity, BarChart2, CheckCircle2, Settings2,
} from 'lucide-react'
import {
  useLiveClassById, useStartLiveStreamById, useEndLiveStreamById, isInteractiveRoom,
  useStreamCredentials,
} from '@/lib/api/liveClasses'
import Spinner from '@/components/ui/Spinner'
import { ClassEntryPanel } from '@/components/live-classes/ClassEntryPanel'
import { MovedToLinkPanel } from '@/components/live-classes/BackupLinkModal'

/* ── WebRTC quality stats ─────────────────────────────── */
interface StreamStats {
  videoBitrate:  number   // kbps
  audioBitrate:  number   // kbps
  packetLoss:    number   // percent
  frameRate:     number
  resolution:    string
}

/* ── Helpers ─────────────────────────────────────────── */
async function getDevices() {
  await navigator.mediaDevices.getUserMedia({ video: true, audio: true }).catch(() => {})
  return navigator.mediaDevices.enumerateDevices()
}

async function connectWHIP(
  pc: RTCPeerConnection,
  stream: MediaStream,
  streamKey: string,
): Promise<() => void> {
  stream.getTracks().forEach(t => pc.addTrack(t, stream))

  const offer = await pc.createOffer()
  await pc.setLocalDescription(offer)

  const whipUrl = `https://global-live.mux.com/api/whip-endpoint/${streamKey}`
  const resp = await fetch(whipUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/sdp' },
    body:    offer.sdp,
  })

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '')
    throw new Error(`WHIP rejected (${resp.status}): ${txt || 'check your stream key'}`)
  }

  const answerSdp = await resp.text()
  await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp })

  // Return delete-session cleanup (WHIP spec)
  const location = resp.headers.get('Location')
  return async () => {
    if (location) {
      await fetch(location, { method: 'DELETE' }).catch(() => {})
    }
  }
}

async function collectStats(
  pc: RTCPeerConnection,
  prev: React.MutableRefObject<Record<string, number>>,
): Promise<StreamStats> {
  const stats = await pc.getStats()
  let videoBps = 0, audioBps = 0, packetLossPct = 0, fps = 0, w = 0, h = 0

  stats.forEach((s: RTCStats & Record<string, unknown>) => {
    if (s['type'] === 'outbound-rtp') {
      const bytesSent  = (s['bytesSent']  as number) ?? 0
      const timestamp  = (s['timestamp']  as number) ?? 0
      const prevBytes  = prev.current[`${s['id']}-bytes`] ?? bytesSent
      const prevTs     = prev.current[`${s['id']}-ts`]    ?? timestamp
      const dt         = (timestamp - prevTs) / 1000
      const bps        = dt > 0 ? ((bytesSent - prevBytes) * 8) / dt : 0

      if (s['kind'] === 'video') {
        videoBps = bps
        fps = (s['framesPerSecond'] as number) ?? fps
        w   = (s['frameWidth']      as number) ?? w
        h   = (s['frameHeight']     as number) ?? h
      } else if (s['kind'] === 'audio') {
        audioBps = bps
      }

      prev.current[`${s['id']}-bytes`] = bytesSent
      prev.current[`${s['id']}-ts`]    = timestamp
    }

    if (s['type'] === 'remote-inbound-rtp' && s['kind'] === 'video') {
      const lost  = (s['packetsLost'] as number) ?? 0
      const total = (s['packetsReceived'] as number ?? 0) + lost
      packetLossPct = total > 0 ? Math.min(100, Math.round((lost / total) * 100)) : 0
    }
  })

  return {
    videoBitrate: Math.round(videoBps / 1000),
    audioBitrate: Math.round(audioBps / 1000),
    packetLoss:   packetLossPct,
    frameRate:    Math.round(fps),
    resolution:   w && h ? `${w}×${h}` : '—',
  }
}

type StudioState = 'idle' | 'loading-devices' | 'ready' | 'starting' | 'connecting' | 'live' | 'ending' | 'ended' | 'error'

/* ── Page ─────────────────────────────────────────────── */
export default function StudioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router  = useRouter()

  const { data: live, isLoading: liveLoading } = useLiveClassById(id)
  const startMutation = useStartLiveStreamById(id)
  const endMutation   = useEndLiveStreamById(id)
  const { data: creds, refetch: fetchCreds }   = useStreamCredentials(id)

  /* Device lists */
  const [cameras,  setCameras]  = useState<MediaDeviceInfo[]>([])
  const [mics,     setMics]     = useState<MediaDeviceInfo[]>([])
  const [cameraId, setCameraId] = useState('')
  const [micId,    setMicId]    = useState('')

  /* Studio state machine */
  const [state,      setState]   = useState<StudioState>('loading-devices')
  const [error,      setError]   = useState<string | null>(null)
  const [stats,      setStats]   = useState<StreamStats | null>(null)

  /* Refs */
  const videoRef     = useRef<HTMLVideoElement>(null)
  const streamRef    = useRef<MediaStream | null>(null)
  const pcRef        = useRef<RTCPeerConnection | null>(null)
  const statsTimer   = useRef<ReturnType<typeof setInterval> | null>(null)
  const prevStatsRef = useRef<Record<string, number>>({})
  const whipCleanup  = useRef<(() => void) | null>(null)

  /* ── Load devices once the class is known to be an in-app one ──
     A class that runs on a meeting link — above all one switched to a backup
     link — never uses this page's camera, and opening it here would hold the
     camera the instructor is about to need in Google Meet. */
  const usesStudioCamera = live?.type === 'internal'
  useEffect(() => {
    if (!usesStudioCamera) return
    getDevices().then(devs => {
      const cams = devs.filter(d => d.kind === 'videoinput')
      const mics = devs.filter(d => d.kind === 'audioinput')
      setCameras(cams)
      setMics(mics)
      setCameraId(cams[0]?.deviceId ?? '')
      setMicId(mics[0]?.deviceId ?? '')
      setState('ready')
    }).catch(() => {
      setError('Could not access camera/microphone. Check browser permissions.')
      setState('error')
    })
  }, [usesStudioCamera])

  /* ── Start camera preview ── */
  const startPreview = useCallback(async (camId: string, micId: string) => {
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop())
      }
      const s = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: camId ? { exact: camId } : undefined, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: { deviceId: micId ? { exact: micId } : undefined },
      })
      streamRef.current = s
      if (videoRef.current) {
        videoRef.current.srcObject = s
        videoRef.current.muted = true
      }
    } catch (err: any) {
      setError(err?.message ?? 'Camera access denied')
      setState('error')
    }
  }, [])

  /* Start preview once devices are ready */
  useEffect(() => {
    if (state === 'ready' && cameraId) {
      startPreview(cameraId, micId)
    }
  }, [state, cameraId, micId, startPreview])

  /* ── Go Live ── */
  const goLive = async () => {
    setError(null)
    setState('starting')

    try {
      // 1. Enable Mux stream (creates the live stream if not already active)
      await startMutation.mutateAsync()

      // 2. Fetch stream credentials
      setState('connecting')
      const { data: credData } = await fetchCreds()
      if (!credData?.streamKey) throw new Error('Could not retrieve stream key')

      // 3. Set up RTCPeerConnection
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      })
      pcRef.current = pc

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
          setError('WebRTC connection lost. Try refreshing and reconnecting.')
          setState('error')
        }
      }

      // 4. Connect WHIP
      const cleanup = await connectWHIP(pc, streamRef.current!, credData.streamKey)
      whipCleanup.current = cleanup

      // 5. Start stats collection
      statsTimer.current = setInterval(async () => {
        if (pcRef.current) {
          const s = await collectStats(pcRef.current, prevStatsRef)
          setStats(s)
        }
      }, 2000)

      setState('live')
    } catch (err: any) {
      setError(
        err?.response?.data?.error?.message
        ?? err?.message
        ?? 'Failed to connect. Check your browser permissions and try again.',
      )
      setState('ready')
    }
  }

  /* ── Stop stream ── */
  const stopStream = async () => {
    setState('ending')
    try {
      // Stop stats
      if (statsTimer.current) { clearInterval(statsTimer.current); statsTimer.current = null }

      // Close WHIP session
      if (whipCleanup.current) { await whipCleanup.current(); whipCleanup.current = null }

      // Close peer connection
      if (pcRef.current) { pcRef.current.close(); pcRef.current = null }

      // Stop media tracks
      if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null }

      // Mark stream ended via API
      await endMutation.mutateAsync()
      setState('ended')
    } catch (err: any) {
      setError(
        err?.response?.data?.error?.message
        ?? err?.message
        ?? 'Failed to end stream gracefully.',
      )
      setState('live') // keep live state so user can retry
    }
  }

  /* Cleanup on unmount */
  useEffect(() => {
    return () => {
      if (statsTimer.current)   clearInterval(statsTimer.current)
      if (whipCleanup.current)  void (whipCleanup.current as () => void)()
      if (pcRef.current)        pcRef.current.close()
      if (streamRef.current)    streamRef.current.getTracks().forEach(t => t.stop())
    }
  }, [])

  /* Device change: restart preview */
  const handleCameraChange = (id: string) => {
    setCameraId(id)
    if (state === 'ready') startPreview(id, micId)
  }
  const handleMicChange = (id: string) => {
    setMicId(id)
    if (state === 'ready') startPreview(cameraId, id)
  }

  /* ── Loading ── */
  if (liveLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner size={28} />
      </div>
    )
  }

  if (!live) {
    return (
      <div className="mx-auto max-w-md py-20 text-center">
        <AlertCircle size={32} className="mx-auto mb-4" style={{ color: '#EF4444' }} />
        <p className="font-bold text-white">Live class not found</p>
        <Link href="/live-classes" className="mt-4 inline-block text-sm" style={{ color: '#0057b8' }}>
          ← Back to live classes
        </Link>
      </div>
    )
  }

  /* ── A meeting-link class — above all one switched to a backup link ──
     An instructor opening the studio from a reminder sent before the switch
     goes to the class's room as it is NOW, never the abandoned one. */
  if (live.type === 'external') {
    return <MovedToLinkPanel live={live} backHref="/live-classes" backLabel="Back to live classes" />
  }

  /* ── Interactive room (LiveKit) ──────────────────────────────────────
     A different engine entirely: no WHIP, no stream key, no camera plumbing
     here — the LiveKit SDK owns the media. Branch before any of the Mux
     machinery runs so a LiveKit class never touches it. */
  if (isInteractiveRoom(live)) {
    return (
      <div className="mx-auto max-w-6xl">
        <Link href="/live-classes" className="mb-4 inline-flex items-center gap-1.5 text-xs font-semibold"
          style={{ color: 'rgba(255,255,255,0.45)' }}>
          ← Back to live classes
        </Link>
        <ClassEntryPanel liveClassId={id} title={live.title} instructorId={live.instructorId} />
      </div>
    )
  }

  /* ── Ended state ── */
  if (state === 'ended') {
    return (
      <div className="mx-auto max-w-xl py-20 text-center">
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}>
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-3xl"
            style={{ background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.25)' }}>
            <CheckCircle2 size={36} style={{ color: '#22C55E' }} />
          </div>
          <h1 className="text-2xl font-bold text-white" style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}>
            Stream ended
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'rgba(255,255,255,0.45)' }}>
            Recording will be available in ~5 minutes.
          </p>
          <div className="mt-8 flex justify-center gap-3">
            <Link href={`/live-classes/${id}/monitor`}
              className="rounded-xl px-5 py-2.5 text-sm font-semibold"
              style={{ background: 'rgba(255,255,255,0.07)', color: 'white' }}>
              View monitor
            </Link>
            <Link href={live.course?.id ? `/courses/${live.course.id}/edit` : '/courses'}
              className="rounded-xl px-5 py-2.5 text-sm font-semibold text-white"
              style={{ background: 'linear-gradient(135deg, #0057b8, #003d80)' }}>
              ← Back to course
            </Link>
          </div>
        </motion.div>
      </div>
    )
  }

  const courseHref = live.course?.id ? `/courses/${live.course.id}/edit` : '/courses'
  const isLiveState = state === 'live'
  const isBusy = state === 'starting' || state === 'connecting' || state === 'ending'

  const busyLabel: Record<string, string> = {
    starting:   'Enabling stream…',
    connecting: 'Connecting WHIP…',
    ending:     'Ending stream…',
  }

  return (
    <div className="mx-auto max-w-6xl">
      {/* Back nav */}
      <Link href={courseHref}
        className="mb-5 inline-flex items-center gap-1.5 text-sm font-semibold transition-opacity hover:opacity-70"
        style={{ color: 'rgba(255,255,255,0.4)' }}>
        <ChevronLeft size={14} />Back to course
      </Link>

      {/* Header */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white" style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}>
            Browser Studio
          </h1>
          <p className="mt-0.5 text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>{live.title}</p>
        </div>

        <div className="flex items-center gap-2">
          {isLiveState && (
            <motion.div
              animate={{ opacity: [1, 0.4, 1] }}
              transition={{ duration: 1.4, repeat: Infinity }}
              className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold text-white"
              style={{ background: '#EF4444' }}>
              <span className="h-2 w-2 rounded-full bg-white" />LIVE
            </motion.div>
          )}
          <Link href={`/live-classes/${id}/monitor`}
            className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-white/10"
            style={{ color: 'rgba(255,255,255,0.5)' }}>
            <Monitor size={12} />Monitor
          </Link>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_300px]">

        {/* ── Camera preview ── */}
        <div>
          <div className="relative overflow-hidden rounded-2xl bg-black" style={{ aspectRatio: '16/9' }}>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="h-full w-full object-cover"
              style={{ transform: 'scaleX(-1)' }} // mirror for natural feel
            />

            {/* Overlay: no camera */}
            {(state === 'loading-devices' || state === 'error') && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3"
                style={{ background: 'rgba(0,0,0,0.7)' }}>
                <VideoOff size={32} style={{ color: 'rgba(255,255,255,0.4)' }} />
                <p className="text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>
                  {state === 'loading-devices' ? 'Loading devices…' : 'Camera unavailable'}
                </p>
              </div>
            )}

            {/* Overlay: connecting */}
            {isBusy && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3"
                style={{ background: 'rgba(0,0,0,0.65)' }}>
                <Spinner size={28} />
                <p className="text-sm font-semibold text-white">{busyLabel[state] ?? 'Please wait…'}</p>
              </div>
            )}

            {/* Live badge overlay */}
            {isLiveState && (
              <div className="absolute left-3 top-3">
                <motion.div
                  animate={{ opacity: [1, 0.6, 1] }}
                  transition={{ duration: 1.4, repeat: Infinity }}
                  className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[10px] font-bold text-white"
                  style={{ background: 'rgba(239,68,68,0.85)' }}>
                  <span className="h-1.5 w-1.5 rounded-full bg-white" />LIVE
                </motion.div>
              </div>
            )}

            {/* Stats overlay */}
            {isLiveState && stats && (
              <div className="absolute bottom-3 right-3 rounded-xl px-3 py-2 text-[10px] font-mono"
                style={{ background: 'rgba(0,0,0,0.75)', color: 'rgba(255,255,255,0.8)' }}>
                <div className="flex gap-3">
                  <span>{stats.videoBitrate}k</span>
                  <span>{stats.frameRate}fps</span>
                  <span>{stats.resolution}</span>
                  {stats.packetLoss > 2 && (
                    <span style={{ color: '#F87171' }}>{stats.packetLoss}% loss</span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Error */}
          {error && (
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="mt-3 flex items-start gap-2 rounded-xl px-3 py-2.5 text-sm"
              style={{ background: 'rgba(239,68,68,0.10)', color: '#F87171', border: '1px solid rgba(239,68,68,0.25)' }}>
              <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />{error}
            </motion.p>
          )}

          {/* Device selectors */}
          {!isLiveState && (
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <DeviceSelect
                icon={<Camera size={12} />}
                label="Camera"
                devices={cameras}
                value={cameraId}
                onChange={handleCameraChange}
                disabled={isBusy}
              />
              <DeviceSelect
                icon={<Mic size={12} />}
                label="Microphone"
                devices={mics}
                value={micId}
                onChange={handleMicChange}
                disabled={isBusy}
              />
            </div>
          )}
        </div>

        {/* ── Right panel ── */}
        <div className="flex flex-col gap-4">

          {/* Connection status card */}
          <div className="rounded-2xl p-4 space-y-3"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.3)' }}>
              Connection
            </p>

            <ConnectionStatus state={state} />

            {/* Quality metrics */}
            {isLiveState && stats && (
              <div className="space-y-1.5 pt-2" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <StatRow label="Video" value={`${stats.videoBitrate} kbps`}
                  color={stats.videoBitrate > 500 ? '#22C55E' : stats.videoBitrate > 150 ? '#F59E0B' : '#EF4444'} />
                <StatRow label="Audio" value={`${stats.audioBitrate} kbps`} color="rgba(255,255,255,0.7)" />
                <StatRow label="Frame rate" value={`${stats.frameRate} fps`}
                  color={stats.frameRate >= 25 ? '#22C55E' : '#F59E0B'} />
                <StatRow label="Resolution" value={stats.resolution} color="rgba(255,255,255,0.7)" />
                {stats.packetLoss > 0 && (
                  <StatRow label="Packet loss" value={`${stats.packetLoss}%`}
                    color={stats.packetLoss < 2 ? '#22C55E' : stats.packetLoss < 5 ? '#F59E0B' : '#EF4444'} />
                )}
              </div>
            )}
          </div>

          {/* Go Live / Stop button */}
          <AnimatePresence mode="wait">
            {!isLiveState ? (
              <motion.button key="go-live"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                onClick={goLive}
                disabled={isBusy || state === 'loading-devices' || state === 'error'}
                className="flex w-full items-center justify-center gap-2.5 rounded-2xl py-4 text-sm font-bold text-white disabled:opacity-50 transition-all hover:brightness-110"
                style={{ background: 'linear-gradient(135deg, #EF4444, #DC2626)', boxShadow: '0 4px 20px rgba(239,68,68,0.3)' }}>
                {isBusy
                  ? <><Spinner size={16} />{busyLabel[state]}</>
                  : <><Radio size={16} />Go Live Now</>}
              </motion.button>
            ) : (
              <motion.button key="stop"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                onClick={stopStream}
                disabled={endMutation.isPending}
                className="flex w-full items-center justify-center gap-2.5 rounded-2xl py-4 text-sm font-bold text-white disabled:opacity-50 transition-all"
                style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.35)', color: '#F87171' }}>
                <Square size={16} />Stop Streaming
              </motion.button>
            )}
          </AnimatePresence>

          {/* Info box */}
          <div className="rounded-xl px-3 py-2.5 text-[11px] space-y-1"
            style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.4)' }}>
            <p className="flex items-start gap-1.5">
              <Activity size={10} className="mt-0.5 flex-shrink-0" style={{ color: '#0057b8' }} />
              Streams directly from your browser using WebRTC (WHIP). No software needed.
            </p>
            <p className="flex items-start gap-1.5">
              <BarChart2 size={10} className="mt-0.5 flex-shrink-0" style={{ color: '#818CF8' }} />
              For 1 000+ viewers, OBS on a wired connection gives higher quality. Browser streaming works great for small sessions.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── Device selector ─────────────────────────────────── */
function DeviceSelect({
  icon, label, devices, value, onChange, disabled,
}: {
  icon:     React.ReactNode
  label:    string
  devices:  MediaDeviceInfo[]
  value:    string
  onChange: (id: string) => void
  disabled: boolean
}) {
  return (
    <div className="flex items-center gap-2 rounded-xl px-3 py-2"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
      <span style={{ color: 'rgba(255,255,255,0.4)' }}>{icon}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled || devices.length === 0}
        className="flex-1 bg-transparent text-xs text-white outline-none disabled:opacity-50"
        style={{ color: 'rgba(255,255,255,0.85)' }}>
        {devices.length === 0
          ? <option>No {label.toLowerCase()} found</option>
          : devices.map(d => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `${label} ${d.deviceId.slice(0, 6)}`}
              </option>
            ))}
      </select>
      <Settings2 size={11} style={{ color: 'rgba(255,255,255,0.2)' }} />
    </div>
  )
}

/* ── Connection status indicator ─────────────────────── */
function ConnectionStatus({ state }: { state: StudioState }) {
  const cfg: Record<StudioState, { icon: React.ReactNode; label: string; color: string }> = {
    'loading-devices': { icon: <Spinner size={13} />, label: 'Loading devices…', color: 'rgba(255,255,255,0.4)' },
    ready:             { icon: <WifiOff size={13} />, label: 'Ready — not streaming', color: 'rgba(255,255,255,0.5)' },
    starting:          { icon: <Spinner size={13} />, label: 'Enabling Mux stream…', color: '#F59E0B' },
    connecting:        { icon: <Spinner size={13} />, label: 'Negotiating WHIP…', color: '#F59E0B' },
    live:              { icon: <Wifi size={13} />, label: 'Connected — you are live', color: '#22C55E' },
    ending:            { icon: <Spinner size={13} />, label: 'Ending stream…', color: '#F59E0B' },
    ended:             { icon: <CheckCircle2 size={13} />, label: 'Stream ended', color: '#22C55E' },
    error:             { icon: <AlertCircle size={13} />, label: 'Connection error', color: '#EF4444' },
    idle:              { icon: <WifiOff size={13} />, label: 'Idle', color: 'rgba(255,255,255,0.4)' },
  }

  const c = cfg[state]
  return (
    <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: c.color }}>
      {c.icon}{c.label}
    </div>
  )
}

/* ── Stat row ─────────────────────────────────────────── */
function StatRow({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span style={{ color: 'rgba(255,255,255,0.4)' }}>{label}</span>
      <span className="font-semibold" style={{ color }}>{value}</span>
    </div>
  )
}
