'use client'

/* ─────────────────────────────────────────────────────────────
   WhatsApp Logs — every template message the platform has sent: who it went
   to, the message as they read it, and whether it went (sent = WhatsApp
   accepted it; delivered / read are not reported to us). super_admin only.
───────────────────────────────────────────────────────────── */
import { useState } from 'react'
import { motion } from 'framer-motion'
import {
  MessageCircle, ChevronLeft, ChevronRight, Search, X, AlertCircle, CheckCircle2, Clock, XCircle, Inbox,
} from 'lucide-react'
import {
  useWhatsAppLogs, useWhatsAppLogSummary, useWhatsAppTemplates, type WhatsAppLog, type WhatsAppLogStatus,
} from '@/lib/api/whatsappLogs'
import { LogSummary, DateRange } from '@/components/logs/LogSummary'
import Spinner from '@/components/ui/Spinner'

const fmtDate = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const fmtPhone = (d: string) => `+${d}`

const STATUS_META: Record<WhatsAppLogStatus, { label: string; bg: string; text: string; icon: React.ElementType }> = {
  sent:    { label: 'Sent',    bg: 'rgba(74,222,128,0.15)',  text: '#4ADE80', icon: CheckCircle2 },
  pending: { label: 'Pending', bg: 'rgba(250,204,21,0.15)',  text: '#FACC15', icon: Clock },
  failed:  { label: 'Failed',  bg: 'rgba(248,113,113,0.15)', text: '#F87171', icon: XCircle },
}

function StatusBadge({ status }: { status: WhatsAppLogStatus }) {
  const m = STATUS_META[status]; const Icon = m.icon
  return (
    <span className="inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] font-semibold" style={{ background: m.bg, color: m.text }}>
      <Icon size={10} />{m.label}
    </span>
  )
}

const selectCls = 'rounded-xl px-3 py-2 text-xs text-white outline-none'
const selectStyle = { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', colorScheme: 'dark' } as const

/* The message as a WhatsApp bubble, its values, and its button. */
function MessagePreview({ log }: { log: WhatsAppLog }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="rounded-2xl p-4" style={{ background: '#0B141A' }}>
        <div className="max-w-[420px] rounded-2xl rounded-tl-sm px-3.5 py-2.5 text-[13px] leading-relaxed" style={{ background: '#1F2C33', color: '#E9EDEF' }}>
          {log.text ? (
            <p className="whitespace-pre-wrap">{log.text.replace(/\*([^*]+)\*/g, '$1')}</p>
          ) : (
            <p className="italic" style={{ color: 'rgba(233,237,239,0.6)' }}>
              The wording of this template is kept by WhatsApp — its values are on the right.
            </p>
          )}
          {log.button && (
            <p className="mt-2 border-t pt-2 text-center text-[12px] font-semibold" style={{ borderColor: 'rgba(255,255,255,0.08)', color: '#53BDEB' }}>
              🔗 Button
            </p>
          )}
        </div>
      </div>
      <div className="space-y-2 text-xs">
        <table className="w-full">
          <tbody>
            {log.values.map((v, i) => (
              <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <td className="py-1.5 pr-3 align-top whitespace-nowrap" style={{ color: 'rgba(255,255,255,0.4)' }}>{v.name}</td>
                <td className="py-1.5 text-white break-words">{v.value || '—'}</td>
              </tr>
            ))}
            {log.button && (
              <tr><td className="py-1.5 pr-3 align-top" style={{ color: 'rgba(255,255,255,0.4)' }}>Button</td>
                <td className="py-1.5 break-all" style={{ color: '#60A5FA' }}>{log.button}</td></tr>
            )}
            <tr><td className="py-1.5 pr-3" style={{ color: 'rgba(255,255,255,0.4)' }}>Template</td>
              <td className="py-1.5 font-mono text-[11px]" style={{ color: 'rgba(255,255,255,0.6)' }}>{log.templateName}</td></tr>
            {log.waMessageId && (
              <tr><td className="py-1.5 pr-3" style={{ color: 'rgba(255,255,255,0.4)' }}>WhatsApp id</td>
                <td className="py-1.5 font-mono text-[10px] break-all" style={{ color: 'rgba(255,255,255,0.45)' }}>{log.waMessageId}</td></tr>
            )}
            {log.lastError && (
              <tr><td className="py-1.5 pr-3 align-top" style={{ color: 'rgba(255,255,255,0.4)' }}>Error</td>
                <td className="py-1.5 break-words" style={{ color: '#F87171' }}>{log.lastError}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function LogRow({ log, index }: { log: WhatsAppLog; index: number }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <motion.tr initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: index * 0.02 }}
        onClick={() => setOpen(o => !o)} className="cursor-pointer transition-colors hover:bg-white/[0.025]"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', background: open ? 'rgba(255,255,255,0.03)' : 'transparent' }}>
        <td className="px-4 py-3 tabular-nums text-[11px] whitespace-nowrap" style={{ color: 'rgba(255,255,255,0.4)' }}>{fmtDate(log.sentAt ?? log.createdAt)}</td>
        <td className="px-4 py-3">
          <p className="text-xs font-medium text-white truncate max-w-[180px]">{log.person?.name ?? 'Unknown number'}</p>
          <p className="text-[11px] tabular-nums" style={{ color: 'rgba(255,255,255,0.4)' }}>{fmtPhone(log.to)}</p>
        </td>
        <td className="px-4 py-3 text-xs whitespace-nowrap" style={{ color: 'rgba(255,255,255,0.75)' }}>{log.label}</td>
        <td className="px-4 py-3">
          <p className="text-xs truncate max-w-[300px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
            {(log.text ?? log.values.map(v => v.value).join(' · ')).replace(/\*/g, '').replace(/\s+/g, ' ')}
          </p>
        </td>
        <td className="px-4 py-3"><StatusBadge status={log.status} /></td>
        <td className="px-4 py-3 text-center text-[11px] tabular-nums" style={{ color: 'rgba(255,255,255,0.4)' }}>{log.attempts}</td>
        <td className="px-4 py-3 text-[11px] truncate max-w-[180px]" style={{ color: log.lastError ? '#F87171' : 'rgba(255,255,255,0.2)' }}>{log.lastError ?? '—'}</td>
        <td className="px-4 py-3"><span className="text-[10px] font-semibold" style={{ color: 'rgba(255,255,255,0.25)' }}>{open ? '▲ hide' : '▼ view'}</span></td>
      </motion.tr>
      {open && (
        <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', background: 'rgba(0,0,0,0.2)' }}>
          <td colSpan={8} className="px-4 py-4"><MessagePreview log={log} /></td>
        </tr>
      )}
    </>
  )
}

export default function WhatsAppLogsPage() {
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState<WhatsAppLogStatus | ''>('')
  const [template, setTemplate] = useState('')
  const [qInput, setQInput] = useState('')
  const [q, setQ] = useState('')
  const [from, setFrom] = useState('')
  const [until, setUntil] = useState('')

  const { data, isLoading, isError } = useWhatsAppLogs({ page, status, template, q, from, until })
  const { data: summary } = useWhatsAppLogSummary()
  const { data: templates = [] } = useWhatsAppTemplates()

  const reset = () => setPage(1)
  const clearAll = () => { setStatus(''); setTemplate(''); setQInput(''); setQ(''); setFrom(''); setUntil(''); setPage(1) }
  const hasFilter = !!(status || template || q || from || until)

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: 'rgba(37,211,102,0.15)', border: '1px solid rgba(37,211,102,0.3)' }}>
              <MessageCircle size={16} style={{ color: '#4ADE80' }} />
            </div>
            <h1 className="text-2xl font-bold text-white" style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}>WhatsApp Logs</h1>
          </div>
          <p className="mt-1 text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>
            Every WhatsApp message the platform has sent. “Sent” means WhatsApp accepted it; sent messages are kept 30 days.
          </p>
        </div>
        {hasFilter && (
          <button onClick={clearAll} className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-white/10"
            style={{ color: 'rgba(255,255,255,0.5)', border: '1px solid rgba(255,255,255,0.1)' }}>
            <X size={11} />Clear filters
          </button>
        )}
      </div>

      <LogSummary data={summary} onPick={s => { setStatus(s); reset() }} />

      <div className="flex flex-wrap items-center gap-3">
        <select value={status} onChange={e => { setStatus(e.target.value as WhatsAppLogStatus | ''); reset() }} className={selectCls} style={selectStyle} aria-label="Status">
          <option value="">All statuses</option><option value="sent">Sent</option><option value="failed">Failed</option><option value="pending">Pending</option>
        </select>
        <select value={template} onChange={e => { setTemplate(e.target.value); reset() }} className={selectCls} style={selectStyle} aria-label="Template">
          <option value="">All messages</option>
          {templates.map(t => <option key={t.name} value={t.name}>{t.label}</option>)}
        </select>
        <DateRange from={from} until={until} onChange={(f, u) => { setFrom(f); setUntil(u); reset() }} />
        <div className="flex items-center gap-1.5 rounded-xl px-3 py-2" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
          <Search size={11} style={{ color: 'rgba(255,255,255,0.3)' }} />
          <input value={qInput} onChange={e => setQInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { setQ(qInput.trim()); reset() } }}
            placeholder="Phone, name or email… (Enter)" className="bg-transparent text-xs text-white outline-none placeholder:text-white/25 w-56" />
          {qInput && <button onClick={() => { setQInput(''); setQ(''); reset() }}><X size={10} style={{ color: 'rgba(255,255,255,0.3)' }} /></button>}
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)' }}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                {['Sent', 'To', 'Message', 'Text', 'Status', 'Attempts', 'Error', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-left font-semibold" style={{ color: 'rgba(255,255,255,0.4)', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={8} className="py-16 text-center"><Spinner size={18} variant="muted" /></td></tr>
              ) : isError ? (
                <tr><td colSpan={8} className="py-16 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <AlertCircle size={22} style={{ color: '#F87171' }} />
                    <p className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>Failed to load WhatsApp logs</p>
                  </div>
                </td></tr>
              ) : !data?.docs.length ? (
                <tr><td colSpan={8} className="py-16 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <Inbox size={22} style={{ color: 'rgba(255,255,255,0.2)' }} />
                    <p className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>{hasFilter ? 'No messages match these filters.' : 'No WhatsApp messages yet.'}</p>
                  </div>
                </td></tr>
              ) : data.docs.map((log, i) => <LogRow key={log.id} log={log} index={i} />)}
            </tbody>
          </table>
        </div>
        {data?.meta && data.meta.total_pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.35)' }}>
              {data.meta.total_count.toLocaleString()} messages · page {data.meta.page} of {data.meta.total_pages}
            </p>
            <div className="flex gap-1">
              <button disabled={!data.meta.has_prev} onClick={() => setPage(p => p - 1)} className="rounded-lg p-1.5 disabled:opacity-30 transition-colors hover:bg-white/[0.05]">
                <ChevronLeft size={14} style={{ color: 'white' }} />
              </button>
              <button disabled={!data.meta.has_next} onClick={() => setPage(p => p + 1)} className="rounded-lg p-1.5 disabled:opacity-30 transition-colors hover:bg-white/[0.05]">
                <ChevronRight size={14} style={{ color: 'white' }} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
