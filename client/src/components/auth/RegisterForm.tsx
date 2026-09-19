'use client'

import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  User, Mail, Lock, Phone, AlertCircle, Eye, EyeOff,
  Upload, ChevronRight, ChevronLeft, Check, FileText, X,
  ChevronDown, Search, MapPin, Calendar, Globe, Briefcase, CreditCard, Camera, Zap,
  Building2,
} from 'lucide-react'
import { api } from '@/lib/axios'
import { cn } from '@/lib/utils'
import { TermsModal } from './TermsModal'
import Spinner from '@/components/ui/Spinner'
import { PROGRAMS, PROGRAM_GROUPS, programLabel } from '@/lib/programs'
import { describeTransportError } from '@/lib/apiResponse'
import { uploadSignupDoc } from '@/lib/signupUpload'

/* ── Types ─────────────────────────────────────────── */
interface FormData {
  name: string; email: string; phone: string; emergencyContact: string
  gender: string; dateOfBirth: string; nationality: string; homeCountry: string
  occupation: string; idType: string; idNumber: string
  countryAttendance: string; villa: string; city: string; addressCountry: string
  passportFile: File | null; idDocFile: File | null; photoFile: File | null
  experienceLevel: string; preferredStartDate: string; hearAboutUs: string
  referralName: string; programs: string[]
  organizationSlug: '' | 'dubai' | 'bangalore'
  paymentMethod: string; password: string; confirmPassword: string; termsAccepted: boolean
}

const INITIAL: FormData = {
  name: '', email: '', phone: '', emergencyContact: '',
  gender: '', dateOfBirth: '', nationality: '', homeCountry: '',
  occupation: '', idType: '', idNumber: '', countryAttendance: '', villa: '',
  city: '', addressCountry: '', passportFile: null, idDocFile: null, photoFile: null,
  experienceLevel: '', preferredStartDate: '', hearAboutUs: '',
  referralName: '', programs: [], organizationSlug: '',
  paymentMethod: '', password: '', confirmPassword: '', termsAccepted: false,
}


const STEP_LABELS = ['Personal', 'Address & Docs', 'Program', 'Account']
const STEP_ICONS  = ['👤', '📄', '🎓', '🔐']

const GENDER_OPTIONS = [
  { value: 'Male',              label: 'Male',              icon: '👨' },
  { value: 'Female',            label: 'Female',            icon: '👩' },
  { value: 'Prefer not to say', label: 'Prefer not to say', icon: '🤐' },
]

const EXPERIENCE_OPTIONS = [
  { value: 'Beginner',     label: 'Beginner',     icon: '🌱' },
  { value: 'Intermediate', label: 'Intermediate', icon: '📈' },
  { value: 'Advanced',     label: 'Advanced',     icon: '🚀' },
]

const HEAR_OPTIONS = [
  { value: 'Instagram',         label: 'Instagram',         icon: '📸' },
  { value: 'TikTok',            label: 'TikTok',             icon: '🎵' },
  { value: 'WhatsApp',          label: 'WhatsApp',           icon: '💬' },
  { value: 'Friend / Referral', label: 'Friend / Referral', icon: '👥' },
  { value: 'Google',            label: 'Google',             icon: '🔍' },
  { value: 'Walk-in',           label: 'Walk-in',            icon: '🚶' },
]

const PAYMENT_OPTIONS = [
  { value: 'Cash / Full',  label: 'Cash / Full',  icon: '💵' },
  { value: 'Card / Full',  label: 'Card / Full',  icon: '💳' },
  { value: 'Card / Split', label: 'Card / Split', icon: '🔀' },
  { value: 'Card Debit',   label: 'Card Debit',   icon: '💳' },
  { value: 'Card Credit',  label: 'Card Credit',  icon: '💳' },
  { value: 'USDT',         label: 'USDT',         icon: '₮'  },
  { value: 'Tabby',        label: 'Tabby',        icon: '⏳' },
  { value: 'Tamara',       label: 'Tamara',       icon: '⭐' },
]

const MONTHS_LONG  = ['January','February','March','April','May','June','July','August','September','October','November','December']
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const WEEK_DAYS    = ['Su','Mo','Tu','We','Th','Fr','Sa']

/* ── Country data ───────────────────────────────────── */
interface Country { name: string; dial: string; flag: string }

const COUNTRIES: Country[] = [
  { name: 'Afghanistan',           dial: '+93',   flag: '🇦🇫' },
  { name: 'Albania',               dial: '+355',  flag: '🇦🇱' },
  { name: 'Algeria',               dial: '+213',  flag: '🇩🇿' },
  { name: 'Angola',                dial: '+244',  flag: '🇦🇴' },
  { name: 'Argentina',             dial: '+54',   flag: '🇦🇷' },
  { name: 'Armenia',               dial: '+374',  flag: '🇦🇲' },
  { name: 'Australia',             dial: '+61',   flag: '🇦🇺' },
  { name: 'Austria',               dial: '+43',   flag: '🇦🇹' },
  { name: 'Azerbaijan',            dial: '+994',  flag: '🇦🇿' },
  { name: 'Bahrain',               dial: '+973',  flag: '🇧🇭' },
  { name: 'Bangladesh',            dial: '+880',  flag: '🇧🇩' },
  { name: 'Belarus',               dial: '+375',  flag: '🇧🇾' },
  { name: 'Belgium',               dial: '+32',   flag: '🇧🇪' },
  { name: 'Benin',                 dial: '+229',  flag: '🇧🇯' },
  { name: 'Bolivia',               dial: '+591',  flag: '🇧🇴' },
  { name: 'Bosnia and Herzegovina',dial: '+387',  flag: '🇧🇦' },
  { name: 'Botswana',              dial: '+267',  flag: '🇧🇼' },
  { name: 'Brazil',                dial: '+55',   flag: '🇧🇷' },
  { name: 'Brunei',                dial: '+673',  flag: '🇧🇳' },
  { name: 'Bulgaria',              dial: '+359',  flag: '🇧🇬' },
  { name: 'Burkina Faso',          dial: '+226',  flag: '🇧🇫' },
  { name: 'Burundi',               dial: '+257',  flag: '🇧🇮' },
  { name: 'Cambodia',              dial: '+855',  flag: '🇰🇭' },
  { name: 'Cameroon',              dial: '+237',  flag: '🇨🇲' },
  { name: 'Canada',                dial: '+1',    flag: '🇨🇦' },
  { name: 'Chad',                  dial: '+235',  flag: '🇹🇩' },
  { name: 'Chile',                 dial: '+56',   flag: '🇨🇱' },
  { name: 'China',                 dial: '+86',   flag: '🇨🇳' },
  { name: 'Colombia',              dial: '+57',   flag: '🇨🇴' },
  { name: 'Congo (Brazzaville)',   dial: '+242',  flag: '🇨🇬' },
  { name: 'Congo (DRC)',           dial: '+243',  flag: '🇨🇩' },
  { name: 'Costa Rica',            dial: '+506',  flag: '🇨🇷' },
  { name: 'Croatia',               dial: '+385',  flag: '🇭🇷' },
  { name: 'Cuba',                  dial: '+53',   flag: '🇨🇺' },
  { name: 'Cyprus',                dial: '+357',  flag: '🇨🇾' },
  { name: 'Czech Republic',        dial: '+420',  flag: '🇨🇿' },
  { name: 'Denmark',               dial: '+45',   flag: '🇩🇰' },
  { name: 'Djibouti',              dial: '+253',  flag: '🇩🇯' },
  { name: 'Dominican Republic',    dial: '+1809', flag: '🇩🇴' },
  { name: 'Ecuador',               dial: '+593',  flag: '🇪🇨' },
  { name: 'Egypt',                 dial: '+20',   flag: '🇪🇬' },
  { name: 'El Salvador',           dial: '+503',  flag: '🇸🇻' },
  { name: 'Eritrea',               dial: '+291',  flag: '🇪🇷' },
  { name: 'Estonia',               dial: '+372',  flag: '🇪🇪' },
  { name: 'Ethiopia',              dial: '+251',  flag: '🇪🇹' },
  { name: 'Fiji',                  dial: '+679',  flag: '🇫🇯' },
  { name: 'Finland',               dial: '+358',  flag: '🇫🇮' },
  { name: 'France',                dial: '+33',   flag: '🇫🇷' },
  { name: 'Gabon',                 dial: '+241',  flag: '🇬🇦' },
  { name: 'Gambia',                dial: '+220',  flag: '🇬🇲' },
  { name: 'Georgia',               dial: '+995',  flag: '🇬🇪' },
  { name: 'Germany',               dial: '+49',   flag: '🇩🇪' },
  { name: 'Ghana',                 dial: '+233',  flag: '🇬🇭' },
  { name: 'Greece',                dial: '+30',   flag: '🇬🇷' },
  { name: 'Guatemala',             dial: '+502',  flag: '🇬🇹' },
  { name: 'Guinea',                dial: '+224',  flag: '🇬🇳' },
  { name: 'Guyana',                dial: '+592',  flag: '🇬🇾' },
  { name: 'Haiti',                 dial: '+509',  flag: '🇭🇹' },
  { name: 'Honduras',              dial: '+504',  flag: '🇭🇳' },
  { name: 'Hungary',               dial: '+36',   flag: '🇭🇺' },
  { name: 'Iceland',               dial: '+354',  flag: '🇮🇸' },
  { name: 'India',                 dial: '+91',   flag: '🇮🇳' },
  { name: 'Indonesia',             dial: '+62',   flag: '🇮🇩' },
  { name: 'Iran',                  dial: '+98',   flag: '🇮🇷' },
  { name: 'Iraq',                  dial: '+964',  flag: '🇮🇶' },
  { name: 'Ireland',               dial: '+353',  flag: '🇮🇪' },
  { name: 'Israel',                dial: '+972',  flag: '🇮🇱' },
  { name: 'Italy',                 dial: '+39',   flag: '🇮🇹' },
  { name: 'Ivory Coast',           dial: '+225',  flag: '🇨🇮' },
  { name: 'Jamaica',               dial: '+1876', flag: '🇯🇲' },
  { name: 'Japan',                 dial: '+81',   flag: '🇯🇵' },
  { name: 'Jordan',                dial: '+962',  flag: '🇯🇴' },
  { name: 'Kazakhstan',            dial: '+7',    flag: '🇰🇿' },
  { name: 'Kenya',                 dial: '+254',  flag: '🇰🇪' },
  { name: 'Kosovo',                dial: '+383',  flag: '🇽🇰' },
  { name: 'Kuwait',                dial: '+965',  flag: '🇰🇼' },
  { name: 'Kyrgyzstan',            dial: '+996',  flag: '🇰🇬' },
  { name: 'Laos',                  dial: '+856',  flag: '🇱🇦' },
  { name: 'Latvia',                dial: '+371',  flag: '🇱🇻' },
  { name: 'Lebanon',               dial: '+961',  flag: '🇱🇧' },
  { name: 'Liberia',               dial: '+231',  flag: '🇱🇷' },
  { name: 'Libya',                 dial: '+218',  flag: '🇱🇾' },
  { name: 'Lithuania',             dial: '+370',  flag: '🇱🇹' },
  { name: 'Luxembourg',            dial: '+352',  flag: '🇱🇺' },
  { name: 'Madagascar',            dial: '+261',  flag: '🇲🇬' },
  { name: 'Malawi',                dial: '+265',  flag: '🇲🇼' },
  { name: 'Malaysia',              dial: '+60',   flag: '🇲🇾' },
  { name: 'Maldives',              dial: '+960',  flag: '🇲🇻' },
  { name: 'Mali',                  dial: '+223',  flag: '🇲🇱' },
  { name: 'Malta',                 dial: '+356',  flag: '🇲🇹' },
  { name: 'Mauritania',            dial: '+222',  flag: '🇲🇷' },
  { name: 'Mauritius',             dial: '+230',  flag: '🇲🇺' },
  { name: 'Mexico',                dial: '+52',   flag: '🇲🇽' },
  { name: 'Moldova',               dial: '+373',  flag: '🇲🇩' },
  { name: 'Mongolia',              dial: '+976',  flag: '🇲🇳' },
  { name: 'Montenegro',            dial: '+382',  flag: '🇲🇪' },
  { name: 'Morocco',               dial: '+212',  flag: '🇲🇦' },
  { name: 'Mozambique',            dial: '+258',  flag: '🇲🇿' },
  { name: 'Myanmar',               dial: '+95',   flag: '🇲🇲' },
  { name: 'Namibia',               dial: '+264',  flag: '🇳🇦' },
  { name: 'Nepal',                 dial: '+977',  flag: '🇳🇵' },
  { name: 'Netherlands',           dial: '+31',   flag: '🇳🇱' },
  { name: 'New Zealand',           dial: '+64',   flag: '🇳🇿' },
  { name: 'Nicaragua',             dial: '+505',  flag: '🇳🇮' },
  { name: 'Niger',                 dial: '+227',  flag: '🇳🇪' },
  { name: 'Nigeria',               dial: '+234',  flag: '🇳🇬' },
  { name: 'North Macedonia',       dial: '+389',  flag: '🇲🇰' },
  { name: 'Norway',                dial: '+47',   flag: '🇳🇴' },
  { name: 'Oman',                  dial: '+968',  flag: '🇴🇲' },
  { name: 'Pakistan',              dial: '+92',   flag: '🇵🇰' },
  { name: 'Palestine',             dial: '+970',  flag: '🇵🇸' },
  { name: 'Panama',                dial: '+507',  flag: '🇵🇦' },
  { name: 'Paraguay',              dial: '+595',  flag: '🇵🇾' },
  { name: 'Peru',                  dial: '+51',   flag: '🇵🇪' },
  { name: 'Philippines',           dial: '+63',   flag: '🇵🇭' },
  { name: 'Poland',                dial: '+48',   flag: '🇵🇱' },
  { name: 'Portugal',              dial: '+351',  flag: '🇵🇹' },
  { name: 'Qatar',                 dial: '+974',  flag: '🇶🇦' },
  { name: 'Romania',               dial: '+40',   flag: '🇷🇴' },
  { name: 'Russia',                dial: '+7',    flag: '🇷🇺' },
  { name: 'Rwanda',                dial: '+250',  flag: '🇷🇼' },
  { name: 'Saudi Arabia',          dial: '+966',  flag: '🇸🇦' },
  { name: 'Senegal',               dial: '+221',  flag: '🇸🇳' },
  { name: 'Serbia',                dial: '+381',  flag: '🇷🇸' },
  { name: 'Sierra Leone',          dial: '+232',  flag: '🇸🇱' },
  { name: 'Singapore',             dial: '+65',   flag: '🇸🇬' },
  { name: 'Slovakia',              dial: '+421',  flag: '🇸🇰' },
  { name: 'Slovenia',              dial: '+386',  flag: '🇸🇮' },
  { name: 'Somalia',               dial: '+252',  flag: '🇸🇴' },
  { name: 'South Africa',          dial: '+27',   flag: '🇿🇦' },
  { name: 'South Korea',           dial: '+82',   flag: '🇰🇷' },
  { name: 'South Sudan',           dial: '+211',  flag: '🇸🇸' },
  { name: 'Spain',                 dial: '+34',   flag: '🇪🇸' },
  { name: 'Sri Lanka',             dial: '+94',   flag: '🇱🇰' },
  { name: 'Sudan',                 dial: '+249',  flag: '🇸🇩' },
  { name: 'Sweden',                dial: '+46',   flag: '🇸🇪' },
  { name: 'Switzerland',           dial: '+41',   flag: '🇨🇭' },
  { name: 'Syria',                 dial: '+963',  flag: '🇸🇾' },
  { name: 'Taiwan',                dial: '+886',  flag: '🇹🇼' },
  { name: 'Tajikistan',            dial: '+992',  flag: '🇹🇯' },
  { name: 'Tanzania',              dial: '+255',  flag: '🇹🇿' },
  { name: 'Thailand',              dial: '+66',   flag: '🇹🇭' },
  { name: 'Togo',                  dial: '+228',  flag: '🇹🇬' },
  { name: 'Tunisia',               dial: '+216',  flag: '🇹🇳' },
  { name: 'Turkey',                dial: '+90',   flag: '🇹🇷' },
  { name: 'Turkmenistan',          dial: '+993',  flag: '🇹🇲' },
  { name: 'Uganda',                dial: '+256',  flag: '🇺🇬' },
  { name: 'Ukraine',               dial: '+380',  flag: '🇺🇦' },
  { name: 'United Arab Emirates',  dial: '+971',  flag: '🇦🇪' },
  { name: 'United Kingdom',        dial: '+44',   flag: '🇬🇧' },
  { name: 'United States',         dial: '+1',    flag: '🇺🇸' },
  { name: 'Uruguay',               dial: '+598',  flag: '🇺🇾' },
  { name: 'Uzbekistan',            dial: '+998',  flag: '🇺🇿' },
  { name: 'Venezuela',             dial: '+58',   flag: '🇻🇪' },
  { name: 'Vietnam',               dial: '+84',   flag: '🇻🇳' },
  { name: 'Yemen',                 dial: '+967',  flag: '🇾🇪' },
  { name: 'Zambia',                dial: '+260',  flag: '🇿🇲' },
  { name: 'Zimbabwe',              dial: '+263',  flag: '🇿🇼' },
]

/* ── Helpers (unchanged) ────────────────────────────── */
function getStrength(pw: string) {
  let s = 0
  if (pw.length >= 8)           s++
  if (/[A-Z]/.test(pw))        s++
  if (/[0-9]/.test(pw))        s++
  if (/[^A-Za-z0-9]/.test(pw)) s++
  const map = [
    { label: '',       color: 'var(--color-border)' },
    { label: 'Weak',   color: 'var(--color-danger)' },
    { label: 'Fair',   color: 'var(--color-warning)' },
    { label: 'Good',   color: 'var(--color-primary)' },
    { label: 'Strong', color: 'var(--color-success)' },
  ]
  return { score: s, ...map[s] }
}

const ID_TYPES = [
  { value: 'Emirates ID',  label: 'Emirates ID',  flag: '🇦🇪', placeholder: '784-0000-0000000-0',   hint: '15 digits — UAE residents' },
  { value: 'Passport',     label: 'Passport',      flag: '🛂',  placeholder: 'e.g. A12345678',      hint: '6–9 alphanumeric characters' },
  { value: 'Aadhaar Card', label: 'Aadhaar Card',  flag: '🇮🇳', placeholder: '0000 0000 0000',      hint: '12-digit Indian national ID' },
  { value: 'Other',        label: 'Other Govt. ID', flag: '🪪',  placeholder: 'Enter your ID number', hint: 'Any valid government-issued ID' },
] as const

const MAX_FILE_BYTES = 3 * 1024 * 1024 // 3 MB — enforced on all document uploads

/* Stored signup documents, keyed by the File the user picked (M-05). A
   WeakMap so a discarded file is collectable; see uploadDoc() in submit(). */
const ID_DOC_META: Record<string, { label: string; hint: string }> = {
  'Emirates ID':  { label: 'Emirates ID Card Copy',  hint: 'Front & back of your Emirates ID card (PDF, JPG, PNG, max 3 MB)' },
  'Passport':     { label: 'Passport Copy',           hint: 'PDF or image of your passport identity page (max 3 MB)' },
  'Aadhaar Card': { label: 'Aadhaar Card Copy',       hint: 'Front & back of your Aadhaar card (PDF, JPG, PNG, max 3 MB)' },
  'Other':        { label: 'ID Document Copy',        hint: 'Clear scan or photo of your government-issued ID (max 3 MB)' },
}

function formatIdNumber(raw: string, type: string): string {
  if (type === 'Emirates ID') {
    const d = raw.replace(/\D/g, '').slice(0, 15)
    const parts: string[] = []
    if (d.length > 0)  parts.push(d.slice(0, 3))
    if (d.length > 3)  parts.push(d.slice(3, 7))
    if (d.length > 7)  parts.push(d.slice(7, 14))
    if (d.length > 14) parts.push(d.slice(14, 15))
    return parts.join('-')
  }
  if (type === 'Aadhaar Card') {
    const d = raw.replace(/\D/g, '').slice(0, 12)
    return d.replace(/(\d{4})(?=\d)/g, '$1 ').trim()
  }
  if (type === 'Passport') {
    return raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 9)
  }
  return raw.slice(0, 30)
}

function extractLocalPhone(full: string): string {
  const sorted = [...COUNTRIES].sort((a, b) => b.dial.length - a.dial.length)
  for (const c of sorted) {
    if (full.startsWith(c.dial)) return full.slice(c.dial.length)
  }
  return full
}

/* ── Design tokens ─────────────────────────────────── */
const inputBase = cn(
  'w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-3.5 py-2.5 text-sm text-[var(--color-text-primary)] outline-none transition-all',
  'placeholder:text-[var(--color-text-muted)]',
  'hover:border-[var(--color-border-strong)]',
  'focus:border-blue-500 focus:ring-2 focus:ring-blue-100',
)
const inputErr = cn(
  'w-full rounded-xl border border-red-300 bg-red-50 px-3.5 py-2.5 text-sm text-[var(--color-text-primary)] outline-none transition-all',
  'placeholder:text-red-300',
  'focus:border-red-400 focus:ring-2 focus:ring-red-100',
)

/* ── Sub-components ─────────────────────────────────── */
function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[12.5px] font-semibold text-[var(--color-text-secondary)] tracking-wide">{label}</label>
      {children}
      <AnimatePresence>
        {error && (
          <motion.p
            initial={{ opacity: 0, y: -4, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={{ opacity: 0, y: -4, height: 0 }}
            transition={{ duration: 0.15 }}
            className="flex items-center gap-1 text-[11px] font-medium text-red-500">
            <AlertCircle size={10} strokeWidth={2.5} className="flex-shrink-0" />
            {error}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  )
}

function Input({ error, className, ...props }: { error?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(error ? inputErr : inputBase, className)}
    />
  )
}

function Select({ error, children, ...props }: { error?: string } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select
        {...props}
        className={cn(
          error ? inputErr : inputBase,
          'appearance-none cursor-pointer pr-9',
          !props.value && 'text-[var(--color-text-muted)]',
        )}>
        {children}
      </select>
      <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
    </div>
  )
}

/* ── CustomSelect — animated dropdown to replace native <select> ── */
function CustomSelect({ options, value, onChange, error, placeholder, icon: FieldIcon }: {
  options: { value: string; label: string; icon?: string }[]
  value: string
  onChange: (v: string) => void
  error?: string
  placeholder?: string
  icon?: React.ComponentType<{ size?: number; className?: string }>
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const selected = options.find(o => o.value === value)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const triggerCls = cn(
    'flex w-full items-center gap-2.5 rounded-xl border bg-[var(--color-bg-surface)] px-3.5 py-2.5 text-left text-sm transition-all duration-150',
    error
      ? open ? 'border-red-400 ring-2 ring-red-100' : 'border-red-300 bg-red-50'
      : open ? 'border-blue-500 ring-2 ring-blue-100' : 'border-[var(--color-border)] hover:border-[var(--color-border-strong)]'
  )

  return (
    <div ref={wrapRef} className="relative">
      <button type="button" onClick={() => setOpen(o => !o)} className={triggerCls}>
        {FieldIcon && !selected?.icon && (
          <FieldIcon size={14} className="flex-shrink-0 text-[var(--color-text-muted)]" />
        )}
        {selected ? (
          <>
            {selected.icon && (
              <span style={{ fontSize: 16, lineHeight: 1, flexShrink: 0 }}>{selected.icon}</span>
            )}
            <span className="flex-1 truncate font-medium text-[var(--color-text-primary)]">{selected.label}</span>
          </>
        ) : (
          <span className="flex-1 truncate text-[var(--color-text-muted)]">{placeholder ?? 'Select…'}</span>
        )}
        <ChevronDown size={13} className={cn('flex-shrink-0 text-[var(--color-text-muted)] transition-transform duration-150', open && 'rotate-180')} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.12 }}
            className="absolute left-0 right-0 top-full z-[999] mt-1.5 overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-surface)] shadow-xl">
            {options.map(opt => (
              <button key={opt.value} type="button"
                onClick={() => { onChange(opt.value); setOpen(false) }}
                className={cn(
                  'flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm transition-colors',
                  opt.value === value ? 'bg-blue-50' : 'hover:bg-[var(--color-bg-muted)]'
                )}>
                {opt.icon && (
                  <span style={{ fontSize: 16, lineHeight: 1, flexShrink: 0 }}>{opt.icon}</span>
                )}
                <span className={cn('flex-1', opt.value === value ? 'font-semibold text-blue-700' : 'text-[var(--color-text-secondary)]')}>
                  {opt.label}
                </span>
                {opt.value === value && <Check size={13} className="flex-shrink-0 text-blue-600" />}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ── DatePicker — custom calendar replacing native <input type="date"> ── */
type PickerMode = 'day' | 'month' | 'year'

function DatePicker({ value, onChange, error, min, max, placeholder = 'Select date' }: {
  value: string; onChange: (v: string) => void; error?: string
  min?: string; max?: string; placeholder?: string
}) {
  const todayObj = new Date(); todayObj.setHours(0,0,0,0)
  const parsed   = value ? new Date(value + 'T00:00:00') : null
  const selected = parsed && !isNaN(parsed.getTime()) ? parsed : null
  const minDate  = min ? new Date(min  + 'T00:00:00') : null
  const maxDate  = max ? new Date(max  + 'T00:00:00') : null

  const initRef  = selected ?? (maxDate ?? todayObj)
  const [open,      setOpen]      = useState(false)
  const [mode,      setMode]      = useState<PickerMode>('day')
  const [viewYear,  setViewYear]  = useState(initRef.getFullYear())
  const [viewMonth, setViewMonth] = useState(initRef.getMonth())
  const [yearPage,  setYearPage]  = useState(Math.floor(initRef.getFullYear() / 12) * 12)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false); setMode('day')
      }
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const handleOpen = () => {
    if (!open) {
      const ref = selected ?? (maxDate ?? todayObj)
      setViewYear(ref.getFullYear()); setViewMonth(ref.getMonth())
      setYearPage(Math.floor(ref.getFullYear() / 12) * 12)
      setMode('day')
    }
    setOpen(o => !o)
  }

  const toStr = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`

  const isDisabled = (d: Date) => !!(
    (minDate && d < minDate) || (maxDate && d > maxDate)
  )
  const isSelected = (d: Date) => !!(selected && toStr(d) === toStr(selected))
  const isToday    = (d: Date) => toStr(d) === toStr(todayObj)

  const handleSelect = (d: Date) => {
    if (isDisabled(d)) return
    onChange(toStr(d)); setOpen(false); setMode('day')
  }

  const prevMonth = () => viewMonth === 0  ? (setViewMonth(11), setViewYear(y=>y-1)) : setViewMonth(m=>m-1)
  const nextMonth = () => viewMonth === 11 ? (setViewMonth(0),  setViewYear(y=>y+1)) : setViewMonth(m=>m+1)

  const firstDow  = new Date(viewYear, viewMonth, 1).getDay()
  const daysInMon = new Date(viewYear, viewMonth + 1, 0).getDate()
  const cells: (Date|null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({length: daysInMon}, (_,i) => new Date(viewYear, viewMonth, i+1)),
  ]

  const yearList = Array.from({length: 12}, (_, i) => yearPage + i)

  const displayValue = selected
    ? `${String(selected.getDate()).padStart(2,'0')} ${MONTHS_SHORT[selected.getMonth()]} ${selected.getFullYear()}`
    : ''

  const triggerCls = cn(
    'flex w-full items-center gap-2.5 rounded-xl border bg-[var(--color-bg-surface)] px-3.5 py-2.5 text-left text-sm transition-all duration-150',
    error
      ? open ? 'border-red-400 ring-2 ring-red-100' : 'border-red-300 bg-red-50'
      : open ? 'border-blue-500 ring-2 ring-blue-100' : 'border-[var(--color-border)] hover:border-[var(--color-border-strong)]'
  )

  return (
    <div ref={wrapRef} className="relative">
      <button type="button" onClick={handleOpen} className={triggerCls}>
        <Calendar size={14} className="flex-shrink-0 text-[var(--color-text-muted)]" />
        {displayValue
          ? <span className="flex-1 font-medium text-[var(--color-text-primary)]">{displayValue}</span>
          : <span className="flex-1 text-[var(--color-text-muted)]">{placeholder}</span>
        }
        <ChevronDown size={13} className={cn('flex-shrink-0 text-[var(--color-text-muted)] transition-transform duration-150', open && 'rotate-180')} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.12 }}
            className="absolute left-0 top-full z-[999] mt-1.5 w-72 select-none overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-surface)] shadow-2xl">

            {mode === 'day' && (<>
              <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid #F1F3F8' }}>
                <button type="button" onClick={prevMonth}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-text-secondary)]">
                  <ChevronLeft size={14} />
                </button>
                <button type="button"
                  onClick={() => { setYearPage(Math.floor(viewYear/12)*12); setMode('year') }}
                  className="flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-bold text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-bg-muted)]">
                  {MONTHS_LONG[viewMonth]} {viewYear}
                  <ChevronDown size={11} className="text-[var(--color-text-muted)]" />
                </button>
                <button type="button" onClick={nextMonth}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-text-secondary)]">
                  <ChevronRight size={14} />
                </button>
              </div>
              <div className="grid grid-cols-7 px-3 pt-3 pb-1">
                {WEEK_DAYS.map(d => (
                  <div key={d} className="flex items-center justify-center text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{d}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-y-0.5 px-3 pb-3">
                {cells.map((d, i) => {
                  if (!d) return <div key={`e${i}`} className="h-8" />
                  const dis = isDisabled(d), sel = isSelected(d), tod = isToday(d)
                  return (
                    <button key={d.getTime()} type="button" onClick={() => handleSelect(d)} disabled={dis}
                      className={cn(
                        'mx-auto flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium transition-all',
                        sel  ? 'bg-blue-600 text-white shadow-sm shadow-blue-200'
                        : tod ? 'border-2 border-blue-500 text-blue-600 hover:bg-[var(--color-hover)]'
                        : dis ? 'cursor-not-allowed text-gray-200'
                        :       'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-muted)]'
                      )}>
                      {d.getDate()}
                    </button>
                  )
                })}
              </div>
              <div className="flex items-center justify-between px-4 py-2.5" style={{ borderTop: '1px solid #F1F3F8' }}>
                <button type="button" onClick={() => onChange('')}
                  className="text-xs text-[var(--color-text-muted)] transition-colors hover:text-red-400">Clear</button>
                <button type="button"
                  onClick={() => !isDisabled(todayObj) && handleSelect(todayObj)}
                  className={cn('text-xs font-semibold transition-colors',
                    isDisabled(todayObj) ? 'cursor-not-allowed text-[var(--color-text-muted)]' : 'text-blue-600 hover:text-blue-700')}>
                  Today
                </button>
              </div>
            </>)}

            {mode === 'year' && (<>
              <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid #F1F3F8' }}>
                <button type="button" onClick={() => setYearPage(p => p - 12)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-bg-muted)]">
                  <ChevronLeft size={14} />
                </button>
                <span className="text-sm font-bold text-[var(--color-text-primary)]">{yearPage} – {yearPage + 11}</span>
                <button type="button" onClick={() => setYearPage(p => p + 12)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-bg-muted)]">
                  <ChevronRight size={14} />
                </button>
              </div>
              <div className="grid grid-cols-3 gap-1.5 p-4">
                {yearList.map(yr => (
                  <button key={yr} type="button"
                    onClick={() => { setViewYear(yr); setMode('month') }}
                    className={cn(
                      'rounded-xl py-2.5 text-sm font-semibold transition-all',
                      yr === viewYear ? 'bg-blue-600 text-white shadow-sm' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-muted)]'
                    )}>
                    {yr}
                  </button>
                ))}
              </div>
              <button type="button" onClick={() => setMode('day')}
                className="w-full py-2 text-xs text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-secondary)]"
                style={{ borderTop: '1px solid #F1F3F8' }}>
                ← Back to calendar
              </button>
            </>)}

            {mode === 'month' && (<>
              <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid #F1F3F8' }}>
                <button type="button" onClick={() => setViewYear(y => y - 1)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-bg-muted)]">
                  <ChevronLeft size={14} />
                </button>
                <span className="text-sm font-bold text-[var(--color-text-primary)]">{viewYear}</span>
                <button type="button" onClick={() => setViewYear(y => y + 1)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-bg-muted)]">
                  <ChevronRight size={14} />
                </button>
              </div>
              <div className="grid grid-cols-3 gap-1.5 p-4">
                {MONTHS_SHORT.map((m, i) => (
                  <button key={m} type="button"
                    onClick={() => { setViewMonth(i); setMode('day') }}
                    className={cn(
                      'rounded-xl py-2.5 text-sm font-semibold transition-all',
                      i === viewMonth && viewYear === (selected?.getFullYear() ?? -1)
                        ? 'bg-blue-600 text-white shadow-sm'
                        : i === viewMonth
                        ? 'border border-blue-300 text-blue-600'
                        : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-muted)]'
                    )}>
                    {m}
                  </button>
                ))}
              </div>
              <button type="button" onClick={() => setMode('year')}
                className="w-full py-2 text-xs text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-secondary)]"
                style={{ borderTop: '1px solid #F1F3F8' }}>
                ← Back to years
              </button>
            </>)}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ── PhoneInput ─────────────────────────────────────── */
function PhoneInput({ value, onChange, error, placeholder = '50 000 0000' }: {
  value: string; onChange: (v: string) => void; error?: string; placeholder?: string
}) {
  const hasErr = !!error
  const [open, setOpen]       = useState(false)
  const [search, setSearch]   = useState('')
  const [focused, setFocused] = useState(false)
  const wrapRef   = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const parsed = (() => {
    if (!value) return { dial: '+971', local: '' }
    const sorted = [...COUNTRIES].sort((a, b) => b.dial.length - a.dial.length)
    for (const c of sorted) {
      if (value.startsWith(c.dial)) return { dial: c.dial, local: value.slice(c.dial.length) }
    }
    return { dial: '+971', local: value }
  })()

  const selectedCountry = COUNTRIES.find(c => c.dial === parsed.dial) ?? COUNTRIES.find(c => c.name === 'United Arab Emirates')!
  const filtered = COUNTRIES.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) || c.dial.includes(search)
  )

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false); setSearch('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 40)
  }, [open])

  const handleLocal = (raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, 13)
    onChange(parsed.dial + digits)
  }

  const handleDial = (dial: string) => {
    onChange(dial + parsed.local)
    setOpen(false); setSearch('')
  }

  const isActive = open || focused
  const wrapCls = cn(
    'flex rounded-xl border bg-[var(--color-bg-surface)] transition-all duration-150',
    hasErr
      ? isActive ? 'border-red-400 ring-2 ring-red-100' : 'border-red-300'
      : isActive ? 'border-blue-500 ring-2 ring-blue-100' : 'border-[var(--color-border)] hover:border-[var(--color-border-strong)]'
  )

  return (
    <div ref={wrapRef} className="relative">
      <div className={wrapCls}>
        {/* Flag + dial code button */}
        <button type="button" onClick={() => setOpen(o => !o)}
          className="flex flex-shrink-0 items-center gap-1.5 rounded-l-xl bg-[var(--color-bg-muted)] px-3 py-2.5 transition-colors hover:bg-[var(--color-bg-muted)]"
          style={{ borderRight: '1px solid var(--color-border)' }}>
          <span style={{ fontSize: 16, lineHeight: 1 }}>{selectedCountry.flag}</span>
          <span className="text-sm font-semibold text-[var(--color-text-secondary)] tabular-nums">{parsed.dial}</span>
          <ChevronDown size={11} className={cn('text-[var(--color-text-muted)] transition-transform duration-150', open && 'rotate-180')} />
        </button>

        {/* Number input */}
        <input
          type="tel"
          value={parsed.local}
          placeholder={placeholder}
          onChange={e => handleLocal(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className="min-w-0 flex-1 rounded-r-xl bg-[var(--color-bg-surface)] px-3 py-2.5 text-sm text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-muted)]"
        />
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.12 }}
            className="absolute left-0 top-full z-[999] mt-1.5 overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-surface)] shadow-xl"
            style={{ width: 300 }}>
            {/* Search */}
            <div className="border-b border-[var(--color-border)] p-2.5">
              <div className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-muted)] px-2.5 py-1.5">
                <Search size={12} className="text-[var(--color-text-muted)] flex-shrink-0" />
                <input ref={searchRef} value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Search country or code…"
                  className="flex-1 bg-transparent text-xs text-[var(--color-text-secondary)] outline-none placeholder:text-[var(--color-text-muted)]" />
                {search && (
                  <button type="button" onClick={() => setSearch('')} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]">
                    <X size={11} />
                  </button>
                )}
              </div>
            </div>
            {/* List */}
            <div className="overflow-y-auto" style={{ maxHeight: 220 }}>
              {filtered.length === 0
                ? <p className="py-5 text-center text-xs text-[var(--color-text-muted)]">No results</p>
                : filtered.map(c => (
                  <button key={c.name} type="button" onClick={() => handleDial(c.dial)}
                    className={cn(
                      'flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors',
                      c.dial === parsed.dial ? 'bg-blue-50' : 'hover:bg-[var(--color-bg-muted)]'
                    )}>
                    <span style={{ fontSize: 16, lineHeight: 1, flexShrink: 0 }}>{c.flag}</span>
                    <span className="flex-1 truncate text-xs text-[var(--color-text-secondary)]">{c.name}</span>
                    <span className="font-mono text-[10px] text-[var(--color-text-muted)]">{c.dial}</span>
                    {c.dial === parsed.dial && <Check size={11} className="flex-shrink-0 text-blue-600" />}
                  </button>
                ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ── CountryPicker ──────────────────────────────────── */
function CountryPicker({ value, onChange, error, placeholder = 'Search and select country…' }: {
  value: string; onChange: (v: string) => void; error?: string; placeholder?: string
}) {
  const hasErr = !!error
  const [open, setOpen]     = useState(false)
  const [search, setSearch] = useState('')
  const wrapRef   = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const selected = COUNTRIES.find(c => c.name === value)
  const filtered = COUNTRIES.filter(c => c.name.toLowerCase().includes(search.toLowerCase()))

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false); setSearch('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 40)
  }, [open])

  const triggerCls = cn(
    'flex w-full items-center gap-2 rounded-xl border bg-[var(--color-bg-surface)] px-3.5 py-2.5 text-left text-sm transition-all duration-150',
    hasErr
      ? open ? 'border-red-400 ring-2 ring-red-100' : 'border-red-300 bg-red-50'
      : open ? 'border-blue-500 ring-2 ring-blue-100' : 'border-[var(--color-border)] hover:border-[var(--color-border-strong)]'
  )

  return (
    <div ref={wrapRef} className="relative">
      <button type="button" onClick={() => setOpen(o => !o)} className={triggerCls}>
        {selected ? (
          <>
            <span style={{ fontSize: 18, lineHeight: 1, flexShrink: 0 }}>{selected.flag}</span>
            <span className="flex-1 truncate text-[var(--color-text-primary)] text-sm">{selected.name}</span>
          </>
        ) : (
          <span className="flex-1 truncate text-[var(--color-text-muted)] text-sm">{placeholder}</span>
        )}
        <ChevronDown size={14} className={cn('flex-shrink-0 text-[var(--color-text-muted)] transition-transform duration-150', open && 'rotate-180')} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.12 }}
            className="absolute left-0 right-0 top-full z-[999] mt-1.5 overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-surface)] shadow-xl">
            {/* Search */}
            <div className="border-b border-[var(--color-border)] p-2.5">
              <div className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-muted)] px-2.5 py-1.5">
                <Search size={12} className="text-[var(--color-text-muted)] flex-shrink-0" />
                <input ref={searchRef} value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Search country…"
                  className="flex-1 bg-transparent text-xs text-[var(--color-text-secondary)] outline-none placeholder:text-[var(--color-text-muted)]" />
                {search && (
                  <button type="button" onClick={() => setSearch('')} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]">
                    <X size={11} />
                  </button>
                )}
              </div>
            </div>
            {/* List */}
            <div className="overflow-y-auto" style={{ maxHeight: 220 }}>
              {filtered.length === 0
                ? <p className="py-5 text-center text-xs text-[var(--color-text-muted)]">No countries found</p>
                : filtered.map(c => (
                  <button key={c.name} type="button"
                    onClick={() => { onChange(c.name); setOpen(false); setSearch('') }}
                    className={cn(
                      'flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors',
                      c.name === value ? 'bg-blue-50' : 'hover:bg-[var(--color-bg-muted)]'
                    )}>
                    <span style={{ fontSize: 17, lineHeight: 1, flexShrink: 0 }}>{c.flag}</span>
                    <span className="flex-1 text-sm text-[var(--color-text-secondary)]">{c.name}</span>
                    {c.name === value && <Check size={13} className="flex-shrink-0 text-blue-600" />}
                  </button>
                ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ── FileDropzone ───────────────────────────────────── */
function FileDropzone({ label, accept, file, onFile, onClear, hint }: {
  label: string; accept: string; file: File | null
  onFile: (f: File) => void; onClear: () => void; hint?: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[12.5px] font-semibold text-[var(--color-text-secondary)] tracking-wide">{label}</label>
      {file ? (
        <div className="flex items-center gap-2.5 rounded-xl border border-blue-200 bg-blue-50 px-3.5 py-2.5">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-blue-100">
            <FileText size={14} className="text-blue-600" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-[var(--color-text-primary)]">{file.name}</p>
            <p className="text-[10px] text-[var(--color-text-muted)]">{(file.size / 1024).toFixed(0)} KB</p>
          </div>
          <button type="button" onClick={onClear}
            className="flex-shrink-0 rounded-full p-1 text-[var(--color-text-muted)] transition-colors hover:bg-red-100 hover:text-red-500">
            <X size={12} />
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => ref.current?.click()}
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) onFile(f) }}
          className={cn(
            'flex flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-5 text-center transition-all',
            dragging
              ? 'border-blue-400 bg-blue-50'
              : 'border-[var(--color-border)] bg-[var(--color-bg-muted)] hover:border-blue-300 hover:bg-[var(--color-hover)]/50'
          )}>
          <div className={cn(
            'flex h-9 w-9 items-center justify-center rounded-full transition-colors',
            dragging ? 'bg-blue-100' : 'bg-[var(--color-bg-muted)]'
          )}>
            <Upload size={16} className={dragging ? 'text-blue-600' : 'text-[var(--color-text-muted)]'} />
          </div>
          <div>
            <p className="text-xs font-semibold text-[var(--color-text-secondary)]">
              {dragging ? 'Drop to upload' : 'Click to upload or drag & drop'}
            </p>
            {hint && <p className="mt-0.5 text-[10px] text-[var(--color-text-muted)]">{hint}</p>}
          </div>
        </button>
      )}
      <input ref={ref} type="file" accept={accept} className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f) }} />
    </div>
  )
}

/* ── Main component ─────────────────────────────────── */
export function RegisterForm({ onSwitch }: { onSwitch: () => void }) {
  const [step,          setStep]          = useState(0)
  const [data,          setData]          = useState<FormData>(INITIAL)
  const [errors,        setErrors]        = useState<Partial<Record<keyof FormData, string>>>({})
  const [loading,       setLoading]       = useState(false)
  const [apiErr,        setApiErr]        = useState<string | null>(null)
  const [showPw,        setShowPw]        = useState(false)
  const [showCpw,       setShowCpw]       = useState(false)
  const [avatarFile,    setAvatarFile]    = useState<File | null>(null)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
  const [avatarError,   setAvatarError]   = useState<string | null>(null)
  const [showTerms,     setShowTerms]     = useState(false)

  // ── Registration mode ────────────────────────────────
  const [mode, setMode] = useState<'express' | 'full'>('express')

  // ── Express account form state ───────────────────────
  const [expressData, setExpressData] = useState({
    name: '', email: '', organizationSlug: '' as '' | 'dubai' | 'bangalore', homeCountry: '', password: '', termsAccepted: false,
  })
  const [expressErrors, setExpressErrors] = useState<{
    name?: string; email?: string; organizationSlug?: string; homeCountry?: string;
    password?: string; termsAccepted?: string
  }>({})
  const [expressLoading, setExpressLoading] = useState(false)
  const [expressApiErr,  setExpressApiErr]  = useState<string | null>(null)
  const [expressShowPw,  setExpressShowPw]  = useState(false)

  const setEx = (k: keyof typeof expressData, v: unknown) => {
    setExpressData(d => ({ ...d, [k]: v }))
    setExpressErrors(e => ({ ...e, [k]: undefined }))
  }

  const set = (k: keyof FormData, v: unknown) => {
    setData(d => ({ ...d, [k]: v }))
    setErrors(e => ({ ...e, [k]: undefined }))
  }

  /* ── Validation ────────────────────────────────────── */
  function validateStep(s: number): boolean {
    const errs: Partial<Record<keyof FormData, string>> = {}
    let avatarErr = false

    if (s === 0) {
      if (!avatarFile) { setAvatarError('Profile photo is required'); avatarErr = true }
      else setAvatarError(null)

      const name = data.name.trim()
      if (!name) {
        errs.name = 'Full name is required'
      } else if (name.split(/\s+/).length < 2) {
        errs.name = 'Enter your first and last name'
      } else if (!/^[a-zA-Z\s\-'\.]+$/.test(name)) {
        errs.name = 'Name must contain letters only'
      }

      if (!data.email.trim()) {
        errs.email = 'Email is required'
      } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
        errs.email = 'Enter a valid email address'
      }

      if (!data.phone) {
        errs.phone = 'Phone number is required'
      } else {
        const local = extractLocalPhone(data.phone)
        if (local.length < 5) errs.phone = 'Enter a complete phone number'
        else if (local.length > 13) errs.phone = 'Phone number is too long'
      }

      if (!data.emergencyContact) {
        errs.emergencyContact = 'Emergency contact is required'
      } else {
        const local = extractLocalPhone(data.emergencyContact)
        if (local.length < 5) errs.emergencyContact = 'Enter a complete phone number'
      }

      if (!data.gender) errs.gender = 'Please select gender'

      if (!data.dateOfBirth) {
        errs.dateOfBirth = 'Date of birth is required'
      } else {
        const dob = new Date(data.dateOfBirth)
        const now = new Date()
        const age = now.getFullYear() - dob.getFullYear()
          - ((now.getMonth() < dob.getMonth() || (now.getMonth() === dob.getMonth() && now.getDate() < dob.getDate())) ? 1 : 0)
        if (isNaN(dob.getTime())) errs.dateOfBirth = 'Enter a valid date'
        else if (age < 10)        errs.dateOfBirth = 'You must be at least 10 years old'
        else if (age > 100)       errs.dateOfBirth = 'Enter a valid date of birth'
      }

      const nat = data.nationality.trim()
      if (!nat) {
        errs.nationality = 'Nationality is required'
      } else if (nat.length < 3) {
        errs.nationality = 'Enter a valid nationality'
      } else if (!/^[a-zA-Z\s\-]+$/.test(nat)) {
        errs.nationality = 'Nationality should contain letters only'
      }

      if (!data.homeCountry) errs.homeCountry = 'Please select your home country'

      if (!data.occupation.trim()) errs.occupation = 'Occupation is required'
      else if (data.occupation.trim().length < 2) errs.occupation = 'Enter a valid occupation'

      if (!data.idType) {
        errs.idType = 'Please select your ID type'
      } else if (!data.idNumber.trim()) {
        errs.idNumber = 'ID number is required'
      } else {
        const num = data.idNumber.trim()
        if (data.idType === 'Emirates ID') {
          const digits = num.replace(/\D/g, '')
          if (digits.length !== 15)       errs.idNumber = 'Emirates ID must be 15 digits (784-XXXX-XXXXXXX-X)'
          else if (!digits.startsWith('784')) errs.idNumber = 'Emirates ID must start with 784'
        } else if (data.idType === 'Passport') {
          const clean = num.replace(/[^A-Z0-9]/gi, '')
          if (clean.length < 6 || clean.length > 9) errs.idNumber = 'Passport number must be 6–9 alphanumeric characters'
        } else if (data.idType === 'Aadhaar Card') {
          const digits = num.replace(/\D/g, '')
          if (digits.length !== 12) errs.idNumber = 'Aadhaar Card must be exactly 12 digits'
        } else if (num.length < 4) {
          errs.idNumber = 'ID number must be at least 4 characters'
        }
      }
    }

    if (s === 1) {
      if (!data.countryAttendance) errs.countryAttendance = 'Please select country of attendance'
      if (!data.villa.trim())       errs.villa             = 'Villa / Apartment is required'
      if (!data.city.trim())        errs.city              = 'City is required'
      if (!data.addressCountry)     errs.addressCountry    = 'Please select your country'
      if (!data.passportFile)                              errs.passportFile = 'Passport copy is required'
      else if (data.passportFile.size > MAX_FILE_BYTES)   errs.passportFile = 'Passport copy must not exceed 3 MB'
      if (!data.idType)                                   errs.idType       = 'Please select your ID type first'
      /* A student whose ID IS their passport has already uploaded it above.
         ID_DOC_META['Passport'] is literally labelled "Passport Copy", so this
         asked for the same page twice, both required, one right under the
         other -- and the only way past the second box was to upload the same
         file again or something arbitrary. */
      else if (data.idType !== 'Passport' && !data.idDocFile)
        errs.idDocFile = `${ID_DOC_META[data.idType]?.label ?? 'ID document'} is required`
      else if (data.idDocFile && data.idDocFile.size > MAX_FILE_BYTES)
        errs.idDocFile = `${ID_DOC_META[data.idType]?.label ?? 'ID document'} must not exceed 3 MB`
    }

    if (s === 2) {
      if (!data.experienceLevel)      errs.experienceLevel    = 'Please select experience level'
      if (!data.preferredStartDate)   errs.preferredStartDate = 'Preferred start date is required'
      else {
        const d = new Date(data.preferredStartDate)
        if (d < new Date()) errs.preferredStartDate = 'Start date must be in the future'
      }
      if (!data.hearAboutUs)          errs.hearAboutUs        = 'Please tell us how you heard about us'
      if (data.programs.length === 0) errs.programs           = 'Please select at least one program'
    }

    if (s === 3) {
      if (!data.organizationSlug) errs.organizationSlug = 'Please select your preferred learning center'
      if (!data.paymentMethod) errs.paymentMethod = 'Please select payment method'
      if (!data.password)      errs.password      = 'Password is required'
      else if (data.password.length < 8)          errs.password = 'At least 8 characters required'
      else if (!/[A-Z]/.test(data.password))      errs.password = 'Must include an uppercase letter'
      else if (!/[0-9]/.test(data.password))      errs.password = 'Must include a number'
      if (data.password !== data.confirmPassword) errs.confirmPassword = 'Passwords do not match'
      if (!data.termsAccepted) errs.termsAccepted = 'You must accept the terms to continue'
    }

    setErrors(errs)
    return Object.keys(errs).length === 0 && !avatarErr
  }

  function next() { if (validateStep(step)) setStep(s => s + 1) }
  function back() { setErrors({}); setStep(s => s - 1) }

  /* ── Submit (unchanged) ─────────────────────────────── */
  async function submit() {
    if (!validateStep(3)) return

    // Hard guard — reject missing or oversized files before creating the account
    if (!avatarFile) {
      setAvatarError('Profile photo is required')
      setStep(0); return
    }
    if (avatarFile.size > MAX_FILE_BYTES) {
      setAvatarError('Profile photo must not exceed 3 MB')
      setStep(0); return
    }
    if (!data.passportFile) {
      setErrors(e => ({ ...e, passportFile: 'Passport copy is required' }))
      setStep(1); return
    }
    if (data.passportFile.size > MAX_FILE_BYTES) {
      setErrors(e => ({ ...e, passportFile: 'Passport copy must not exceed 3 MB' }))
      setStep(1); return
    }
    /* Same exemption as the step check. Without it this guard bounced the
       student back to step 1 for a document the form had (correctly) stopped
       asking them for -- and the box it pointed at was no longer on screen. */
    if (data.idType !== 'Passport' && !data.idDocFile) {
      setErrors(e => ({ ...e, idDocFile: `${ID_DOC_META[data.idType]?.label ?? 'ID document'} is required` }))
      setStep(1); return
    }
    if (data.idDocFile && data.idDocFile.size > MAX_FILE_BYTES) {
      setErrors(e => ({ ...e, idDocFile: `${ID_DOC_META[data.idType]?.label ?? 'ID document'} must not exceed 3 MB` }))
      setStep(1); return
    }

    setLoading(true); setApiErr(null)
    try {
      /* Documents go up BEFORE the account is created (M-05).

         They used to go up after, using the session /auth/register returns —
         so turning on SIGNUP_REQUIRE_VERIFICATION, which returns no session,
         would have made all three uploads and both profile patches 401 and
         every full signup would have quietly lost its documents. Uploading
         first and passing the references into the register payload removes
         that dependency: registration is now a single request that needs no
         session on either side of it.

         POST /uploads/signup-doc is the unauthenticated counterpart of
         /uploads/kyc — same file types, same magic-byte check, a tighter size
         cap and its own hourly limit. `kind: 'photo'` selects the public
         prefix for the avatar; anything else lands under the private `kyc/`
         one, which is never served directly. */
      const passportUrl = await uploadSignupDoc(data.passportFile, 'kyc', 'passport copy')
      /* The passport IS the ID document for these students, so send it as
         both rather than uploading the same bytes twice or leaving a required
         field empty. */
      const idDocUrl    = data.idType === 'Passport'
        ? passportUrl
        /* Non-null by the guard above: for every type EXCEPT Passport that
           guard returns early when the file is missing. The type checker
           cannot see across it, and the assertion is narrower than widening
           uploadDoc to take a null it should never receive. */
        : await uploadSignupDoc(data.idDocFile!, 'kyc', ID_DOC_META[data.idType]?.label ?? 'ID document')
      const photoUrl    = await uploadSignupDoc(avatarFile,        'photo', 'profile photo')

      /* The global axios timeout is 15s, which is right for the reads this
         app makes and wrong for this one request. It is the last step of a
         four-screen form, it runs on a connection that has just carried up
         to three files, and losing it to the clock discards everything the
         student typed. The server side is quick — one bcrypt and a couple of
         writes, with the emails fired and not awaited — so a longer budget
         costs nothing and only ever helps a slow link. */
      const reg = await api.post('/auth/register', {
        name:             data.name.trim(),
        email:            data.email.trim().toLowerCase(),
        password:         data.password,
        organizationSlug: data.organizationSlug,
        enrollmentApplication: {
          passportUrl, idDocUrl, photoUrl,
          phone: data.phone, emergencyContact: data.emergencyContact,
          gender: data.gender, dateOfBirth: data.dateOfBirth,
          nationality: data.nationality, homeCountry: data.homeCountry,
          occupation: data.occupation, idType: data.idType, idNumber: data.idNumber,
          countryAttendance: data.countryAttendance, villa: data.villa,
          city: data.city, addressCountry: data.addressCountry,
          experienceLevel: data.experienceLevel, preferredStartDate: data.preferredStartDate,
          hearAboutUs: data.hearAboutUs, referralName: data.referralName || undefined,
          programs: data.programs, paymentMethod: data.paymentMethod,
        },
      }, { timeout: 45_000 })

      /* Verification-first mode issues no session, and nothing after this point
         needs one — the documents were stored above and travelled in with the
         register payload, so both branches below are complete accounts. */
      if (reg.data?.data?.verificationRequired) {
        window.location.href = '/login?verify=sent'
        return
      }

      window.location.href = '/my-learning'
    } catch (err: unknown) {
      const resp = (err as { response?: { data?: { error?: { message?: string; code?: string } } } })?.response?.data?.error
      const code = resp?.code
      /* An error the API SENT wins: it knows what was wrong. Only when there
         is no response at all do we describe the transport, so the student
         never reads "Failed to fetch" or "Network Error" — neither of which
         is a sentence about them or their form. The uploader above already
         returns prose, so its message passes through untouched. */
      const msg  = resp?.message
        ?? describeTransportError(err)
        ?? (err instanceof Error ? err.message : undefined)
        ?? 'Registration failed. Please try again.'
      if (code === 'EMAIL_TAKEN') {
        setStep(3)
        setErrors(e => ({ ...e, email: msg }))
      } else {
        setApiErr(msg)
      }
      setLoading(false)
    }
  }

  async function submitExpress() {
    const errs: typeof expressErrors = {}
    const name = expressData.name.trim()

    /* Name */
    if (!name) errs.name = 'Full name is required'
    else if (name.split(/\s+/).length < 2) errs.name = 'Enter your first and last name'
    else if (!/^[a-zA-Z\s\-'\.]+$/.test(name)) errs.name = 'Name must contain letters only'

    /* Email */
    if (!expressData.email.trim()) errs.email = 'Email is required'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(expressData.email)) errs.email = 'Enter a valid email address'

    /* Preferred learning center */
    if (!expressData.organizationSlug) errs.organizationSlug = 'Please select your preferred learning center'

    /* Country */
    if (!expressData.homeCountry) errs.homeCountry = 'Please select your country'

    /* Password */
    if (!expressData.password) errs.password = 'Password is required'
    else if (expressData.password.length < 8) errs.password = 'At least 8 characters required'
    else if (!/[A-Z]/.test(expressData.password)) errs.password = 'Must include an uppercase letter'
    else if (!/[0-9]/.test(expressData.password)) errs.password = 'Must include a number'

    /* Terms */
    if (!expressData.termsAccepted) errs.termsAccepted = 'You must accept the terms to continue'

    setExpressErrors(errs)
    if (Object.keys(errs).length > 0) return

    setExpressLoading(true)
    setExpressApiErr(null)
    try {
      const reg = await api.post('/auth/register', {
        name,
        email:            expressData.email.trim().toLowerCase(),
        password:         expressData.password,
        signupType:       'express',
        organizationSlug: expressData.organizationSlug,
        enrollmentApplication: {
          homeCountry: expressData.homeCountry,
        },
      })
      /* Verification-first mode returns no session (M-05) — the same answer a taken address gets. Send the user to sign-in with a note rather than to a page that would bounce them straight back. */
      if (reg.data?.data?.verificationRequired) {
        window.location.href = '/login?verify=sent'
        return
      }

      window.location.href = '/my-learning'
    } catch (err: unknown) {
      const resp = (err as { response?: { data?: { error?: { message?: string; code?: string } } } })?.response?.data?.error
      const code = resp?.code
      const msg  = resp?.message
        ?? describeTransportError(err)
        ?? (err instanceof Error ? err.message : undefined)
        ?? 'Registration failed. Please try again.'
      if (code === 'EMAIL_TAKEN') {
        setExpressErrors(e => ({ ...e, email: msg }))
      } else {
        setExpressApiErr(msg)
      }
      setExpressLoading(false)
    }
  }

  const strength = getStrength(data.password)

  /* ── Step content ───────────────────────────────────── */
  function renderStep() {
    if (step === 0) return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">

        {/* ── Profile photo ───────────────────────────── */}
        <div className="sm:col-span-2 flex flex-col items-center gap-1.5 pb-2">
          <label htmlFor="avatar-upload" className="group cursor-pointer">
            <div className="relative h-20 w-20 overflow-hidden rounded-full border-2 border-dashed border-[var(--color-border-strong)] bg-[var(--color-bg-muted)] transition-colors group-hover:border-blue-400">
              {avatarPreview
                ? <img src={avatarPreview} alt="Profile" className="h-full w-full object-cover" />
                : <div className="flex h-full w-full items-center justify-center">
                    <Camera size={22} className="text-[var(--color-text-muted)] transition-colors group-hover:text-blue-400" />
                  </div>
              }
              <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/30 opacity-0 transition-opacity group-hover:opacity-100">
                <Camera size={15} className="text-white" />
              </div>
            </div>
          </label>
          <input id="avatar-upload" type="file" accept="image/*" className="hidden"
            onChange={e => {
              const f = e.target.files?.[0]
              if (!f) return
              if (f.size > MAX_FILE_BYTES) {
                setAvatarError('Profile photo must not exceed 3 MB')
                e.target.value = ''
                return
              }
              setAvatarFile(f)
              setAvatarPreview(URL.createObjectURL(f))
              setAvatarError(null)
            }}
          />
          <p className="text-[11px] text-[var(--color-text-muted)]">Profile photo <span className="text-red-400">*</span> <span className="text-[var(--color-text-muted)]">(max 3 MB)</span></p>
          {avatarError && (
            <p className="flex items-center gap-1 text-[11px] font-medium text-red-500">
              <AlertCircle size={10} strokeWidth={2.5} />{avatarError}
            </p>
          )}
        </div>

        <Field label="Full Name *" error={errors.name}>
          <div className="relative">
            <User size={14} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <Input error={errors.name} value={data.name} placeholder="e.g. Ahmed Al Mansouri"
              className="pl-9" onChange={e => set('name', e.target.value)} />
          </div>
        </Field>

        <Field label="Email Address *" error={errors.email}>
          <div className="relative">
            <Mail size={14} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <Input error={errors.email} value={data.email} type="email" placeholder="you@example.com"
              className="pl-9" onChange={e => set('email', e.target.value)} />
          </div>
        </Field>

        <Field label="Phone / WhatsApp *" error={errors.phone}>
          <PhoneInput value={data.phone} onChange={v => set('phone', v)} error={errors.phone} />
        </Field>

        <Field label="Emergency Contact *" error={errors.emergencyContact}>
          <PhoneInput value={data.emergencyContact} onChange={v => set('emergencyContact', v)}
            error={errors.emergencyContact} placeholder="Emergency number" />
        </Field>

        <Field label="Gender *" error={errors.gender}>
          <CustomSelect
            options={GENDER_OPTIONS}
            value={data.gender}
            onChange={v => set('gender', v)}
            error={errors.gender}
            placeholder="Select gender"
          />
        </Field>

        <Field label="Date of Birth *" error={errors.dateOfBirth}>
          <DatePicker
            value={data.dateOfBirth}
            onChange={v => set('dateOfBirth', v)}
            error={errors.dateOfBirth}
            max={new Date(new Date().setFullYear(new Date().getFullYear() - 10)).toISOString().split('T')[0]}
            placeholder="Select date of birth"
          />
        </Field>

        <Field label="Nationality *" error={errors.nationality}>
          <div className="relative">
            <Globe size={14} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <Input error={errors.nationality} value={data.nationality} placeholder="e.g. Emirati"
              className="pl-9"
              onChange={e => set('nationality', e.target.value.replace(/[^a-zA-Z\s\-]/g, ''))} />
          </div>
        </Field>

        <Field label="Home Country *" error={errors.homeCountry}>
          <CountryPicker value={data.homeCountry} onChange={v => set('homeCountry', v)}
            error={errors.homeCountry} placeholder="Select home country…" />
        </Field>

        <Field label="Occupation *" error={errors.occupation}>
          <div className="relative">
            <Briefcase size={14} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <Input error={errors.occupation} value={data.occupation} placeholder="e.g. Business Owner"
              className="pl-9" onChange={e => set('occupation', e.target.value)} />
          </div>
        </Field>

        <Field label="ID Type *" error={errors.idType}>
          <CustomSelect
            options={ID_TYPES.map(t => ({ value: t.value, label: t.label, icon: t.flag }))}
            value={data.idType}
            onChange={v => { set('idType', v); set('idNumber', '') }}
            error={errors.idType}
            placeholder="Select ID type…"
            icon={CreditCard}
          />
        </Field>

        {data.idType && (() => {
          const cfg = ID_TYPES.find(t => t.value === data.idType)!
          return (
            <Field label={`${cfg.label} Number *`} error={errors.idNumber}>
              <div className="space-y-1">
                <Input
                  error={errors.idNumber}
                  value={data.idNumber}
                  placeholder={cfg.placeholder}
                  onChange={e => set('idNumber', formatIdNumber(e.target.value, data.idType))}
                />
                <p className="pl-0.5 text-[11px] text-[var(--color-text-muted)]">{cfg.hint}</p>
              </div>
            </Field>
          )
        })()}
      </div>
    )

    if (step === 1) return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Country of Attendance *" error={errors.countryAttendance}>
            <CountryPicker value={data.countryAttendance} onChange={v => set('countryAttendance', v)}
              error={errors.countryAttendance} placeholder="Which country will you attend from?" />
          </Field>
        </div>

        <Field label="Villa / Apartment *" error={errors.villa}>
          <div className="relative">
            <MapPin size={14} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <Input error={errors.villa} value={data.villa} placeholder="Villa 12, Al Barsha"
              className="pl-9" onChange={e => set('villa', e.target.value)} />
          </div>
        </Field>

        <Field label="City / Town *" error={errors.city}>
          <div className="relative">
            <MapPin size={14} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <Input error={errors.city} value={data.city} placeholder="Dubai"
              className="pl-9" onChange={e => set('city', e.target.value)} />
          </div>
        </Field>

        <div className="sm:col-span-2">
          <Field label="Country *" error={errors.addressCountry}>
            <CountryPicker value={data.addressCountry} onChange={v => set('addressCountry', v)}
              error={errors.addressCountry} placeholder="Select country…" />
          </Field>
        </div>

        <div className="sm:col-span-2 flex flex-col gap-4">
          {/* Passport upload — always required */}
          <div>
            <FileDropzone
              label="Passport Copy * (PDF, JPG, PNG)"
              accept=".pdf,.jpg,.jpeg,.png,.webp"
              file={data.passportFile}
              onFile={f => {
                if (f.size > MAX_FILE_BYTES) {
                  setErrors(e => ({ ...e, passportFile: 'Passport copy must not exceed 3 MB' }))
                  return
                }
                set('passportFile', f)
              }}
              onClear={() => set('passportFile', null)}
              hint="Clear scan or photo of your passport identity page (max 3 MB)"
            />
            {errors.passportFile && (
              <p className="flex items-center gap-1 text-[11px] font-medium text-red-500 mt-1">
                <AlertCircle size={10} strokeWidth={2.5} />{errors.passportFile}
              </p>
            )}
          </div>

          {/* Selected ID document upload — label depends on idType.
              Skipped when that type is Passport: it is the file above. */}
          {data.idType === 'Passport' ? (
            <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.45)' }}>
              You chose Passport as your ID, so the copy above is the only
              document we need.
            </p>
          ) : (() => {
            const docMeta = ID_DOC_META[data.idType] ?? { label: 'ID Document Copy', hint: 'Clear scan or photo of your government-issued ID (max 10 MB)' }
            return (
              <div>
                <FileDropzone
                  label={`${docMeta.label} * (PDF, JPG, PNG)`}
                  accept=".pdf,.jpg,.jpeg,.png,.webp"
                  file={data.idDocFile}
                  onFile={f => {
                    if (f.size > MAX_FILE_BYTES) {
                      setErrors(e => ({ ...e, idDocFile: `${docMeta.label} must not exceed 3 MB` }))
                      return
                    }
                    set('idDocFile', f)
                  }}
                  onClear={() => set('idDocFile', null)}
                  hint={docMeta.hint}
                />
                {errors.idDocFile && (
                  <p className="flex items-center gap-1 text-[11px] font-medium text-red-500 mt-1">
                    <AlertCircle size={10} strokeWidth={2.5} />{errors.idDocFile}
                  </p>
                )}
              </div>
            )
          })()}
        </div>

      </div>
    )

    if (step === 2) return (
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Experience Level *" error={errors.experienceLevel}>
            <CustomSelect
              options={EXPERIENCE_OPTIONS}
              value={data.experienceLevel}
              onChange={v => set('experienceLevel', v)}
              error={errors.experienceLevel}
              placeholder="Select level"
            />
          </Field>

          <Field label="Preferred Start Date *" error={errors.preferredStartDate}>
            <DatePicker
              value={data.preferredStartDate}
              onChange={v => set('preferredStartDate', v)}
              error={errors.preferredStartDate}
              min={new Date().toISOString().split('T')[0]}
              placeholder="Select start date"
            />
          </Field>

          <Field label="How did you hear about us? *" error={errors.hearAboutUs}>
            <CustomSelect
              options={HEAR_OPTIONS}
              value={data.hearAboutUs}
              onChange={v => set('hearAboutUs', v)}
              error={errors.hearAboutUs}
              placeholder="Select source"
            />
          </Field>

          {data.hearAboutUs === 'Friend / Referral' && (
            <Field label="Who referred you?">
              <Input value={data.referralName} placeholder="Referral name"
                onChange={e => set('referralName', e.target.value)} />
            </Field>
          )}
        </div>

        <Field label="Select Programs & Courses *" error={errors.programs}>
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-muted)] p-4">
            <div className="flex flex-col gap-4">
              {PROGRAM_GROUPS.map(group => (
                <div key={group}>
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-muted)]">{group}</p>
                  <div className="flex flex-wrap gap-2">
                    {PROGRAMS.filter(p => p.group === group).map(p => {
                      const active = data.programs.includes(p.id)
                      return (
                        <button key={p.id} type="button"
                          onClick={() => set('programs', active ? data.programs.filter(x => x !== p.id) : [...data.programs, p.id])}
                          className={cn(
                            'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all',
                            active
                              ? 'bg-blue-600 text-white shadow-sm shadow-blue-200'
                              : 'border border-[var(--color-border)] bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)] hover:border-blue-300 hover:text-blue-600'
                          )}>
                          {active && <Check size={10} strokeWidth={3} />}
                          {p.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Field>
      </div>
    )

    return (
      <div className="flex flex-col gap-4">
        <Field label="Preferred Learning Center *" error={errors.organizationSlug}>
          <CustomSelect
            options={[
              { value: 'dubai',     label: 'Dubai, UAE' },
              { value: 'bangalore', label: 'Bangalore, India' },
            ]}
            value={data.organizationSlug}
            onChange={v => set('organizationSlug', v)}
            error={errors.organizationSlug}
            placeholder="Select your preferred learning center…"
            icon={Building2}
          />
        </Field>

        <Field label="Payment Method *" error={errors.paymentMethod}>
          <CustomSelect
            options={PAYMENT_OPTIONS}
            value={data.paymentMethod}
            onChange={v => set('paymentMethod', v)}
            error={errors.paymentMethod}
            placeholder="Select payment method"
            icon={CreditCard}
          />
        </Field>

        <Field label="Password *" error={errors.password}>
          <div className="relative">
            <Lock size={14} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <input
              type={showPw ? 'text' : 'password'} value={data.password}
              placeholder="Min. 8 chars, uppercase + number"
              onChange={e => set('password', e.target.value)}
              className={cn(errors.password ? inputErr : inputBase, 'pl-9 pr-10')}
            />
            <button type="button" onClick={() => setShowPw(x => !x)}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors">
              {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
          {data.password && (
            <div className="flex items-center gap-2 pt-0.5">
              <div className="flex flex-1 gap-1">
                {[1,2,3,4].map(i => (
                  <div key={i} className="h-1.5 flex-1 rounded-full transition-all duration-300"
                    style={{ background: i <= strength.score ? strength.color: 'var(--color-border)' }} />
                ))}
              </div>
              <span className="text-[10px] font-bold" style={{ color: strength.color }}>{strength.label}</span>
            </div>
          )}
        </Field>

        <Field label="Confirm Password *" error={errors.confirmPassword}>
          <div className="relative">
            <Lock size={14} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <input
              type={showCpw ? 'text' : 'password'} value={data.confirmPassword}
              placeholder="Repeat your password"
              onChange={e => set('confirmPassword', e.target.value)}
              className={cn(errors.confirmPassword ? inputErr : inputBase, 'pl-9 pr-10')}
            />
            <button type="button" onClick={() => setShowCpw(x => !x)}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors">
              {showCpw ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </Field>

        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-muted)] p-3.5 hover:border-blue-200 hover:bg-[var(--color-hover)]/40 transition-all">
          <input type="checkbox" checked={data.termsAccepted}
            onChange={e => set('termsAccepted', e.target.checked)}
            className="mt-0.5 h-4 w-4 flex-shrink-0 cursor-pointer rounded accent-blue-600" />
          <span className="text-xs leading-relaxed text-[var(--color-text-secondary)]">
            I agree to Delta Institutions&apos;{' '}
            <button
              type="button"
              onClick={e => { e.preventDefault(); setShowTerms(true) }}
              className="font-semibold transition-colors hover:opacity-80"
              style={{ color: 'var(--color-primary)' }}
            >
              Terms &amp; Conditions
            </button>
            , Privacy Policy, and KHDA training regulations.
            I confirm the information provided is accurate and complete.
          </span>
        </label>
        {errors.termsAccepted && (
          <p className="flex items-center gap-1 text-[11px] font-medium text-red-500">
            <AlertCircle size={10} strokeWidth={2.5} />{errors.termsAccepted}
          </p>
        )}
      </div>
    )
  }

  /* ── Render ─────────────────────────────────────────── */
  const expressStrength = getStrength(expressData.password)

  return (
    <div className="flex flex-col gap-5">

      {/* ── Mode tab switcher ─────────────────────────── */}
      <div className="flex gap-1.5 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-muted)] p-1">
        <button
          type="button"
          onClick={() => setMode('express')}
          className={cn(
            'relative flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold transition-all duration-200',
            mode === 'express'
              ? 'bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] shadow-sm'
              : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
          )}>
          <Zap size={14} className={cn('shrink-0', mode === 'express' ? 'text-blue-600' : 'text-[var(--color-text-muted)]')} />
          {/* The label is the one thing here that must never wrap: with the
              badge alongside it, "Express Account" would otherwise break
              across two lines and make this tab taller than its neighbour. */}
          <span className="whitespace-nowrap">Express Account</span>
          {/* Dropped on phones. With neither label wrapping, the two tabs plus
              this badge need ~373px; a 375px screen gives the row 306, so
              keeping it would trade the fixed line-break for a horizontal
              scrollbar. From `sm` up the column is 400px and it fits with room
              to spare. A badge on the tab that is already visibly selected is
              the right thing to lose first. */}
          {mode === 'express' && (
            <span className="hidden shrink-0 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10px] font-bold tracking-wide sm:inline-block"
              style={{ background: 'var(--color-primary-light)', color: 'var(--color-primary)' }}>
              Recommended
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setMode('full')}
          className={cn(
            'flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold transition-all duration-200',
            mode === 'full'
              ? 'bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] shadow-sm'
              : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
          )}>
          <FileText size={14} className={cn('shrink-0', mode === 'full' ? 'text-blue-600' : 'text-[var(--color-text-muted)]')} />
          <span className="whitespace-nowrap">Full Registration</span>
        </button>
      </div>

      <AnimatePresence mode="wait">

        {/* ── Express Account form ─────────────────────── */}
        {mode === 'express' && (
          <motion.div key="express-form"
            initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 16 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="flex flex-col gap-4">

            <div>
              <h2 className="text-base font-bold text-[var(--color-text-primary)]">Create your account</h2>
              <p className="text-sm text-[var(--color-text-muted)]">Quick setup — just the essentials to get started</p>
            </div>

            {/* Name */}
            <Field label="Full Name *" error={expressErrors.name}>
              <div className="relative">
                <User size={14} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
                <Input error={expressErrors.name} value={expressData.name}
                  placeholder="e.g. Ahmed Al Mansouri" className="pl-9"
                  onChange={e => setEx('name', e.target.value)} />
              </div>
            </Field>

            {/* Email */}
            <Field label="Email Address *" error={expressErrors.email}>
              <div className="relative">
                <Mail size={14} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
                <Input error={expressErrors.email} value={expressData.email}
                  type="email" placeholder="you@example.com" className="pl-9"
                  onChange={e => setEx('email', e.target.value)} />
              </div>
            </Field>

            {/* Preferred Learning Center — decides which office/organization the student joins */}
            <Field label="Preferred Learning Center *" error={expressErrors.organizationSlug}>
              <CustomSelect
                options={[
                  { value: 'dubai',     label: 'Dubai, UAE' },
                  { value: 'bangalore', label: 'Bangalore, India' },
                ]}
                value={expressData.organizationSlug}
                onChange={v => setEx('organizationSlug', v)}
                error={expressErrors.organizationSlug}
                placeholder="Select your preferred learning center…"
                icon={Building2}
              />
            </Field>

            {/* Country of Residence */}
            <Field label="Country of Residence *" error={expressErrors.homeCountry}>
              <CountryPicker value={expressData.homeCountry}
                onChange={v => setEx('homeCountry', v)}
                error={expressErrors.homeCountry}
                placeholder="Select your country of residence…" />
            </Field>

            {/* Password */}
            <Field label="Password *" error={expressErrors.password}>
              <div className="relative">
                <Lock size={14} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
                <input
                  type={expressShowPw ? 'text' : 'password'}
                  value={expressData.password}
                  placeholder="Min. 8 chars, uppercase + number"
                  onChange={e => setEx('password', e.target.value)}
                  className={cn(expressErrors.password ? inputErr : inputBase, 'pl-9 pr-10')}
                />
                <button type="button" onClick={() => setExpressShowPw(x => !x)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors">
                  {expressShowPw ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              {expressData.password && (
                <div className="flex items-center gap-2 pt-0.5">
                  <div className="flex flex-1 gap-1">
                    {[1,2,3,4].map(i => (
                      <div key={i} className="h-1.5 flex-1 rounded-full transition-all duration-300"
                        style={{ background: i <= expressStrength.score ? expressStrength.color: 'var(--color-border)' }} />
                    ))}
                  </div>
                  <span className="text-[10px] font-bold" style={{ color: expressStrength.color }}>
                    {expressStrength.label}
                  </span>
                </div>
              )}
            </Field>

            {/* Terms */}
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-muted)] p-3.5 hover:border-blue-200 hover:bg-[var(--color-hover)]/40 transition-all">
              <input type="checkbox" checked={expressData.termsAccepted}
                onChange={e => setEx('termsAccepted', e.target.checked)}
                className="mt-0.5 h-4 w-4 flex-shrink-0 cursor-pointer rounded accent-blue-600" />
              <span className="text-xs leading-relaxed text-[var(--color-text-secondary)]">
                I agree to Delta Institutions&apos;{' '}
                <button type="button" onClick={e => { e.preventDefault(); setShowTerms(true) }}
                  className="font-semibold transition-colors hover:opacity-80" style={{ color: 'var(--color-primary)' }}>
                  Terms &amp; Conditions
                </button>
                , Privacy Policy, and KHDA training regulations.
              </span>
            </label>
            {expressErrors.termsAccepted && (
              <p className="flex items-center gap-1 text-[11px] font-medium text-red-500">
                <AlertCircle size={10} strokeWidth={2.5} />{expressErrors.termsAccepted}
              </p>
            )}

            {/* API error */}
            <AnimatePresence>
              {expressApiErr && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                  className="flex items-center gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
                  <AlertCircle size={15} className="flex-shrink-0" />
                  {expressApiErr}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Submit */}
            <button type="button" onClick={submitExpress} disabled={expressLoading}
              className="flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold text-white transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
              style={{ background: 'var(--color-primary)', boxShadow: '0 4px 14px rgba(0,87,184,0.3)' }}>
              {expressLoading ? <><Spinner size={14} /> Creating Account…</> : 'Create Account & Continue'}
            </button>

          </motion.div>
        )}

        {/* ── Full Registration form ───────────────────── */}
        {mode === 'full' && (
          <motion.div key="full-form"
            initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="flex flex-col gap-5">

            {/* Step indicator */}
            <div className="flex items-start">
              {STEP_LABELS.map((label, i) => (
                <div key={i} className={cn('flex items-center', i < STEP_LABELS.length - 1 && 'flex-1')}>
                  <div className="flex flex-col items-center gap-1.5">
                    <motion.div
                      animate={{
                        background: i < step  ? '#0057b8' : i === step ? '#0057b8' : '#F1F3F8',
                        boxShadow:  i === step ? '0 0 0 4px rgba(0,87,184,0.12)' : 'none',
                      }}
                      transition={{ duration: 0.2 }}
                      className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold"
                      style={{ color: i <= step ? '#fff' : 'var(--color-text-muted)' }}>
                      {i < step
                        ? <Check size={14} strokeWidth={3} />
                        : <span>{i + 1}</span>}
                    </motion.div>
                    <span className={cn(
                      'hidden text-[10px] font-semibold whitespace-nowrap sm:block transition-colors duration-200',
                      i === step ? 'text-blue-600' : i < step ? 'text-[var(--color-text-muted)]' : 'text-[var(--color-text-muted)]'
                    )}>{label}</span>
                  </div>
                  {i < STEP_LABELS.length - 1 && (
                    <div className="mx-2 mb-5 flex-1">
                      <div className="h-[2px] w-full rounded-full overflow-hidden bg-[var(--color-bg-muted)]">
                        <motion.div
                          animate={{ width: i < step ? '100%' : '0%' }}
                          transition={{ duration: 0.3 }}
                          className="h-full rounded-full bg-blue-600" />
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Step header */}
            <div>
              <h2 className="text-base font-bold text-[var(--color-text-primary)]">Step {step + 1}: {STEP_LABELS[step]}</h2>
              <p className="text-sm text-[var(--color-text-muted)]">
                {step === 0 && 'Tell us about yourself'}
                {step === 1 && 'Your address and documents'}
                {step === 2 && 'Choose your programs'}
                {step === 3 && 'Create your account'}
              </p>
            </div>

            {/* Fields */}
            <AnimatePresence mode="wait">
              <motion.div key={step}
                initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}>
                {renderStep()}
              </motion.div>
            </AnimatePresence>

            {/* API error */}
            <AnimatePresence>
              {apiErr && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                  className="flex items-center gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
                  <AlertCircle size={15} className="flex-shrink-0" />
                  {apiErr}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Navigation */}
            <div className="flex items-center gap-2 pt-1">
              {step > 0 && (
                <button type="button" onClick={back}
                  className="flex items-center gap-1.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-4 py-2.5 text-sm font-semibold text-[var(--color-text-secondary)] transition-all hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-muted)]">
                  <ChevronLeft size={15} /> Back
                </button>
              )}
              {step < 3 ? (
                <button type="button" onClick={next}
                  className="ml-auto flex items-center gap-1.5 rounded-xl px-5 py-2.5 text-sm font-bold text-white transition-all hover:opacity-90 active:scale-[0.98]"
                  style={{ background: 'var(--color-primary)', boxShadow: '0 4px 14px rgba(0,87,184,0.3)' }}>
                  Continue <ChevronRight size={15} />
                </button>
              ) : (
                <button type="button" onClick={submit} disabled={loading}
                  className="ml-auto flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold text-white transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
                  style={{ background: 'var(--color-primary)', boxShadow: '0 4px 14px rgba(0,87,184,0.3)' }}>
                  {loading ? <><Spinner size={14} /> Submitting…</> : 'Submit Application'}
                </button>
              )}
            </div>

          </motion.div>
        )}

      </AnimatePresence>

      {/* ── Sign in link ─────────────────────────────────── */}
      <p className="text-center text-xs text-[var(--color-text-muted)]">
        Already have an account?{' '}
        <button onClick={onSwitch} className="font-semibold text-blue-600 hover:underline">Sign in</button>
      </p>

      {/* ── Terms modal — always mounted so it can open from any step ── */}
      <TermsModal open={showTerms} onClose={() => setShowTerms(false)} />
    </div>
  )
}
