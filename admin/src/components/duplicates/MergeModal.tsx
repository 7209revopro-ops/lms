'use client'

import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, BadgeCheck, AlertTriangle, GitMerge, ArrowRight, Check } from 'lucide-react'
import { AvatarImg } from '@/components/ui/AvatarImg'
import Spinner from '@/components/ui/Spinner'
import { useToast } from '@/store/ui.store'
import {
  useCompareAccounts, useMergePreview, useMergeAccounts,
  type CompareAccount, type PickGroup, type Picks,
} from '@/lib/api/duplicates'

/* ─────────────────────────────────────────────────────
   Merge two student accounts into one.

   1. The two side by side — the admin picks the account to KEEP (the one
      whose email was proven and who signs in is suggested).
   2. Detail by detail, whose value the kept account carries.
   3. What will move, straight from the server's dry run.
   4. Typing the closed account's email, then Merge.
───────────────────────────────────────────────────── */

const GROUPS: { key: PickGroup; label: string }[] = [
  { key: 'name',         label: 'Name' },
  { key: 'phone',        label: 'Phone' },
  { key: 'photo',        label: 'Photo' },
  { key: 'registration', label: 'Registration details' },
  { key: 'academy',      label: 'Academy' },
  { key: 'approval',     label: 'Approval' },
]

const muted = 'rgba(255,255,255,0.45)'
const PROGRAMME: Record<string, string> = { '4x-trading': 'Forex', 'digital-marketing': 'Digital Marketing', ai: 'AI', jura: 'JURA', cma: 'CMA' }
const fmt = (iso?: string) => iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

function AccountCard({ a, keep, suggested, onKeep, countLabels }: {
  a: CompareAccount; keep: boolean; suggested: boolean; onKeep: () => void; countLabels: Record<string, string>
}) {
  return (
    <button type="button" onClick={onKeep}
      className="flex w-full flex-col gap-3 rounded-2xl p-4 text-left transition-colors"
      style={{
        background: keep ? 'rgba(0,87,184,0.12)' : 'rgba(255,255,255,0.03)',
        border: `1px solid ${keep ? 'rgba(96,165,250,0.55)' : 'rgba(255,255,255,0.08)'}`,
      }}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-xs font-semibold" style={{ color: keep ? '#93C5FD' : muted }}>
          <span className="flex h-4 w-4 items-center justify-center rounded-full"
            style={{ border: `1.5px solid ${keep ? '#60A5FA' : 'rgba(255,255,255,0.3)'}`, background: keep ? '#3B82F6' : 'transparent' }}>
            {keep && <Check size={10} color="white" />}
          </span>
          {keep ? 'Keep this account' : 'Close this account'}
        </span>
        {suggested && (
          <span className="rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
            style={{ background: 'rgba(74,222,128,0.14)', color: '#4ADE80' }}>Suggested</span>
        )}
      </div>
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center overflow-hidden rounded-full text-sm font-bold text-white"
          style={{ background: 'rgba(255,255,255,0.08)' }}>
          <AvatarImg src={a.avatarUrl} name={a.name} className="h-full w-full object-cover" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">{a.name}</p>
          <p className="truncate text-xs" style={{ color: 'rgba(255,255,255,0.65)' }}>{a.email}</p>
          <p className="mt-0.5 flex items-center gap-1 text-[11px]" style={{ color: a.isVerified ? '#4ADE80' : '#FBBF24' }}>
            {a.isVerified ? <><BadgeCheck size={11} />Email verified</> : <><AlertTriangle size={11} />Email never verified</>}
          </p>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
        <dt style={{ color: muted }}>Last sign-in</dt><dd className="text-right text-white">{a.lastLoginAt ? fmt(a.lastLoginAt) : 'Never'}</dd>
        <dt style={{ color: muted }}>Created</dt><dd className="text-right text-white">{fmt(a.createdAt)}</dd>
        <dt style={{ color: muted }}>Status</dt><dd className="text-right capitalize text-white">{a.enrollmentStatus ?? '—'}{a.isActive ? '' : ' · blocked'}</dd>
        {Object.keys(countLabels).map(k => [k, a.counts[k] ?? 0] as const).map(([k, v]) => (
          <span key={k} className="contents">
            <dt style={{ color: muted }}>{countLabels[k] ?? k}</dt>
            <dd className="text-right tabular-nums" style={{ color: v ? 'white' : 'rgba(255,255,255,0.3)' }}>{v}</dd>
          </span>
        ))}
      </dl>
    </button>
  )
}

export default function MergeModal({ ids, onClose }: { ids: [string, string]; onClose: () => void }) {
  const toast = useToast()
  const { data: cmp, isLoading, isError, error } = useCompareAccounts(ids)
  const [primaryId, setPrimaryId] = useState<string | null>(null)
  const [overrides, setOverrides] = useState<Picks>({})
  const [confirm, setConfirm]     = useState('')
  const [keepEmail, setKeepEmail] = useState(true)
  useEffect(() => { if (cmp && !primaryId) setPrimaryId(cmp.suggestedPrimaryId) }, [cmp, primaryId])

  const [left, right] = cmp?.accounts ?? []
  const primary   = cmp?.accounts.find(a => a.id === primaryId)
  const secondary = cmp?.accounts.find(a => a.id !== primaryId)
  const { data: preview, isFetching: previewing, isError: previewFailed } =
    useMergePreview(primary?.id ?? null, secondary?.id ?? null, overrides)
  const merge = useMergeAccounts()

  const picks = preview?.picks ?? {}
  /* "primary"/"secondary" are about which account is kept; the columns are fixed. */
  const sideOf = (a: CompareAccount | undefined) => (a?.id === primaryId ? 'primary' : 'secondary')
  const choose = (g: PickGroup, a: CompareAccount) => setOverrides({ ...picks, [g]: sideOf(a) })
  const keep = (id: string) => { if (id !== primaryId) { setPrimaryId(id); setOverrides({}); setConfirm('') } }

  const confirmed = !!secondary && confirm.trim().toLowerCase() === secondary.email.toLowerCase()
  const moved = useMemo(() => (preview?.items ?? []).filter(i => i.moved || i.dropped), [preview])

  const doMerge = async () => {
    if (!primary || !secondary) return
    try {
      await merge.mutateAsync({ primaryId: primary.id, secondaryId: secondary.id, picks, confirmEmail: confirm, keepSecondaryEmail: keepEmail })
      toast.success(`Merged. ${secondary.email} now signs in to ${primary.email}.`)
      onClose()
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message ?? 'The merge did not complete. Check Merge history.')
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        style={{ background: 'rgba(0,0,0,0.65)' }}
        onClick={() => { if (!merge.isPending) onClose() }}>
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 8 }}
          onClick={e => e.stopPropagation()}
          role="dialog" aria-modal="true" aria-labelledby="merge-title"
          className="flex w-full max-w-3xl flex-col rounded-2xl shadow-2xl"
          style={{ background: '#161829', border: '1px solid rgba(255,255,255,0.10)', maxHeight: '92vh' }}>

          <div className="flex flex-shrink-0 items-center justify-between gap-3 px-6 py-4"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            <div>
              <h2 id="merge-title" className="text-lg font-bold text-white" style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}>
                Merge accounts
              </h2>
              <p className="mt-0.5 text-xs" style={{ color: muted }}>Pick the account to keep. Everything from the other moves into it.</p>
            </div>
            <button onClick={onClose} disabled={merge.isPending} aria-label="Close"
              className="rounded-lg p-2 transition-colors hover:bg-white/10" style={{ color: muted }}>
              <X size={16} />
            </button>
          </div>

          <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
            {isLoading ? (
              <div className="flex justify-center py-16"><Spinner size={20} variant="muted" /></div>
            ) : isError || !cmp || !left || !right ? (
              <div className="flex flex-col items-center gap-2 py-12 text-center">
                <AlertTriangle size={22} style={{ color: '#F87171' }} />
                <p className="text-sm" style={{ color: muted }}>
                  {(error as any)?.response?.data?.error?.message ?? 'Could not load these accounts.'}
                </p>
              </div>
            ) : (
              <>
                {/* 1 — which to keep */}
                <section>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider" style={{ color: muted }}>1 · Which account to keep</h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {[left, right].map(a => (
                      <AccountCard key={a.id} a={a} keep={a.id === primaryId} suggested={a.id === cmp.suggestedPrimaryId}
                        onKeep={() => keep(a.id)} countLabels={cmp.countLabels} />
                    ))}
                  </div>
                </section>

                {/* 2 — details */}
                <section>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider" style={{ color: muted }}>2 · Details the kept account will have</h3>
                  <div className="overflow-hidden rounded-xl" style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
                    {GROUPS.map(({ key, label }, i) => {
                      const lv = left.details[key], rv = right.details[key]
                      const same = lv === rv
                      return (
                        <div key={key} className="grid grid-cols-[120px_1fr_1fr] items-stretch text-xs"
                          style={{ borderTop: i ? '1px solid rgba(255,255,255,0.05)' : undefined }}>
                          <div className="px-3 py-2.5 font-medium" style={{ color: muted }}>{label}</div>
                          {[left, right].map(a => {
                            const v = a.details[key]
                            const on = picks[key] === sideOf(a)
                            return (
                              <button key={a.id} type="button" disabled={same || !preview} onClick={() => choose(key, a)}
                                className="flex items-center gap-2 px-3 py-2.5 text-left transition-colors enabled:hover:bg-white/[0.04] disabled:cursor-default"
                                style={{ background: !same && on ? 'rgba(0,87,184,0.12)' : 'transparent', color: !same && !on ? 'rgba(255,255,255,0.4)' : 'white' }}
                                aria-pressed={!same && on}>
                                {!same && (
                                  <span className="flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded-full"
                                    style={{ border: `1.5px solid ${on ? '#60A5FA' : 'rgba(255,255,255,0.3)'}`, background: on ? '#3B82F6' : 'transparent' }}>
                                    {on && <Check size={8} color="white" />}
                                  </span>
                                )}
                                <span className="truncate">{v || '—'}</span>
                              </button>
                            )
                          })}
                        </div>
                      )
                    })}
                    <div className="grid grid-cols-[120px_1fr] text-xs" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                      <div className="px-3 py-2.5 font-medium" style={{ color: muted }}>Programmes</div>
                      <div className="px-3 py-2.5 text-white">{preview?.categories?.length ? preview.categories.map(c => PROGRAMME[c] ?? c).join(', ') : '—'}
                        <span style={{ color: muted }}> · both accounts' together</span></div>
                    </div>
                  </div>
                  <p className="mt-2 text-[11px]" style={{ color: muted }}>The email always stays the kept account's.</p>
                </section>

                {/* 3 — what happens */}
                <section>
                  <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider" style={{ color: muted }}>
                    3 · What will happen {previewing && <Spinner size={11} variant="muted" />}
                  </h3>
                  {previewFailed ? (
                    <p className="text-xs" style={{ color: '#F87171' }}>Could not work out the merge. Close and try again.</p>
                  ) : (
                    <div className="space-y-2 rounded-xl p-4 text-xs" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                      {moved.length ? (
                        <ul className="space-y-1.5">
                          {moved.map(i => (
                            <li key={i.model + i.label} className="flex flex-wrap items-baseline gap-x-2">
                              <span className="text-white">{i.label}</span>
                              <span style={{ color: muted }}>
                                {i.moved ? `${i.moved} moved` : ''}{i.moved && i.dropped ? ' · ' : ''}{i.dropped ? `${i.dropped} duplicate${i.dropped === 1 ? '' : 's'} removed` : ''}
                              </span>
                              {i.kept.length > 0 && <span className="w-full pl-3 text-[11px]" style={{ color: 'rgba(255,255,255,0.35)' }}>{i.kept.join(' · ')}</span>}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p style={{ color: muted }}>{preview ? 'The account being closed has no courses, bookings or other records.' : '…'}</p>
                      )}
                      {secondary && primary && (
                        <p className="flex items-start gap-2 pt-2" style={{ borderTop: moved.length ? '1px solid rgba(255,255,255,0.06)' : undefined, color: 'rgba(255,255,255,0.7)' }}>
                          <ArrowRight size={12} className="mt-0.5 flex-shrink-0" />
                          <span><b className="text-white">{secondary.email}</b> is closed and signed out. Signing in with it opens <b className="text-white">{primary.email}</b>. You can undo this from Merge history.</span>
                        </p>
                      )}
                    </div>
                  )}
                </section>

                {/* 4 — confirm */}
                {secondary && primary && (
                  <section className="space-y-3">
                    <label className="flex cursor-pointer items-start gap-2.5 rounded-xl p-3 text-xs"
                      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.75)' }}>
                      <input type="checkbox" checked={keepEmail} onChange={e => setKeepEmail(e.target.checked)}
                        className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 accent-blue-500" />
                      <span>
                        Save <b className="text-white">{secondary.email}</b> on <b className="text-white">{primary.email}</b> as a secondary email
                        <span className="mt-0.5 block text-[11px]" style={{ color: muted }}>
                          Shown on the student and found by the Students search.{secondary.secondaryEmails.length ? ` Its earlier secondary emails (${secondary.secondaryEmails.join(', ')}) come across too.` : ''}
                        </span>
                      </span>
                    </label>
                    <label htmlFor="merge-confirm" className="mb-1.5 block text-xs" style={{ color: muted }}>
                      To confirm, type the email of the account being closed: <b className="text-white">{secondary.email}</b>
                    </label>
                    <input id="merge-confirm" value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="off" spellCheck={false}
                      placeholder={secondary.email}
                      className="w-full rounded-xl px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/20"
                      style={{ background: 'rgba(255,255,255,0.05)', border: `1px solid ${confirmed ? 'rgba(74,222,128,0.5)' : 'rgba(255,255,255,0.1)'}` }} />
                  </section>
                )}
              </>
            )}
          </div>

          <div className="flex flex-shrink-0 items-center justify-end gap-2 px-6 py-4" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
            <button onClick={onClose} disabled={merge.isPending}
              className="rounded-xl px-4 py-2 text-sm font-semibold transition-colors hover:bg-white/10" style={{ color: 'rgba(255,255,255,0.7)' }}>
              Cancel
            </button>
            <button onClick={() => void doMerge()} disabled={!confirmed || merge.isPending || previewing || !preview}
              className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
              style={{ background: '#0057b8' }}>
              {merge.isPending ? <Spinner size={13} /> : <GitMerge size={14} />}
              Merge accounts
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
