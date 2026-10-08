'use client'

import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LifeBuoy, Search, Send,
  CheckCircle2, Clock, AlertCircle, XCircle, Inbox,
  BarChart2, Users, MessageSquare,
  Circle,
} from 'lucide-react'
import {
  useAdminTickets, useAdminTicket, useAdminReply, useSetTicketStatus,
  useSupportStats, useSupportPerformance,
  type SupportTicket, type SupportStatus,
  PROGRAM_LABELS, CATEGORY_LABELS,
} from '@/lib/api/support'
import { useCurrentUser } from '@/lib/api/user'
import Spinner from '@/components/ui/Spinner'
import { CsTag } from '@/components/ui/CsTag'

/* ─── helpers ──────────────────────────────────────── */
const fmtDate = (iso: string) => {
  const d = new Date(iso)
  const now = new Date()
  const diff = (now.getTime() - d.getTime()) / 1000
  if (diff < 60)    return 'just now'
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

const STATUS_META: Record<SupportStatus, { label: string; color: string; bg: string; icon: React.ElementType }> = {
  open:     { label: 'Open',     color: '#60a5fa', bg: 'rgba(96,165,250,0.14)',  icon: Circle },
  pending:  { label: 'Pending',  color: '#fbbf24', bg: 'rgba(251,191,36,0.14)',  icon: Clock },
  resolved: { label: 'Resolved', color: '#34d399', bg: 'rgba(52,211,153,0.14)',  icon: CheckCircle2 },
  closed:   { label: 'Closed',   color: '#9ca3af', bg: 'rgba(156,163,175,0.14)', icon: XCircle },
}

function StatusBadge({ status }: { status: SupportStatus }) {
  const m = STATUS_META[status]
  const Icon = m.icon
  return (
    <span className="inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-xs font-semibold"
      style={{ background: m.bg, color: m.color }}>
      <Icon size={10} />
      {m.label}
    </span>
  )
}

function ProgramBadge({ program }: { program?: string }) {
  if (!program) return null
  const COLORS: Record<string, { bg: string; color: string }> = {
    'ai':                { bg: 'rgba(192,132,252,0.14)', color: '#c084fc' },
    '4x-trading':        { bg: 'rgba(251,146,60,0.14)',  color: '#fb923c' },
    'jura':              { bg: 'rgba(139,92,246,0.14)', color: '#8B5CF6' },
    'digital-marketing': { bg: 'rgba(96,165,250,0.14)',  color: '#60a5fa' },
  }
  const c = COLORS[program] ?? { bg: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.5)' }
  return (
    <span className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
      style={{ background: c.bg, color: c.color }}>
      {PROGRAM_LABELS[program] ?? program}
    </span>
  )
}

/* ─── Stat card ─────────────────────────────────────── */
function StatCard({ label, value, icon: Icon, color }: { label: string; value: number; icon: React.ElementType; color: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl p-4"
      style={{ background: '#1a1d2e', border: '1px solid rgba(255,255,255,0.07)' }}>
      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl"
        style={{ background: `${color}18` }}>
        <Icon size={16} style={{ color }} />
      </div>
      <div>
        <p className="text-xl font-bold leading-none text-white">{value}</p>
        <p className="mt-0.5 text-xs" style={{ color: 'rgba(255,255,255,0.38)' }}>{label}</p>
      </div>
    </div>
  )
}

/* ─── Ticket row ─────────────────────────────────────── */
function TicketRow({ ticket, active, onClick }: { ticket: SupportTicket; active: boolean; onClick: () => void }) {
  const user = typeof ticket.userId === 'object' ? ticket.userId : null
  const initials = (user?.name ?? '?').charAt(0).toUpperCase()

  return (
    <button onClick={onClick} className="w-full text-left">
      <div className="flex items-start gap-3 rounded-xl px-3 py-3 transition-all"
        style={{
          background: active ? 'rgba(0,87,184,0.14)' : 'transparent',
          border: active ? '1px solid rgba(0,87,184,0.25)' : '1px solid transparent',
        }}>
        <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
          style={{ background: 'linear-gradient(135deg,#0057b8,#0041a3)' }}>
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-sm font-semibold text-white">{ticket.subject}</p>
            {ticket.adminUnread && (
              <span className="flex h-2 w-2 flex-shrink-0 rounded-full" style={{ background: '#60a5fa' }} />
            )}
          </div>
          <p className="truncate text-xs" style={{ color: 'rgba(255,255,255,0.40)' }}>{user?.name ?? 'Unknown'}</p>
          <CsTag cs={user?.tetraCs} />
          <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
            <StatusBadge status={ticket.status} />
            <ProgramBadge program={ticket.program} />
            <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.28)' }}>{fmtDate(ticket.lastMessageAt)}</span>
          </div>
        </div>
      </div>
    </button>
  )
}

/* ─── Thread panel ───────────────────────────────────── */
function ThreadPanel({ ticketId, onClose }: { ticketId: string; onClose: () => void }) {
  const { data: ticket, isLoading } = useAdminTicket(ticketId)
  const replyMut  = useAdminReply(ticketId)
  const statusMut = useSetTicketStatus(ticketId)
  const [draft, setDraft] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [ticket?.messages.length])

  const send = async () => {
    if (!draft.trim() || replyMut.isPending) return
    await replyMut.mutateAsync(draft.trim())
    setDraft('')
  }

  if (isLoading) return (
    <div className="flex h-full items-center justify-center gap-2">
      <Spinner size={18} />
      <span className="text-sm" style={{ color: 'rgba(255,255,255,0.35)' }}>Loading…</span>
    </div>
  )
  if (!ticket) return null

  const user = typeof ticket.userId === 'object' ? ticket.userId : null
  const statuses: SupportStatus[] = ['open', 'pending', 'resolved', 'closed']

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex-shrink-0 p-5" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-white">{ticket.subject}</h3>
            <div className="mt-1 flex items-center gap-2 flex-wrap">
              <span className="text-xs" style={{ color: 'rgba(255,255,255,0.42)' }}>
                {user?.name ?? 'Unknown'} · {user?.email}
              </span>
              <CsTag cs={user?.tetraCs} variant="chip" />
            </div>
            <div className="mt-2 flex items-center gap-1.5 flex-wrap">
              <ProgramBadge program={ticket.program} />
              {ticket.category && (
                <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.32)' }}>
                  {CATEGORY_LABELS[ticket.category] ?? ticket.category}
                </span>
              )}
            </div>
          </div>
          {/* Status pills */}
          <div className="flex flex-shrink-0 flex-wrap gap-1.5">
            {statuses.map(s => {
              const m = STATUS_META[s]
              const Icon = m.icon
              const isActive = ticket.status === s
              return (
                <button key={s} onClick={() => statusMut.mutate(s)}
                  disabled={statusMut.isPending}
                  className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-all disabled:opacity-50"
                  style={isActive
                    ? { background: m.bg, color: m.color, border: `1px solid ${m.color}45` }
                    : { background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.32)', border: '1px solid rgba(255,255,255,0.08)' }
                  }>
                  <Icon size={9} />{m.label}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {ticket.messages.map((m, i) => {
          const fromAdmin = m.senderRole === 'admin'
          const sender = typeof m.senderId === 'object' ? m.senderId : null
          return (
            <div key={m._id ?? i} className={`flex ${fromAdmin ? 'justify-end' : 'justify-start'}`}>
              <div className="max-w-[80%]">
                <div className="rounded-2xl px-4 py-2.5 text-sm"
                  style={fromAdmin
                    ? { background: '#0057b8', color: 'white', borderBottomRightRadius: 6 }
                    : { background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.88)', borderBottomLeftRadius: 6 }
                  }>
                  {m.body}
                </div>
                <p className={`mt-1 text-[10px] ${fromAdmin ? 'text-right' : ''}`}
                  style={{ color: 'rgba(255,255,255,0.28)' }}>
                  {fromAdmin ? (sender?.name ?? 'Support Team') : (user?.name ?? 'Student')} · {fmtDate(m.createdAt)}
                </p>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {/* Reply */}
      {ticket.status !== 'closed' ? (
        <div className="flex-shrink-0 p-4" style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="flex gap-2">
            <textarea
              value={draft} onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
              placeholder="Reply to this ticket…"
              rows={3}
              className="flex-1 resize-none rounded-xl p-3 text-sm outline-none text-white placeholder:text-white/25"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)' }} />
            <button onClick={send} disabled={!draft.trim() || replyMut.isPending}
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl transition-all disabled:opacity-40"
              style={{ background: '#0057b8' }}>
              {replyMut.isPending ? <Spinner size={14} variant="white" /> : <Send size={14} color="white" />}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex-shrink-0 p-4 text-center text-sm"
          style={{ color: 'rgba(255,255,255,0.32)', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
          This ticket is closed. Change the status above to reply.
        </div>
      )}
    </div>
  )
}

/* ─── Performance tab ────────────────────────────────── */
function PerformancePanel() {
  const { data, isLoading } = useSupportPerformance()

  if (isLoading) return (
    <div className="flex h-64 items-center justify-center gap-2">
      <Spinner size={18} />
    </div>
  )

  const PROG_COLORS: Record<string, { accent: string; bg: string }> = {
    'ai':                { accent: '#c084fc', bg: 'rgba(192,132,252,0.12)' },
    '4x-trading':        { accent: '#fb923c', bg: 'rgba(251,146,60,0.12)' },
    'jura':              { accent: '#8B5CF6', bg: 'rgba(139,92,246,0.12)' },
    'digital-marketing': { accent: '#60a5fa', bg: 'rgba(96,165,250,0.12)' },
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h3 className="text-base font-bold text-white">Admin Team Performance</h3>
        <p className="mt-0.5 text-sm" style={{ color: 'rgba(255,255,255,0.40)' }}>Ticket resolution stats by program team</p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {(data ?? []).map(prog => {
          const c = PROG_COLORS[prog.program] ?? { accent: 'rgba(255,255,255,0.5)', bg: 'rgba(255,255,255,0.06)' }
          const resolvedPct = prog.total > 0 ? Math.round((prog.resolved / prog.total) * 100) : 0
          return (
            <div key={prog.program} className="rounded-2xl p-5"
              style={{ background: '#131525', border: '1px solid rgba(255,255,255,0.07)' }}>
              <div className="flex items-center gap-2 mb-4">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl" style={{ background: c.bg }}>
                  <Users size={14} style={{ color: c.accent }} />
                </div>
                <div>
                  <p className="text-sm font-bold text-white">{prog.label}</p>
                  <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.32)' }}>admin team</p>
                </div>
              </div>

              <div className="mb-3">
                <div className="flex justify-between mb-1">
                  <span className="text-xs" style={{ color: 'rgba(255,255,255,0.40)' }}>Resolution rate</span>
                  <span className="text-xs font-bold" style={{ color: c.accent }}>{resolvedPct}%</span>
                </div>
                <div className="h-1.5 w-full rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }}>
                  <div className="h-full rounded-full transition-all" style={{ width: `${resolvedPct}%`, background: c.accent }} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: 'Total',    value: prog.total,    color: 'rgba(255,255,255,0.7)' },
                  { label: 'Open',     value: prog.open,     color: '#60a5fa' },
                  { label: 'Pending',  value: prog.pending,  color: '#fbbf24' },
                  { label: 'Resolved', value: prog.resolved, color: '#34d399' },
                ].map(s => (
                  <div key={s.label} className="rounded-xl p-2.5" style={{ background: 'rgba(255,255,255,0.04)' }}>
                    <p className="text-base font-bold" style={{ color: s.color }}>{s.value}</p>
                    <p className="text-[10px]" style={{ color: 'rgba(255,255,255,0.32)' }}>{s.label}</p>
                  </div>
                ))}
              </div>

              <div className="mt-3 flex items-center justify-between rounded-xl px-3 py-2" style={{ background: c.bg }}>
                <span className="text-[11px] font-medium" style={{ color: c.accent }}>Avg first reply</span>
                <span className="text-xs font-bold" style={{ color: c.accent }}>
                  {prog.responded > 0 ? `${prog.avgResponseHours}h` : '—'}
                </span>
              </div>

              {prog.unread > 0 && (
                <div className="mt-2 flex items-center gap-1.5 rounded-xl px-3 py-2"
                  style={{ background: 'rgba(239,68,68,0.12)' }}>
                  <AlertCircle size={12} style={{ color: '#f87171' }} />
                  <span className="text-[11px] font-medium" style={{ color: '#f87171' }}>
                    {prog.unread} unread {prog.unread === 1 ? 'ticket' : 'tickets'}
                  </span>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ─── Main page ──────────────────────────────────────── */
const PROGRAM_TABS: { id: string; label: string }[] = [
  { id: 'all',                label: 'All' },
  { id: 'ai',                 label: 'AI' },
  { id: '4x-trading',        label: 'FOREX' },
  { id: 'jura',              label: 'JURA' },
  { id: 'digital-marketing', label: 'Digital Marketing' },
]

const STATUS_FILTERS = [
  { id: 'all',      label: 'All' },
  { id: 'open',     label: 'Open' },
  { id: 'pending',  label: 'Pending' },
  { id: 'resolved', label: 'Resolved' },
  { id: 'closed',   label: 'Closed' },
]

export default function AdminSupportPage() {
  const { data: me } = useCurrentUser()
  const role = me?.role ?? ''
  const isSuperAdmin = role === 'admin' || role === 'super_admin'

  const [activeTab,     setActiveTab]     = useState<'inbox' | 'performance'>('inbox')
  const [programFilter, setProgramFilter] = useState('all')
  const [statusFilter,  setStatusFilter]  = useState('all')
  const [search,        setSearch]        = useState('')
  const [activeTicket,  setActiveTicket]  = useState<string | null>(null)

  const filter = {
    status:  statusFilter !== 'all' ? statusFilter : undefined,
    search:  search || undefined,
    program: isSuperAdmin && programFilter !== 'all' ? programFilter : undefined,
  }

  const { data: tickets = [], isLoading: ticketsLoading } = useAdminTickets(filter)
  const { data: stats }                                   = useSupportStats(isSuperAdmin ? (programFilter !== 'all' ? programFilter : undefined) : undefined)

  const unread = tickets.filter(t => t.adminUnread).length

  return (
    <div className="flex h-[calc(100vh-64px)] flex-col overflow-hidden">
      {/* ── Page header ── */}
      <div className="flex-shrink-0 px-6 pt-5 pb-0">
        <div className="flex items-center justify-between gap-4 mb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl"
              style={{ background: 'rgba(0,87,184,0.15)', border: '1px solid rgba(0,87,184,0.25)' }}>
              <LifeBuoy size={17} style={{ color: '#60a5fa' }} />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white" style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}>
                Support Inbox
              </h1>
              {unread > 0 && (
                <p className="text-xs" style={{ color: 'rgba(255,255,255,0.38)' }}>
                  {unread} unread {unread === 1 ? 'ticket' : 'tickets'}
                </p>
              )}
            </div>
          </div>
          {isSuperAdmin && (
            <div className="flex rounded-xl p-1" style={{ background: 'rgba(255,255,255,0.06)' }}>
              {[
                { id: 'inbox',       label: 'Inbox',       icon: Inbox },
                { id: 'performance', label: 'Performance', icon: BarChart2 },
              ].map(t => (
                <button key={t.id} onClick={() => setActiveTab(t.id as 'inbox' | 'performance')}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all"
                  style={activeTab === t.id
                    ? { background: '#0057b8', color: 'white' }
                    : { color: 'rgba(255,255,255,0.40)' }}>
                  <t.icon size={12} />{t.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Stats row */}
        {stats && activeTab === 'inbox' && (
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            <StatCard label="Total"    value={stats.total}    icon={MessageSquare} color="rgba(255,255,255,0.55)" />
            <StatCard label="Open"     value={stats.open}     icon={Circle}        color="#60a5fa" />
            <StatCard label="Pending"  value={stats.pending}  icon={Clock}         color="#fbbf24" />
            <StatCard label="Resolved" value={stats.resolved} icon={CheckCircle2}  color="#34d399" />
            <StatCard label="Closed"   value={stats.closed}   icon={XCircle}       color="#9ca3af" />
            <StatCard label="Unread"   value={stats.unread}   icon={AlertCircle}   color="#f87171" />
          </div>
        )}

        {/* Program filter tabs */}
        {isSuperAdmin && activeTab === 'inbox' && (
          <div className="mb-4 flex gap-1 overflow-x-auto scrollbar-none">
            {PROGRAM_TABS.map(t => (
              <button key={t.id} onClick={() => { setProgramFilter(t.id); setActiveTicket(null) }}
                className="flex-shrink-0 rounded-xl px-3 py-1.5 text-xs font-semibold transition-all whitespace-nowrap"
                style={programFilter === t.id
                  ? { background: '#0057b8', color: 'white' }
                  : { background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.45)' }}>
                {t.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Performance tab ── */}
      {activeTab === 'performance' ? (
        <div className="flex-1 overflow-y-auto rounded-2xl mx-6 mb-6"
          style={{ background: '#1a1d2e', border: '1px solid rgba(255,255,255,0.07)' }}>
          <PerformancePanel />
        </div>
      ) : (
        /* ── Inbox: split panel ── */
        <div className="mx-6 mb-6 flex flex-1 gap-4 overflow-hidden min-h-0">
          {/* Left: ticket list */}
          <div className="flex w-80 flex-shrink-0 flex-col overflow-hidden rounded-2xl"
            style={{ background: '#1a1d2e', border: '1px solid rgba(255,255,255,0.07)' }}>
            <div className="flex-shrink-0 p-3 space-y-2"
              style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="relative">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2"
                  style={{ color: 'rgba(255,255,255,0.28)' }} />
                <input
                  value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Search tickets…"
                  className="w-full rounded-xl py-2 pl-8 pr-3 text-sm outline-none text-white placeholder:text-white/25"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }} />
              </div>
              <div className="flex gap-1 overflow-x-auto scrollbar-none">
                {STATUS_FILTERS.map(f => (
                  <button key={f.id} onClick={() => setStatusFilter(f.id)}
                    className="flex-shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-all whitespace-nowrap"
                    style={statusFilter === f.id
                      ? { background: '#0057b8', color: 'white' }
                      : { background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.38)' }}>
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
              {ticketsLoading ? (
                <div className="flex h-32 items-center justify-center gap-2">
                  <Spinner size={16} />
                </div>
              ) : tickets.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <Inbox size={28} style={{ color: 'rgba(255,255,255,0.15)' }} />
                  <p className="text-sm" style={{ color: 'rgba(255,255,255,0.30)' }}>No tickets found</p>
                </div>
              ) : (
                tickets.map(t => (
                  <TicketRow key={t.id} ticket={t} active={activeTicket === t.id}
                    onClick={() => setActiveTicket(t.id)} />
                ))
              )}
            </div>
          </div>

          {/* Right: thread */}
          <div className="flex-1 overflow-hidden rounded-2xl"
            style={{ background: '#1a1d2e', border: '1px solid rgba(255,255,255,0.07)' }}>
            {activeTicket ? (
              <ThreadPanel key={activeTicket} ticketId={activeTicket} onClose={() => setActiveTicket(null)} />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl"
                  style={{ background: 'rgba(255,255,255,0.05)' }}>
                  <LifeBuoy size={24} style={{ color: 'rgba(255,255,255,0.18)' }} />
                </div>
                <p className="text-sm font-semibold text-white">Select a ticket</p>
                <p className="text-xs" style={{ color: 'rgba(255,255,255,0.32)' }}>
                  Pick a conversation from the list to view and reply
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
