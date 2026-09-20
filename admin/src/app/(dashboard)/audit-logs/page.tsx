'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import {
  ClipboardList, ChevronLeft, ChevronRight, Search, X,
  AlertCircle, User, BookOpen, Tag, Star, ShoppingBag,
} from 'lucide-react'
import { useAuditLogs, type AuditLog } from '@/lib/api/auditlogs'
import Spinner from '@/components/ui/Spinner'

/* ─── Helpers ──────────────────────────────────────────── */
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

const ACTION_COLORS: Record<string, { bg: string; text: string }> = {
  'course.create':   { bg: 'rgba(74,222,128,0.15)', text: '#4ADE80' },
  'course.update':   { bg: 'rgba(96,165,250,0.15)', text: '#60A5FA' },
  'course.delete':   { bg: 'rgba(248,113,113,0.15)', text: '#F87171' },
  'course.publish':  { bg: 'rgba(74,222,128,0.15)', text: '#4ADE80' },
  'course.unpublish':{ bg: 'rgba(250,204,21,0.15)',  text: '#FACC15' },
  'category.create': { bg: 'rgba(196,181,253,0.15)', text: '#C4B5FD' },
  'category.update': { bg: 'rgba(96,165,250,0.15)', text: '#60A5FA' },
  'category.delete': { bg: 'rgba(248,113,113,0.15)', text: '#F87171' },
  'user.roleChange': { bg: 'rgba(250,204,21,0.15)',  text: '#FACC15' },
  'user.deactivate': { bg: 'rgba(248,113,113,0.15)', text: '#F87171' },
  'review.delete':   { bg: 'rgba(248,113,113,0.15)', text: '#F87171' },
  'bulk.publish':    { bg: 'rgba(74,222,128,0.15)',  text: '#4ADE80' },
  'bulk.archive':    { bg: 'rgba(250,204,21,0.15)',  text: '#FACC15' },
  'liveclass.create':{ bg: 'rgba(74,222,128,0.15)',  text: '#4ADE80' },
  'liveclass.update':{ bg: 'rgba(96,165,250,0.15)',  text: '#60A5FA' },
  'liveclass.delete':{ bg: 'rgba(248,113,113,0.15)', text: '#F87171' },
  'liveclass.repeat':{ bg: 'rgba(196,181,253,0.15)', text: '#C4B5FD' },
}

function ActionBadge({ action }: { action: string }) {
  const c = ACTION_COLORS[action] ?? { bg: 'rgba(255,255,255,0.06)', text: 'rgba(255,255,255,0.5)' }
  return (
    <span className="inline-flex items-center rounded-lg px-2 py-0.5 text-[11px] font-semibold"
      style={{ background: c.bg, color: c.text }}>
      {action}
    </span>
  )
}

function entityIcon(entity: string) {
  if (entity.startsWith('course'))   return <BookOpen size={11} />
  if (entity.startsWith('category')) return <Tag size={11} />
  if (entity.startsWith('user'))     return <User size={11} />
  if (entity.startsWith('review'))   return <Star size={11} />
  if (entity.startsWith('order'))    return <ShoppingBag size={11} />
  return null
}

const ENTITY_OPTIONS = ['', 'course', 'category', 'user', 'review', 'order', 'coupon', 'lesson']
const ACTION_OPTIONS = [
  '', 'course.create', 'course.update', 'course.delete', 'course.publish', 'course.unpublish',
  'category.create', 'category.update', 'category.delete',
  'user.roleChange', 'user.deactivate', 'review.delete',
  'bulk.publish', 'bulk.archive',
  'liveclass.create', 'liveclass.update', 'liveclass.delete', 'liveclass.repeat',
]

/* ─── Row ──────────────────────────────────────────────── */
function LogRow({ log, index }: { log: AuditLog; index: number }) {
  const [expanded, setExpanded] = useState(false)
  const hasMeta = log.meta && Object.keys(log.meta).length > 0

  return (
    <>
      <motion.tr
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: index * 0.02 }}
        onClick={() => hasMeta && setExpanded(e => !e)}
        style={{
          borderBottom: '1px solid rgba(255,255,255,0.04)',
          cursor: hasMeta ? 'pointer' : 'default',
          background: expanded ? 'rgba(255,255,255,0.03)' : 'transparent',
        }}
        className="transition-colors hover:bg-white/[0.025]">

        {/* Timestamp */}
        <td className="px-4 py-3 tabular-nums text-[11px] whitespace-nowrap"
          style={{ color: 'rgba(255,255,255,0.4)' }}>
          {fmtDate(log.createdAt)}
        </td>

        {/* Actor */}
        <td className="px-4 py-3">
          <div>
            <p className="text-xs font-medium text-white truncate max-w-[160px]">{log.actorEmail}</p>
            <p className="text-[10px] capitalize" style={{ color: 'rgba(255,255,255,0.35)' }}>{log.actorRole}</p>
          </div>
        </td>

        {/* Action */}
        <td className="px-4 py-3">
          <ActionBadge action={log.action} />
        </td>

        {/* Entity */}
        <td className="px-4 py-3">
          <div className="flex items-center gap-1.5 text-[11px]" style={{ color: 'rgba(255,255,255,0.5)' }}>
            {entityIcon(log.entity)}
            <span>{log.entity}</span>
            {log.entityId && (
              <span className="font-mono text-[10px]" style={{ color: 'rgba(255,255,255,0.2)' }}>
                #{log.entityId.slice(-6)}
              </span>
            )}
          </div>
        </td>

        {/* IP */}
        <td className="px-4 py-3 text-[11px] font-mono" style={{ color: 'rgba(255,255,255,0.3)' }}>
          {log.ip ?? '—'}
        </td>

        {/* Meta indicator */}
        <td className="px-4 py-3">
          {hasMeta && (
            <span className="text-[10px] font-semibold" style={{ color: 'rgba(255,255,255,0.25)' }}>
              {expanded ? '▲ hide' : '▼ meta'}
            </span>
          )}
        </td>
      </motion.tr>

      {/* Expanded meta row */}
      {expanded && hasMeta && (
        <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', background: 'rgba(0,0,0,0.2)' }}>
          <td colSpan={6} className="px-4 py-3">
            <pre className="overflow-x-auto rounded-lg p-3 text-[11px] font-mono leading-relaxed"
              style={{ background: 'rgba(0,0,0,0.3)', color: '#A5B4FC', maxHeight: 200, overflowY: 'auto' }}>
              {JSON.stringify(log.meta, null, 2)}
            </pre>
          </td>
        </tr>
      )}
    </>
  )
}

/* ─── Page ─────────────────────────────────────────────── */
export default function AuditLogsPage() {
  const [page,      setPage]      = useState(1)
  const [action,    setAction]    = useState('')
  const [entity,    setEntity]    = useState('')
  const [actorInput,setActorInput]= useState('')
  const [actorId,   setActorId]   = useState('')

  const { data, isLoading, isError } = useAuditLogs({ page, action: action || undefined, entity: entity || undefined, actorId: actorId || undefined })

  const applyActor = () => { setActorId(actorInput.trim()); setPage(1) }
  const clearAll   = () => { setAction(''); setEntity(''); setActorInput(''); setActorId(''); setPage(1) }
  const hasFilter  = !!action || !!entity || !!actorId

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl"
              style={{ background: 'rgba(99,102,241,0.18)', border: '1px solid rgba(99,102,241,0.3)' }}>
              <ClipboardList size={16} style={{ color: '#818CF8' }} />
            </div>
            <h1 className="text-2xl font-bold text-white" style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}>
              Audit Logs
            </h1>
          </div>
          <p className="mt-1 text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>
            All admin actions — immutable record for compliance and debugging.
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
        {/* Action */}
        <select
          value={action}
          onChange={e => { setAction(e.target.value); setPage(1) }}
          className="rounded-xl px-3 py-2 text-xs text-white outline-none"
          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
          {ACTION_OPTIONS.map(a => (
            <option key={a} value={a} style={{ background: '#1A1D2E' }}>
              {a || 'All actions'}
            </option>
          ))}
        </select>

        {/* Entity */}
        <select
          value={entity}
          onChange={e => { setEntity(e.target.value); setPage(1) }}
          className="rounded-xl px-3 py-2 text-xs text-white outline-none"
          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
          {ENTITY_OPTIONS.map(e => (
            <option key={e} value={e} style={{ background: '#1A1D2E' }}>
              {e || 'All entities'}
            </option>
          ))}
        </select>

        {/* Actor ID */}
        <div className="flex items-center gap-1.5 rounded-xl px-3 py-2"
          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
          <Search size={11} style={{ color: 'rgba(255,255,255,0.3)' }} />
          <input
            value={actorInput}
            onChange={e => setActorInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && applyActor()}
            placeholder="Filter by actor ID…"
            className="bg-transparent text-xs text-white outline-none placeholder:text-white/25 w-44"
          />
          {actorInput && (
            <button onClick={() => { setActorInput(''); setActorId(''); setPage(1) }}>
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
                {['Timestamp', 'Actor', 'Action', 'Entity', 'IP', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-left font-semibold"
                    style={{ color: 'rgba(255,255,255,0.4)', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={6} className="py-16 text-center">
                  <Spinner size={18} variant="muted" />
                </td></tr>
              ) : isError ? (
                <tr><td colSpan={6} className="py-16 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <AlertCircle size={22} style={{ color: '#F87171' }} />
                    <p className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>Failed to load audit logs</p>
                  </div>
                </td></tr>
              ) : !data?.docs.length ? (
                <tr><td colSpan={6} className="py-16 text-center text-sm"
                  style={{ color: 'rgba(255,255,255,0.3)' }}>
                  No audit log entries found.
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
