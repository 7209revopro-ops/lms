'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Eye, Search, Mail, Calendar,
  ShieldOff, ShieldCheck, ChevronLeft, ChevronRight,
  Clock, Phone, MapPin, BookOpen, CreditCard, User, FileText,
  ImageIcon, Trash2, ExternalLink, X, XCircle,
} from 'lucide-react'
import { useUsers, useDeleteUser, type AdminUser } from '@/lib/api/users'
import { useToggleBlock } from '@/lib/api/enrollmentRequests'
import { useCurrentUser } from '@/lib/api/user'
import { useToast } from '@/store/ui.store'
import Spinner from '@/components/ui/Spinner'
import { useDocumentUrl } from '@/lib/api/documents'
import { programLabel } from '@/lib/programs'
import { useBackdropClose } from '@/hooks/useBackdropClose'
import { AvatarImg } from '@/components/ui/AvatarImg'
import { CsTag } from '@/components/ui/CsTag'

function fmtDate(d?: string) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/* ── Inline document card ──────────────────────────── */
function DocCard({ label, url }: { label: string; url?: string }) {
  const [imgError, setImgError] = useState(false)

  if (!url) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-xl p-4 text-center"
        style={{ background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.1)', minHeight: 120 }}>
        <ImageIcon size={22} style={{ color: 'rgba(255,255,255,0.15)' }} />
        <div>
          <p className="text-xs font-medium" style={{ color: 'rgba(255,255,255,0.3)' }}>{label}</p>
          <p className="text-[10px] mt-0.5" style={{ color: 'rgba(255,255,255,0.2)' }}>Not submitted</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'rgba(255,255,255,0.35)' }}>{label}</p>
      <div className="relative overflow-hidden rounded-xl" style={{ border: '1px solid rgba(255,255,255,0.1)' }}>
        {!imgError ? (
          <img
            src={url}
            alt={label}
            className="w-full object-cover"
            style={{ maxHeight: 160 }}
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 py-8"
            style={{ background: 'rgba(255,255,255,0.03)' }}>
            <FileText size={22} style={{ color: 'rgba(255,255,255,0.3)' }} />
            <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>PDF document</p>
          </div>
        )}
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="absolute bottom-2 right-2 flex items-center gap-1 rounded-lg px-2.5 py-1 text-[10px] font-semibold backdrop-blur-sm transition-opacity hover:opacity-90"
          style={{ background: 'rgba(0,0,0,0.6)', color: 'rgba(255,255,255,0.8)', border: '1px solid rgba(255,255,255,0.15)' }}>
          <ExternalLink size={9} />Open
        </a>
      </div>
    </div>
  )
}

/* Identity scans are stored as bare keys and exchanged for a short-lived
   signed link (H-11); DocCard renders whatever comes back. */
function SignedDocCard({ label, userId, field, stored }: {
  label: string; userId: string; field: 'passport' | 'idDoc'; stored?: string
}) {
  const doc = useDocumentUrl(userId, field, stored)
  /* A submitted document whose link failed is not the same as none: say so
     rather than rendering an empty slot that reads as "never sent one". */
  if (doc.state === 'error') {
    return (
      <div>
        <p className="mb-1 text-[9px]" style={{ color: 'rgba(255,255,255,0.3)' }}>{label}</p>
        <span className="flex h-20 w-full items-center justify-center rounded-lg px-2 text-center text-[10px]"
          style={{ border: '1px solid rgba(248,113,113,0.3)', color: '#F87171' }}>
          Submitted — link would not load
        </span>
      </div>
    )
  }
  return <DocCard label={label} url={doc.url} />
}

/* ── Detail modal (read-only) ──────────────────────── */
function ViewerDetailModal({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const backdrop = useBackdropClose(onClose)
  const app = user.enrollmentApplication
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

  function Section({ icon: Icon, title, children }: {
    icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>
    title: string
    children: React.ReactNode
  }) {
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
        {...backdrop} />
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
        className="relative flex w-full max-w-2xl flex-col rounded-2xl overflow-hidden"
        style={{
          background: 'linear-gradient(145deg,#0e1022,#0a0c18)',
          border: '1px solid rgba(255,255,255,0.1)',
          boxShadow: '0 40px 80px rgba(0,0,0,0.85)',
          zIndex: 1,
          maxHeight: '90vh',
        }}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 flex-shrink-0"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-full"
              style={{ background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)' }}>
              <AvatarImg src={user.avatarUrl}
                className="h-full w-full object-cover"
                fallback={<span className="text-sm font-bold" style={{ color: '#818CF8' }}>{user.name[0]?.toUpperCase() ?? '?'}</span>} />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">{user.name}</h2>
              <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>{user.email}</p>
              <CsTag cs={user.tetraCs} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isRejected ? (
              <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold"
                style={{ background: 'rgba(248,113,113,0.12)', color: '#F87171' }}>
                <XCircle size={9} />Rejected
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold"
                style={{ background: 'rgba(251,191,36,0.12)', color: '#FBBF24' }}>
                <Clock size={9} />Pending approval
              </span>
            )}
            <button onClick={onClose}
              className="rounded-lg p-1.5 transition-colors hover:bg-white/[0.08]"
              style={{ color: 'rgba(255,255,255,0.5)' }}>
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Rejection info banner */}
        {isRejected && (user.rejectionReason || user.rejectedByEmail) && (
          <div className="mx-6 mt-4 rounded-xl px-4 py-3 flex-shrink-0"
            style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)' }}>
            <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: '#F87171' }}>Rejection Details</p>
            {user.rejectionReason && (
              <p className="text-sm" style={{ color: 'rgba(255,255,255,0.75)' }}>{user.rejectionReason}</p>
            )}
            {user.rejectedByEmail && (
              <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.35)' }}>
                Rejected by {user.rejectedByName ?? user.rejectedByEmail}
                {user.rejectedAt && ` · ${fmtDate(user.rejectedAt)}`}
              </p>
            )}
          </div>
        )}

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {!app ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center" style={{ color: 'rgba(255,255,255,0.3)' }}>
              <FileText size={28} className="opacity-40" />
              <p className="text-sm">No enrollment form data submitted</p>
              <p className="text-xs" style={{ color: 'rgba(255,255,255,0.2)' }}>
                This account may have been created before the enrollment form was introduced.
              </p>
            </div>
          ) : (
            <>
              <Section icon={User} title="Personal Information">
                <Row label="Phone / WhatsApp"  value={app.phone} />
                <Row label="Emergency Contact" value={app.emergencyContact} />
                <Row label="Gender"            value={app.gender} />
                <Row label="Date of Birth"     value={app.dateOfBirth} />
                <Row label="Nationality"       value={app.nationality} />
                <Row label="Home Country"      value={app.homeCountry} />
                <Row label="Occupation"        value={app.occupation} />
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
                <Row label="Villa / Apartment"     value={app.villa} />
                <Row label="City"                  value={app.city} />
                <Row label="Country"               value={app.addressCountry} />
              </Section>

              <Section icon={BookOpen} title="Program Preferences">
                <Row label="Experience Level"     value={app.experienceLevel} />
                <Row label="Preferred Start Date" value={app.preferredStartDate} />
                <Row label="How Did You Hear"     value={app.hearAboutUs} />
                {app.referralName && <Row label="Referral Name" value={app.referralName} />}
                {app.programs && app.programs.length > 0 && (
                  <div className="col-span-2 flex flex-col gap-0.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'rgba(255,255,255,0.3)' }}>
                      Selected Programs
                    </span>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {app.programs.map(p => (
                        <span key={p} className="rounded-lg px-2.5 py-1 text-xs font-medium"
                          style={{ background: 'rgba(99,102,241,0.12)', color: '#818CF8', border: '1px solid rgba(99,102,241,0.25)' }}>
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

              {/* Documents */}
              <div className="rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                <div className="mb-3 flex items-center gap-2">
                  <FileText size={13} style={{ color: 'rgba(255,255,255,0.4)' }} />
                  <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.4)' }}>
                    Submitted Documents
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <SignedDocCard label="Passport Copy" userId={String(user.id)} field="passport" stored={app.passportUrl} />
                  <SignedDocCard label={app.idType === 'Emirates ID' ? 'Emirates ID Card' : app.idType === 'Aadhaar Card' ? 'Aadhaar Card' : app.idType === 'Other' ? 'ID Document' : 'Passport Copy'} userId={String(user.id)} field="idDoc" stored={app.idDocUrl} />
                  <DocCard label="Profile Photo" url={app.photoUrl} />
                </div>
              </div>
            </>
          )}
        </div>
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

type ViewerTab = 'pending' | 'rejected'

const TABS: { value: ViewerTab; label: string; color: string }[] = [
  { value: 'pending',  label: 'Pending',  color: '#FBBF24' },
  { value: 'rejected', label: 'Rejected', color: '#F87171' },
]

/* ── Main page ─────────────────────────────────────── */
export default function ViewersPage() {
  const { data: me } = useCurrentUser()
  const toast        = useToast()

  const [tab,          setTab]          = useState<ViewerTab>('pending')
  const [search,       setSearch]       = useState('')
  const [page,         setPage]         = useState(1)
  const [detailTarget, setDetailTarget] = useState<AdminUser | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  const isFullAdmin = me?.role === 'super_admin' || me?.role === 'admin'

  const { data, isLoading, refetch } = useUsers('student', {
    search,
    page,
    per_page: 20,
    enrollmentStatus: tab,
  })

  const viewers     = data?.docs ?? []
  const meta        = data?.meta

  const toggleBlock = useToggleBlock()
  const deleteUser  = useDeleteUser()

  const handleToggleBlock = async (user: AdminUser) => {
    try {
      await toggleBlock.mutateAsync({ userId: user.id, isActive: !user.isActive })
      toast.success(
        user.isActive ? `${user.name} blocked` : `${user.name} unblocked`,
        user.isActive ? 'User can no longer log in.' : 'User can log in again.',
      )
      refetch()
    } catch (err: any) {
      toast.error('Action failed', err?.response?.data?.error?.message)
    }
  }

  const handleDelete = async (userId: string) => {
    try {
      await deleteUser.mutateAsync(userId)
      toast.success('Viewer deleted', 'The account has been permanently removed.')
      setDeleteTarget(null)
      refetch()
    } catch (err: any) {
      toast.error('Delete failed', err?.response?.data?.error?.message)
    }
  }

  const handleTabChange = (t: ViewerTab) => {
    setTab(t)
    setPage(1)
    setSearch('')
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2.5" style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}>
            <div className="flex h-8 w-8 items-center justify-center rounded-xl"
              style={{ background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)' }}>
              <Eye size={15} style={{ color: '#818CF8' }} />
            </div>
            Viewers
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>
            Users who signed up but have not yet been approved as students.
          </p>
        </div>
        {meta && (
          <div className="flex items-center gap-2 rounded-2xl px-4 py-2.5 flex-shrink-0"
            style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.18)' }}>
            <Eye size={13} style={{ color: '#818CF8' }} />
            <span className="text-sm font-bold" style={{ color: '#818CF8' }}>{meta.total_count}</span>
            <span className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>{tab}</span>
          </div>
        )}
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-3 rounded-2xl px-4 py-3.5"
        style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.15)' }}>
        <Eye size={14} className="mt-0.5 flex-shrink-0" style={{ color: '#818CF8' }} />
        <p className="text-xs leading-relaxed" style={{ color: 'rgba(255,255,255,0.5)' }}>
          Viewers can browse the platform but cannot access course content or book live classes.
          To approve or reject requests, use the <strong style={{ color: 'rgba(255,255,255,0.7)' }}>Enrollment Requests</strong> section.
          Click any row to view their submitted application and documents.
        </p>
      </div>

      {/* Tabs + Search */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Sub-tabs */}
        <div className="flex overflow-hidden rounded-xl" style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)' }}>
          {TABS.map(t => (
            <button
              key={t.value}
              onClick={() => handleTabChange(t.value)}
              className="px-4 py-2 text-sm font-medium transition-all"
              style={{
                color:      tab === t.value ? t.color : 'rgba(255,255,255,0.45)',
                background: tab === t.value ? `${t.color}18` : 'transparent',
                borderRight: '1px solid rgba(255,255,255,0.06)',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative flex-1" style={{ minWidth: 180, maxWidth: 320 }}>
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'rgba(255,255,255,0.3)' }} />
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
            placeholder="Search by name or email…"
            className="w-full rounded-xl py-2 pl-9 pr-4 text-sm text-white outline-none transition-all placeholder:text-white/25"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
            onFocus={e => { e.currentTarget.style.border = '1px solid rgba(99,102,241,0.5)'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.10)' }}
            onBlur={e => { e.currentTarget.style.border = '1px solid rgba(255,255,255,0.08)'; e.currentTarget.style.boxShadow = 'none' }}
          />
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-2xl" style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse">
            <thead>
              <tr style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                {['Viewer', 'Email', tab === 'rejected' ? 'Rejected by' : 'Status', 'Signed up', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-3 text-left"
                    style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={5} className="px-4 py-16 text-center">
                  <div className="inline-flex items-center gap-2 text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>
                    <Spinner size={14} />Loading…
                  </div>
                </td></tr>
              )}
              {!isLoading && viewers.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-20 text-center">
                  <div style={{ color: 'rgba(255,255,255,0.3)' }}>
                    <Eye size={32} className="mx-auto mb-3 opacity-30" />
                    <p className="text-sm font-medium">
                      {tab === 'pending' ? 'No pending viewers' : 'No rejected viewers'}
                    </p>
                    <p className="mt-1 text-xs" style={{ color: 'rgba(255,255,255,0.2)' }}>
                      {tab === 'pending' ? 'New signups will appear here' : 'Rejected users will appear here'}
                    </p>
                  </div>
                </td></tr>
              )}
              {!isLoading && viewers.map((user, i) => (
                <motion.tr
                  key={user.id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                  style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', cursor: 'pointer' }}
                  className="group transition-colors hover:bg-white/[0.02]"
                  onClick={() => setDetailTarget(user)}
                >
                  {/* Name + avatar */}
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="relative flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-full"
                        style={{
                          background: tab === 'rejected' ? 'rgba(248,113,113,0.12)' : 'rgba(99,102,241,0.15)',
                          border: `1px solid ${tab === 'rejected' ? 'rgba(248,113,113,0.25)' : 'rgba(99,102,241,0.25)'}`,
                        }}>
                        <AvatarImg src={user.avatarUrl}
                          className="h-full w-full object-cover"
                          fallback={<span className="text-xs font-bold" style={{ color: tab === 'rejected' ? '#F87171' : '#818CF8' }}>
                              {user.name[0]?.toUpperCase() ?? '?'}
                            </span>} />
                        {!user.isActive && (
                          <div className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full"
                            style={{ background: '#EF4444', border: '2px solid #0D0F1A' }}>
                            <ShieldOff size={8} className="text-white" />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-white" style={{ maxWidth: 180 }}>{user.name}</p>
                        {!user.isActive && (
                          <span className="text-[10px] font-medium" style={{ color: '#EF4444' }}>Blocked</span>
                        )}
                        <div style={{ maxWidth: 200 }}><CsTag cs={user.tetraCs} /></div>
                      </div>
                    </div>
                  </td>

                  {/* Email */}
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-1.5" style={{ color: 'rgba(255,255,255,0.55)' }}>
                      <Mail size={11} />
                      <span className="text-xs truncate max-w-[220px]">{user.email}</span>
                    </div>
                  </td>

                  {/* Status / Rejected by */}
                  <td className="px-4 py-3.5">
                    {tab === 'rejected' ? (
                      <div className="flex flex-col gap-0.5">
                        {user.rejectedByEmail && (
                          <p className="text-xs font-medium" style={{ color: 'rgba(255,255,255,0.65)' }}>
                            {user.rejectedByName ?? user.rejectedByEmail}
                          </p>
                        )}
                        {user.rejectionReason && (
                          <p className="text-[11px] truncate max-w-[200px]" title={user.rejectionReason}
                            style={{ color: 'rgba(255,255,255,0.3)' }}>
                            {user.rejectionReason}
                          </p>
                        )}
                        {user.rejectedAt && (
                          <p className="text-[10px]" style={{ color: 'rgba(255,255,255,0.25)' }}>
                            {fmtDate(user.rejectedAt)}
                          </p>
                        )}
                        {!user.rejectedByEmail && !user.rejectionReason && (
                          <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold"
                            style={{ background: 'rgba(248,113,113,0.12)', color: '#F87171' }}>
                            <XCircle size={10} />Rejected
                          </span>
                        )}
                      </div>
                    ) : (
                      <div className="flex flex-col gap-1">
                        <span className="inline-flex w-fit items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold"
                          style={{ background: 'rgba(99,102,241,0.12)', color: '#818CF8' }}>
                          <Eye size={10} />Viewer
                        </span>
                        <span className="inline-flex w-fit items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-medium"
                          style={{ background: 'rgba(251,191,36,0.10)', color: '#FBBF24' }}>
                          <Clock size={9} />Pending approval
                        </span>
                      </div>
                    )}
                  </td>

                  {/* Joined */}
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-1.5 text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
                      <Calendar size={11} />{fmtDate(user.createdAt)}
                    </div>
                  </td>

                  {/* Actions */}
                  <td className="px-4 py-3.5" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                      {deleteTarget === user.id ? (
                        <DeleteConfirm
                          loading={deleteUser.isPending}
                          onConfirm={() => handleDelete(user.id)}
                          onCancel={() => setDeleteTarget(null)}
                        />
                      ) : (
                        <>
                          <button
                            onClick={() => handleToggleBlock(user)}
                            disabled={toggleBlock.isPending}
                            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all disabled:opacity-40"
                            style={user.isActive
                              ? { color: '#F87171', border: '1px solid rgba(248,113,113,0.3)' }
                              : { color: '#4ADE80', border: '1px solid rgba(74,222,128,0.3)' }}>
                            {toggleBlock.isPending
                              ? <Spinner size={10} />
                              : user.isActive ? <ShieldOff size={10} /> : <ShieldCheck size={10} />}
                            {user.isActive ? 'Block' : 'Unblock'}
                          </button>
                          {isFullAdmin && (
                            <button
                              onClick={() => setDeleteTarget(user.id)}
                              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all"
                              style={{ color: 'rgba(239,68,68,0.6)', border: '1px solid rgba(239,68,68,0.2)' }}
                              title="Permanently delete this account">
                              <Trash2 size={10} />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {meta && meta.total_pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <span className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>
              Page {meta.page} of {meta.total_pages} · {meta.total_count} viewers
            </span>
            <div className="flex gap-1">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={!meta.has_prev}
                className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors disabled:opacity-30"
                style={{ color: 'rgba(255,255,255,0.5)' }}>
                <ChevronLeft size={13} />
              </button>
              <button onClick={() => setPage(p => p + 1)} disabled={!meta.has_next}
                className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors disabled:opacity-30"
                style={{ color: 'rgba(255,255,255,0.5)' }}>
                <ChevronRight size={13} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Detail modal */}
      <AnimatePresence>
        {detailTarget && (
          <ViewerDetailModal
            user={detailTarget}
            onClose={() => setDetailTarget(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
