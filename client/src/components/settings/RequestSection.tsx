'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  User, Mail, Phone, AlertCircle, Upload, ChevronRight, ChevronLeft, Check,
  FileText, X, ChevronDown, Search, MapPin, Calendar, Briefcase, CreditCard,
  Clock, CheckCircle2, XCircle, RefreshCw, Eye, Zap, Shield,
} from 'lucide-react'
import { isValidPhoneNumber } from 'libphonenumber-js'
import { api } from '@/lib/axios'
import { describeTransportError } from '@/lib/apiResponse'
import { useCurrentUser, useCompleteRegistration } from '@/lib/api/user'
import Spinner from '@/components/ui/Spinner'
import { useDocumentUrl } from '@/lib/api/documents'
import { PROGRAMS, PROGRAM_GROUPS, programLabel } from '@/lib/programs'

/* Students type a local-looking number with the country code but no "+"
   (971553646039, not +971553646039) far more often than they type the "+" a
   phone keypad buries behind a long-press on "0". Rejecting that as "missing
   country code" is technically correct and useless — the digits are right
   there. Try the "+" the student left out before giving up on the number. */
function normalizePhone(raw: string): { value: string; valid: boolean } {
  const trimmed = raw.trim()
  if (!trimmed) return { value: trimmed, valid: false }
  const withPlus = trimmed.startsWith('+') ? trimmed : `+${trimmed.replace(/\D/g, '')}`
  return { value: withPlus, valid: isValidPhoneNumber(withPlus) }
}

/* ── Constants ─────────────────────────────────────── */
const COUNTRY_NAMES = [
  'Afghanistan','Albania','Algeria','Angola','Argentina','Armenia','Australia','Austria',
  'Azerbaijan','Bahrain','Bangladesh','Belarus','Belgium','Benin','Bolivia','Bosnia and Herzegovina',
  'Botswana','Brazil','Brunei','Bulgaria','Burkina Faso','Burundi','Cambodia','Cameroon','Canada',
  'Chad','Chile','China','Colombia','Congo (Brazzaville)','Congo (DRC)','Costa Rica','Croatia',
  'Cuba','Cyprus','Czech Republic','Denmark','Djibouti','Dominican Republic','Ecuador','Egypt',
  'El Salvador','Eritrea','Estonia','Ethiopia','Fiji','Finland','France','Gabon','Gambia',
  'Georgia','Germany','Ghana','Greece','Guatemala','Guinea','Guyana','Haiti','Honduras',
  'Hungary','Iceland','India','Indonesia','Iran','Iraq','Ireland','Israel','Italy','Ivory Coast',
  'Jamaica','Japan','Jordan','Kazakhstan','Kenya','Kosovo','Kuwait','Kyrgyzstan','Laos','Latvia',
  'Lebanon','Liberia','Libya','Lithuania','Luxembourg','Madagascar','Malawi','Malaysia','Maldives',
  'Mali','Malta','Mauritania','Mauritius','Mexico','Moldova','Mongolia','Montenegro','Morocco',
  'Mozambique','Myanmar','Namibia','Nepal','Netherlands','New Zealand','Nicaragua','Niger','Nigeria',
  'North Macedonia','Norway','Oman','Pakistan','Palestine','Panama','Paraguay','Peru','Philippines',
  'Poland','Portugal','Qatar','Romania','Russia','Rwanda','Saudi Arabia','Senegal','Serbia',
  'Sierra Leone','Singapore','Slovakia','Slovenia','Somalia','South Africa','South Korea','Spain',
  'Sri Lanka','Sudan','Sweden','Switzerland','Syria','Taiwan','Tajikistan','Tanzania','Thailand',
  'Togo','Trinidad and Tobago','Tunisia','Turkey','Turkmenistan','Uganda','Ukraine',
  'United Arab Emirates','United Kingdom','United States','Uruguay','Uzbekistan','Venezuela',
  'Vietnam','Yemen','Zambia','Zimbabwe',
]


const GENDER_OPTIONS    = ['Male','Female','Prefer not to say']
const ID_TYPE_OPTIONS   = ['Emirates ID','Passport','Aadhaar Card','Other']
const EXPERIENCE_OPTIONS = ['Beginner','Intermediate','Advanced']
const HEAR_OPTIONS      = ['Instagram','TikTok','WhatsApp','Friend / Referral','Google','Walk-in']
const PAYMENT_OPTIONS   = ['Cash / Full','Card / Full','Card / Split','Card Debit','Card Credit','USDT','Tabby','Tamara']

const STEP_LABELS = ['Personal','Address & Docs','Program','Payment']
const STEP_ICONS  = ['👤','📄','🎓','💳']

/* ── Style helpers ──────────────────────────────────── */
const inputBase: React.CSSProperties = {
  background: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)',
  borderRadius: 12, padding: '10px 14px', fontSize: 14, width: '100%',
  outline: 'none', transition: 'border 0.15s, box-shadow 0.15s',
}
const inputFocus = (el: HTMLElement) => {
  el.style.border = '1.5px solid #0057b8'
  el.style.boxShadow = '0 0 0 3px rgba(0,87,184,0.08)'
}
const inputBlur = (el: HTMLElement) => {
  el.style.border = '1px solid var(--color-border)'
  el.style.boxShadow = 'none'
}

/* ── Sub-components ─────────────────────────────────── */
/* Identity scans are stored as bare keys and exchanged for a short-lived
   signed link (H-11). Renders nothing until there is something to open. */
function DocLink({ userId, field, stored, label }: {
  userId?: string; field: 'passport' | 'idDoc'; stored?: string; label: string
}) {
  const url = useDocumentUrl(userId, field, stored)
  if (!stored) return null
  return (
    <a href={url ?? undefined} target="_blank" rel="noreferrer"
      aria-disabled={!url}
      className="flex flex-col items-center gap-1.5 rounded-xl p-3 text-center transition-colors hover:bg-[var(--color-hover)]"
      style={{ border: '1px solid var(--color-border)', opacity: url ? 1 : 0.5, pointerEvents: url ? 'auto' : 'none' }}>
      <FileText size={20} style={{ color: 'var(--color-primary)' }} />
      <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>{label}</span>
      <Eye size={11} style={{ color: 'var(--color-text-muted)' }} />
    </a>
  )
}

function Field({ label, required, error, children }: {
  label: string; required?: boolean; error?: string; children: React.ReactNode
}) {
  return (
    <div {...(error ? { 'data-field-error': '1' } : {})}>
      <label className="mb-1.5 block text-xs font-semibold" style={{ color: error ? '#DC2626' : 'var(--color-text-secondary)' }}>
        {label}{required && <span style={{ color: 'var(--color-danger)' }}> *</span>}
      </label>
      {children}
      <AnimatePresence>
        {error && (
          <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="mt-1 flex items-center gap-1 text-xs" style={{ color: 'var(--color-danger)' }}>
            <AlertCircle size={11} />{error}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  )
}

function StyledInput({ value, onChange, placeholder, type = 'text', readOnly = false, icon, hint, maxLength, onBlur }: {
  value: string; onChange: (v: string) => void; placeholder?: string
  type?: string; readOnly?: boolean; icon?: React.ReactNode; hint?: string
  maxLength?: number; onBlur?: () => void
}) {
  return (
    <div className="relative">
      {icon && (
        <div className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-muted)' }}>
          {icon}
        </div>
      )}
      <input type={type} value={value} readOnly={readOnly} placeholder={placeholder}
        maxLength={maxLength}
        onChange={e => onChange(e.target.value)}
        style={{
          ...inputBase,
          paddingLeft: icon ? 36 : 14,
          background: readOnly ? 'var(--color-bg-subtle)' : 'var(--color-bg-subtle)',
          color: readOnly ? 'var(--color-text-muted)' : 'var(--color-text-primary)',
          cursor: readOnly ? 'not-allowed' : 'text',
        }}
        onFocus={e => { if (!readOnly) inputFocus(e.currentTarget) }}
        onBlur={e => { inputBlur(e.currentTarget); onBlur?.() }}
      />
      {hint && <p className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>{hint}</p>}
    </div>
  )
}

function CountrySelect({ value, onChange, placeholder = 'Select country' }: {
  value: string; onChange: (v: string) => void; placeholder?: string
}) {
  const [open, setOpen]     = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  const filtered = COUNTRY_NAMES.filter(c => c.toLowerCase().includes(search.toLowerCase()))

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen(o => !o)}
        className="flex w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-sm transition-all"
        style={{ ...inputBase, textAlign: 'left' }}
        onFocus={e => inputFocus(e.currentTarget)}
        onBlur={e => inputBlur(e.currentTarget)}>
        <span style={{ color: value ? 'var(--color-text-primary)' : 'var(--color-text-muted)' }}>{value || placeholder}</span>
        <ChevronDown size={14} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
            className="absolute z-50 mt-1 w-full overflow-hidden rounded-xl bg-[var(--color-bg-surface)] shadow-xl"
            style={{ border: '1px solid var(--color-border)', maxHeight: 260 }}>
            <div className="flex items-center gap-2 border-b px-3 py-2" style={{ borderColor: 'var(--color-border)' }}>
              <Search size={13} style={{ color: 'var(--color-text-muted)' }} />
              <input autoFocus value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search country…" className="flex-1 text-sm outline-none"
                style={{ background: 'transparent', color: 'var(--color-text-primary)' }} />
            </div>
            <div className="overflow-y-auto" style={{ maxHeight: 200 }}>
              {filtered.map(c => (
                <button key={c} type="button"
                  onClick={() => { onChange(c); setOpen(false); setSearch('') }}
                  className="flex w-full items-center px-3.5 py-2 text-sm text-left transition-colors hover:bg-[var(--color-hover)]"
                  style={{ color: c === value ? '#0057b8' : 'var(--color-text-secondary)', fontWeight: c === value ? 600 : 400 }}>
                  {c}
                  {c === value && <Check size={13} className="ml-auto" style={{ color: 'var(--color-primary)' }} />}
                </button>
              ))}
              {filtered.length === 0 && (
                <p className="px-4 py-3 text-sm" style={{ color: 'var(--color-text-muted)' }}>No results</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function OptionSelect({ value, onChange, options, placeholder = 'Select…' }: {
  value: string; onChange: (v: string) => void; options: string[]; placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen(o => !o)}
        className="flex w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-sm transition-all"
        style={{ ...inputBase, textAlign: 'left' }}
        onFocus={e => inputFocus(e.currentTarget)}
        onBlur={e => inputBlur(e.currentTarget)}>
        <span style={{ color: value ? 'var(--color-text-primary)' : 'var(--color-text-muted)' }}>{value || placeholder}</span>
        <ChevronDown size={14} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
            className="absolute z-50 mt-1 w-full overflow-hidden rounded-xl bg-[var(--color-bg-surface)] shadow-xl"
            style={{ border: '1px solid var(--color-border)' }}>
            {options.map(opt => (
              <button key={opt} type="button"
                onClick={() => { onChange(opt); setOpen(false) }}
                className="flex w-full items-center px-3.5 py-2.5 text-sm text-left transition-colors hover:bg-[var(--color-hover)]"
                style={{ color: opt === value ? '#0057b8' : 'var(--color-text-secondary)', fontWeight: opt === value ? 600 : 400 }}>
                {opt}
                {opt === value && <Check size={13} className="ml-auto" style={{ color: 'var(--color-primary)' }} />}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function CardOptions({ value, onChange, options }: {
  value: string; onChange: (v: string) => void
  options: { value: string; label: string; icon?: string }[]
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(opt => (
        <button key={opt.value} type="button" onClick={() => onChange(opt.value)}
          className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium transition-all"
          style={{
            background: value === opt.value ? 'rgba(0,87,184,0.08)' : 'var(--color-bg-subtle)',
            border: `1.5px solid ${value === opt.value ? '#0057b8' : 'var(--color-border)'}`,
            color: value === opt.value ? '#0057b8' : 'var(--color-text-secondary)',
          }}>
          {opt.icon && <span>{opt.icon}</span>}
          {opt.label}
        </button>
      ))}
    </div>
  )
}

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024
const ALLOWED_MIME     = ['image/jpeg','image/png','image/webp','application/pdf']

function fmtSize(bytes: number) {
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`
}

function validateUploadFile(file: File): string | null {
  if (!ALLOWED_MIME.includes(file.type))
    return `"${file.name}" is not supported — use JPG, PNG, WebP, or PDF`
  if (file.size > MAX_UPLOAD_BYTES)
    return `File too large (${fmtSize(file.size)}) — max 5 MB`
  return null
}

function FileUpload({ label, file, onFile, accept = 'image/*,.pdf', uploading, uploadedUrl, onFileError }: {
  label: string; file: File | null; onFile: (f: File | null) => void
  accept?: string; uploading?: boolean; uploadedUrl?: string; onFileError?: (msg: string) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [drag, setDrag] = useState(false)
  const [localErr, setLocalErr] = useState<string | null>(null)

  const handleFile = useCallback((f: File) => {
    const err = validateUploadFile(f)
    if (err) { setLocalErr(err); onFileError?.(err); return }
    setLocalErr(null)
    onFile(f)
  }, [onFile, onFileError])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDrag(false)
    const f = e.dataTransfer.files[0]
    if (f) handleFile(f)
  }, [handleFile])

  const hasErr = !!localErr

  return (
    <div>
      <div
        onDragOver={e => { e.preventDefault(); setDrag(true) }}
        onDragLeave={() => setDrag(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl p-5 transition-all"
        style={{
          border: `2px dashed ${hasErr ? '#EF4444' : drag ? '#0057b8' : uploadedUrl ? '#22C55E' : 'var(--color-text-muted)'}`,
          background: hasErr ? 'rgba(239,68,68,0.04)' : drag ? 'rgba(0,87,184,0.04)' : uploadedUrl ? 'rgba(34,197,94,0.04)' : 'var(--color-bg-inset)',
          minHeight: 100,
        }}>
        <input ref={inputRef} type="file" accept={accept} className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }} />
        {uploading ? (
          <><Spinner size={20} /><p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Uploading…</p></>
        ) : uploadedUrl ? (
          <>
            <div className="flex h-9 w-9 items-center justify-center rounded-full"
              style={{ background: 'rgba(34,197,94,0.1)' }}>
              <Check size={18} style={{ color: 'var(--color-success)' }} />
            </div>
            <p className="text-xs font-medium" style={{ color: 'var(--color-success)' }}>Uploaded ✓</p>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Click to replace</p>
          </>
        ) : file ? (
          <>
            <FileText size={22} style={{ color: 'var(--color-primary)' }} />
            <p className="text-xs font-medium text-center" style={{ color: 'var(--color-text-secondary)' }}>{file.name}</p>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{fmtSize(file.size)} · Click to change</p>
          </>
        ) : (
          <>
            <div className="flex h-9 w-9 items-center justify-center rounded-full"
              style={{ background: hasErr ? 'rgba(239,68,68,0.08)' : 'rgba(0,87,184,0.08)' }}>
              <Upload size={18} style={{ color: hasErr ? '#EF4444' : '#0057b8' }} />
            </div>
            <p className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>{label}</p>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>PDF, JPG, PNG · max 5 MB</p>
          </>
        )}
      </div>
      {localErr && (
        <p className="mt-1 flex items-center gap-1 text-xs" style={{ color: 'var(--color-danger)' }}>
          <AlertCircle size={11} />{localErr}
        </p>
      )}
    </div>
  )
}

/* ── Progress stepper ───────────────────────────────── */
function StepBar({ step, total }: { step: number; total: number }) {
  return (
    <div className="mb-6 flex items-center gap-0">
      {Array.from({ length: total }, (_, i) => (
        <div key={i} className="flex flex-1 items-center">
          <div className="relative flex flex-col items-center">
            <motion.div
              animate={{
                background: i < step ? '#22C55E' : i === step ? '#0057b8' : 'var(--color-border)',
                scale: i === step ? 1.1 : 1,
              }}
              transition={{ duration: 0.3 }}
              className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white shadow-sm">
              {i < step ? <Check size={13} /> : <span>{STEP_ICONS[i]}</span>}
            </motion.div>
            <p className="absolute top-9 w-20 text-center text-[10px] font-medium"
              style={{ color: i === step ? '#0057b8' : i < step ? '#22C55E' : 'var(--color-text-muted)' }}>
              {STEP_LABELS[i]}
            </p>
          </div>
          {i < total - 1 && (
            <div className="mx-1 h-0.5 flex-1 rounded-full transition-all duration-500"
              style={{ background: i < step ? '#22C55E' : 'var(--color-border)' }} />
          )}
        </div>
      ))}
    </div>
  )
}

/* ── Status badge ───────────────────────────────────── */
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string; icon: React.ReactNode; label: string }> = {
    pending:  { bg: 'rgba(251,191,36,0.1)',  color: '#D97706', icon: <Clock size={13} />,         label: 'Under Review'  },
    approved: { bg: 'rgba(34,197,94,0.1)',   color: 'var(--color-success)', icon: <CheckCircle2 size={13} />,  label: 'Approved'      },
    rejected: { bg: 'rgba(239,68,68,0.1)',   color: 'var(--color-danger)', icon: <XCircle size={13} />,       label: 'Rejected'      },
  }
  const s = map[status] ?? map['pending']
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
      style={{ background: s.bg, color: s.color }}>
      {s.icon}{s.label}
    </span>
  )
}

/* ── Read-only info card ────────────────────────────── */
function InfoRow({ label, value }: { label: string; value?: string | string[] }) {
  if (!value || (Array.isArray(value) && value.length === 0)) return null
  return (
    <div className="flex items-start justify-between gap-4 py-2.5"
      style={{ borderBottom: '1px solid var(--color-border)' }}>
      <span className="text-xs font-medium flex-shrink-0" style={{ color: 'var(--color-text-muted)', minWidth: 140 }}>{label}</span>
      <span className="text-xs text-right" style={{ color: 'var(--color-text-primary)' }}>
        {Array.isArray(value) ? value.join(', ') : value}
      </span>
    </div>
  )
}

/* ─────────────────────────────────────────────────────
   Main component
───────────────────────────────────────────────────── */
interface FormData {
  name: string; phone: string; emergencyContact: string; gender: string
  dateOfBirth: string; nationality: string; homeCountry: string; occupation: string
  idType: string; idNumber: string; countryAttendance: string; villa: string
  city: string; addressCountry: string; experienceLevel: string
  preferredStartDate: string; hearAboutUs: string; referralName: string
  programs: string[]; paymentMethod: string; termsAccepted: boolean
}

interface Errors { [key: string]: string }

/* API field name → the label printed above that box on this form. Anything
   missing from here is simply left out of the message rather than shown as a
   key, because a key the student cannot find is worse than a short list. */
const FIELD_LABELS: Record<string, string> = {
  phone: 'Phone', emergencyContact: 'Emergency Contact', gender: 'Gender',
  dateOfBirth: 'Date of Birth', nationality: 'Nationality', homeCountry: 'Home Country',
  occupation: 'Occupation', idType: 'ID Type', idNumber: 'ID Number',
  countryAttendance: 'Country of Attendance', villa: 'Villa / Apartment', city: 'City',
  addressCountry: 'Country', passportUrl: 'Passport copy', idDocUrl: 'ID document copy',
  photoUrl: 'Photo', experienceLevel: 'Experience Level',
  preferredStartDate: 'Preferred Start', hearAboutUs: 'Heard About Us',
  referralName: 'Referral', programs: 'Programs', paymentMethod: 'Payment Method',
  avatarUrl: 'Photo',
}

export function RequestSection() {
  const { data: user, isLoading } = useCurrentUser()
  const completeRegistration = useCompleteRegistration()

  /* ── Derive view state ──────────────────────── */
  const hasSubmitted   = !!user?.fullRegistrationSubmittedAt
  const enrollStatus   = user?.enrollmentStatus
  const isExpress      = user?.signupType === 'express'

  type ViewState = 'form' | 'pending' | 'rejected' | 'approved'
  let derivedView: ViewState = 'form'
  if (enrollStatus === 'rejected')                          derivedView = 'rejected'
  else if (hasSubmitted && enrollStatus === 'pending')      derivedView = 'pending'
  else if (enrollStatus === 'approved')                     derivedView = 'approved'
  else if (!hasSubmitted && isExpress)                      derivedView = 'form'

  const [showForm, setShowForm]  = useState(false) // re-submit from rejected state
  const viewState: ViewState = showForm ? 'form' : derivedView

  /* ── Form state ─────────────────────────────── */
  const app = user?.enrollmentApplication
  const [step, setStep] = useState(0)
  const [form, setForm] = useState<FormData>({
    name:              user?.name            ?? '',
    phone:             app?.phone            ?? '',
    emergencyContact:  app?.emergencyContact ?? '',
    gender:            app?.gender           ?? '',
    dateOfBirth:       app?.dateOfBirth      ?? '',
    nationality:       app?.nationality      ?? '',
    homeCountry:       app?.homeCountry      ?? '',
    occupation:        app?.occupation       ?? '',
    idType:            app?.idType           ?? '',
    idNumber:          app?.idNumber         ?? '',
    countryAttendance: app?.countryAttendance ?? '',
    villa:             app?.villa            ?? '',
    city:              app?.city             ?? '',
    addressCountry:    app?.addressCountry   ?? '',
    experienceLevel:   app?.experienceLevel  ?? '',
    preferredStartDate: app?.preferredStartDate ?? '',
    hearAboutUs:       app?.hearAboutUs      ?? '',
    referralName:      app?.referralName     ?? '',
    programs:          app?.programs         ?? [],
    paymentMethod:     app?.paymentMethod    ?? '',
    termsAccepted:     false,
  })

  /* Prefill from the saved application ONCE, and never clobber typing.

     This used to re-run on every `user` change and merge with `??`. Both
     halves were wrong together:

       · useCurrentUser has staleTime 60s and React Query refetches on window
         focus by default, so simply alt-tabbing away to look up a passport
         number and coming back re-ran this;
       · `??` only falls back on null/undefined. A draft saved with
         experienceLevel: '' and programs: [] is NOT absent by that test, so
         those empty values were written straight over what the student had
         just selected.

     The student then sat on the payment step with Experience and Programs
     silently blanked, pressed Submit, and the server refused the payload for
     fields it looked like they had filled in.

     Prefilling is still worth doing, so it happens once, and only into
     fields that are still empty. */
  const prefilled = useRef(false)
  useEffect(() => {
    if (!user || prefilled.current) return
    prefilled.current = true
    const a = user.enrollmentApplication
    /* Treat '' and [] as "nothing stored", which is what they mean here. */
    const keep = <T,>(stored: T | undefined, current: T): T => {
      if (stored === undefined || stored === null) return current
      if (typeof stored === 'string' && stored.trim() === '') return current
      if (Array.isArray(stored) && stored.length === 0) return current
      return stored
    }
    setForm(f => ({
      ...f,
      name:              user.name            ?? f.name,
      phone:             keep(a?.phone, f.phone),
      emergencyContact:  keep(a?.emergencyContact, f.emergencyContact),
      gender:            keep(a?.gender, f.gender),
      dateOfBirth:       keep(a?.dateOfBirth, f.dateOfBirth),
      nationality:       keep(a?.nationality, f.nationality),
      homeCountry:       keep(a?.homeCountry, f.homeCountry),
      occupation:        keep(a?.occupation, f.occupation),
      idType:            keep(a?.idType, f.idType),
      idNumber:          keep(a?.idNumber, f.idNumber),
      countryAttendance: keep(a?.countryAttendance, f.countryAttendance),
      villa:             keep(a?.villa, f.villa),
      city:              keep(a?.city, f.city),
      addressCountry:    keep(a?.addressCountry, f.addressCountry),
      experienceLevel:   keep(a?.experienceLevel, f.experienceLevel),
      preferredStartDate: keep(a?.preferredStartDate, f.preferredStartDate),
      hearAboutUs:       keep(a?.hearAboutUs, f.hearAboutUs),
      referralName:      keep(a?.referralName, f.referralName),
      programs:          keep(a?.programs, f.programs),
      paymentMethod:     keep(a?.paymentMethod, f.paymentMethod),
    }))
  }, [user])

  const set = (key: keyof FormData, val: string | boolean | string[]) =>
    setForm(f => ({ ...f, [key]: val }))

  const clearError = (key: string) =>
    setErrors(e => { const n = { ...e }; delete n[key]; return n })

  /* ── File state ─────────────────────────────── */
  /* When the ID they named IS their passport, the two uploads below are the
     same piece of paper.

     The second box is labelled `${idType} Document Copy`, so choosing Passport
     rendered "Passport Copy" and "Passport Document Copy" side by side, both
     required. A student either uploaded the same scan twice or, to get past a
     box they could not satisfy, uploaded something arbitrary -- which is worse
     than asking twice, because it lands in KYC looking like a real second
     document. Ask once, and store it in both fields so the admin screen and
     the API contract are unchanged. */
  const passportIsTheId = form.idType === 'Passport'

  const [passportFile, setPassportFile]   = useState<File | null>(null)
  const [idDocFile, setIdDocFile]         = useState<File | null>(null)
  const [photoFile, setPhotoFile]         = useState<File | null>(null)
  const [passportUrl, setPassportUrl]     = useState(app?.passportUrl ?? '')
  const [idDocUrl, setIdDocUrl]           = useState(app?.idDocUrl    ?? '')
  const [photoUrl, setPhotoUrl]           = useState(app?.photoUrl    ?? '')
  const [uploading, setUploading]         = useState({ passport: false, idDoc: false, photo: false })

  /* Identity scans go to /uploads/kyc, which is never served publicly and is
     read back through /documents/:userId/:field (H-11). The profile photo
     stays on /uploads/document because it doubles as the public avatar. */
  const uploadFile = useCallback(async (file: File, kind: 'kyc' | 'document' = 'document'): Promise<string> => {
    const fd = new FormData()
    fd.append('file', file)
    /* Unset the default 'application/json' header so axios auto-sets
       'multipart/form-data; boundary=...' when it detects FormData */
    const res = await api.post(`/uploads/${kind}`, fd, {
      headers: { 'Content-Type': undefined },
      /* The shared axios timeout is 15 s, sized for reads. This carries up to
         5 MB from a phone; on a slow uplink it was aborted and then reported
         as a file-type problem, and every retry re-sent the earlier files. */
      timeout: 45_000,
    })
    return res.data?.data?.url ?? res.data?.url ?? ''
  }, [])

  /* Changing the ID type away from Passport clears the copy that was filled
     in from it. Without this the second box reappears already showing
     "Uploaded ✓" -- holding the passport, not the Emirates ID it is now
     asking for -- and the student has no reason to think anything is wrong. */
  useEffect(() => {
    if (!passportIsTheId && idDocUrl && idDocUrl === passportUrl) {
      setIdDocUrl('')
      setIdDocFile(null)
    }
  }, [passportIsTheId, idDocUrl, passportUrl])

  /* ── Validation ─────────────────────────────── */
  const [errors, setErrors] = useState<Errors>({})

  const validateStep = (s: number): boolean => {
    const e: Errors = {}
    if (s === 0) {
      /* Name */
      const nameTrimmed = form.name.trim()
      if (!nameTrimmed)
        e['name'] = 'Full name is required'
      else if (nameTrimmed.length < 2)
        e['name'] = 'Name must be at least 2 characters'
      else if (!/[a-zA-Z]/.test(nameTrimmed))
        e['name'] = 'Name must contain letters'
      else if (/\d/.test(nameTrimmed))
        e['name'] = 'Name cannot contain numbers'

      /* Phone — validated against the real numbering plan for its country
         (libphonenumber-js), not a generic digit-count guess. A student who
         typed the country code without the leading "+" (971553646039) gets
         it added for them rather than rejected — see normalizePhone(). */
      if (!form.phone.trim()) {
        e['phone'] = 'Phone number is required'
      } else {
        const normalized = normalizePhone(form.phone)
        if (!normalized.valid) e['phone'] = 'Enter a valid phone number with country code (e.g. +971 50 123 4567)'
        else if (normalized.value !== form.phone) set('phone', normalized.value)
      }

      /* Emergency contact — optional; if provided must be meaningful */
      if (form.emergencyContact.trim() && form.emergencyContact.trim().length < 5)
        e['emergencyContact'] = 'Please provide a valid emergency contact number'

      /* Gender */
      if (!form.gender)
        e['gender'] = 'Please select a gender'

      /* Date of birth — must be ≥ 16 and ≤ 100 years ago */
      if (!form.dateOfBirth) {
        e['dateOfBirth'] = 'Date of birth is required'
      } else {
        const ageYears = (Date.now() - new Date(form.dateOfBirth).getTime()) / (365.25 * 86400000)
        if (ageYears < 16)
          e['dateOfBirth'] = 'You must be at least 16 years old to enroll'
        else if (ageYears > 100)
          e['dateOfBirth'] = 'Please enter a valid date of birth'
      }

      /* Nationality / home country */
      if (!form.nationality.trim())
        e['nationality'] = 'Nationality is required'
      else if (form.nationality.trim().length < 2)
        e['nationality'] = 'Please enter a valid nationality'
      if (!form.homeCountry)
        e['homeCountry'] = 'Home country is required'

      /* Occupation */
      const occTrimmed = form.occupation.trim()
      if (!occTrimmed)
        e['occupation'] = 'Occupation is required'
      else if (occTrimmed.length < 2)
        e['occupation'] = 'Please enter a valid occupation'
      else if (/\d/.test(occTrimmed))
        e['occupation'] = 'Occupation cannot contain numbers'

      /* ID Type */
      if (!form.idType)
        e['idType'] = 'ID type is required'

      /* ID Number — format check by type */
      const idRaw = form.idNumber.trim()
      if (!idRaw) {
        e['idNumber'] = 'ID number is required'
      } else if (form.idType === 'Emirates ID') {
        const digits = idRaw.replace(/[-\s]/g, '')
        if (!/^\d{15}$/.test(digits))
          e['idNumber'] = 'Emirates ID must be 15 digits (784-XXXX-XXXXXXX-X)'
      } else if (form.idType === 'Passport') {
        if (!/^[A-Z0-9]{6,9}$/i.test(idRaw))
          e['idNumber'] = 'Passport number must be 6–9 alphanumeric characters'
      } else if (form.idType === 'Aadhaar Card') {
        const digits = idRaw.replace(/\s/g, '')
        if (!/^\d{12}$/.test(digits))
          e['idNumber'] = 'Aadhaar number must be exactly 12 digits'
      }
    }
    if (s === 1) {
      if (!form.countryAttendance)   e['countryAttendance'] = 'Country of attendance is required'
      if (!form.city.trim())
        e['city'] = 'City is required'
      else if (form.city.trim().length < 2)
        e['city'] = 'City name must be at least 2 characters'
      if (!form.addressCountry)      e['addressCountry']    = 'Address country is required'
      if (!passportUrl && !passportFile) e['passport'] = 'Passport copy is required'
      /* Only when it is a genuinely different document. */
      if (!passportIsTheId && !idDocUrl && !idDocFile)
        e['idDoc'] = 'ID document copy is required'
    }
    if (s === 2) {
      if (!form.experienceLevel)        e['experienceLevel']    = 'Please select your experience level'
      if (!form.preferredStartDate)     e['preferredStartDate'] = 'Preferred start date is required'
      else if (new Date(form.preferredStartDate) <= new Date())
                                        e['preferredStartDate'] = 'Start date must be in the future'
      if (!form.hearAboutUs)            e['hearAboutUs']        = 'Please tell us how you heard about us'
      if (form.hearAboutUs === 'Friend / Referral' && !form.referralName.trim())
                                        e['referralName']       = 'Please provide the name of who referred you'
      if (form.programs.length === 0)   e['programs']           = 'Please select at least one program'
    }
    if (s === 3) {
      if (!form.paymentMethod)   e['paymentMethod']  = 'Please select a payment method'
      if (!form.termsAccepted)   e['termsAccepted']  = 'You must accept the terms & conditions'
    }
    setErrors(e)
    /* Scroll to first error */
    if (Object.keys(e).length > 0) {
      setTimeout(() => {
        const el = document.querySelector('[data-field-error]')
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 50)
    }
    return Object.keys(e).length === 0
  }

  const handleNext = async () => {
    if (!validateStep(step)) return

    /* Upload files when leaving step 1 */
    if (step === 1) {
      try {
        if (passportFile) {
          setUploading(u => ({ ...u, passport: true }))
          const url = await uploadFile(passportFile, 'kyc')
          setPassportUrl(url)
          /* One upload, both fields. complete-registration requires idDocUrl,
             and for this student the passport IS the ID document -- so send it
             rather than leaving a required field empty or uploading twice. */
          if (passportIsTheId) setIdDocUrl(url)
          setUploading(u => ({ ...u, passport: false }))
        }
        if (!passportIsTheId && idDocFile) {
          setUploading(u => ({ ...u, idDoc: true }))
          const url = await uploadFile(idDocFile, 'kyc')
          setIdDocUrl(url)
          setUploading(u => ({ ...u, idDoc: false }))
        }
        if (photoFile) {
          setUploading(u => ({ ...u, photo: true }))
          const url = await uploadFile(photoFile)
          setPhotoUrl(url)
          setUploading(u => ({ ...u, photo: false }))
        }
      } catch (err: unknown) {
        const msg = (err as { response?: { data?: { error?: { message?: string } } } })
          ?.response?.data?.error?.message
          ?? describeTransportError(err)
          ?? 'Upload failed — check file type (JPG/PNG/PDF) and size (max 5 MB), then try again.'
        setErrors(e => ({ ...e, upload: msg }))
        setUploading({ passport: false, idDoc: false, photo: false })
        return
      }
    }

    setStep(s => s + 1)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleSubmit = async () => {
    /* EVERY step, not just this one.

       validateStep(3) checks the payment method and the tick-box and nothing
       else, so anything missing from an earlier step went to the server
       unchecked and came back as "Request validation failed" -- a message
       that names no field and leaves the student with nowhere to click.

       Checking all four here means the form answers for itself, in the step
       where the problem is, and the student is taken to it. */
    for (const st of [0, 1, 2, 3]) {
      if (!validateStep(st)) {
        if (st !== step) setStep(st)
        return
      }
    }
    try {
      await completeRegistration.mutateAsync({
        phone:              form.phone,
        emergencyContact:   form.emergencyContact,
        gender:             form.gender,
        dateOfBirth:        form.dateOfBirth,
        nationality:        form.nationality,
        homeCountry:        form.homeCountry,
        occupation:         form.occupation,
        idType:             form.idType,
        idNumber:           form.idNumber,
        countryAttendance:  form.countryAttendance,
        villa:              form.villa,
        city:               form.city,
        addressCountry:     form.addressCountry,
        passportUrl,
        /* Derived here rather than trusted from state: the student may have
           picked Passport, uploaded, gone back, and changed the ID type (or
           the reverse). Deciding at submit time means the file that is sent
           always matches the ID type that is sent. */
        idDocUrl: passportIsTheId ? passportUrl : idDocUrl,
        photoUrl,
        experienceLevel:    form.experienceLevel,
        preferredStartDate: form.preferredStartDate,
        hearAboutUs:        form.hearAboutUs,
        referralName:       form.referralName,
        programs:           form.programs,
        paymentMethod:      form.paymentMethod,
        avatarUrl:          photoUrl,
      })
      setShowForm(false)
    } catch (err: any) {
      /* The API answers a rejected payload with details[] naming each field;
         showing only error.message reduced all of that to "Request validation
         failed". If the server ever refuses something the checks above let
         through, say WHICH field -- otherwise the student is stuck guessing
         on a form they cannot see anything wrong with. */
      const e   = err?.response?.data?.error
      const det = Array.isArray(e?.details) ? e.details : []
      /* Named with the SAME words the form uses, not the API's field keys.
         "Please check: experienceLevel, programs" is only marginally better
         than the generic sentence if the student has to guess which box
         "experienceLevel" is. */
      const names = det
        .map((d: any) => FIELD_LABELS[String(d?.field ?? '')] ?? '')
        .filter(Boolean)
      const unique = [...new Set(names)]
      const msg = unique.length
        ? `Please check ${unique.join(', ')} — then submit again.`
        : (e?.message ?? 'Submission failed. Please try again.')
      setErrors({ submit: msg })
    }
  }

  /* ─────────────────────────────────────────── */
  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Spinner size={24} />
      </div>
    )
  }

  /* ── ① Approved ─────────────────────────────── */
  if (viewState === 'approved') {
    return (
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl bg-[var(--color-bg-surface)] p-8 text-center" style={{ border: '1px solid var(--color-border)' }}>
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full"
          style={{ background: 'rgba(34,197,94,0.1)' }}>
          <CheckCircle2 size={32} style={{ color: 'var(--color-success)' }} />
        </div>
        <h2 className="mb-2 text-lg font-bold" style={{ color: 'var(--color-text-primary)' }}>Registration Approved!</h2>
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
          Your full registration has been approved. You now have complete access to all courses, live classes, and bookings.
        </p>
      </motion.div>
    )
  }

  /* ── ② Pending (read-only view) ─────────────── */
  if (viewState === 'pending') {
    const a = user?.enrollmentApplication
    return (
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
        {/* Status header */}
        <div className="rounded-2xl bg-[var(--color-bg-surface)] p-6" style={{ border: '1px solid var(--color-border)' }}>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-base font-bold" style={{ color: 'var(--color-text-primary)' }}>Registration Request</h2>
              <p className="mt-0.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                Submitted on {user?.fullRegistrationSubmittedAt
                  ? new Date(user.fullRegistrationSubmittedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
                  : '—'}
              </p>
            </div>
            <StatusBadge status="pending" />
          </div>
          <div className="mt-4 rounded-xl px-4 py-3 text-sm"
            style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)', color: '#92400E' }}>
            <Clock size={13} className="mr-1.5 inline-block" style={{ color: '#D97706' }} />
            Your registration is under review by our admissions team. You'll be notified once a decision is made.
          </div>
        </div>

        {/* Express Account (original) */}
        <div className="rounded-2xl bg-[var(--color-bg-surface)] p-6" style={{ border: '1px solid var(--color-border)' }}>
          <div className="mb-4 flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-full"
              style={{ background: 'rgba(124,58,237,0.1)' }}>
              <Zap size={13} style={{ color: '#7C3AED' }} />
            </div>
            <h3 className="text-sm font-bold" style={{ color: 'var(--color-text-primary)' }}>Express Account</h3>
          </div>
          <InfoRow label="Name"         value={user?.name} />
          <InfoRow label="Email"        value={user?.email} />
          <InfoRow label="Home Country" value={a?.homeCountry} />
          <InfoRow label="Account Type" value="Express (upgrading to Full)" />
        </div>

        {/* Full registration data */}
        <div className="rounded-2xl bg-[var(--color-bg-surface)] p-6" style={{ border: '1px solid var(--color-border)' }}>
          <div className="mb-4 flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-full"
              style={{ background: 'rgba(0,87,184,0.1)' }}>
              <FileText size={13} style={{ color: 'var(--color-primary)' }} />
            </div>
            <h3 className="text-sm font-bold" style={{ color: 'var(--color-text-primary)' }}>Full Registration</h3>
          </div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>Personal</p>
          <InfoRow label="Phone"              value={a?.phone} />
          <InfoRow label="Emergency Contact"  value={a?.emergencyContact} />
          <InfoRow label="Gender"             value={a?.gender} />
          <InfoRow label="Date of Birth"      value={a?.dateOfBirth} />
          <InfoRow label="Nationality"        value={a?.nationality} />
          <InfoRow label="Occupation"         value={a?.occupation} />
          <InfoRow label="ID Type"            value={a?.idType} />
          <InfoRow label="ID Number"          value={a?.idNumber} />

          <p className="mb-3 mt-4 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>Address</p>
          <InfoRow label="Country of Attendance" value={a?.countryAttendance} />
          <InfoRow label="Villa / Apartment"     value={a?.villa} />
          <InfoRow label="City"                  value={a?.city} />
          <InfoRow label="Country"               value={a?.addressCountry} />

          <p className="mb-3 mt-4 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>Documents</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <DocLink userId={user?.id} field="passport" stored={a?.passportUrl} label="Passport" />
            <DocLink userId={user?.id} field="idDoc" stored={a?.idDocUrl} label="ID Document" />
          </div>

          <p className="mb-3 mt-4 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>Program</p>
          <InfoRow label="Experience Level"    value={a?.experienceLevel} />
          <InfoRow label="Preferred Start"     value={a?.preferredStartDate} />
          <InfoRow label="Heard About Us"      value={a?.hearAboutUs} />
          <InfoRow label="Referral"            value={a?.referralName} />
          <InfoRow label="Programs"            value={a?.programs} />
          <InfoRow label="Payment Method"      value={a?.paymentMethod} />
        </div>
      </motion.div>
    )
  }

  /* ── ③ Rejected ─────────────────────────────── */
  if (viewState === 'rejected') {
    const a = user?.enrollmentApplication
    return (
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
        {/* Rejection card */}
        <div className="rounded-2xl bg-[var(--color-bg-surface)] p-6" style={{ border: '1px solid rgba(239,68,68,0.25)' }}>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-base font-bold" style={{ color: 'var(--color-text-primary)' }}>Registration Request</h2>
              <p className="mt-0.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>Previous submission was not approved</p>
            </div>
            <StatusBadge status="rejected" />
          </div>
          {user?.rejectionReason && (
            <div className="mt-4 rounded-xl px-4 py-3"
              style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)' }}>
              <p className="mb-1 text-xs font-semibold" style={{ color: 'var(--color-danger)' }}>Reason for rejection:</p>
              <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>{user.rejectionReason}</p>
            </div>
          )}
          <motion.button whileHover={{ y: -1 }} whileTap={{ scale: 0.97 }}
            onClick={() => { setStep(0); setShowForm(true); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
            className="mt-4 flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold text-white"
            style={{ background: 'var(--color-primary)', boxShadow: '0 4px 14px rgba(0,87,184,0.28)' }}>
            <RefreshCw size={14} />Submit New Registration
          </motion.button>
        </div>

        {/* Previous submission (read-only) */}
        {a && (
          <div className="rounded-2xl bg-[var(--color-bg-surface)] p-6" style={{ border: '1px solid var(--color-border)' }}>
            <h3 className="mb-4 text-sm font-bold" style={{ color: 'var(--color-text-muted)' }}>Previous Submission (read-only)</h3>
            <InfoRow label="Phone"              value={a.phone} />
            <InfoRow label="Gender"             value={a.gender} />
            <InfoRow label="Date of Birth"      value={a.dateOfBirth} />
            <InfoRow label="Nationality"        value={a.nationality} />
            <InfoRow label="Occupation"         value={a.occupation} />
            <InfoRow label="ID Type"            value={a.idType} />
            <InfoRow label="Country"            value={a.countryAttendance} />
            <InfoRow label="City"               value={a.city} />
            <InfoRow label="Experience Level"   value={a.experienceLevel} />
            <InfoRow label="Programs"           value={a.programs} />
            <InfoRow label="Payment Method"     value={a.paymentMethod} />
          </div>
        )}
      </motion.div>
    )
  }

  /* ── ④ Form ──────────────────────────────────── */
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      {/* Header */}
      <div className="rounded-2xl bg-[var(--color-bg-surface)] p-6" style={{ border: '1px solid var(--color-border)' }}>
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full"
            style={{ background: 'rgba(0,87,184,0.08)' }}>
            <Shield size={18} style={{ color: 'var(--color-primary)' }} />
          </div>
          <div>
            <h2 className="text-base font-bold" style={{ color: 'var(--color-text-primary)' }}>Complete Your Registration</h2>
            <p className="mt-0.5 text-sm" style={{ color: 'var(--color-text-muted)' }}>
              Fill in your full enrollment details to get approved for courses, live classes, and bookings.
            </p>
          </div>
        </div>
      </div>

      {/* Form card */}
      <div className="rounded-2xl bg-[var(--color-bg-surface)] p-6" style={{ border: '1px solid var(--color-border)' }}>
        {/* Step bar — needs a bit of top padding for the labels */}
        <div className="pb-8 pt-2">
          <StepBar step={step} total={4} />
        </div>

        <>
          {/* ── Step 0: Personal ──────────────── */}
          {step === 0 && (
            <div key="step0" className="space-y-4">
              <p className="text-sm font-bold" style={{ color: 'var(--color-text-primary)' }}>Personal Information</p>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Full Name" required error={errors['name']}>
                  <StyledInput value={form.name} onChange={v => { set('name', v); clearError('name') }}
                    placeholder="Your full name" icon={<User size={14} />} maxLength={80} />
                </Field>
                <Field label="Email">
                  <StyledInput value={user?.email ?? ''} onChange={() => {}} readOnly
                    icon={<Mail size={14} />} />
                </Field>
                <Field label="Phone / WhatsApp" required error={errors['phone']}>
                  <StyledInput value={form.phone}
                    onChange={v => { set('phone', v.replace(/[^+\d\s\-()]/g, '')); clearError('phone') }}
                    placeholder="+971 50 123 4567"
                    icon={<Phone size={14} />}
                    maxLength={20}
                    hint="Include country code (e.g. +971, +91, +44)"
                    onBlur={() => {
                      if (!form.phone) return
                      const normalized = normalizePhone(form.phone)
                      if (!normalized.valid) {
                        setErrors(e => ({ ...e, phone: 'Enter a valid phone number with country code (e.g. +971 50 123 4567)' }))
                      } else {
                        if (normalized.value !== form.phone) set('phone', normalized.value)
                        clearError('phone')
                      }
                    }}
                  />
                </Field>
                <Field label="Emergency Contact" error={errors['emergencyContact']}>
                  <StyledInput value={form.emergencyContact}
                    onChange={v => { set('emergencyContact', v); clearError('emergencyContact') }}
                    placeholder="e.g. +971 50 000 0000"
                    icon={<Phone size={14} />} maxLength={30} />
                </Field>
              </div>

              <Field label="Gender" required error={errors['gender']}>
                <CardOptions value={form.gender}
                  onChange={v => { set('gender', v); clearError('gender') }}
                  options={GENDER_OPTIONS.map(g => ({ value: g, label: g, icon: g === 'Male' ? '👨' : g === 'Female' ? '👩' : '🤐' }))} />
              </Field>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Date of Birth" required error={errors['dateOfBirth']}>
                  <input type="date" value={form.dateOfBirth}
                    onChange={e => { set('dateOfBirth', e.target.value); clearError('dateOfBirth') }}
                    max={new Date(Date.now() - 16 * 365.25 * 86400000).toISOString().split('T')[0]}
                    style={{ ...inputBase, paddingLeft: 14 }}
                    onFocus={e => inputFocus(e.currentTarget)}
                    onBlur={e => {
                      inputBlur(e.currentTarget)
                      if (form.dateOfBirth) {
                        const age = (Date.now() - new Date(form.dateOfBirth).getTime()) / (365.25 * 86400000)
                        if (age < 16) setErrors(prev => ({ ...prev, dateOfBirth: 'You must be at least 16 years old to enroll' }))
                      }
                    }} />
                </Field>
                <Field label="Nationality" required error={errors['nationality']}>
                  <CountrySelect value={form.nationality}
                    onChange={v => { set('nationality', v); clearError('nationality') }}
                    placeholder="Select nationality" />
                </Field>
                <Field label="Home Country" required error={errors['homeCountry']}>
                  <CountrySelect value={form.homeCountry}
                    onChange={v => { set('homeCountry', v); clearError('homeCountry') }} />
                </Field>
                <Field label="Occupation" required error={errors['occupation']}>
                  <StyledInput value={form.occupation}
                    onChange={v => { set('occupation', v); clearError('occupation') }}
                    placeholder="e.g. Business Owner, Software Engineer…"
                    icon={<Briefcase size={14} />} maxLength={60} />
                </Field>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="ID Type" required error={errors['idType']}>
                  <OptionSelect value={form.idType}
                    onChange={v => { set('idType', v); clearError('idType'); clearError('idNumber') }}
                    options={ID_TYPE_OPTIONS} placeholder="Select ID type" />
                </Field>
                <Field label={`${form.idType || 'ID'} Number`} required error={errors['idNumber']}>
                  <StyledInput value={form.idNumber}
                    onChange={v => { set('idNumber', v.toUpperCase()); clearError('idNumber') }}
                    placeholder={
                      form.idType === 'Emirates ID'  ? '784-XXXX-XXXXXXX-X' :
                      form.idType === 'Passport'     ? 'e.g. A12345678' :
                      form.idType === 'Aadhaar Card' ? 'XXXX XXXX XXXX' :
                                                       'Enter your ID number'
                    }
                    hint={
                      form.idType === 'Emirates ID'  ? '15 digits — hyphens optional' :
                      form.idType === 'Passport'     ? '6–9 alphanumeric characters' :
                      form.idType === 'Aadhaar Card' ? '12-digit Aadhaar number' :
                                                       undefined
                    }
                    icon={<FileText size={14} />} maxLength={20} />
                </Field>
              </div>
            </div>
          )}

          {/* ── Step 1: Address & Docs ────────── */}
          {step === 1 && (
            <div key="step1" className="space-y-4">
              <p className="text-sm font-bold" style={{ color: 'var(--color-text-primary)' }}>Address & Documents</p>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Country of Attendance" required error={errors['countryAttendance']}>
                  <CountrySelect value={form.countryAttendance}
                    onChange={v => { set('countryAttendance', v); clearError('countryAttendance') }} />
                </Field>
                <Field label="Villa / Apartment" error={errors['villa']}>
                  <StyledInput value={form.villa} onChange={v => set('villa', v)}
                    placeholder="Villa 12, Apt 4B…" icon={<MapPin size={14} />} maxLength={60} />
                </Field>
                <Field label="City" required error={errors['city']}>
                  <StyledInput value={form.city}
                    onChange={v => { set('city', v); clearError('city') }}
                    placeholder="Dubai, Abu Dhabi…" icon={<MapPin size={14} />} maxLength={60} />
                </Field>
                <Field label="Country" required error={errors['addressCountry']}>
                  <CountrySelect value={form.addressCountry}
                    onChange={v => { set('addressCountry', v); clearError('addressCountry') }} />
                </Field>
              </div>

              {errors['upload'] && (
                <div className="flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-xs"
                  style={{ background: '#FEE2E2', color: 'var(--color-danger)' }}>
                  <AlertCircle size={13} />{errors['upload']}
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Passport Copy" required error={errors['passport']}>
                  <FileUpload label="Upload Passport" file={passportFile} onFile={setPassportFile}
                    uploading={uploading.passport} uploadedUrl={passportUrl} />
                  {passportIsTheId && (
                    <p className="mt-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                      You chose Passport as your ID, so this is the only document we need.
                    </p>
                  )}
                </Field>
                {/* Hidden, not disabled: a greyed-out box still reads as
                    something the student failed to do. */}
                {!passportIsTheId && (
                  <Field label={`${form.idType || 'ID'} Document Copy`} required error={errors['idDoc']}>
                    <FileUpload label="Upload ID Document" file={idDocFile} onFile={setIdDocFile}
                      uploading={uploading.idDoc} uploadedUrl={idDocUrl} />
                  </Field>
                )}
              </div>

              <Field label="Profile Photo (optional)">
                <FileUpload label="Upload Profile Photo" file={photoFile} onFile={setPhotoFile}
                  accept="image/*" uploading={uploading.photo} uploadedUrl={photoUrl} />
              </Field>
            </div>
          )}

          {/* ── Step 2: Program ───────────────── */}
          {step === 2 && (
            <div key="step2" className="space-y-4">
              <p className="text-sm font-bold" style={{ color: 'var(--color-text-primary)' }}>Program Selection</p>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Experience Level" required error={errors['experienceLevel']}>
                  <CardOptions value={form.experienceLevel} onChange={v => set('experienceLevel', v)}
                    options={[
                      { value: 'Beginner',     label: 'Beginner',     icon: '🌱' },
                      { value: 'Intermediate', label: 'Intermediate', icon: '📈' },
                      { value: 'Advanced',     label: 'Advanced',     icon: '🚀' },
                    ]} />
                </Field>
                <Field label="Preferred Start Date" required error={errors['preferredStartDate']}>
                  <input type="date" value={form.preferredStartDate}
                    onChange={e => set('preferredStartDate', e.target.value)}
                    min={new Date(Date.now() + 86400000).toISOString().split('T')[0]}
                    style={{ ...inputBase, paddingLeft: 14 }}
                    onFocus={e => inputFocus(e.currentTarget)}
                    onBlur={e => inputBlur(e.currentTarget)} />
                </Field>
              </div>

              <Field label="How did you hear about us?" required error={errors['hearAboutUs']}>
                <CardOptions value={form.hearAboutUs} onChange={v => { set('hearAboutUs', v); clearError('hearAboutUs') }}
                  options={[
                    { value: 'Instagram',         label: 'Instagram',         icon: '📸' },
                    { value: 'TikTok',            label: 'TikTok',            icon: '🎵' },
                    { value: 'WhatsApp',          label: 'WhatsApp',          icon: '💬' },
                    { value: 'Friend / Referral', label: 'Friend / Referral', icon: '👥' },
                    { value: 'Google',            label: 'Google',            icon: '🔍' },
                    { value: 'Walk-in',           label: 'Walk-in',           icon: '🚶' },
                  ]} />
              </Field>

              <Field
                label={form.hearAboutUs === 'Friend / Referral' ? 'Referral Name' : 'Referral Name (optional)'}
                required={form.hearAboutUs === 'Friend / Referral'}
                error={errors['referralName']}
              >
                <StyledInput value={form.referralName}
                  onChange={v => { set('referralName', v); clearError('referralName') }}
                  placeholder="Who referred you?" />
              </Field>

              <Field label="Select Program(s)" required error={errors['programs']}>
                {PROGRAM_GROUPS.map(group => (
                  <div key={group} className="mb-3">
                    <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>{group}</p>
                    <div className="flex flex-wrap gap-2">
                      {PROGRAMS.filter(p => p.group === group).map(p => {
                        const selected = form.programs.includes(p.id)
                        return (
                          <button key={p.id} type="button"
                            onClick={() => {
                              const next = selected
                                ? form.programs.filter(x => x !== p.id)
                                : [...form.programs, p.id]
                              set('programs', next)
                              clearError('programs')
                            }}
                            className="rounded-xl px-3 py-2 text-sm font-medium transition-all"
                            style={{
                              background: selected ? 'rgba(0,87,184,0.08)' : 'var(--color-bg-subtle)',
                              border: `1.5px solid ${selected ? '#0057b8' : 'var(--color-border)'}`,
                              color: selected ? '#0057b8' : 'var(--color-text-secondary)',
                            }}>
                            {selected && <Check size={11} className="mr-1 inline-block" />}
                            {p.label}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </Field>
            </div>
          )}

          {/* ── Step 3: Payment ───────────────── */}
          {step === 3 && (
            <div key="step3" className="space-y-4">
              <p className="text-sm font-bold" style={{ color: 'var(--color-text-primary)' }}>Payment Method</p>

              <Field label="Preferred Payment Method" required error={errors['paymentMethod']}>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {PAYMENT_OPTIONS.map(opt => {
                    const icons: Record<string, string> = {
                      'Cash / Full': '💵', 'Card / Full': '💳', 'Card / Split': '🔀',
                      'Card Debit': '💳', 'Card Credit': '💳', 'USDT': '₮', 'Tabby': '⏳', 'Tamara': '⭐',
                    }
                    const selected = form.paymentMethod === opt
                    return (
                      <button key={opt} type="button" onClick={() => { set('paymentMethod', opt); clearError('paymentMethod') }}
                        className="flex flex-col items-center gap-1.5 rounded-xl p-3 text-center transition-all"
                        style={{
                          background: selected ? 'rgba(0,87,184,0.08)' : 'var(--color-bg-subtle)',
                          border: `1.5px solid ${selected ? '#0057b8' : 'var(--color-border)'}`,
                        }}>
                        <span className="text-lg">{icons[opt] ?? '💳'}</span>
                        <span className="text-xs font-medium"
                          style={{ color: selected ? '#0057b8' : 'var(--color-text-secondary)' }}>{opt}</span>
                      </button>
                    )
                  })}
                </div>
              </Field>

              {/* Summary */}
              <div className="rounded-xl p-4" style={{ background: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)' }}>
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>Application Summary</p>
                <div className="space-y-1.5 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                  <div className="flex gap-2"><span style={{ color: 'var(--color-text-muted)', minWidth: 120 }}>Name</span><span>{form.name}</span></div>
                  <div className="flex gap-2"><span style={{ color: 'var(--color-text-muted)', minWidth: 120 }}>Country</span><span>{form.homeCountry}</span></div>
                  <div className="flex gap-2"><span style={{ color: 'var(--color-text-muted)', minWidth: 120 }}>Experience</span><span>{form.experienceLevel}</span></div>
                  <div className="flex gap-2"><span style={{ color: 'var(--color-text-muted)', minWidth: 120 }}>Programs</span><span>{form.programs.map(programLabel).join(', ')}</span></div>
                </div>
              </div>

              {/* Terms */}
              <div className="flex items-start gap-3 rounded-xl p-4"
                style={{ background: 'rgba(0,87,184,0.04)', border: '1px solid rgba(0,87,184,0.15)' }}>
                <input type="checkbox" id="terms" checked={form.termsAccepted}
                  onChange={e => set('termsAccepted', e.target.checked)}
                  className="mt-0.5 h-4 w-4 flex-shrink-0 cursor-pointer accent-blue-600" />
                <label htmlFor="terms" className="text-xs cursor-pointer" style={{ color: 'var(--color-text-secondary)' }}>
                  I agree to the <a href="/terms" className="font-semibold underline" style={{ color: 'var(--color-primary)' }}>Terms & Conditions</a> and confirm that all information provided is accurate and complete.
                </label>
              </div>
              {errors['termsAccepted'] && (
                <p className="flex items-center gap-1 text-xs" style={{ color: 'var(--color-danger)' }}>
                  <AlertCircle size={11} />{errors['termsAccepted']}
                </p>
              )}

              {errors['submit'] && (
                <div className="flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-xs"
                  style={{ background: '#FEE2E2', color: 'var(--color-danger)' }}>
                  <AlertCircle size={13} />{errors['submit']}
                </div>
              )}
            </div>
          )}
        </>

        {/* Navigation buttons */}
        <div className="mt-6 flex items-center justify-between border-t pt-5" style={{ borderColor: 'var(--color-border)' }}>
          <button type="button" onClick={() => { setStep(s => s - 1); setErrors({}) }}
            disabled={step === 0}
            className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-30"
            style={{ color: 'var(--color-text-muted)', border: '1px solid var(--color-border)' }}>
            <ChevronLeft size={14} />Back
          </button>

          {step < 3 ? (
            <motion.button whileHover={{ y: -1 }} whileTap={{ scale: 0.97 }}
              type="button" onClick={handleNext}
              /* A second tap while the files were still going up ran handleNext
                 twice: six uploads, and two setStep(s => s + 1) that skipped the
                 Program step entirely. */
              disabled={uploading.passport || uploading.idDoc || uploading.photo}
              className="flex items-center gap-2 rounded-xl px-5 py-2 text-sm font-bold text-white disabled:opacity-70"
              style={{ background: 'var(--color-primary)', boxShadow: '0 4px 14px rgba(0,87,184,0.28)' }}>
              Next<ChevronRight size={14} />
            </motion.button>
          ) : (
            <motion.button whileHover={{ y: -1 }} whileTap={{ scale: 0.97 }}
              type="button" onClick={handleSubmit}
              disabled={completeRegistration.isPending}
              className="flex items-center gap-2 rounded-xl px-6 py-2 text-sm font-bold text-white disabled:opacity-70"
              style={{ background: 'var(--color-primary)', boxShadow: '0 4px 14px rgba(0,87,184,0.28)' }}>
              {completeRegistration.isPending ? (
                <><Spinner size={14} />Submitting…</>
              ) : (
                <><Check size={14} />Submit Registration</>
              )}
            </motion.button>
          )}
        </div>
      </div>
    </motion.div>
  )
}
