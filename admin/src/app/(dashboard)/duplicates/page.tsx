'use client'

import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Users, Phone, GitMerge, EyeOff, Eye, BadgeCheck, AlertTriangle, AlertCircle,
  History, Undo2, CheckCircle2, ShieldAlert, Inbox,
} from 'lucide-react'
import Spinner from '@/components/ui/Spinner'
import { AvatarImg } from '@/components/ui/AvatarImg'
import MergeModal from '@/components/duplicates/MergeModal'
import { useToast } from '@/store/ui.store'
import { useCurrentUser } from '@/lib/api/user'
import { useOrganizations } from '@/lib/api/organizations'
import {
  useDuplicateGroups, useDismissGroup, useUndismissGroup, useMergeHistory, useUndoMerge,
  type DuplicateGroup, type Confidence, type MergeRecord,
} from '@/lib/api/duplicates'
import { useQueryState, setQueryParams } from '@/lib/useQueryState'

/* ─────────────────────────────────────────────────────
   Duplicate Accounts — students who share a phone number, most likely one
   person with two accounts (a mistyped email at an import or a checkout,
   then their own sign-up). A super admin reviews a group and merges it, or
   marks it "Not a duplicate" (a family on one phone). Every merge is listed
   under Merge history and can be undone there.
───────────────────────────────────────────────────── */

const muted = 'rgba(255,255,255,0.45)'
const fmt = (iso?: string) => iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

const CONF: Record<Confidence, { label: string; bg: string; text: string; hint: string }> = {
  high:   { label: 'Very likely', bg: 'rgba(248,113,113,0.15)', text: '#F87171', hint: 'Same phone, and the same ID, birth date or an email one typo away' },
  medium: { label: 'Likely',      bg: 'rgba(250,204,21,0.15)',  text: '#FACC15', hint: 'Same phone and a similar name' },
  low:    { label: 'Check',       bg: 'rgba(148,163,184,0.15)', text: '#CBD5E1', hint: 'Only the phone matches — could be family' },
}

function GroupCard({ group, orgName, dismissed, index, onReview }: {
  group: DuplicateGroup; orgName: (id?: string) => string; dismissed: boolean; index: number
  onReview: (ids: [string, string]) => void
}) {
  const toast = useToast()
  const dismiss = useDismissGroup()
  const undismiss = useUndismissGroup()
  /* A group of three or more: the admin picks which two to merge (two at a time). */
  const [sel, setSel] = useState<string[]>(group.accounts.slice(0, 2).map(a => a.id))
  const many = group.accounts.length > 2
  const c = CONF[group.confidence]
  const toggle = (id: string) => setSel(s => s.includes(id) ? s.filter(x => x !== id) : [...s.slice(-1), id])

  const onDismiss = async () => {
    try {
      if (dismissed) { await undismiss.mutateAsync(group.key); toast.success('Shown again.') }
      else { await dismiss.mutateAsync(group.accounts.map(a => a.id)); toast.success('Marked as not a duplicate.') }
    } catch (err: any) { toast.error(err?.response?.data?.error?.message ?? 'Could not update.') }
  }

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index, 10) * 0.03 }}
      className="overflow-hidden rounded-2xl"
      style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)', opacity: dismissed ? 0.7 : 1 }}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <span className="flex items-center gap-1.5 text-sm font-semibold tabular-nums text-white"><Phone size={13} style={{ color: '#60A5FA' }} />{group.phone}</span>
        <span className="rounded-lg px-2 py-0.5 text-[11px] font-semibold" style={{ background: c.bg, color: c.text }} title={c.hint}>{c.label}</span>
        <span className="text-[11px]" style={{ color: muted }}>{group.reasons.join(' · ')}</span>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => void onDismiss()} disabled={dismiss.isPending || undismiss.isPending}
            className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-white/10"
            style={{ color: 'rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.1)' }}>
            {dismissed ? <><Eye size={12} />Show again</> : <><EyeOff size={12} />Not a duplicate</>}
          </button>
          {!dismissed && (
            <button onClick={() => sel.length === 2 && onReview([sel[0]!, sel[1]!])} disabled={sel.length !== 2}
              className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold text-white transition-opacity disabled:opacity-40"
              style={{ background: '#0057b8' }}>
              <GitMerge size={12} />Review &amp; merge
            </button>
          )}
        </div>
      </div>
      {many && !dismissed && (
        <p className="px-4 pt-2 text-[11px]" style={{ color: muted }}>{group.accounts.length} accounts — tick the two to merge first.</p>
      )}
      <ul>
        {group.accounts.map(a => (
          <li key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-xs"
            style={{ borderTop: '1px solid rgba(255,255,255,0.03)' }}>
            {many && !dismissed && (
              <input type="checkbox" checked={sel.includes(a.id)} onChange={() => toggle(a.id)} aria-label={`Select ${a.email}`}
                className="h-3.5 w-3.5 accent-blue-500" />
            )}
            <div className="flex min-w-[220px] flex-1 items-center gap-2.5">
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center overflow-hidden rounded-full text-xs font-bold text-white"
                style={{ background: 'rgba(255,255,255,0.08)' }}>
                <AvatarImg src={a.avatarUrl} name={a.name} className="h-full w-full object-cover" />
              </div>
              <div className="min-w-0">
                <p className="truncate font-semibold text-white">{a.name}</p>
                <p className="flex items-center gap-1 truncate" style={{ color: 'rgba(255,255,255,0.6)' }}>
                  {a.email}
                  {a.isVerified
                    ? <BadgeCheck size={11} style={{ color: '#4ADE80' }} aria-label="Email verified" />
                    : <AlertTriangle size={11} style={{ color: '#FBBF24' }} aria-label="Email never verified" />}
                </p>
              </div>
            </div>
            <span className="w-28 tabular-nums" style={{ color: muted }}>{a.phone}</span>
            <span className="w-24 capitalize" style={{ color: muted }}>{a.enrollmentStatus ?? '—'}{a.isActive ? '' : ' · blocked'}</span>
            <span className="w-28" style={{ color: muted }}>{orgName(a.organizationId)}</span>
            <span className="w-32" style={{ color: muted }}>Signed in {a.lastLoginAt ? fmt(a.lastLoginAt) : 'never'}</span>
            <span className="w-28" style={{ color: 'rgba(255,255,255,0.3)' }}>Created {fmt(a.createdAt)}</span>
          </li>
        ))}
      </ul>
    </motion.div>
  )
}

const STATUS: Record<MergeRecord['status'], { label: string; bg: string; text: string }> = {
  done:    { label: 'Merged',  bg: 'rgba(74,222,128,0.15)',  text: '#4ADE80' },
  undone:  { label: 'Undone',  bg: 'rgba(148,163,184,0.15)', text: '#CBD5E1' },
  failed:  { label: 'Stopped part-way', bg: 'rgba(248,113,113,0.15)', text: '#F87171' },
  running: { label: 'Running', bg: 'rgba(250,204,21,0.15)',  text: '#FACC15' },
}

function MergeHistory() {
  const toast = useToast()
  const [page, setPage] = useState(1)
  const { data, isLoading, isError } = useMergeHistory(page)
  const undo = useUndoMerge()
  const [asking, setAsking] = useState<string | null>(null)

  const doUndo = async (m: MergeRecord) => {
    try {
      const r = await undo.mutateAsync(m.id)
      if (r.notes.length) toast.error(`Undone, but: ${r.notes.join(' ')}`)
      else toast.success(`Undone. ${m.secondaryEmail} is its own account again.`)
    } catch (err: any) { toast.error(err?.response?.data?.error?.message ?? 'Could not undo.') }
    setAsking(null)
  }

  if (isLoading) return <div className="flex justify-center py-16"><Spinner size={18} variant="muted" /></div>
  if (isError) return <p className="py-16 text-center text-sm" style={{ color: '#F87171' }}>Failed to load the merge history.</p>
  if (!data?.data.length) return (
    <div className="flex flex-col items-center gap-2 py-16">
      <History size={22} style={{ color: 'rgba(255,255,255,0.2)' }} />
      <p className="text-sm" style={{ color: muted }}>No accounts have been merged yet.</p>
    </div>
  )
  return (
    <div className="overflow-hidden rounded-2xl" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)' }}>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              {['When', 'Kept', 'Closed', 'Moved', 'By', 'Status', ''].map(h => (
                <th key={h} className="whitespace-nowrap px-4 py-3 text-left font-semibold" style={{ color: 'rgba(255,255,255,0.4)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.data.map(m => {
              const s = STATUS[m.status]
              const total = m.summary.reduce((n, i) => n + i.moved, 0)
              return (
                <tr key={m.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }} className="align-top">
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums" style={{ color: muted }}>{new Date(m.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                  <td className="px-4 py-3 text-white">{m.primaryEmail}</td>
                  <td className="px-4 py-3" style={{ color: 'rgba(255,255,255,0.6)' }}>{m.secondaryEmail}</td>
                  <td className="px-4 py-3" style={{ color: muted }} title={m.summary.map(i => `${i.label}: ${i.moved}`).join('\n')}>
                    {total} record{total === 1 ? '' : 's'}
                  </td>
                  <td className="px-4 py-3" style={{ color: muted }}>{m.mergedByEmail ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex rounded-lg px-2 py-0.5 text-[11px] font-semibold" style={{ background: s.bg, color: s.text }}>{s.label}</span>
                    {m.error && <p className="mt-1 max-w-[220px] text-[11px]" style={{ color: '#F87171' }}>{m.error}</p>}
                    {m.undoNotes?.map((n, i) => <p key={i} className="mt-1 max-w-[220px] text-[11px]" style={{ color: '#FBBF24' }}>{n}</p>)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    {(m.status === 'done' || m.status === 'failed') && (
                      asking === m.id ? (
                        <span className="inline-flex items-center gap-2">
                          <span style={{ color: muted }}>Split them again?</span>
                          <button onClick={() => void doUndo(m)} disabled={undo.isPending}
                            className="rounded-lg px-2.5 py-1 font-semibold text-white" style={{ background: '#B91C1C' }}>
                            {undo.isPending ? <Spinner size={11} /> : 'Undo'}
                          </button>
                          <button onClick={() => setAsking(null)} className="rounded-lg px-2 py-1" style={{ color: muted }}>Cancel</button>
                        </span>
                      ) : (
                        <button onClick={() => setAsking(m.id)}
                          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-semibold transition-colors hover:bg-white/10"
                          style={{ color: 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.1)' }}>
                          <Undo2 size={11} />Undo
                        </button>
                      )
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {data.meta.total_pages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 text-[11px]" style={{ borderTop: '1px solid rgba(255,255,255,0.06)', color: muted }}>
          <span>Page {data.meta.page} of {data.meta.total_pages}</span>
          <span className="flex gap-2">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="disabled:opacity-30">Previous</button>
            <button disabled={page >= data.meta.total_pages} onClick={() => setPage(p => p + 1)} className="disabled:opacity-30">Next</button>
          </span>
        </div>
      )}
    </div>
  )
}

export default function DuplicatesPage() {
  const { data: me, isLoading: meLoading } = useCurrentUser()
  const isSuper = me?.role === 'super_admin'
  const [tab] = useQueryState<'groups' | 'history'>('tab', 'groups')
  const [showDismissed, setShowDismissed] = useState(false)
  const [conf, setConf] = useState<Confidence | ''>('')
  const [reviewing, setReviewing] = useState<[string, string] | null>(null)
  const { data, isLoading, isError } = useDuplicateGroups(showDismissed)
  const { data: orgs } = useOrganizations(isSuper)
  const orgName = (id?: string) => orgs?.find(o => o.id === id)?.name ?? '—'

  const groups = useMemo(() => (data?.groups ?? []).filter(g => !conf || g.confidence === conf), [data, conf])
  const open = useMemo(() => (data?.groups ?? []).filter(g => !g.dismissed), [data])
  const counts = useMemo(() => {
    const c: Record<Confidence, number> = { high: 0, medium: 0, low: 0 }
    for (const g of open) c[g.confidence]++
    return c
  }, [open])

  if (!meLoading && !isSuper) {
    return (
      <div className="flex flex-col items-center gap-2 py-24">
        <ShieldAlert size={24} style={{ color: 'rgba(255,255,255,0.3)' }} />
        <p className="text-sm" style={{ color: muted }}>Only a super admin can review and merge duplicate accounts.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl"
            style={{ background: 'rgba(0,87,184,0.18)', border: '1px solid rgba(0,87,184,0.3)' }}>
            <Users size={16} style={{ color: '#60A5FA' }} />
          </div>
          <h1 className="text-2xl font-bold text-white" style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}>Duplicate Accounts</h1>
        </div>
        <p className="mt-1 text-sm" style={{ color: muted }}>
          Students who share a phone number — usually one person with two accounts. Merge them into one, or mark them as not a duplicate.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {([['groups', 'Possible duplicates', GitMerge], ['history', 'Merge history', History]] as const).map(([k, label, Icon]) => (
          <button key={k} onClick={() => setQueryParams({ tab: k === 'groups' ? null : k })}
            className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-colors"
            style={{
              background: tab === k ? 'rgba(0,87,184,0.2)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${tab === k ? 'rgba(96,165,250,0.4)' : 'rgba(255,255,255,0.08)'}`,
              color: tab === k ? 'white' : 'rgba(255,255,255,0.6)',
            }}>
            <Icon size={12} />{label}
            {k === 'groups' && data && <span className="tabular-nums" style={{ color: muted }}>{open.length}</span>}
          </button>
        ))}
      </div>

      {tab === 'history' ? <MergeHistory /> : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {(['', 'high', 'medium', 'low'] as const).map(k => (
              <button key={k || 'all'} onClick={() => setConf(k)}
                className="rounded-xl px-3 py-1.5 text-xs font-medium transition-colors hover:bg-white/[0.08]"
                style={{
                  background: conf === k ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)', color: conf === k ? 'white' : 'rgba(255,255,255,0.55)',
                }}>
                {k ? `${CONF[k].label} (${counts[k]})` : 'All'}
              </button>
            ))}
            <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs" style={{ color: 'rgba(255,255,255,0.55)' }}>
              <input type="checkbox" checked={showDismissed} onChange={e => setShowDismissed(e.target.checked)} className="h-3.5 w-3.5 accent-blue-500" />
              Show "not a duplicate" ({data?.dismissed ?? 0})
            </label>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-16"><Spinner size={18} variant="muted" /></div>
          ) : isError ? (
            <div className="flex flex-col items-center gap-2 py-16">
              <AlertCircle size={22} style={{ color: '#F87171' }} />
              <p className="text-sm" style={{ color: muted }}>Failed to load possible duplicates.</p>
            </div>
          ) : !groups.length ? (
            <div className="flex flex-col items-center gap-2 py-16">
              {conf ? <Inbox size={22} style={{ color: 'rgba(255,255,255,0.2)' }} /> : <CheckCircle2 size={22} style={{ color: '#4ADE80' }} />}
              <p className="text-sm" style={{ color: muted }}>{conf ? 'None at this level.' : 'No students share a phone number. Nothing to merge.'}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {groups.map((g, i) => (
                <GroupCard key={g.key} group={g} index={i} orgName={orgName} dismissed={!!g.dismissed} onReview={setReviewing} />
              ))}
            </div>
          )}
        </>
      )}

      {reviewing && <MergeModal ids={reviewing} onClose={() => setReviewing(null)} />}
    </div>
  )
}
