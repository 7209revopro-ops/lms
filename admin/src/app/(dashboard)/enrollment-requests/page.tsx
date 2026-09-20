'use client'

import { useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Clock, CheckCircle2, XCircle, AlertCircle, Search,
  TrendingUp, Megaphone, Cpu, LayoutGrid, ChevronDown, Check,
  ShieldCheck, Mail, X, Plus, Eye, RotateCcw, ShieldOff,
  FileText, User, Phone, MapPin, BookOpen, CreditCard, ExternalLink,
  ImageIcon, ZoomIn, AlertTriangle, Upload, Trash2, Zap, Globe, Users,
} from 'lucide-react'
import {
  useExpressMembers, useExpressMembersStats, useExpressMembersCount,
  useToggleExpressMember, useDeleteExpressMember,
  type ExpressMember,
} from '@/lib/api/expressMembers'
import {
  useEnrollmentRequests, useApproveEnrollment, useRejectEnrollment, useRemoveEnrollmentCategory,
  useRevokeToViewer, useToggleBlock,
  type EnrollmentRequest, type EnrollmentRequestStatus, type ProgramCategory,
} from '@/lib/api/enrollmentRequests'
import { useCurrentUser } from '@/lib/api/user'
import { useToast } from '@/store/ui.store'
import { api } from '@/lib/axios'
import { useQueryClient } from '@tanstack/react-query'
import { useDeleteUser } from '@/lib/api/users'
import { useDocumentUrl, type ResolvedDocument } from '@/lib/api/documents'
import Spinner from '@/components/ui/Spinner'
import { programLabel } from '@/lib/programs'

/* ── Constants ─────────────────────────────────────── */
const CATEGORY_META: Record<ProgramCategory, { label: string; color: string; bg: string; Icon: React.ComponentType<{ size?: number }> }> = {
  '4x-trading':        { label: 'FOREX Trading',     color: '#10B981', bg: 'rgba(16,185,129,0.14)',  Icon: TrendingUp },
  'jura':              { label: 'JURA',              color: '#8B5CF6', bg: 'rgba(139,92,246,0.14)', Icon: TrendingUp },
  'digital-marketing': { label: 'Digital Marketing', color: '#0057b8', bg: 'rgba(0,87,184,0.14)', Icon: Megaphone  },
  'ai':                { label: 'AI',                 color: '#8B5CF6', bg: 'rgba(139,92,246,0.14)', Icon: Cpu        },
}

const ALL_CATEGORIES: ProgramCategory[] = ['4x-trading', 'digital-marketing', 'ai', 'jura']

const ROLE_LABEL: Record<string, string> = {
  super_admin:             'Super Admin',
  admin:                   'Admin',
  sub_admin:               'Sub Admin',
}

// Scope now has ONE source for every staff role — see lib/programScope.ts.
import { categoryScopeOf } from '@/lib/programScope'

/* ── Category badge (plain) ─────────────────────────── */
function CategoryBadge({ cat }: { cat: ProgramCategory }) {
  const m = CATEGORY_META[cat]
  return (
    <span className="inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] font-semibold"
      style={{ background: m.bg, color: m.color }}>
      <m.Icon size={10} />{m.label}
    </span>
  )
}

/* ── Removable category badge ───────────────────────── */
function RemovableCategoryBadge({ cat, canRemove, removing, onRemove }: {
  cat:       ProgramCategory
  canRemove: boolean
  removing:  boolean
  onRemove:  () => void
}) {
  const m = CATEGORY_META[cat]
  return (
    <span className="inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] font-semibold"
      style={{ background: m.bg, color: m.color }}>
      <m.Icon size={10} />{m.label}
      {canRemove && (
        <button
          type="button"
          onClick={e => { e.stopPropagation(); onRemove() }}
          disabled={removing}
          title={`Remove from ${m.label}`}
          className="ml-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full transition-all hover:bg-black/20 disabled:opacity-30"
        >
          {removing ? <Spinner size={8} /> : <X size={8} />}
        </button>
      )}
    </span>
  )
}

/* ── Add-category dropdown (for admin/super_admin) ───── */
function AddCategoryDropdown({ existingCats, loading, onAdd }: {
  existingCats: ProgramCategory[]
  loading:      boolean
  onAdd:        (cat: ProgramCategory) => void
}) {
  const [open, setOpen] = useState(false)
  const missing = ALL_CATEGORIES.filter(c => !existingCats.includes(c))
  if (missing.length === 0) return null

  return (
    <div className="relative">
      <button
        type="button"
        disabled={loading}
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-all hover:bg-white/[0.08] disabled:opacity-40"
        style={{ color: 'rgba(255,255,255,0.55)', border: '1px solid rgba(255,255,255,0.12)' }}
        title="Add to another program"
      >
        {loading ? <Spinner size={10} /> : <Plus size={10} />}
        Add Program
      </button>
      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: -4, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.97 }}
              transition={{ duration: 0.1 }}
              className="absolute right-0 top-full z-50 mt-1 w-44 overflow-hidden rounded-xl py-1"
              style={{ background: '#131525', border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 20px 50px rgba(0,0,0,0.7)' }}
            >
              {missing.map(cat => {
                const m = CATEGORY_META[cat]
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => { onAdd(cat); setOpen(false) }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-white/[0.06]"
                    style={{ color: m.color }}
                  >
                    <m.Icon size={10} /><span>{m.label}</span>
                  </button>
                )
              })}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ── Multi-category select ──────────────────────────── */
function CategorySelect({ value, onChange, disabled }: {
  value:    ProgramCategory[]
  onChange: (cats: ProgramCategory[]) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const toggle = (cat: ProgramCategory) => {
    onChange(value.includes(cat) ? value.filter(c => c !== cat) : [...value, cat])
  }
  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm transition-all"
        style={{
          background: 'rgba(255,255,255,0.06)',
          border: `1px solid ${open ? 'rgba(74,222,128,0.5)' : 'rgba(255,255,255,0.09)'}`,
          boxShadow: open ? '0 0 0 3px rgba(74,222,128,0.08)' : 'none',
          color: 'white',
        }}
      >
        <span className="flex flex-wrap gap-1">
          {value.length === 0
            ? <span style={{ color: 'rgba(255,255,255,0.35)' }}>Select categories…</span>
            : value.map(c => <CategoryBadge key={c} cat={c} />)}
        </span>
        <ChevronDown size={13} style={{ color: 'rgba(255,255,255,0.35)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }} />
      </button>
      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-[70]" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: -4, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.97 }}
              transition={{ duration: 0.1 }}
              className="absolute left-0 bottom-full z-[71] mb-1 w-full overflow-hidden rounded-xl py-1"
              style={{ background: '#131525', border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 20px 50px rgba(0,0,0,0.7)' }}
            >
              {ALL_CATEGORIES.map(cat => {
                const m = CATEGORY_META[cat]
                const selected = value.includes(cat)
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => toggle(cat)}
                    className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm transition-colors hover:bg-white/[0.06]"
                  >
                    <div className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded"
                      style={{ background: selected ? m.bg : 'rgba(255,255,255,0.06)', border: `1px solid ${selected ? m.color : 'rgba(255,255,255,0.15)'}` }}>
                      {selected && <Check size={10} style={{ color: m.color }} />}
                    </div>
                    <span className="flex items-center gap-1.5" style={{ color: selected ? m.color : 'rgba(255,255,255,0.75)' }}>
                      <m.Icon size={10} />{m.label}
                    </span>
                  </button>
                )
              })}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ── Approve dialog ─────────────────────────────────── */
function ApproveDialog({ user, scopeCategory, onClose, onConfirm, loading }: {
  user:          EnrollmentRequest
  scopeCategory: ProgramCategory | null
  onClose:       () => void
  onConfirm:     (cats: ProgramCategory[]) => void
  loading:       boolean
}) {
  const [cats, setCats] = useState<ProgramCategory[]>(
    scopeCategory ? [scopeCategory] : (user.categories.length ? user.categories : []),
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="absolute inset-0"
        style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}
        onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        className="relative w-full max-w-md rounded-2xl"
        style={{ background: 'linear-gradient(145deg,#0e1022,#0a0c18)', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 40px 80px rgba(0,0,0,0.8)', zIndex: 1 }}
      >
        <div className="px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: '#4ADE80' }}>Approve Student</p>
          <h2 className="mt-0.5 text-base font-bold text-white">{user.name}</h2>
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>{user.email}</p>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium" style={{ color: 'rgba(255,255,255,0.45)' }}>
              Assign program category {scopeCategory ? '(auto-set for your role)' : '(select one or more)'}
            </label>
            {scopeCategory ? (
              <div className="flex items-center gap-2 rounded-xl px-3 py-2.5"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                <CategoryBadge cat={scopeCategory} />
                <span className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>— locked to your program</span>
              </div>
            ) : (
              <CategorySelect value={cats} onChange={setCats} />
            )}
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose}
              className="rounded-xl px-4 py-2 text-sm font-medium transition-colors hover:bg-white/[0.07]"
              style={{ color: 'rgba(255,255,255,0.5)' }}>Cancel</button>
            <button
              onClick={() => cats.length > 0 && onConfirm(cats)}
              disabled={loading || cats.length === 0}
              className="flex items-center gap-1.5 rounded-xl px-5 py-2 text-sm font-semibold text-white transition-all hover:opacity-90 disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg,#4ADE80,#22c55e)', boxShadow: '0 4px 14px rgba(74,222,128,0.3)' }}>
              {loading && <Spinner size={13} />}
              <CheckCircle2 size={13} />
              Approve
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  )
}

/* ── Reject / Revoke dialog ─────────────────────────── */
function RejectDialog({ user, isRevoke, onClose, onConfirm, loading }: {
  user:      EnrollmentRequest
  isRevoke?: boolean
  onClose:   () => void
  onConfirm: (reason: string) => void
  loading:   boolean
}) {
  const [reason, setReason] = useState('')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="absolute inset-0"
        style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}
        onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        className="relative w-full max-w-md rounded-2xl"
        style={{ background: 'linear-gradient(145deg,#0e1022,#0a0c18)', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 40px 80px rgba(0,0,0,0.8)', zIndex: 1 }}
      >
        <div className="px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: '#EF4444' }}>
            {isRevoke ? 'Revoke All Access' : 'Reject Request'}
          </p>
          <h2 className="mt-0.5 text-base font-bold text-white">{user.name}</h2>
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>{user.email}</p>
        </div>
        <div className="p-5">
          <div className="mb-4 flex items-center gap-2 rounded-xl p-3"
            style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
            <AlertCircle size={14} style={{ color: '#EF4444', flexShrink: 0 }} />
            <p className="text-xs" style={{ color: 'rgba(255,255,255,0.7)' }}>
              {isRevoke
                ? 'This will remove all program assignments and unenroll this student from every course. They will become a viewer with no access. This cannot be undone without re-approving.'
                : 'The student will be notified by email. They can be re-approved later.'}
            </p>
          </div>
          <label className="mb-1.5 block text-xs font-medium" style={{ color: 'rgba(255,255,255,0.45)' }}>
            {isRevoke ? 'Reason for revoking access' : 'Reason for rejection'}
          </label>
          <textarea
            value={reason} onChange={e => setReason(e.target.value)}
            placeholder={isRevoke ? 'e.g. Account policy violation…' : 'e.g. Incomplete information — please resubmit with valid details…'}
            rows={4}
            className="w-full resize-none rounded-xl px-3 py-2.5 text-sm text-white outline-none transition-all placeholder:text-white/20"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.09)' }}
            onFocus={e => { e.currentTarget.style.border = '1px solid rgba(239,68,68,0.4)'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(239,68,68,0.08)' }}
            onBlur={e => { e.currentTarget.style.border = '1px solid rgba(255,255,255,0.09)'; e.currentTarget.style.boxShadow = 'none' }}
          />
          <p className="mt-1 text-xs" style={{ color: 'rgba(255,255,255,0.25)' }}>{reason.length}/1000</p>
          <div className="mt-5 flex justify-end gap-2">
            <button onClick={onClose}
              className="rounded-xl px-4 py-2 text-sm font-medium transition-colors hover:bg-white/[0.07]"
              style={{ color: 'rgba(255,255,255,0.5)' }}>Cancel</button>
            <button
              onClick={() => reason.trim().length >= 5 && onConfirm(reason.trim())}
              disabled={loading || reason.trim().length < 5}
              className="flex items-center gap-1.5 rounded-xl px-5 py-2 text-sm font-semibold text-white transition-all hover:opacity-90 disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg,#EF4444,#DC2626)' }}>
              {loading && <Spinner size={13} />}
              {isRevoke ? 'Revoke All Access' : 'Confirm rejection'}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  )
}

/* ── Document viewer with lightbox + admin upload ────── */
const ID_DOC_LABEL: Record<string, string> = {
  'Emirates ID':  'Emirates ID',
  'Passport':     'Passport (ID)',
  'Aadhaar Card': 'Aadhaar Card',
  'Other':        'Govt. ID',
}

function DocumentsSection({ passportUrl: rawPassportUrl, idDocUrl: rawIdDocUrl, photoUrl, userId, idType }: {
  passportUrl?: string
  idDocUrl?:    string
  photoUrl?:    string
  userId:       string
  idType?:      string
}) {
  /* Identity scans are stored as bare keys and exchanged for a short-lived
     signed link (H-11). The photo is public and passes through unchanged. */
  const passportDoc = useDocumentUrl(userId, 'passport', rawPassportUrl)
  const idDocDoc    = useDocumentUrl(userId, 'idDoc',    rawIdDocUrl)

  const [lightbox,    setLightbox]    = useState<string | null>(null)
  const [pdfView,     setPdfView]     = useState<'passport' | 'idDoc' | 'photo' | null>(null)
  const [uploading,   setUploading]   = useState<'passport' | 'idDoc' | 'photo' | null>(null)
  const passportRef = useRef<HTMLInputElement>(null)
  const idDocRef    = useRef<HTMLInputElement>(null)
  const photoRef    = useRef<HTMLInputElement>(null)
  const toast       = useToast()
  const qc          = useQueryClient()

  const isImage = (url: string) => /\.(jpg|jpeg|png|webp)$/i.test(url)

  async function handleUpload(file: File, field: 'passport' | 'idDoc' | 'photo') {
    setUploading(field)
    try {
      const fd = new FormData()
      fd.append('file', file)
      /* Identity scans go to the gated kyc/ prefix; the photo is the public
         avatar and stays where it is (H-11). */
      const endpoint = field === 'photo' ? '/uploads/document' : '/uploads/kyc'
      const uploadRes = await api.post<{ success: true; data: { url: string } }>(endpoint, fd, {
        headers: { 'Content-Type': undefined },
      })
      const url = uploadRes.data.data.url

      const body = field === 'passport' ? { passportUrl: url }
        : field === 'idDoc' ? { idDocUrl: url }
        : { photoUrl: url }
      await api.patch(`/admin/enrollment-requests/${userId}/docs`, body)

      const label = field === 'passport' ? 'Passport' : field === 'idDoc' ? (ID_DOC_LABEL[idType ?? ''] ?? 'ID Document') : 'Photo'
      toast.success(`${label} uploaded`)
      qc.invalidateQueries({ queryKey: ['admin', 'enrollment-requests'] })
    } catch {
      toast.error('Upload failed. Please try again.')
    } finally {
      setUploading(null)
    }
  }

  function DocCard({ label, doc, field }: {
    label: string
    doc:   ResolvedDocument
    field: 'passport' | 'idDoc' | 'photo'
  }) {
    const url = doc.url
    const inputRef = field === 'passport' ? passportRef : field === 'idDoc' ? idDocRef : photoRef
    const isLoading = uploading === field

    /* A document that exists but whose link did not resolve must never read as
       "not submitted": the reviewer would upload a replacement over the
       student's file believing none was there. Say what happened and offer a
       retry instead. */
    if (doc.state === 'loading' || doc.state === 'error') {
      const failed = doc.state === 'error'
      return (
        <div className="flex flex-col gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'rgba(255,255,255,0.3)' }}>{label}</p>
          <div className="flex h-36 flex-col items-center justify-center gap-2 rounded-xl px-3 text-center"
            style={{
              background: failed ? 'rgba(248,113,113,0.06)' : 'rgba(255,255,255,0.02)',
              border: `1px solid ${failed ? 'rgba(248,113,113,0.30)' : 'rgba(255,255,255,0.10)'}`,
            }}>
            {failed ? (
              <>
                <AlertCircle size={18} style={{ color: '#F87171' }} />
                <span className="text-[11px]" style={{ color: '#F87171' }}>
                  Submitted, but the link would not load
                </span>
                <button type="button" onClick={doc.retry}
                  className="text-[11px] underline transition-opacity hover:opacity-80"
                  style={{ color: '#60A5FA' }}>
                  Try again
                </button>
              </>
            ) : (
              <>
                <Spinner size={18} variant="muted" />
                <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.35)' }}>
                  Loading document…
                </span>
              </>
            )}
          </div>
        </div>
      )
    }

    if (!url) {
      return (
        <div className="flex flex-col gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'rgba(255,255,255,0.3)' }}>{label}</p>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={isLoading}
            className="flex h-36 flex-col items-center justify-center gap-2 rounded-xl transition-all hover:brightness-110 disabled:opacity-50"
            style={{ background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.15)', cursor: 'pointer' }}>
            {isLoading ? (
              <Spinner size={18} variant="muted" />
            ) : (
              <Upload size={18} style={{ color: 'rgba(255,255,255,0.3)' }} />
            )}
            <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.25)' }}>
              {isLoading ? 'Uploading…' : 'Not submitted — click to upload'}
            </span>
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.webp"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f, field); e.target.value = '' }}
          />
        </div>
      )
    }

    if (isImage(url)) {
      return (
        <div className="flex flex-col gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'rgba(255,255,255,0.3)' }}>{label}</p>
          <div className="group relative h-36 cursor-zoom-in overflow-hidden rounded-xl"
            style={{ border: '1px solid rgba(255,255,255,0.1)' }}
            onClick={() => setLightbox(url)}>
            <img src={url} alt={label} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
            <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100"
              style={{ background: 'rgba(0,0,0,0.5)' }}>
              <ZoomIn size={22} className="text-white" />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <a href={url} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-[11px] transition-colors hover:opacity-80"
              style={{ color: '#60A5FA' }}>
              <ExternalLink size={10} />Open full size
            </a>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={isLoading}
              className="flex items-center gap-1 text-[11px] transition-colors hover:opacity-80 disabled:opacity-40"
              style={{ color: 'rgba(255,255,255,0.35)' }}>
              {isLoading ? <Spinner size={9} /> : <Upload size={9} />}
              Replace
            </button>
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f, field); e.target.value = '' }}
            />
          </div>
        </div>
      )
    }

    /* PDF */
    return (
      <div className="flex flex-col gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'rgba(255,255,255,0.3)' }}>{label}</p>
        {pdfView === field ? (
          <div className="flex flex-col gap-1">
            <iframe src={url} className="h-48 w-full rounded-xl" style={{ border: '1px solid rgba(255,255,255,0.1)', background: '#fff' }} />
            <button onClick={() => setPdfView(null)} className="text-[11px]" style={{ color: 'rgba(255,255,255,0.35)' }}>Close preview</button>
          </div>
        ) : (
          <div className="flex h-36 flex-col items-center justify-center gap-3 rounded-xl"
            style={{ background: 'rgba(96,165,250,0.06)', border: '1px solid rgba(96,165,250,0.2)' }}>
            <FileText size={24} style={{ color: '#60A5FA' }} />
            <div className="flex flex-col items-center gap-1.5">
              <button onClick={() => setPdfView(field)}
                className="rounded-lg px-3 py-1.5 text-xs font-medium transition-colors hover:opacity-80"
                style={{ background: 'rgba(96,165,250,0.15)', color: '#60A5FA', border: '1px solid rgba(96,165,250,0.3)' }}>
                Preview PDF
              </button>
              <a href={url} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 text-[11px] transition-colors hover:opacity-80"
                style={{ color: 'rgba(255,255,255,0.35)' }}>
                <ExternalLink size={9} />Open in new tab
              </a>
            </div>
          </div>
        )}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={isLoading}
            className="flex items-center gap-1 text-[11px] transition-colors hover:opacity-80 disabled:opacity-40"
            style={{ color: 'rgba(255,255,255,0.35)' }}>
            {isLoading ? <Spinner size={9} /> : <Upload size={9} />}
            Replace
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.webp"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f, field); e.target.value = '' }}
          />
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
        <div className="mb-3 flex items-center gap-2">
          <ImageIcon size={13} style={{ color: 'rgba(255,255,255,0.4)' }} />
          <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.4)' }}>Submitted Documents</span>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <DocCard label="Passport Copy"                                doc={passportDoc} field="passport" />
          <DocCard label={ID_DOC_LABEL[idType ?? ''] ?? 'ID Document'} doc={idDocDoc}    field="idDoc"    />
          {/* The photo is public and never signed, so it is always resolved. */}
          <DocCard label="Profile Photo"
            doc={{ url: photoUrl || undefined, state: photoUrl ? 'ready' : 'absent' }}
            field="photo" />
        </div>
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}>
          <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.92)' }} />
          <div className="relative z-10 max-h-[90vh] max-w-4xl" onClick={e => e.stopPropagation()}>
            <img src={lightbox} alt="Document" className="max-h-[85vh] max-w-full rounded-xl object-contain"
              style={{ boxShadow: '0 40px 80px rgba(0,0,0,0.8)' }} />
            <button onClick={() => setLightbox(null)}
              className="absolute -right-3 -top-3 flex h-8 w-8 items-center justify-center rounded-full text-white transition-colors hover:bg-white/20"
              style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)' }}>
              <X size={14} />
            </button>
            <a href={lightbox} target="_blank" rel="noopener noreferrer"
              className="absolute -bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-1.5 text-xs"
              style={{ color: 'rgba(255,255,255,0.5)' }}>
              <ExternalLink size={11} />Open original
            </a>
          </div>
        </div>
      )}
    </>
  )
}

/* ── Application detail modal ───────────────────────── */
function ApplicationDetailModal({ user, scopeCategory, onClose, onApprove, onReject, approveLoading, rejectLoading }: {
  user:           EnrollmentRequest
  scopeCategory:  ProgramCategory | null
  onClose:        () => void
  onApprove:      () => void
  onReject:       () => void
  approveLoading: boolean
  rejectLoading:  boolean
}) {
  const app = user.enrollmentApplication
  const isPending  = user.enrollmentStatus === 'pending'
  const isApproved = user.enrollmentStatus === 'approved'
  const isRejected = user.enrollmentStatus === 'rejected' || user.enrollmentStatus === 'cancelled'

  function Row({ label, value }: { label: string; value?: string | null }) {
    if (!value) return null
    return (
      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'rgba(255,255,255,0.3)' }}>{label}</span>
        <span className="text-sm" style={{ color: 'rgba(255,255,255,0.85)' }}>{value}</span>
      </div>
    )
  }

  function Section({ icon: Icon, title, children }: { icon: React.ComponentType<{ size?: number; style?: React.CSSProperties; className?: string }>; title: string; children: React.ReactNode }) {
    return (
      <div className="rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
        <div className="mb-3 flex items-center gap-2">
          <Icon size={13} style={{ color: 'rgba(255,255,255,0.4)' }} />
          <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.4)' }}>{title}</span>
        </div>
        <div className="grid grid-cols-2 gap-3">{children}</div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="absolute inset-0"
        style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }}
        onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
        className="relative flex w-full max-w-2xl flex-col rounded-2xl overflow-hidden"
        style={{ background: 'linear-gradient(145deg,#0e1022,#0a0c18)', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 40px 80px rgba(0,0,0,0.85)', zIndex: 1, maxHeight: '90vh' }}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 flex-shrink-0" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full"
              style={{ background: 'rgba(0,87,184,0.15)', border: '1px solid rgba(0,87,184,0.3)' }}>
              <span className="text-sm font-bold" style={{ color: '#0057b8' }}>{user.name[0]?.toUpperCase() ?? '?'}</span>
            </div>
            <div>
              <h2 className="text-base font-bold text-white">{user.name}</h2>
              <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>{user.email}</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 transition-colors hover:bg-white/[0.08]" style={{ color: 'rgba(255,255,255,0.5)' }}>
            <X size={15} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {/* Why this student was rejected.

              The reason was already stored and already shown as a truncated
              line in the table, but the panel — the place an admin opens to
              decide whether to re-approve — never said it. Re-approving is
              exactly the moment you want to read why somebody said no. */}
          {isRejected && (
            <div className="rounded-xl p-4"
              style={{ background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.22)' }}>
              <div className="mb-2 flex items-center gap-2">
                <XCircle size={13} style={{ color: '#F87171' }} />
                <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: '#F87171' }}>
                  {user.enrollmentStatus === 'cancelled' ? 'Enrollment cancelled' : 'Request rejected'}
                </span>
              </div>
              <p className="text-sm" style={{ color: 'rgba(255,255,255,0.85)' }}>
                {user.rejectionReason || 'No reason was recorded.'}
              </p>
              {(user.rejectedByName || user.rejectedByEmail || user.rejectedAt) && (
                <p className="mt-2 text-[11px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
                  {(user.rejectedByName || user.rejectedByEmail) && `by ${user.rejectedByName ?? user.rejectedByEmail}`}
                  {user.rejectedAt && ` · ${new Date(user.rejectedAt).toLocaleDateString('en-US', {
                    year: 'numeric', month: 'short', day: 'numeric',
                  })}`}
                </p>
              )}
              {/* Rejection deletes every course enrolment and decrements the
                  course counters. Re-approving restores the account, not the
                  seats — say so before the button is pressed rather than
                  leaving an admin to discover it from a confused student. */}
              <p className="mt-3 text-[11px]" style={{ color: 'rgba(255,255,255,0.45)' }}>
                Re-approving restores access to the portal. Course enrollments were
                removed when the student was rejected and are not restored — they
                need to be assigned again.
              </p>
            </div>
          )}

          {!app ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center" style={{ color: 'rgba(255,255,255,0.3)' }}>
              <FileText size={28} className="opacity-40" />
              <p className="text-sm">No enrollment form data submitted</p>
              <p className="text-xs" style={{ color: 'rgba(255,255,255,0.2)' }}>This account was created before the enrollment form was introduced.</p>
            </div>
          ) : (
            <>
              <Section icon={User} title="Personal Information">
                <Row label="Phone / WhatsApp" value={app.phone} />
                <Row label="Emergency Contact" value={app.emergencyContact} />
                <Row label="Gender" value={app.gender} />
                <Row label="Date of Birth" value={app.dateOfBirth} />
                <Row label="Nationality" value={app.nationality} />
                <Row label="Home Country" value={app.homeCountry} />
                <Row label="Occupation" value={app.occupation} />
                {(app.idType || app.idNumber) ? (
                  <>
                    <Row label="ID Type"   value={app.idType} />
                    <Row label="ID Number" value={app.idNumber} />
                  </>
                ) : (
                  <Row label="Emirates ID" value={app.emiratesId} />
                )}
              </Section>

              <Section icon={MapPin} title="Address">
                <Row label="Country of Attendance" value={app.countryAttendance} />
                <Row label="Villa / Apartment" value={app.villa} />
                <Row label="City" value={app.city} />
                <Row label="Country" value={app.addressCountry} />
              </Section>

              <Section icon={BookOpen} title="Program Preferences">
                <Row label="Experience Level" value={app.experienceLevel} />
                <Row label="Preferred Start Date" value={app.preferredStartDate} />
                <Row label="How Did You Hear" value={app.hearAboutUs} />
                {app.referralName && <Row label="Referral Name" value={app.referralName} />}
                {app.programs && app.programs.length > 0 && (
                  <div className="col-span-2 flex flex-col gap-0.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'rgba(255,255,255,0.3)' }}>Selected Programs</span>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {app.programs.map(p => (
                        <span key={p} className="rounded-lg px-2.5 py-1 text-xs font-medium"
                          style={{ background: 'rgba(0,87,184,0.12)', color: '#0057b8', border: '1px solid rgba(0,87,184,0.25)' }}>
                          {programLabel(p)}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </Section>

              <Section icon={CreditCard} title="Payment">
                <Row label="Payment Method" value={app.paymentMethod} />
              </Section>

              {/* Documents — always shown */}
              <DocumentsSection passportUrl={app.passportUrl} idDocUrl={app.idDocUrl} photoUrl={app.photoUrl} userId={user.id} idType={app.idType} />
            </>
          )}
        </div>

        {/* Footer actions */}
        {(isPending || isRejected) && (
          <div className="flex items-center justify-end gap-2 px-6 py-4 flex-shrink-0" style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
            {isPending && (
              <>
                <button onClick={onReject} disabled={rejectLoading}
                  className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white transition-all hover:opacity-90 disabled:opacity-40"
                  style={{ background: 'rgba(239,68,68,0.85)' }}>
                  {rejectLoading && <Spinner size={13} />}
                  <XCircle size={13} />Reject
                </button>
                <button onClick={onApprove} disabled={approveLoading}
                  className="flex items-center gap-1.5 rounded-xl px-5 py-2 text-sm font-semibold text-white transition-all hover:opacity-90 disabled:opacity-40"
                  style={{ background: 'linear-gradient(135deg,#4ADE80,#22c55e)', boxShadow: '0 4px 14px rgba(74,222,128,0.3)' }}>
                  {approveLoading && <Spinner size={13} />}
                  <CheckCircle2 size={13} />Approve
                </button>
              </>
            )}
            {isRejected && (
              <button onClick={onApprove} disabled={approveLoading}
                className="flex items-center gap-1.5 rounded-xl px-5 py-2 text-sm font-semibold text-white transition-all hover:opacity-90 disabled:opacity-40"
                style={{ background: 'linear-gradient(135deg,#4ADE80,#22c55e)', boxShadow: '0 4px 14px rgba(74,222,128,0.3)' }}>
                {approveLoading && <Spinner size={13} />}
                <CheckCircle2 size={13} />Re-approve
              </button>
            )}
          </div>
        )}
        {isApproved && (
          <div className="flex items-center justify-between px-6 py-3 flex-shrink-0" style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
            <span className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: '#4ADE80' }}>
              <CheckCircle2 size={13} />Student is approved
            </span>
            <button onClick={onReject} disabled={rejectLoading}
              className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold text-white transition-all hover:opacity-90 disabled:opacity-40"
              style={{ background: 'rgba(239,68,68,0.85)' }}>
              {rejectLoading && <Spinner size={12} />}
              <XCircle size={11} />Reject Student
            </button>
          </div>
        )}
      </motion.div>
    </div>
  )
}

/* ── Delete confirmation inline ────────────────────── */
function DeleteConfirm({ onConfirm, onCancel, loading }: {
  onConfirm: () => void
  onCancel:  () => void
  loading:   boolean
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px]" style={{ color: 'rgba(248,113,113,0.8)' }}>Delete?</span>
      <button
        onClick={onConfirm}
        disabled={loading}
        className="flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-semibold transition-all disabled:opacity-50"
        style={{ background: 'rgba(239,68,68,0.15)', color: '#F87171', border: '1px solid rgba(239,68,68,0.3)' }}>
        {loading ? <Spinner size={8} /> : 'Yes'}
      </button>
      <button
        onClick={onCancel}
        className="rounded-lg px-2 py-1 text-[10px] font-medium transition-all"
        style={{ color: 'rgba(255,255,255,0.4)', border: '1px solid rgba(255,255,255,0.1)' }}>
        No
      </button>
    </div>
  )
}

/* ── Main page ─────────────────────────────────────── */
export default function EnrollmentRequestsPage() {
  const { data: me } = useCurrentUser()
  const toast        = useToast()

  const [statusFilter,   setStatusFilter]   = useState<EnrollmentRequestStatus | 'all'>('pending')
  const [search,         setSearch]         = useState('')
  const [approveTarget,  setApproveTarget]  = useState<EnrollmentRequest | null>(null)
  const [rejectTarget,   setRejectTarget]   = useState<EnrollmentRequest | null>(null)
  const [removingCat,    setRemovingCat]    = useState<{ userId: string; cat: ProgramCategory } | null>(null)
  const [detailTarget,   setDetailTarget]   = useState<EnrollmentRequest | null>(null)
  const [deleteTarget,   setDeleteTarget]   = useState<string | null>(null)
  const [blockFilter,    setBlockFilter]    = useState<'all' | 'blocked' | 'unblocked'>('all')
  const [accountType,    setAccountType]    = useState<'full' | 'express'>('full')
  const [expressDelete,  setExpressDelete]  = useState<ExpressMember | null>(null)

  const approve         = useApproveEnrollment()
  const reject          = useRejectEnrollment()
  const revokeToViewer  = useRevokeToViewer()
  const removeCategory  = useRemoveEnrollmentCategory()
  const toggleBlock     = useToggleBlock()
  const deleteUser      = useDeleteUser()

  // Scope lives on `program` for every scoped admin now — one source, shared.
  const scopeCategory: ProgramCategory | null = categoryScopeOf(me) ?? null

  // Full admins (admin/super_admin) have no scope restriction
  const isFullAdmin = me?.role === 'super_admin' || me?.role === 'admin'

  // super_admin/admin: always yes
  // category admin: only if student has exactly 1 category matching their scope
  // (multi-category students are protected — remove other categories first)
  const canRevokeStudent = (displayCats: ProgramCategory[]) =>
    isFullAdmin || (!!scopeCategory && displayCats.length === 1 && displayCats[0] === scopeCategory)

  const { data, isLoading } = useEnrollmentRequests(statusFilter)

  // Dashboard stat counts for Full Registration
  const { data: pendingCountData  } = useEnrollmentRequests('pending')
  const { data: approvedCountData } = useEnrollmentRequests('approved')
  const { data: rejectedCountData } = useEnrollmentRequests('rejected')
  const { data: allCountData      } = useEnrollmentRequests('all')

  // Express members — only fetched when that tab is active (avoids stale-cache misses)
  const expressStatus = blockFilter === 'blocked' ? 'blocked' : blockFilter === 'unblocked' ? 'active' : 'all'
  const { data: expressData, isLoading: expressLoading } = useExpressMembers(
    expressStatus, search, 1, 200, accountType === 'express',
  )
  const expressMembers = expressData?.data ?? []
  const { data: expressStats } = useExpressMembersStats(accountType === 'express')
  const { data: expressTotalCount = 0 } = useExpressMembersCount()
  const toggleExpressMember = useToggleExpressMember()
  const deleteExpressMember = useDeleteExpressMember()

  const handleToggleExpress = async (m: ExpressMember) => {
    try {
      await toggleExpressMember.mutateAsync(m.id)
      toast.success(m.isActive ? `${m.name} blocked` : `${m.name} unblocked`, '')
    } catch (err: any) {
      toast.error('Action failed', err?.response?.data?.error?.message)
    }
  }

  const handleDeleteExpress = async () => {
    if (!expressDelete) return
    try {
      await deleteExpressMember.mutateAsync(expressDelete.id)
      toast.success('Member deleted', `${expressDelete.name}'s account has been removed.`)
      setExpressDelete(null)
    } catch (err: any) {
      toast.error('Delete failed', err?.response?.data?.error?.message)
    }
  }

  /* What the server holds for this status, against what it actually sent.
     The search below filters only what was sent, so if these ever differ the
     admin must be told - otherwise a search for someone past the cut reads
     as "this person never signed up". */
  const loadedCount = (data?.data ?? []).length
  const serverCount = data?.meta?.total_count ?? loadedCount
  const truncated   = serverCount > loadedCount

  const requests = (data?.data ?? []).filter(r => {
    if (search) {
      const q = search.toLowerCase()
      if (!r.name.toLowerCase().includes(q) && !r.email.toLowerCase().includes(q)) return false
    }
    if ((statusFilter === 'pending' || statusFilter === 'rejected') && blockFilter !== 'all') {
      if (blockFilter === 'blocked'   &&  r.isActive) return false
      if (blockFilter === 'unblocked' && !r.isActive) return false
    }
    return true
  })

  const handleApprove = async (cats: ProgramCategory[]) => {
    if (!approveTarget) return
    try {
      await approve.mutateAsync({ userId: approveTarget.id, categories: cats })
      toast.success(`${approveTarget.name} approved`, `Assigned to: ${cats.map(c => CATEGORY_META[c].label).join(', ')}`)
      setApproveTarget(null)
    } catch (err: any) {
      toast.error('Approval failed', err?.response?.data?.error?.message)
    }
  }

  const handleReject = async (reason: string) => {
    if (!rejectTarget) return
    try {
      await reject.mutateAsync({ userId: rejectTarget.id, reason })
      toast.success(
        rejectTarget.enrollmentStatus === 'approved' ? 'Student rejected' : 'Request rejected',
        rejectTarget.enrollmentStatus === 'approved'
          ? `${rejectTarget.name} removed from all programs and courses.`
          : `${rejectTarget.name} has been notified.`,
      )
      setRejectTarget(null)
    } catch (err: any) {
      toast.error('Action failed', err?.response?.data?.error?.message)
    }
  }

  const handleToggleBlock = async (r: EnrollmentRequest) => {
    try {
      await toggleBlock.mutateAsync({ userId: r.id, isActive: !r.isActive })
      toast.success(
        r.isActive ? `${r.name} blocked` : `${r.name} unblocked`,
        r.isActive ? 'User can no longer log in.' : 'User can now log in again.',
      )
    } catch (err: any) {
      toast.error('Action failed', err?.response?.data?.error?.message)
    }
  }

  const handleRevokeToViewer = async (r: EnrollmentRequest) => {
    try {
      await revokeToViewer.mutateAsync({ userId: r.id })
      toast.success('Reverted to viewer', `${r.name} is now in viewer mode and pending re-approval.`)
    } catch (err: any) {
      toast.error('Action failed', err?.response?.data?.error?.message)
    }
  }

  const handleDelete = async (userId: string) => {
    try {
      await deleteUser.mutateAsync(userId)
      toast.success('User deleted', 'The account has been permanently removed.')
      setDeleteTarget(null)
    } catch (err: any) {
      toast.error('Delete failed', err?.response?.data?.error?.message)
    }
  }

  const handleAddCategory = async (r: EnrollmentRequest, cat: ProgramCategory) => {
    try {
      await approve.mutateAsync({ userId: r.id, categories: [cat] })
      toast.success(`Added to ${CATEGORY_META[cat].label}`, `${r.name} now has access to this program.`)
    } catch (err: any) {
      toast.error('Failed to add program', err?.response?.data?.error?.message)
    }
  }

  const handleRemoveCategory = async (r: EnrollmentRequest, cat: ProgramCategory) => {
    setRemovingCat({ userId: r.id, cat })
    try {
      const result = await removeCategory.mutateAsync({ userId: r.id, category: cat })
      if (result.enrollmentStatus === 'rejected') {
        toast.success('Category removed', `${r.name} had no remaining programs and has been moved to rejected.`)
      } else {
        toast.success(`Removed from ${CATEGORY_META[cat].label}`, `${r.name} still has access to other programs.`)
      }
    } catch (err: any) {
      toast.error('Remove failed', err?.response?.data?.error?.message)
    } finally {
      setRemovingCat(null)
    }
  }

  // Can current admin remove a specific category from a student?
  const canRemoveCategory = (cat: ProgramCategory): boolean => {
    if (isFullAdmin) return true
    if (scopeCategory) return cat === scopeCategory
    return false
  }

  const STATUS_TABS: { value: EnrollmentRequestStatus | 'all'; label: string; color: string }[] = [
    { value: 'pending',  label: 'Pending',  color: '#FBBF24' },
    { value: 'approved', label: 'Approved', color: '#4ADE80' },
    { value: 'rejected', label: 'Rejected', color: '#F87171' },
    { value: 'all',      label: 'All',      color: 'rgba(255,255,255,0.4)' },
  ]

  const pendingCount = pendingCountData?.meta?.total_count ?? 0

  // Stat values
  const fullStats = {
    pending:  pendingCountData?.meta?.total_count  ?? 0,
    approved: approvedCountData?.meta?.total_count ?? 0,
    rejected: rejectedCountData?.meta?.total_count ?? 0,
    total:    allCountData?.meta?.total_count      ?? 0,
  }

  return (
    <div className="space-y-6">
      {/* Header row — title on left, account-type switcher on right */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white" style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}>
            Student Requests
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>
            {scopeCategory
              ? `Review student signup requests — your approvals assign them to ${CATEGORY_META[scopeCategory].label}.`
              : 'Review and approve student signup requests across all programs.'}
          </p>
        </div>

        {/* Account-type switcher — TOP RIGHT */}
        <div className="flex overflow-hidden rounded-xl flex-shrink-0" style={{ border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.03)' }}>
          <button
            onClick={() => { setAccountType('full'); setBlockFilter('all') }}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium transition-all"
            style={{
              color:      accountType === 'full' ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.35)',
              background: accountType === 'full' ? 'rgba(255,255,255,0.09)' : 'transparent',
              borderRight: '1px solid rgba(255,255,255,0.07)',
            }}
          >
            Full Registration
            {pendingCount > 0 && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold text-white"
                style={{ background: '#F59E0B' }}>
                {pendingCount > 99 ? '99+' : pendingCount}
              </span>
            )}
          </button>
          <button
            onClick={() => { setAccountType('express'); setBlockFilter('all') }}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium transition-all"
            style={{
              color:      accountType === 'express' ? '#A78BFA' : 'rgba(255,255,255,0.35)',
              background: accountType === 'express' ? 'rgba(139,92,246,0.12)' : 'transparent',
            }}
          >
            <Zap size={12} />Express Account
            {expressTotalCount > 0 && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold text-white"
                style={{ background: '#7C3AED' }}>
                {expressTotalCount > 99 ? '99+' : expressTotalCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* ── Dashboard stat cards ── */}
      {accountType === 'full' && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Pending',  value: fullStats.pending,  icon: Clock,         color: '#FBBF24', bg: 'rgba(251,191,36,0.10)',  border: 'rgba(251,191,36,0.18)' },
            { label: 'Approved', value: fullStats.approved, icon: CheckCircle2,  color: '#4ADE80', bg: 'rgba(74,222,128,0.10)',  border: 'rgba(74,222,128,0.18)' },
            { label: 'Rejected', value: fullStats.rejected, icon: XCircle,       color: '#F87171', bg: 'rgba(248,113,113,0.10)', border: 'rgba(248,113,113,0.18)' },
            { label: 'Total',    value: fullStats.total,    icon: LayoutGrid,    color: 'rgba(255,255,255,0.6)', bg: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.1)' },
          ].map(s => {
            const Icon = s.icon
            return (
              <motion.div
                key={s.label}
                initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                className="rounded-2xl p-4"
                style={{ background: s.bg, border: `1px solid ${s.border}` }}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: s.color }}>{s.label}</span>
                  <Icon size={14} style={{ color: s.color, opacity: 0.7 }} />
                </div>
                <p className="text-2xl font-bold text-white tabular-nums">{s.value}</p>
              </motion.div>
            )
          })}
        </div>
      )}

      {accountType === 'express' && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Total',   value: expressStats?.total   ?? 0, icon: Users,      color: '#A78BFA', bg: 'rgba(139,92,246,0.10)', border: 'rgba(139,92,246,0.18)' },
            { label: 'Active',  value: expressStats?.active  ?? 0, icon: ShieldCheck, color: '#4ADE80', bg: 'rgba(74,222,128,0.10)',  border: 'rgba(74,222,128,0.18)' },
            { label: 'Blocked', value: expressStats?.blocked ?? 0, icon: ShieldOff,   color: '#F87171', bg: 'rgba(248,113,113,0.10)', border: 'rgba(248,113,113,0.18)' },
          ].map(s => {
            const Icon = s.icon
            return (
              <motion.div
                key={s.label}
                initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                className="rounded-2xl p-4"
                style={{ background: s.bg, border: `1px solid ${s.border}` }}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: s.color }}>{s.label}</span>
                  <Icon size={14} style={{ color: s.color, opacity: 0.7 }} />
                </div>
                <p className="text-2xl font-bold text-white tabular-nums">{s.value}</p>
              </motion.div>
            )
          })}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Status tabs — only for full-registration view */}
        {accountType === 'full' && (
          <div className="flex overflow-hidden rounded-xl" style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)' }}>
            {STATUS_TABS.map(t => (
              <button
                key={t.value}
                onClick={() => { setStatusFilter(t.value); setBlockFilter('all') }}
                className="relative px-4 py-2 text-sm font-medium transition-all"
                style={{
                  color:      statusFilter === t.value ? t.color : 'rgba(255,255,255,0.45)',
                  background: statusFilter === t.value ? `${t.color}18` : 'transparent',
                  borderRight: '1px solid rgba(255,255,255,0.06)',
                }}
              >
                {t.label}
                {t.value === 'pending' && statusFilter !== 'pending' && pendingCount > 0 && (
                  <span className="ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold"
                    style={{ background: 'rgba(251,191,36,0.2)', color: '#FBBF24' }}>
                    {pendingCount}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Block filter — shown for pending/rejected (full) or always for express */}
        {(accountType === 'express' || statusFilter === 'pending' || statusFilter === 'rejected') && (
          <div className="flex overflow-hidden rounded-xl" style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)' }}>
            {(['all', 'unblocked', 'blocked'] as const).map(f => (
              <button
                key={f}
                onClick={() => setBlockFilter(f)}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-all"
                style={{
                  color:      blockFilter === f
                    ? f === 'blocked' ? '#F87171' : f === 'unblocked' ? '#4ADE80' : 'rgba(255,255,255,0.7)'
                    : 'rgba(255,255,255,0.35)',
                  background: blockFilter === f
                    ? f === 'blocked' ? 'rgba(248,113,113,0.12)' : f === 'unblocked' ? 'rgba(74,222,128,0.12)' : 'rgba(255,255,255,0.06)'
                    : 'transparent',
                  borderRight: '1px solid rgba(255,255,255,0.06)',
                }}
              >
                {f === 'blocked'   && <ShieldOff size={10} />}
                {f === 'unblocked' && <ShieldCheck size={10} />}
                {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        )}

        <div className="relative flex-1" style={{ minWidth: 180, maxWidth: 320 }}>
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            style={{ color: 'rgba(255,255,255,0.3)' }} />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or email…"
            className="w-full rounded-xl py-2 pl-9 pr-4 text-sm text-white outline-none transition-all placeholder:text-white/25"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
          />
        </div>
      </div>

      {/* ── Express Account delete confirm dialog ── */}
      <AnimatePresence>
        {expressDelete && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
          >
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setExpressDelete(null)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-sm rounded-2xl p-6 text-center"
              style={{ background: '#131525', border: '1px solid rgba(255,255,255,0.1)' }}
            >
              <AlertTriangle size={28} className="mx-auto mb-3" style={{ color: '#F87171' }} />
              <p className="text-base font-semibold text-white mb-1">Delete member?</p>
              <p className="text-xs mb-5" style={{ color: 'rgba(255,255,255,0.45)' }}>
                <span className="font-medium text-white">{expressDelete.name}</span>&apos;s account will be permanently removed.
              </p>
              <div className="flex gap-2">
                <button onClick={() => setExpressDelete(null)}
                  className="flex-1 rounded-xl py-2 text-sm font-medium transition-all"
                  style={{ border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.6)' }}>
                  Cancel
                </button>
                <button onClick={handleDeleteExpress} disabled={deleteExpressMember.isPending}
                  className="flex-1 rounded-xl py-2 text-sm font-semibold text-white transition-all disabled:opacity-40"
                  style={{ background: 'rgba(239,68,68,0.85)' }}>
                  {deleteExpressMember.isPending ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Table */}
      <div className="overflow-hidden rounded-2xl" style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
        <div className="overflow-x-auto">

          {/* ── Express Account table ── */}
          {accountType === 'express' && (
            <table className="w-full min-w-[600px] border-collapse">
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                  {['Member', 'Country of Residence', 'Signed up', 'Status', ''].map(h => (
                    <th key={h} className="px-4 py-3 text-left"
                      style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {expressLoading && (
                  <tr><td colSpan={5} className="px-4 py-14 text-center">
                    <div className="inline-flex items-center gap-2 text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>
                      <Spinner size={14} />Loading express members…
                    </div>
                  </td></tr>
                )}
                {!expressLoading && expressMembers.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-16 text-center">
                    <div style={{ color: 'rgba(255,255,255,0.3)' }}>
                      <Zap size={28} className="mx-auto mb-3 opacity-40" />
                      <p className="text-sm font-medium">No express account members</p>
                    </div>
                  </td></tr>
                )}
                {!expressLoading && expressMembers.map((m, i) => (
                  <motion.tr
                    key={m.id}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.025 }}
                    style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
                    className="group transition-colors hover:bg-white/[0.02]"
                  >
                    {/* Member */}
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full"
                          style={{ background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.25)' }}>
                          <span className="text-xs font-bold" style={{ color: '#A78BFA' }}>
                            {m.name[0]?.toUpperCase() ?? '?'}
                          </span>
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-white" style={{ maxWidth: 180 }}>{m.name}</p>
                          <p className="truncate text-xs" style={{ color: 'rgba(255,255,255,0.4)', maxWidth: 200 }}>{m.email}</p>
                        </div>
                      </div>
                    </td>
                    {/* Country */}
                    <td className="px-4 py-3.5">
                      {m.country ? (
                        <div className="flex items-center gap-1.5 text-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>
                          <Globe size={11} style={{ color: 'rgba(255,255,255,0.3)' }} />{m.country}
                        </div>
                      ) : (
                        <span className="text-xs" style={{ color: 'rgba(255,255,255,0.2)' }}>—</span>
                      )}
                    </td>
                    {/* Signed up */}
                    <td className="px-4 py-3.5">
                      <span className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
                        {new Date(m.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                    </td>
                    {/* Status */}
                    <td className="px-4 py-3.5">
                      {m.isActive ? (
                        <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
                          style={{ background: 'rgba(74,222,128,0.12)', color: '#4ADE80' }}>
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
                          style={{ background: 'rgba(248,113,113,0.12)', color: '#F87171' }}>
                          <ShieldOff size={10} />Blocked
                        </span>
                      )}
                    </td>
                    {/* Actions */}
                    <td className="px-4 py-3.5" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                          onClick={() => handleToggleExpress(m)}
                          disabled={toggleExpressMember.isPending}
                          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all disabled:opacity-40"
                          style={m.isActive
                            ? { color: '#F87171', border: '1px solid rgba(248,113,113,0.3)' }
                            : { color: '#4ADE80', border: '1px solid rgba(74,222,128,0.3)' }}>
                          {m.isActive ? <ShieldOff size={10} /> : <ShieldCheck size={10} />}
                          {m.isActive ? 'Block' : 'Unblock'}
                        </button>
                        {isFullAdmin && (
                          <button
                            onClick={() => setExpressDelete(m)}
                            className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-all"
                            style={{ color: 'rgba(239,68,68,0.6)', border: '1px solid rgba(239,68,68,0.2)' }}
                            title="Delete this account">
                            <Trash2 size={10} />
                          </button>
                        )}
                      </div>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          )}

          {/* ── Full Registration table ── */}
          {accountType === 'full' && (
          <table className="w-full min-w-[700px] border-collapse">
            <thead>
              <tr style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                {['Student', 'Country of Residence', 'Programs', statusFilter === 'approved' ? 'Approved by' : statusFilter === 'rejected' ? 'Rejected by' : 'Status', 'Signed up', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-left"
                    style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={6} className="px-4 py-14 text-center">
                  <div className="inline-flex items-center gap-2 text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>
                    <Spinner size={14} />Loading requests…
                  </div>
                </td></tr>
              )}
              {/* "None" must never be said on a partial list. The search filters
                  only the rows that were sent, so on a truncated list an empty
                  result means "not in the part we loaded", which is a different
                  sentence entirely - and the dangerous one, because it reads as
                  "this student never applied". */}
              {!isLoading && requests.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-16 text-center">
                  <div style={{ color: 'rgba(255,255,255,0.3)' }}>
                    <CheckCircle2 size={28} className="mx-auto mb-3 opacity-40" />
                    <p className="text-sm font-medium">
                      {truncated
                        ? `Not in the first ${loadedCount} of ${serverCount} ${statusFilter} requests`
                        : statusFilter === 'pending' ? 'No pending requests' : `No ${statusFilter} requests`}
                    </p>
                    {truncated && (
                      <p className="mt-1.5 text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
                        Narrow by programme to bring the rest into range.
                      </p>
                    )}
                  </div>
                </td></tr>
              )}
              {!isLoading && truncated && requests.length > 0 && (
                <tr><td colSpan={6} className="px-4 py-2.5 text-center text-xs"
                  style={{ color: '#FBBF24', background: 'rgba(250,204,21,0.06)', borderBottom: '1px solid rgba(250,204,21,0.15)' }}>
                    Showing {loadedCount} of {serverCount}. Search only looks at these {loadedCount} - narrow by programme to reach the rest.
                </td></tr>
              )}
              {!isLoading && requests.map((r, i) => {
                const isPending  = r.enrollmentStatus === 'pending'
                const isApproved = r.enrollmentStatus === 'approved'
                const isRejected = r.enrollmentStatus === 'rejected' || r.enrollmentStatus === 'cancelled'
                const date       = new Date(r.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                const displayCats: ProgramCategory[] = r.categories?.length
                  ? r.categories
                  : r.category ? [r.category] : []

                // For approved rows: can this admin add their scope category to this student?
                const canAddOwn = isApproved && scopeCategory && !displayCats.includes(scopeCategory)
                // Can this admin add any category (admin/super_admin) to this student?
                const canAddAny = isApproved && isFullAdmin && displayCats.length < ALL_CATEGORIES.length

                return (
                  <motion.tr
                    key={r.id}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.03 }}
                    style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', cursor: 'pointer' }}
                    className="group transition-colors hover:bg-white/[0.02]"
                    onClick={() => setDetailTarget(r)}
                  >
                    {/* Student */}
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full"
                          style={{ background: 'rgba(0,87,184,0.15)', border: '1px solid rgba(0,87,184,0.25)' }}>
                          <span className="text-xs font-bold" style={{ color: '#0057b8' }}>
                            {r.name[0]?.toUpperCase() ?? '?'}
                          </span>
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-white" style={{ maxWidth: 180 }}>{r.name}</p>
                          <p className="truncate text-xs" style={{ color: 'rgba(255,255,255,0.4)', maxWidth: 200 }}>{r.email}</p>
                        </div>
                      </div>
                    </td>

                    {/* Country of Residence */}
                    <td className="px-4 py-3.5">
                      {r.enrollmentApplication?.homeCountry ? (
                        <div className="flex items-center gap-1.5 text-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>
                          <Globe size={11} style={{ color: 'rgba(255,255,255,0.3)' }} />
                          {r.enrollmentApplication.homeCountry}
                        </div>
                      ) : (
                        <span className="text-xs" style={{ color: 'rgba(255,255,255,0.2)' }}>—</span>
                      )}
                    </td>

                    {/* Programs */}
                    <td className="px-4 py-3.5">
                      {displayCats.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {displayCats.map(c => (
                            isApproved
                              ? <RemovableCategoryBadge
                                  key={c}
                                  cat={c}
                                  canRemove={canRemoveCategory(c)}
                                  removing={removingCat?.userId === r.id && removingCat?.cat === c}
                                  onRemove={() => handleRemoveCategory(r, c)}
                                />
                              : <CategoryBadge key={c} cat={c} />
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs" style={{ color: 'rgba(255,255,255,0.25)' }}>Not assigned</span>
                      )}
                    </td>

                    {/* Status / Metadata */}
                    <td className="px-4 py-3.5">
                      {isPending && (
                        <div className="flex flex-col gap-1">
                          <span className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold"
                            style={{ background: 'rgba(251,191,36,0.14)', color: '#FBBF24' }}>
                            <Clock size={11} />Pending
                          </span>
                          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
                            style={{ background: 'rgba(99,102,241,0.12)', color: '#818CF8' }}>
                            <Eye size={9} />Viewer mode
                          </span>
                          {!r.isActive && (
                            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
                              style={{ background: 'rgba(239,68,68,0.10)', color: '#F87171' }}>
                              <ShieldOff size={9} />Blocked
                            </span>
                          )}
                        </div>
                      )}
                      {isApproved && r.approvedByEmail && (
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-1 text-[11px]" style={{ color: '#4ADE80' }}>
                            <ShieldCheck size={11} />
                            <span className="font-semibold">{r.approvedByName ?? r.approvedByEmail}</span>
                          </div>
                          <div className="flex items-center gap-1 text-[10px]" style={{ color: 'rgba(255,255,255,0.35)' }}>
                            <Mail size={9} />{r.approvedByEmail}
                          </div>
                          {r.approvedByRole && (
                            <div className="text-[10px]" style={{ color: 'rgba(255,255,255,0.25)' }}>
                              {ROLE_LABEL[r.approvedByRole] ?? r.approvedByRole}
                              {r.approvedAt && ` · ${new Date(r.approvedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
                            </div>
                          )}
                        </div>
                      )}
                      {isApproved && !r.approvedByEmail && (
                        <span className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold"
                          style={{ background: 'rgba(74,222,128,0.14)', color: '#4ADE80' }}>
                          <CheckCircle2 size={11} />Approved
                        </span>
                      )}
                      {isApproved && !r.isActive && (
                        <div className="mt-1">
                          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
                            style={{ background: 'rgba(239,68,68,0.10)', color: '#F87171' }}>
                            <ShieldOff size={9} />Blocked
                          </span>
                        </div>
                      )}
                      {isRejected && (
                        <div className="space-y-0.5">
                          <span className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold"
                            style={{ background: 'rgba(248,113,113,0.14)', color: '#F87171' }}>
                            <XCircle size={11} />Rejected
                          </span>
                          {r.rejectionReason && (
                            <p className="max-w-[200px] truncate text-[10px]"
                              title={r.rejectionReason}
                              style={{ color: 'rgba(255,255,255,0.35)' }}>
                              {r.rejectionReason}
                            </p>
                          )}
                          {(r.rejectedByName || r.rejectedByEmail) && (
                            <div className="text-[10px]" style={{ color: 'rgba(255,255,255,0.25)' }}>
                              by {r.rejectedByName ?? r.rejectedByEmail}
                              {r.rejectedAt && ` · ${new Date(r.rejectedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
                            </div>
                          )}
                        </div>
                      )}
                    </td>

                    {/* Signed up */}
                    <td className="px-4 py-3.5">
                      <span className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>{date}</span>
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3.5" onClick={e => e.stopPropagation()}>
                      {isPending && (
                        <div className="flex items-center justify-end gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                          {deleteTarget === r.id ? (
                            <DeleteConfirm
                              loading={deleteUser.isPending}
                              onConfirm={() => handleDelete(r.id)}
                              onCancel={() => setDeleteTarget(null)}
                            />
                          ) : (
                            <>
                              <button
                                onClick={() => setApproveTarget(r)}
                                className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-white transition-all hover:opacity-90"
                                style={{ background: 'rgba(74,222,128,0.85)' }}>
                                <CheckCircle2 size={11} />Approve
                              </button>
                              <button
                                onClick={() => setRejectTarget(r)}
                                className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-white transition-all hover:opacity-90"
                                style={{ background: 'rgba(239,68,68,0.85)' }}>
                                <XCircle size={11} />Reject
                              </button>
                              <button
                                onClick={() => handleToggleBlock(r)}
                                disabled={toggleBlock.isPending}
                                className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all disabled:opacity-40"
                                style={r.isActive
                                  ? { color: '#F87171', border: '1px solid rgba(248,113,113,0.3)' }
                                  : { color: '#4ADE80', border: '1px solid rgba(74,222,128,0.3)' }}>
                                {toggleBlock.isPending
                                  ? <Spinner size={10} />
                                  : r.isActive ? <ShieldOff size={10} /> : <ShieldCheck size={10} />}
                                {r.isActive ? 'Block' : 'Unblock'}
                              </button>
                              {isFullAdmin && (
                                <button
                                  onClick={() => setDeleteTarget(r.id)}
                                  className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-all"
                                  style={{ color: 'rgba(239,68,68,0.6)', border: '1px solid rgba(239,68,68,0.2)' }}
                                  title="Permanently delete this account">
                                  <Trash2 size={10} />
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      )}

                      {isApproved && (
                        <div className="flex items-center justify-end gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                          {/* Category admin: add their program to this student if not already present */}
                          {canAddOwn && (
                            <button
                              onClick={() => handleAddCategory(r, scopeCategory!)}
                              disabled={approve.isPending}
                              className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-all hover:opacity-80 disabled:opacity-40"
                              style={{
                                background: CATEGORY_META[scopeCategory!].bg,
                                color: CATEGORY_META[scopeCategory!].color,
                                border: `1px solid ${CATEGORY_META[scopeCategory!].color}40`,
                              }}>
                              {approve.isPending ? <Spinner size={10} /> : <Plus size={10} />}
                              Add to {CATEGORY_META[scopeCategory!].label}
                            </button>
                          )}

                          {/* Admin/super_admin: dropdown to add any missing category */}
                          {canAddAny && (
                            <AddCategoryDropdown
                              existingCats={displayCats}
                              loading={approve.isPending}
                              onAdd={cat => handleAddCategory(r, cat)}
                            />
                          )}

                          {/* Revoke to viewer — admin/super_admin always; category admin only if student is in exactly their 1 category */}
                          {canRevokeStudent(displayCats) && (
                            <button
                              onClick={() => handleRevokeToViewer(r)}
                              disabled={revokeToViewer.isPending}
                              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all hover:bg-indigo-500/10 disabled:opacity-40"
                              style={{ color: 'rgba(129,140,248,0.9)', border: '1px solid rgba(129,140,248,0.2)' }}>
                              {revokeToViewer.isPending ? <Spinner size={10} /> : <RotateCcw size={10} />}
                              Revoke to Viewer
                            </button>
                          )}
                          {/* Reject approved student — removes all programs and course enrollments */}
                          <button
                            onClick={() => setRejectTarget(r)}
                            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-all hover:opacity-90"
                            style={{ background: 'rgba(239,68,68,0.85)' }}>
                            <XCircle size={11} />Reject
                          </button>
                        </div>
                      )}

                      {isRejected && (
                        <div className="flex items-center justify-end gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                          {deleteTarget === r.id ? (
                            <DeleteConfirm
                              loading={deleteUser.isPending}
                              onConfirm={() => handleDelete(r.id)}
                              onCancel={() => setDeleteTarget(null)}
                            />
                          ) : (
                            <>
                              <button
                                onClick={() => setApproveTarget(r)}
                                className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-white transition-all hover:opacity-90"
                                style={{ background: 'rgba(74,222,128,0.85)' }}>
                                <CheckCircle2 size={11} />Re-approve
                              </button>
                              <button
                                onClick={() => handleToggleBlock(r)}
                                disabled={toggleBlock.isPending}
                                className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all disabled:opacity-40"
                                style={r.isActive
                                  ? { color: '#F87171', border: '1px solid rgba(248,113,113,0.3)' }
                                  : { color: '#4ADE80', border: '1px solid rgba(74,222,128,0.3)' }}>
                                {toggleBlock.isPending
                                  ? <Spinner size={10} />
                                  : r.isActive ? <ShieldOff size={10} /> : <ShieldCheck size={10} />}
                                {r.isActive ? 'Block' : 'Unblock'}
                              </button>
                              {isFullAdmin && (
                                <button
                                  onClick={() => setDeleteTarget(r.id)}
                                  className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-all"
                                  style={{ color: 'rgba(239,68,68,0.6)', border: '1px solid rgba(239,68,68,0.2)' }}
                                  title="Permanently delete this account">
                                  <Trash2 size={10} />
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </td>
                  </motion.tr>
                )
              })}
            </tbody>
          </table>
          )} {/* end accountType === 'full' */}

        </div>
      </div>

      {/* Approve dialog */}
      <AnimatePresence>
        {approveTarget && (
          <ApproveDialog
            user={approveTarget}
            scopeCategory={scopeCategory}
            onClose={() => setApproveTarget(null)}
            onConfirm={handleApprove}
            loading={approve.isPending}
          />
        )}
      </AnimatePresence>

      {/* Reject / Revoke dialog */}
      <AnimatePresence>
        {rejectTarget && (
          <RejectDialog
            user={rejectTarget}
            isRevoke={rejectTarget.enrollmentStatus === 'approved'}
            onClose={() => setRejectTarget(null)}
            onConfirm={handleReject}
            loading={reject.isPending}
          />
        )}
      </AnimatePresence>

      {/* Application detail modal */}
      <AnimatePresence>
        {detailTarget && (
          <ApplicationDetailModal
            user={detailTarget}
            scopeCategory={scopeCategory}
            onClose={() => setDetailTarget(null)}
            onApprove={() => {
              setApproveTarget(detailTarget)
              setDetailTarget(null)
            }}
            onReject={() => {
              setRejectTarget(detailTarget)
              setDetailTarget(null)
            }}
            approveLoading={approve.isPending}
            rejectLoading={reject.isPending || revokeToViewer.isPending}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
