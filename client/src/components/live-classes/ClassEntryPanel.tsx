'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Loader2, Radio } from 'lucide-react'
import { redirectToClass, handoffError } from '@/lib/joinClass'

/* ─────────────────────────────────────────────────────
   ClassEntryPanel — the student's door into an interactive class.
   ─────────────────────────────────────────────────────
   Replaces LiveKitRoomView, which used to build the room inside the LMS. The
   room now lives on the meeting platform, which owns the pre-join screen, the
   camera and microphone prompts, the lobby, and the watermark.

   What stays here is the part the LMS is the authority on: whether this
   student may go at all. The handoff runs every entitlement rule — booking,
   enrolment, blocked module, academy, time window — before it returns a URL.

   TWO refusals get their own treatment, because they are not errors:

     425 TOO_EARLY   the doors have not opened. Count down and retry.
     409 not started the instructor has not arrived. Wait and retry.

   A class goes "Live Now" fifteen minutes before its start time, which says
   only what the clock says — the room itself appears when the host walks in.
   Most students meet that gap, so it must read as waiting, not as a fault.
───────────────────────────────────────────────────── */
type Phase = 'idle' | 'opening' | 'waiting' | 'early' | 'error'

const POLL_MS = 8000

export function ClassEntryPanel({ liveClassId }: { liveClassId: string }) {
  const [phase,   setPhase]   = useState<Phase>('idle')
  const [error,   setError]   = useState<string | null>(null)
  const [waitFor, setWaitFor] = useState(0)

  const join = useCallback(async () => {
    setPhase('opening')
    setError(null)
    try {
      await redirectToClass(liveClassId)
      /* The browser is leaving; leave the spinner up. */
    } catch (err) {
      const e = err as { response?: { status?: number; data?: { error?: { code?: string; retryAfter?: number } } } }
      const status = e?.response?.status
      const code   = e?.response?.data?.error?.code
      const retry  = e?.response?.data?.error?.retryAfter

      if (status === 425 && retry) { setWaitFor(Number(retry)); setPhase('early'); return }
      if (status === 409 && code !== 'CLASS_CANCELLED' && code !== 'CLASS_ENDED') {
        setPhase('waiting'); return
      }
      /* The registration prompt says this one (lib/registrationGate, opened by lib/axios). */
      if (code === 'REGISTRATION_REQUIRED') { setPhase('idle'); return }
      setError(handoffError(err))
      setPhase('error')
    }
  }, [liveClassId])

  /* Early: count down, then try once by itself. */
  useEffect(() => {
    if (phase !== 'early' || waitFor <= 0) return
    const t = setInterval(() => {
      setWaitFor(s => {
        if (s <= 1) { clearInterval(t); void join(); return 0 }
        return s - 1
      })
    }, 1000)
    return () => clearInterval(t)
  }, [phase, waitFor, join])

  /* Waiting for the host: keep asking, so the promise below is true. */
  useEffect(() => {
    if (phase !== 'waiting') return
    const t = setTimeout(() => { void join() }, POLL_MS)
    return () => clearTimeout(t)
  }, [phase, join])

  const mm = String(Math.floor(waitFor / 60)).padStart(2, '0')
  const ss = String(waitFor % 60).padStart(2, '0')

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl"
        style={{ background: 'rgba(124,58,237,0.15)' }}>
        <Radio size={22} style={{ color: '#A78BFA' }} />
      </div>

      {phase === 'early' ? (
        <>
          <p className="text-sm font-semibold text-white">The room opens shortly</p>
          <p className="font-mono text-2xl font-bold" style={{ color: '#A78BFA' }}>{mm}:{ss}</p>
          <p className="max-w-xs text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>
            You will be taken in automatically — no need to refresh.
          </p>
        </>
      ) : phase === 'waiting' ? (
        <>
          <p className="text-sm font-semibold text-white">Waiting for the instructor</p>
          <p className="max-w-xs text-xs leading-relaxed" style={{ color: 'rgba(255,255,255,0.45)' }}>
            Your seat is reserved. The class opens the moment the instructor
            starts it, and you will be taken in automatically.
          </p>
          <p className="flex items-center gap-1.5 text-[11px]" style={{ color: 'rgba(255,255,255,0.30)' }}>
            <Loader2 size={11} className="animate-spin" />Checking every few seconds — no need to refresh
          </p>
        </>
      ) : (
        <>
          <p className="text-sm font-semibold text-white">Interactive class</p>
          {error && (
            <div className="flex max-w-md items-start gap-2 rounded-xl px-3 py-2 text-left text-xs"
              style={{ background: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.25)', color: '#FCA5A5' }}>
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}
          <button
            onClick={join}
            disabled={phase === 'opening'}
            className="flex items-center gap-2 rounded-2xl px-6 py-3 text-sm font-bold text-white transition-all disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #7C3AED, #A78BFA)' }}>
            {phase === 'opening'
              ? <><Loader2 size={15} className="animate-spin" />Opening…</>
              : <><Radio size={15} />Join the class</>}
          </button>
        </>
      )}
    </div>
  )
}
