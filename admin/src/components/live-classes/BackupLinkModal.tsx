'use client'

/* Backup link — the instructor cannot get into the class's room (the in-app
   room will not open, or the Meet will not let them in), so swap another one
   in on the spot: a fresh Google Meet with the instructor as co-host, or a
   link pasted here. Students who press Join go to the new link from then on.
   Backend: LiveClassService.switchToBackupLink. */
import { useState } from 'react'
import { motion } from 'framer-motion'
import Link from 'next/link'
import { X, LifeBuoy, Video, Link2, Copy, Check, AlertCircle, CheckCircle2, ExternalLink, ChevronLeft } from 'lucide-react'
import { zoneOf, foreignZoneTag } from '@/lib/timezone'
import {
  useBackupLinkInfo, useSwitchBackupLink, markInstructorJoined,
  type LiveClass, type BackupLinkInfo, type BackupLinkSwitched,
} from '@/lib/api/liveClasses'
import Spinner from '@/components/ui/Spinner'
import { useToast } from '@/store/ui.store'
import { copyText } from '@/lib/shareLink'

/* The Backup colour: urgent, and apart from the green Join and the blue actions. */
export const BACKUP_RED = '#F43F5E'
const muted = { color: 'rgba(255,255,255,0.45)' } as const

export function BackupLinkModal({ live, onClose }: { live: LiveClass; onClose: () => void }) {
  const toast = useToast()
  const { data: info, isLoading, error: infoError } = useBackupLinkInfo(live.id)
  const swap = useSwitchBackupLink()
  const [url, setUrl]       = useState('')
  const [error, setError]   = useState<string | null>(null)
  const [done, setDone]     = useState<BackupLinkSwitched | null>(null)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy]     = useState<'generate' | 'paste' | null>(null)

  const tag  = foreignZoneTag(live.organizationSlug)
  const when = new Date(live.scheduledStart).toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    timeZone: zoneOf(live.organizationSlug),
  }) + (tag ? ` ${tag}` : '')

  async function run(mode: 'generate' | 'paste') {
    if (busy || done) return   // Enter in the box, or a second click, while one is on its way
    setError(null)
    const pasted = url.trim()
    if (mode === 'paste' && !/^https:\/\/\S+$/i.test(pasted)) {
      setError('Paste the full meeting link, starting with https://')
      return
    }
    setBusy(mode)
    try {
      const r = await swap.mutateAsync(mode === 'generate' ? { id: live.id, mode } : { id: live.id, mode, url: pasted })
      setDone(r)
      toast.success('Backup link is live', 'Students who press Join now go to the new link.')
    } catch (e: any) {
      setError(e?.response?.data?.error?.message ?? 'Could not switch the link. Please try again.')
    } finally {
      setBusy(null)
    }
  }

  async function copy(text: string) {
    try { await copyText(text); setCopied(true); setTimeout(() => setCopied(false), 1500) }
    catch { toast.error('Could not copy', 'Select the link and copy it by hand.') }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 8 }}
        transition={{ duration: 0.18 }}
        role="dialog" aria-modal="true" aria-labelledby="backup-link-title"
        className="relative w-full max-w-md overflow-hidden rounded-2xl border shadow-2xl"
        style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.08)' }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pb-4 pt-5" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg" style={{ background: 'rgba(244,63,94,0.14)' }}>
              <LifeBuoy size={15} style={{ color: BACKUP_RED }} />
            </div>
            <div className="min-w-0">
              <h2 id="backup-link-title" className="text-sm font-semibold text-white">Backup link</h2>
              <p className="mt-0.5 truncate text-[11px]" style={muted}>{live.title} · {when}</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-white/10" style={muted}>
            <X size={14} />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {isLoading && <div className="flex justify-center py-8"><Spinner /></div>}
          {infoError && !info && <Problem text="Could not load this class. Close and try again." />}

          {done ? (
            <Done done={done} info={info} copied={copied} onCopy={() => copy(done.url)} />
          ) : info && (
            <>
              <p className="text-xs leading-relaxed" style={{ color: 'rgba(255,255,255,0.6)' }}>
                Instructor can&apos;t get into the class? Move it to a new room. Students who press
                <b className="text-white"> Join</b> go straight to the new link — on the website and here.
              </p>
              <div className="rounded-xl px-3 py-2.5 text-xs" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                <span style={muted}>Room now: </span>
                <span className="text-white">{roomLabel(info)}</span>
                {info.backupLink && (
                  <span className="mt-1 block" style={{ color: '#FDA4AF' }}>
                    Already on a backup link since {new Date(info.backupLink.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: zoneOf(live.organizationSlug) })} — you can switch again.
                  </span>
                )}
              </div>

              {!info.canSwitch ? (
                <Problem text={info.reason ?? 'This class cannot take a backup link.'} />
              ) : (
                <>
                  {/* 1 — generate */}
                  <div className="rounded-xl p-3.5" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                    <div className="flex items-start gap-2.5">
                      <Video size={15} className="mt-0.5 flex-shrink-0" style={{ color: '#93C5FD' }} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-white">Generate a new Google Meet link</p>
                        <p className="mt-0.5 text-[11px] leading-relaxed" style={muted}>{hostLine(info)}</p>
                      </div>
                    </div>
                    <button onClick={() => run('generate')} disabled={!!busy}
                      className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                      style={{ background: BACKUP_RED }}>
                      {busy === 'generate' ? <><Spinner size={12} /> Making the Meet…</> : <><Video size={12} /> Generate &amp; switch</>}
                    </button>
                  </div>

                  {/* 2 — paste */}
                  <div className="rounded-xl p-3.5" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                    <div className="flex items-start gap-2.5">
                      <Link2 size={15} className="mt-0.5 flex-shrink-0" style={{ color: '#93C5FD' }} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-white">Paste a meeting link</p>
                        <p className="mt-0.5 text-[11px]" style={muted}>A Google Meet, Zoom or Teams link you already have open.</p>
                      </div>
                    </div>
                    <div className="mt-3 flex gap-2">
                      <input value={url} onChange={e => { setUrl(e.target.value); setError(null) }}
                        onKeyDown={e => { if (e.key === 'Enter' && url.trim()) void run('paste') }}
                        placeholder="https://meet.google.com/abc-defg-hij" aria-label="Meeting link"
                        className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-xs text-white outline-none placeholder:text-white/25 focus:border-rose-500/50"
                        style={{ background: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.1)' }} />
                      <button onClick={() => run('paste')} disabled={!!busy || !url.trim()}
                        className="flex flex-shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                        style={{ background: BACKUP_RED }}>
                        {busy === 'paste' ? <Spinner size={12} /> : <Link2 size={12} />}Use link
                      </button>
                    </div>
                  </div>

                  <p className="text-[11px] leading-relaxed" style={muted}>
                    Booked students get a notice in the app{info.instructor ? `, and ${info.instructor.name} gets the new link by email` : ''}.
                    {info.current.type === 'internal' && ' The class moves from the in-app room to this link.'}
                  </p>
                </>
              )}
            </>
          )}

          {error && <Problem text={error} />}
        </div>

        <div className="flex justify-end px-5 pb-5">
          <button onClick={onClose}
            className="rounded-lg px-4 py-2 text-xs font-medium transition-colors hover:bg-white/[0.06]"
            style={{ color: done ? '#fff' : 'rgba(255,255,255,0.5)', background: done ? 'rgba(255,255,255,0.08)' : undefined }}>
            {done ? 'Done' : 'Cancel'}
          </button>
        </div>
      </motion.div>
    </div>
  )
}

function Done({ done, info, copied, onCopy }: { done: BackupLinkSwitched; info?: BackupLinkInfo; copied: boolean; onCopy: () => void }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: '#34D399' }}>
        <CheckCircle2 size={16} /> Backup link is live
      </div>
      <div className="flex items-center gap-2 rounded-xl px-3 py-2.5" style={{ background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.2)' }}>
        <a href={done.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-xs font-semibold text-white underline-offset-2 hover:underline">{done.url}</a>
        <button onClick={onCopy} aria-label="Copy link"
          className="flex h-7 flex-shrink-0 items-center gap-1 rounded-lg px-2 text-[11px] font-semibold transition-colors hover:bg-white/10" style={{ color: '#34D399' }}>
          {copied ? <><Check size={12} />Copied</> : <><Copy size={12} />Copy</>}
        </button>
      </div>
      <ul className="space-y-1 text-[11px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
        <li>• Students who press Join now go to this link — website and admin.</li>
        <li>• Booked students were notified in the app.</li>
        {done.instructorEmailed && <li>• {info?.instructor?.name ?? 'The instructor'} was emailed the link.</li>}
        {done.mode === 'generated' && (done.cohost
          ? <li>• Co-host: <b className="text-white">{done.cohost}</b> — they join with that Google account.</li>
          : info?.instructor?.organizer
            ? <li>• {info.instructor.name} hosts it on their own Google account{info.instructor.email ? <> (<b className="text-white">{info.instructor.email}</b>)</> : null}.</li>
            : <li style={{ color: '#FBBF24' }}>• No co-host was set — send the instructor this link (Copy) so they can join.</li>)}
      </ul>
    </div>
  )
}

/* Where the studio and monitor pages send a class that runs on a meeting link
   — above all one switched to a backup link: an instructor opening the studio
   from a reminder sent before the switch must land on the new room, never the
   abandoned one. */
export function MovedToLinkPanel({ live, backHref, backLabel }: { live: LiveClass; backHref: string; backLabel: string }) {
  const url = live.meetingUrl
  return (
    <div className="mx-auto max-w-xl">
      <Link href={backHref} className="mb-4 inline-flex items-center gap-1.5 text-xs font-semibold" style={muted}>
        <ChevronLeft size={14} />{backLabel}
      </Link>
      <div className="rounded-2xl p-6 text-center" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl" style={{ background: 'rgba(244,63,94,0.14)' }}>
          <LifeBuoy size={22} style={{ color: BACKUP_RED }} />
        </div>
        <h1 className="text-lg font-bold text-white">{live.backupLink ? 'This class moved to a backup link' : 'This class runs on a meeting link'}</h1>
        <p className="mt-1 text-sm" style={muted}>
          {live.title}{live.backupLink?.previousType === 'internal' ? ' — the in-app room is no longer used.' : ''}
        </p>
        {url ? (
          <a href={url} target="_blank" rel="noopener noreferrer" onClick={() => markInstructorJoined(live.id)}
            className="mt-5 inline-flex items-center gap-1.5 rounded-xl px-5 py-2.5 text-sm font-bold text-white transition-opacity hover:opacity-90"
            style={{ background: 'linear-gradient(135deg,#22C55E,#16A34A)' }}>
            <ExternalLink size={14} />Join the class
          </a>
        ) : (
          <p className="mt-5 text-sm" style={{ color: '#FCA5A5' }}>No link is set yet — add one from Live Classes → Backup.</p>
        )}
        {url && <p className="mt-3 break-all text-[11px]" style={muted}>{url}</p>}
      </div>
    </div>
  )
}

function Problem({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 rounded-xl px-3 py-2.5 text-xs" role="alert"
      style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#FCA5A5' }}>
      <AlertCircle size={13} className="mt-0.5 flex-shrink-0" />{text}
    </div>
  )
}

function roomLabel(info: BackupLinkInfo): string {
  if (info.current.type === 'internal') return 'In-app meeting room'
  const u = info.current.meetingUrl
  if (!u) return 'No link yet'
  return /meet\.google\.com/i.test(u) ? `Google Meet · ${u.replace(/^https:\/\//i, '')}` : u.replace(/^https:\/\//i, '')
}

/* Who a generated Meet hands the controls to — createGoogleMeetLink's rule. */
function hostLine(info: BackupLinkInfo): string {
  const i = info.instructor
  if (!i) return 'A fresh Meet room. No instructor on this class — nobody is made co-host.'
  if (i.organizer) return `A fresh Meet room on ${i.name}'s own Google account (${i.email ?? i.meetEmail}) — they host it.`
  if (!i.meetEmail) return `A fresh Meet room. ${i.name} has no email on file, so nobody is made co-host.`
  return i.via === 'meet-email'
    ? `A fresh Meet room with ${i.name} as co-host, signed in as ${i.meetEmail} (their Gmail for Google Meet).`
    : `A fresh Meet room with ${i.name} as co-host as ${i.meetEmail} — their login email. If they use Meet with another Google account, add it as their Gmail for Google Meet first.`
}
