'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Film, Search, Play, Clock, Calendar, User, BookOpen,
  AlertCircle, X, ExternalLink, Loader2,
} from 'lucide-react'
import Spinner from '@/components/ui/Spinner'
import { useRecordings, useRecordingPlayback, type RecordingRow } from '@/lib/api/recordings'
import { useCurrentUser } from '@/lib/api/user'
import { useBackdropClose } from '@/hooks/useBackdropClose'

/* ── Class recordings ────────────────────────────────────
   Every interactive class is recorded from the moment the first person walks
   in — the meeting platform starts a room-composite egress on the first real
   participant and there is no control, anywhere, to turn it off.

   What this screen shows is a LIST OF IDS, never URLs. A playback link is
   minted on demand, expires, and is audited, so a link that escapes into an
   inbox or a screenshot stops working, and "who watched this class" stays an
   answerable question. That is why Watch is a button and not an anchor. */

function fmtDuration(secs: number | null, fallbackMins: number): string {
  if (secs == null) return `~${fallbackMins}m scheduled`
  const h = Math.floor(secs / 3600)
  const m = Math.round((secs % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function fmtWhen(iso: string | null, fallback: string): string {
  const d = new Date(iso ?? fallback)
  return d.toLocaleString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

/* ── Player overlay ─────────────────────────────────── */
function PlayerModal({ row, url, onClose }: { row: RecordingRow; url: string; onClose: () => void }) {
  const backdrop = useBackdropClose(onClose)
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.72)' }} {...backdrop}>
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 8 }} onClick={e => e.stopPropagation()}
        className="w-full max-w-4xl overflow-hidden rounded-2xl"
        style={{ background: '#161829', border: '1px solid rgba(255,255,255,0.10)' }}>
        <div className="flex items-start justify-between gap-3 px-5 py-4"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-bold text-white">{row.title}</h2>
            <p className="mt-0.5 truncate text-[11px]" style={{ color: 'rgba(255,255,255,0.40)' }}>
              {row.course?.title ?? 'No course'} · {fmtWhen(row.endedAt, row.scheduledStart)}
            </p>
          </div>
          <button onClick={onClose}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl transition-colors hover:bg-white/10"
            style={{ color: 'rgba(255,255,255,0.45)' }}>
            <X size={15} />
          </button>
        </div>

        <video src={url} controls autoPlay className="w-full" style={{ maxHeight: '70vh', background: '#000' }} />

        <div className="flex items-center justify-between gap-3 px-5 py-3 text-[11px]"
          style={{ borderTop: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.35)' }}>
          <span>This link is temporary and expires. Reopen from here rather than sharing it.</span>
          <a href={url} target="_blank" rel="noopener noreferrer"
            className="flex flex-shrink-0 items-center gap-1 font-semibold"
            style={{ color: '#0057b8' }}>
            <ExternalLink size={11} />Open in a new tab
          </a>
        </div>
      </motion.div>
    </motion.div>
  )
}

/* ── Page ───────────────────────────────────────────── */
export default function RecordingsPage() {
  const { data: me } = useCurrentUser()
  const [search, setSearch]   = useState('')
  const [page,   setPage]     = useState(1)
  const [playing, setPlaying] = useState<{ row: RecordingRow; url: string } | null>(null)
  const [failed,  setFailed]  = useState<string | null>(null)

  const { data: rows = [], isLoading, isError } = useRecordings(page, search)
  const playback = useRecordingPlayback()

  const watch = (row: RecordingRow) => {
    setFailed(null)
    playback.mutate(row.id, {
      onSuccess: d => setPlaying({ row, url: d.url }),
      onError: (e: any) => setFailed(
        e?.response?.data?.error?.message ?? 'Could not get a playback link.',
      ),
    })
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-5 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl"
          style={{ background: 'rgba(0,87,184,0.15)' }}>
          <Film size={19} style={{ color: '#0057b8' }} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-white"
            style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}>Class Recordings</h1>
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.40)' }}>
            {me?.role === 'super_admin'
              ? 'Every recorded class, across all academies'
              : 'Recorded classes in your academy'}
          </p>
        </div>
      </div>

      <div className="mb-4 flex items-center gap-2 rounded-2xl px-3 py-2"
        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
        <Search size={14} style={{ color: 'rgba(255,255,255,0.35)' }} />
        <input
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1) }}
          placeholder="Search by class title…"
          className="w-full bg-transparent text-sm text-white outline-none placeholder:text-white/30" />
      </div>

      {failed && (
        <div className="mb-4 flex items-start gap-2 rounded-xl px-3 py-2.5 text-xs"
          style={{ background: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.25)', color: '#FCA5A5' }}>
          <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
          <span>{failed}</span>
        </div>
      )}

      {isLoading && (
        <div className="flex items-center justify-center gap-3 py-20">
          <Spinner size={18} /><span className="text-sm" style={{ color: 'rgba(255,255,255,0.45)' }}>Loading recordings…</span>
        </div>
      )}

      {isError && (
        <div className="py-20 text-center">
          <AlertCircle size={28} className="mx-auto mb-3" style={{ color: '#EF4444' }} />
          <p className="text-sm font-semibold text-white">Couldn’t load recordings</p>
        </div>
      )}

      {!isLoading && !isError && rows.length === 0 && (
        <div className="rounded-2xl py-20 text-center"
          style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <Film size={28} className="mx-auto mb-3" style={{ color: 'rgba(255,255,255,0.25)' }} />
          <p className="text-sm font-semibold text-white">
            {search ? 'No recordings match that search' : 'No recordings yet'}
          </p>
          <p className="mx-auto mt-1.5 max-w-sm text-[11px] leading-relaxed"
            style={{ color: 'rgba(255,255,255,0.35)' }}>
            Interactive classes record automatically and appear here a few minutes
            after the class ends.
          </p>
        </div>
      )}

      {!isLoading && !isError && rows.length > 0 && (
        <div className="space-y-2">
          {rows.map(row => (
            <div key={row.id}
              className="flex items-center gap-4 rounded-2xl px-4 py-3"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-white">{row.title}</p>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]"
                  style={{ color: 'rgba(255,255,255,0.40)' }}>
                  <span className="flex items-center gap-1"><Calendar size={10} />{fmtWhen(row.endedAt, row.scheduledStart)}</span>
                  <span className="flex items-center gap-1"><Clock size={10} />{fmtDuration(row.recordingSecs, row.durationMins)}</span>
                  {row.course && <span className="flex items-center gap-1"><BookOpen size={10} />{row.course.title}</span>}
                  {row.instructor && <span className="flex items-center gap-1"><User size={10} />{row.instructor.name}</span>}
                </div>
              </div>

              <motion.button
                whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                onClick={() => watch(row)}
                disabled={playback.isPending}
                className="flex flex-shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold text-white disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, #0057b8, #003d80)' }}>
                {playback.isPending && playback.variables === row.id
                  ? <><Loader2 size={12} className="animate-spin" />Preparing…</>
                  : <><Play size={12} />Watch</>}
              </motion.button>
            </div>
          ))}
        </div>
      )}

      {!isLoading && !isError && (rows.length === 20 || page > 1) && (
        <div className="mt-4 flex items-center justify-center gap-2">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
            className="rounded-xl px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
            style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.7)' }}>Previous</button>
          <span className="px-2 text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>Page {page}</span>
          <button onClick={() => setPage(p => p + 1)} disabled={rows.length < 20}
            className="rounded-xl px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
            style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.7)' }}>Next</button>
        </div>
      )}

      <AnimatePresence>
        {playing && (
          <PlayerModal row={playing.row} url={playing.url} onClose={() => setPlaying(null)} />
        )}
      </AnimatePresence>
    </div>
  )
}
