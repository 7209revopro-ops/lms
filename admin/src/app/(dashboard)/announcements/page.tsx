'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Megaphone, Plus, Pencil, Trash2, ChevronLeft, ChevronRight, X, Check, ChevronDown, Building2,
} from 'lucide-react'
import {
  useAdminAnnouncements, useCreateAnnouncement, useUpdateAnnouncement, useDeleteAnnouncement,
  type AdminAnnouncement,
} from '@/lib/api/announcements'
import { useOrganizations } from '@/lib/api/organizations'
import { useCurrentUser } from '@/lib/api/user'
import { datetimeLocalToISO, isoToDatetimeLocal } from '@/lib/timezone'
import { MediaUploadField } from '@/components/ui/MediaUploadField'
import Spinner from '@/components/ui/Spinner'
import { useToast } from '@/store/ui.store'

/* ── Dark-modal select, same shape as AddUserModal's — kept local rather
   than extracted, matching how every dark-modal field in this app already
   does it (Users, Instructors each carry their own copy). ── */
function SelectField({
  label, value, options, onChange, locked, error,
}: {
  label:    string
  value:    string
  options:  { value: string; label: string }[]
  onChange: (v: string) => void
  locked?:  boolean
  error?:   string
}) {
  const [open, setOpen] = useState(false)
  const current = options.find(o => o.value === value)

  if (locked) {
    return (
      <div>
        <label className="mb-1.5 block text-xs font-medium" style={{ color: 'rgba(255,255,255,0.45)' }}>{label}</label>
        <div className="rounded-xl px-3 py-2.5 text-sm"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.4)' }}>
          {current?.label ?? '—'}
        </div>
      </div>
    )
  }

  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium" style={{ color: 'rgba(255,255,255,0.45)' }}>{label}</label>
      <div className="relative">
        <button type="button" onClick={() => setOpen(v => !v)}
          className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm transition-all"
          style={{
            background: 'rgba(255,255,255,0.06)',
            border: `1px solid ${error ? '#ef4444' : open ? 'rgba(0,87,184,0.5)' : 'rgba(255,255,255,0.09)'}`,
            color: value ? 'white' : 'rgba(255,255,255,0.35)',
          }}>
          <span>{current?.label ?? `Select ${label.toLowerCase()}…`}</span>
          <ChevronDown size={13} style={{ color: 'rgba(255,255,255,0.35)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
        </button>
        <AnimatePresence>
          {open && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
              <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.12 }}
                className="absolute left-0 right-0 top-full z-20 mt-1.5 max-h-56 overflow-y-auto rounded-xl p-1.5"
                style={{ background: '#161829', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 12px 32px rgba(0,0,0,0.5)' }}>
                {options.map(o => (
                  <button key={o.value} type="button" onClick={() => { onChange(o.value); setOpen(false) }}
                    className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-white/[0.06]"
                    style={{ color: o.value === value ? 'white' : 'rgba(255,255,255,0.7)' }}>
                    {o.label}
                    {o.value === value && <Check size={13} style={{ color: '#0057b8' }} />}
                  </button>
                ))}
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>
      {error && <p className="mt-1 text-[11px]" style={{ color: '#ef4444' }}>{error}</p>}
    </div>
  )
}

/* Synthetic entry — never a real academy id, only ever produced/consumed
   client-side. The route treats an explicit `organizationId: null` as "every
   academy", which is what selecting this option sends. */
const ALL_ACADEMIES = '__all__'

/* Scheduled / Live / Expired is derived from the dates and isActive alone —
   no separate status field to drift out of sync with them. */
function statusOf(a: Pick<AdminAnnouncement, 'startDate' | 'endDate' | 'isActive'>): { label: string; bg: string; color: string } {
  if (!a.isActive) return { label: 'Inactive', bg: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.4)' }
  const now = Date.now()
  if (now < new Date(a.startDate).getTime()) return { label: 'Scheduled', bg: 'rgba(96,165,250,0.14)', color: '#60A5FA' }
  if (now > new Date(a.endDate).getTime())   return { label: 'Expired',   bg: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.4)' }
  return { label: 'Live', bg: 'rgba(74,222,128,0.15)', color: '#4ADE80' }
}

function fmtRange(startISO: string, endISO: string): string {
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
  return `${new Date(startISO).toLocaleString('en-US', opts)} – ${new Date(endISO).toLocaleString('en-US', opts)}`
}

/* ─── Create / edit form ─────────────────────────────── */
function AnnouncementFormModal({ initial, onClose }: { initial?: AdminAnnouncement; onClose: () => void }) {
  const { data: me } = useCurrentUser()
  const isSuper = me?.role === 'super_admin'
  const { data: orgs } = useOrganizations(isSuper)

  const [title,       setTitle]       = useState(initial?.title ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [mediaUrl,     setMediaUrl]     = useState(initial?.mediaUrl ?? '')
  const [startLocal,  setStartLocal]  = useState(initial ? isoToDatetimeLocal(initial.startDate) : '')
  const [endLocal,    setEndLocal]    = useState(initial ? isoToDatetimeLocal(initial.endDate) : '')
  /* Only meaningful for a super_admin — an admin's academy is fixed server-
     side regardless of what this holds, so the field is simply not shown to
     them (see the locked branch below). */
  const [orgChoice,   setOrgChoice]   = useState(
    initial ? (initial.organizationId ?? ALL_ACADEMIES) : (orgs?.[0]?.id ?? ALL_ACADEMIES),
  )
  const [errors,  setErrors]  = useState<Record<string, string>>({})
  const [saving,  setSaving]  = useState(false)
  const [apiErr,  setApiErr]  = useState<string | null>(null)

  const create = useCreateAnnouncement()
  const update = useUpdateAnnouncement()

  const validate = () => {
    const e: Record<string, string> = {}
    if (title.trim().length < 3) e.title = 'Title must be at least 3 characters'
    if (!description.trim()) e.description = 'Description is required'
    if (!startLocal) e.startDate = 'Start date is required'
    if (!endLocal) e.endDate = 'End date is required'
    if (startLocal && endLocal && datetimeLocalToISO(endLocal) <= datetimeLocalToISO(startLocal)) {
      e.endDate = 'End date must be after start date'
    }
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleSave = async () => {
    if (!validate()) return
    setSaving(true); setApiErr(null)
    try {
      const dto = {
        title:       title.trim(),
        description: description.trim(),
        mediaUrl:    mediaUrl || undefined,
        startDate:   datetimeLocalToISO(startLocal),
        endDate:     datetimeLocalToISO(endLocal),
        /* An admin never sends this key at all — the server would refuse it
           outright if it did, so omitting it here is the honest UI: there is
           genuinely nothing for them to choose. A super admin sends a real
           academy id, or explicit null for "every academy". */
        ...(isSuper ? { organizationId: orgChoice === ALL_ACADEMIES ? null : orgChoice } : {}),
      }
      if (initial) await update.mutateAsync({ id: initial.id, ...dto })
      else         await create.mutateAsync(dto)
      onClose()
    } catch (err: any) {
      setApiErr(err?.response?.data?.error?.message ?? 'Could not save the announcement.')
    } finally {
      setSaving(false)
    }
  }

  const inputCls = 'w-full rounded-xl px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/25'
  const inputStyle = { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', colorScheme: 'dark' as const }

  const academyOptions = [
    { value: ALL_ACADEMIES, label: 'All Academies' },
    ...(orgs ?? []).map(o => ({ value: o.id, label: o.name })),
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center"
      style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.96, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-md space-y-4 overflow-y-auto rounded-2xl p-6"
        style={{ background: '#1A1D2E', border: '1px solid rgba(255,255,255,0.1)', maxHeight: '90vh' }}>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: '#0057b8' }}>
              {initial ? 'Edit' : 'New'}
            </p>
            <h2 className="mt-0.5 text-base font-bold text-white">
              {initial ? 'Edit Announcement' : 'New Announcement'}
            </h2>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-white/10">
            <X size={16} style={{ color: 'rgba(255,255,255,0.5)' }} />
          </button>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium" style={{ color: 'rgba(255,255,255,0.45)' }}>Title</label>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Ramadan class schedule change"
            className={inputCls} style={{ ...inputStyle, border: errors.title ? '1px solid #ef4444' : inputStyle.border }} />
          {errors.title && <p className="mt-1 text-[11px]" style={{ color: '#ef4444' }}>{errors.title}</p>}
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium" style={{ color: 'rgba(255,255,255,0.45)' }}>Description</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={4}
            placeholder="What should students know?"
            className={inputCls} style={{ ...inputStyle, border: errors.description ? '1px solid #ef4444' : inputStyle.border, resize: 'vertical' }} />
          {errors.description && <p className="mt-1 text-[11px]" style={{ color: '#ef4444' }}>{errors.description}</p>}
        </div>

        <MediaUploadField
          value={mediaUrl}
          onChange={setMediaUrl}
          type="image"
          label="Banner image (optional)"
          hint="Shown at the top of the popup students see"
        />

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium" style={{ color: 'rgba(255,255,255,0.45)' }}>Start date</label>
            <input type="datetime-local" value={startLocal} onChange={e => setStartLocal(e.target.value)}
              className={inputCls} style={{ ...inputStyle, border: errors.startDate ? '1px solid #ef4444' : inputStyle.border }} />
            {errors.startDate && <p className="mt-1 text-[11px]" style={{ color: '#ef4444' }}>{errors.startDate}</p>}
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium" style={{ color: 'rgba(255,255,255,0.45)' }}>End date</label>
            <input type="datetime-local" value={endLocal} onChange={e => setEndLocal(e.target.value)}
              className={inputCls} style={{ ...inputStyle, border: errors.endDate ? '1px solid #ef4444' : inputStyle.border }} />
            {errors.endDate && <p className="mt-1 text-[11px]" style={{ color: '#ef4444' }}>{errors.endDate}</p>}
          </div>
        </div>

        {/* Academy — super admins only. An org admin has nothing to choose:
            their own academy is the only possible answer, enforced server-side
            regardless of what any screen sends. */}
        {isSuper && (
          <SelectField label="Academy" value={orgChoice} options={academyOptions} onChange={setOrgChoice} />
        )}

        {apiErr && (
          <p className="flex items-center gap-1.5 rounded-xl px-3 py-2.5 text-xs"
            style={{ background: 'rgba(239,68,68,0.1)', color: '#F87171', border: '1px solid rgba(239,68,68,0.2)' }}>
            {apiErr}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="rounded-xl px-4 py-2 text-sm font-semibold transition-colors hover:bg-white/[0.08]"
            style={{ color: 'rgba(255,255,255,0.5)' }}>Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-1.5 rounded-xl px-5 py-2 text-sm font-bold text-white transition-all disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg, #0057b8, #003d80)' }}>
            {saving && <Spinner size={13} />}
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </motion.div>
    </div>
  )
}

/* ─── Page ───────────────────────────────────────────── */
export default function AdminAnnouncementsPage() {
  const [page,     setPage]     = useState(1)
  const [modal,    setModal]    = useState<'create' | AdminAnnouncement | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  const { data, isLoading } = useAdminAnnouncements({ page, per_page: 15 })
  const { data: orgs } = useOrganizations(true)
  const updateMut = useUpdateAnnouncement()
  const deleteMut = useDeleteAnnouncement()
  const toast = useToast()

  const academyLabel = (organizationId?: string) =>
    organizationId ? (orgs?.find(o => o.id === organizationId)?.name ?? '—') : 'All Academies'

  const handleToggleActive = async (a: AdminAnnouncement) => {
    try {
      await updateMut.mutateAsync({ id: a.id, isActive: !a.isActive })
    } catch {
      toast.error(a.isActive ? 'Could not deactivate the announcement' : 'Could not activate the announcement')
    }
  }

  const handleDelete = async (a: AdminAnnouncement) => {
    if (!confirm(`Delete "${a.title}"? This cannot be undone.`)) return
    setDeleting(a.id)
    try {
      await deleteMut.mutateAsync(a.id)
    } catch (err: any) {
      toast.error('Delete failed', err?.response?.data?.error?.message)
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-white" style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}>
            <Megaphone size={22} style={{ color: '#0057b8' }} />
            Announcements
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>
            Scheduled broadcasts students see as a popup the moment they log in.
          </p>
        </div>
        <button onClick={() => setModal('create')}
          className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-white transition-all hover:opacity-90"
          style={{ background: 'linear-gradient(135deg, #0057b8, #003d80)' }}>
          <Plus size={14} />New Announcement
        </button>
      </div>

      <div className="overflow-hidden rounded-2xl" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)' }}>
        <table className="w-full text-xs">
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              {['Title', 'Academy', 'Window', 'Status', ''].map(h => (
                <th key={h} className="px-4 py-3 text-left font-semibold" style={{ color: 'rgba(255,255,255,0.4)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={5} className="py-16 text-center"><Spinner size={18} variant="muted" /></td></tr>
            ) : !data?.docs.length ? (
              <tr><td colSpan={5} className="py-16 text-center text-sm" style={{ color: 'rgba(255,255,255,0.3)' }}>
                No announcements yet. Create one to get started.
              </td></tr>
            ) : data.docs.map((a, i) => {
              const status = statusOf(a)
              return (
                <motion.tr key={a.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }}
                  style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <td className="px-4 py-3">
                    <span className="font-semibold text-white">{a.title}</span>
                  </td>
                  <td className="px-4 py-3" style={{ color: 'rgba(255,255,255,0.6)' }}>
                    <span className="inline-flex items-center gap-1">
                      <Building2 size={11} style={{ color: 'rgba(255,255,255,0.35)' }} />
                      {academyLabel(a.organizationId)}
                    </span>
                  </td>
                  <td className="px-4 py-3" style={{ color: 'rgba(255,255,255,0.5)' }}>
                    {fmtRange(a.startDate, a.endDate)}
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => handleToggleActive(a)}
                      className="rounded-lg px-2 py-0.5 text-[11px] font-semibold transition-colors"
                      style={{ background: status.bg, color: status.color }}>
                      {status.label}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button onClick={() => setModal(a)} className="rounded-lg p-1.5 transition-colors hover:bg-white/[0.08]">
                        <Pencil size={12} style={{ color: 'rgba(255,255,255,0.5)' }} />
                      </button>
                      <button onClick={() => handleDelete(a)} disabled={deleting === a.id}
                        className="rounded-lg p-1.5 transition-colors hover:bg-white/[0.08] disabled:opacity-40">
                        {deleting === a.id ? <Spinner size={12} /> : <Trash2 size={12} style={{ color: '#F87171' }} />}
                      </button>
                    </div>
                  </td>
                </motion.tr>
              )
            })}
          </tbody>
        </table>

        {data?.meta && data.meta.total_pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.35)' }}>
              Page {data.meta.page} of {data.meta.total_pages}
            </p>
            <div className="flex gap-1">
              <button disabled={!data.meta.has_prev} onClick={() => setPage(p => p - 1)}
                className="rounded-lg p-1.5 disabled:opacity-30 hover:bg-white/[0.05]">
                <ChevronLeft size={14} style={{ color: 'white' }} />
              </button>
              <button disabled={!data.meta.has_next} onClick={() => setPage(p => p + 1)}
                className="rounded-lg p-1.5 disabled:opacity-30 hover:bg-white/[0.05]">
                <ChevronRight size={14} style={{ color: 'white' }} />
              </button>
            </div>
          </div>
        )}
      </div>

      <AnimatePresence>
        {modal !== null && (
          <AnnouncementFormModal initial={modal === 'create' ? undefined : modal} onClose={() => setModal(null)} />
        )}
      </AnimatePresence>
    </div>
  )
}
