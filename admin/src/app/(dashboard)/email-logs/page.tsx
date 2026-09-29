'use client'

import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Mail, ChevronLeft, ChevronRight, ChevronDown, Search, X,
  AlertCircle, CheckCircle2, Clock, XCircle, Check, Inbox,
} from 'lucide-react'
import { useEmailLogs, fetchEmailLogHtml, type EmailLog, type EmailLogStatus } from '@/lib/api/emailLogs'
import Spinner from '@/components/ui/Spinner'

/* ─── Helpers ──────────────────────────────────────────── */
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

const STATUS_META: Record<EmailLogStatus, { label: string; bg: string; text: string; icon: React.ElementType }> = {
  sent:    { label: 'Sent',    bg: 'rgba(74,222,128,0.15)',  text: '#4ADE80', icon: CheckCircle2 },
  pending: { label: 'Pending', bg: 'rgba(250,204,21,0.15)',  text: '#FACC15', icon: Clock },
  failed:  { label: 'Failed',  bg: 'rgba(248,113,113,0.15)', text: '#F87171', icon: XCircle },
}

function StatusBadge({ status }: { status: EmailLogStatus }) {
  const m = STATUS_META[status]
  const Icon = m.icon
  return (
    <span className="inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] font-semibold"
      style={{ background: m.bg, color: m.text }}>
      <Icon size={10} />{m.label}
    </span>
  )
}

const STATUS_OPTIONS: (EmailLogStatus | '')[] = ['', 'sent', 'pending', 'failed']

/* ─── Status filter dropdown ──────────────────────────────
   A native <select>'s popup is drawn by the OS/browser, not this app —
   on most platforms that means a flat, unstyled list that floats over
   whatever's beneath it with no rounding or border, clashing with the
   rest of the dark UI. This is a fully custom listbox instead, styled
   and animated to match everything else on the page. */
function StatusDropdown({ value, onChange }: { value: EmailLogStatus | ''; onChange: (v: EmailLogStatus | '') => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const onEscape   = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onEscape)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onEscape)
    }
  }, [open])

  const current = value ? STATUS_META[value] : null

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-white outline-none transition-colors hover:bg-white/[0.08]"
        style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', minWidth: 140 }}>
        {current ? (
          <span className="flex items-center gap-1.5">
            <current.icon size={11} style={{ color: current.text }} />
            {current.label}
          </span>
        ) : (
          <span style={{ color: 'rgba(255,255,255,0.6)' }}>All statuses</span>
        )}
        <ChevronDown size={12} className="ml-auto transition-transform"
          style={{ color: 'rgba(255,255,255,0.35)', transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.12 }}
            className="absolute left-0 top-[calc(100%+6px)] z-20 overflow-hidden rounded-xl py-1 shadow-2xl"
            style={{ background: '#181B29', border: '1px solid rgba(255,255,255,0.1)', minWidth: 160 }}>
            {STATUS_OPTIONS.map(s => {
              const meta = s ? STATUS_META[s] : null
              const selected = s === value
              return (
                <button
                  key={s || 'all'}
                  type="button"
                  onClick={() => { onChange(s); setOpen(false) }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-white/[0.06]"
                  style={{ color: selected ? 'white' : 'rgba(255,255,255,0.65)' }}>
                  {meta ? <meta.icon size={11} style={{ color: meta.text }} /> : <Inbox size={11} style={{ color: 'rgba(255,255,255,0.4)' }} />}
                  <span className="flex-1 font-medium">{meta ? meta.label : 'All statuses'}</span>
                  {selected && <Check size={12} style={{ color: '#60A5FA' }} />}
                </button>
              )
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ─── Row ──────────────────────────────────────────────── */
function LogRow({ log, index }: { log: EmailLog; index: number }) {
  const [expanded, setExpanded] = useState(false)
  const [html,     setHtml]     = useState<string | null>(null)
  const [loading,  setLoading]  = useState(false)

  const toggle = async () => {
    if (expanded) { setExpanded(false); return }
    setExpanded(true)
    if (html === null) {
      setLoading(true)
      try { setHtml(await fetchEmailLogHtml(log.id)) }
      catch { setHtml('<p style="color:#F87171">Could not load this email\'s body.</p>') }
      finally { setLoading(false) }
    }
  }

  return (
    <>
      <motion.tr
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: index * 0.02 }}
        onClick={toggle}
        style={{
          borderBottom: '1px solid rgba(255,255,255,0.04)',
          cursor: 'pointer',
          background: expanded ? 'rgba(255,255,255,0.03)' : 'transparent',
        }}
        className="transition-colors hover:bg-white/[0.025]">

        {/* Timestamp — sentAt when it went out, createdAt (queued) otherwise */}
        <td className="px-4 py-3 tabular-nums text-[11px] whitespace-nowrap"
          style={{ color: 'rgba(255,255,255,0.4)' }}>
          {fmtDate(log.sentAt ?? log.createdAt)}
        </td>

        {/* Recipient */}
        <td className="px-4 py-3">
          <p className="text-xs font-medium text-white truncate max-w-[200px]">{log.to}</p>
        </td>

        {/* Subject */}
        <td className="px-4 py-3">
          <p className="text-xs truncate max-w-[260px]" style={{ color: 'rgba(255,255,255,0.7)' }}>{log.subject}</p>
        </td>

        {/* Status */}
        <td className="px-4 py-3">
          <StatusBadge status={log.status} />
        </td>

        {/* Attempts */}
        <td className="px-4 py-3 text-center text-[11px] tabular-nums" style={{ color: 'rgba(255,255,255,0.4)' }}>
          {log.attempts}
        </td>

        {/* Sent via */}
        <td className="px-4 py-3 text-[11px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
          {log.sentVia ?? '—'}
        </td>

        {/* Error (truncated) */}
        <td className="px-4 py-3 text-[11px] truncate max-w-[180px]" style={{ color: log.lastError ? '#F87171' : 'rgba(255,255,255,0.2)' }}>
          {log.lastError ?? '—'}
        </td>

        {/* Expand indicator */}
        <td className="px-4 py-3">
          <span className="text-[10px] font-semibold" style={{ color: 'rgba(255,255,255,0.25)' }}>
            {expanded ? '▲ hide' : '▼ view'}
          </span>
        </td>
      </motion.tr>

      {/* Expanded body preview */}
      {expanded && (
        <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', background: 'rgba(0,0,0,0.2)' }}>
          <td colSpan={8} className="px-4 py-3">
            {loading ? (
              <div className="flex items-center justify-center py-8"><Spinner size={16} variant="muted" /></div>
            ) : (
              <div className="overflow-hidden rounded-xl" style={{ background: '#0B0D14', border: '1px solid rgba(255,255,255,0.08)' }}>
                {/* sandbox="" (no tokens): renders the email's layout/CSS but
                    runs no scripts, forms or same-origin access — a rendered
                    preview of our own transactional HTML, inert either way. */}
                <iframe
                  sandbox=""
                  srcDoc={html ?? ''}
                  title={`Email preview — ${log.subject}`}
                  style={{ width: '100%', height: 420, border: 'none', background: 'white' }}
                />
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

/* ─── Page ─────────────────────────────────────────────── */
export default function EmailLogsPage() {
  const [page,      setPage]      = useState(1)
  const [status,    setStatus]    = useState<EmailLogStatus | ''>('')
  const [toInput,   setToInput]   = useState('')
  const [to,        setTo]        = useState('')

  const { data, isLoading, isError } = useEmailLogs({ page, status: status || undefined, to: to || undefined })

  const applyTo   = () => { setTo(toInput.trim()); setPage(1) }
  const clearAll  = () => { setStatus(''); setToInput(''); setTo(''); setPage(1) }
  const hasFilter = !!status || !!to

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl"
              style={{ background: 'rgba(0,87,184,0.18)', border: '1px solid rgba(0,87,184,0.3)' }}>
              <Mail size={16} style={{ color: '#60A5FA' }} />
            </div>
            <h1 className="text-2xl font-bold text-white" style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}>
              Email Logs
            </h1>
          </div>
          <p className="mt-1 text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>
            Every email the platform has queued — delivered, pending, or failed.
          </p>
        </div>
        {hasFilter && (
          <button onClick={clearAll}
            className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-white/10"
            style={{ color: 'rgba(255,255,255,0.5)', border: '1px solid rgba(255,255,255,0.1)' }}>
            <X size={11} />Clear filters
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <StatusDropdown value={status} onChange={v => { setStatus(v); setPage(1) }} />

        <div className="flex items-center gap-1.5 rounded-xl px-3 py-2"
          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
          <Search size={11} style={{ color: 'rgba(255,255,255,0.3)' }} />
          <input
            value={toInput}
            onChange={e => setToInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && applyTo()}
            placeholder="Filter by recipient email…"
            className="bg-transparent text-xs text-white outline-none placeholder:text-white/25 w-56"
          />
          {toInput && (
            <button onClick={() => { setToInput(''); setTo(''); setPage(1) }}>
              <X size={10} style={{ color: 'rgba(255,255,255,0.3)' }} />
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-2xl"
        style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)' }}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                {['Sent', 'To', 'Subject', 'Status', 'Attempts', 'Via', 'Error', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-left font-semibold"
                    style={{ color: 'rgba(255,255,255,0.4)', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={8} className="py-16 text-center">
                  <Spinner size={18} variant="muted" />
                </td></tr>
              ) : isError ? (
                <tr><td colSpan={8} className="py-16 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <AlertCircle size={22} style={{ color: '#F87171' }} />
                    <p className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>Failed to load email logs</p>
                  </div>
                </td></tr>
              ) : !data?.docs.length ? (
                <tr><td colSpan={8} className="py-16 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <Inbox size={22} style={{ color: 'rgba(255,255,255,0.2)' }} />
                    <p className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>
                      {hasFilter ? 'No emails match these filters.' : 'No email log entries yet.'}
                    </p>
                    {hasFilter && (
                      <button onClick={clearAll}
                        className="mt-1 text-xs font-semibold transition-colors hover:text-white"
                        style={{ color: '#60A5FA' }}>
                        Clear filters
                      </button>
                    )}
                  </div>
                </td></tr>
              ) : data.docs.map((log, i) => (
                <LogRow key={log.id} log={log} index={i} />
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {data?.meta && data.meta.total_pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3"
            style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.35)' }}>
              {data.meta.total_count.toLocaleString()} entries · page {data.meta.page} of {data.meta.total_pages}
            </p>
            <div className="flex gap-1">
              <button disabled={!data.meta.has_prev} onClick={() => setPage(p => p - 1)}
                className="rounded-lg p-1.5 disabled:opacity-30 transition-colors hover:bg-white/[0.05]">
                <ChevronLeft size={14} style={{ color: 'white' }} />
              </button>
              <button disabled={!data.meta.has_next} onClick={() => setPage(p => p + 1)}
                className="rounded-lg p-1.5 disabled:opacity-30 transition-colors hover:bg-white/[0.05]">
                <ChevronRight size={14} style={{ color: 'white' }} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
