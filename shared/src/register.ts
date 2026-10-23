/* ─────────────────────────────────────────────────────────────
   Student registration — the website's RegisterForm.tsx rules, ported so the
   app collects exactly what the website collects and sends exactly the body
   the website sends (POST /auth/register). Pure: no React, no HTTP.

   Two modes, as on the website:
     express — name, email, learning centre, country, password, terms
     full    — four steps (Personal · Address & Docs · Program · Account)
               with passport / ID / photo uploads

   Validators return MESSAGE KEYS (the app's i18n `register.errors.*`), never
   English, so Arabic is a translation file away. Phone numbers are checked by
   the caller (libphonenumber in the app) and passed in, keeping this file
   dependency-free.
───────────────────────────────────────────────────────────── */

export const CENTERS = [
  { value: 'dubai', label: 'Dubai, UAE' },
  { value: 'bangalore', label: 'Bangalore, India' },
] as const
export type CenterSlug = typeof CENTERS[number]['value']

export const GENDERS = ['Male', 'Female', 'Prefer not to say'] as const

export const ID_TYPES = [
  { value: 'Emirates ID', label: 'Emirates ID', doc: 'Emirates ID Card Copy' },
  { value: 'Passport', label: 'Passport', doc: 'Passport Copy' },
  { value: 'Aadhaar Card', label: 'Aadhaar Card', doc: 'Aadhaar Card Copy' },
  { value: 'Other', label: 'Other Govt. ID', doc: 'ID Document Copy' },
] as const
export type IdType = typeof ID_TYPES[number]['value']

export const EXPERIENCE = ['Beginner', 'Intermediate', 'Advanced'] as const
export const HEAR_ABOUT = ['Instagram', 'TikTok', 'WhatsApp', 'Friend / Referral', 'Google', 'Walk-in'] as const
export const REFERRAL = 'Friend / Referral'
export const PAYMENT_METHODS = ['Cash / Full', 'Card / Full', 'Card / Split', 'Card Debit', 'Card Credit', 'USDT', 'Tabby', 'Tamara'] as const

export const PROGRAM_GROUPS = [
  { title: 'Forex Academy', items: [
    { id: 'forex-beginner', label: 'Forex: Beginner' },
    { id: 'forex-intermediate', label: 'Forex: Intermediate' },
    { id: 'forex-advanced', label: 'Forex: Advanced' },
  ] },
  { title: 'Digital Marketing', items: [
    { id: 'dm-social', label: 'Social Media Marketing' },
    { id: 'dm-seo', label: 'SEO & Content' },
  ] },
  { title: 'AI Academy', items: [
    { id: 'ai-fundamentals', label: 'AI Fundamentals' },
    { id: 'ai-trading', label: 'AI Trading Automation' },
  ] },
  { title: 'JURA Academy', items: [
    { id: 'jura-core', label: 'JURA Program' },
    { id: 'jura-labour-law', label: 'UAE Labour Law & HR Compliance' },
  ] },
] as const

export const STEPS = ['personal', 'address', 'program', 'account'] as const

/** Upload budgets — the server refuses signup documents over 3 MB. */
export const DOC_MAX_BYTES = 3 * 1024 * 1024
export const AVATAR_MAX_BYTES = 600 * 1024
export const AVATAR_MAX_DIMENSION = 1024
export const DOC_MAX_DIMENSION = 1920
export const DOC_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const

export interface RegisterForm {
  name: string
  email: string
  password: string
  confirmPassword: string
  organizationSlug: CenterSlug | ''
  homeCountry: string
  terms: boolean
  // full
  phone: string
  emergencyContact: string
  gender: string
  dateOfBirth: string          // YYYY-MM-DD
  nationality: string
  occupation: string
  idType: IdType | ''
  idNumber: string
  countryAttendance: string
  villa: string
  city: string
  addressCountry: string
  experienceLevel: string
  preferredStartDate: string   // YYYY-MM-DD
  hearAboutUs: string
  referralName: string
  programs: string[]
  paymentMethod: string
  /** Whether each document has been picked (the files live in the app). */
  hasPhoto: boolean
  hasPassport: boolean
  hasIdDoc: boolean
}

export const EMPTY_FORM: RegisterForm = {
  name: '', email: '', password: '', confirmPassword: '', organizationSlug: '', homeCountry: '', terms: false,
  phone: '', emergencyContact: '', gender: '', dateOfBirth: '', nationality: '', occupation: '',
  idType: '', idNumber: '', countryAttendance: '', villa: '', city: '', addressCountry: '',
  experienceLevel: '', preferredStartDate: '', hearAboutUs: '', referralName: '', programs: [], paymentMethod: '',
  hasPhoto: false, hasPassport: false, hasIdDoc: false,
}

export type Errors = Partial<Record<keyof RegisterForm, string>>

/* The SAME rule as the server's zod .email() (the website copied it from zod's
   source), so an address accepted here is never refused at submit. */
export const EMAIL_RE = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9-]*\.)+[A-Z]{2,}$/i

/** Formats an ID number as the student types, per ID type (the website's rules). */
export function formatIdNumber(type: IdType | '', raw: string): string {
  switch (type) {
    case 'Emirates ID': {
      const d = raw.replace(/\D/g, '').slice(0, 15)
      return [d.slice(0, 3), d.slice(3, 7), d.slice(7, 14), d.slice(14, 15)].filter(Boolean).join('-')
    }
    case 'Passport': return raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 9)
    case 'Aadhaar Card': return raw.replace(/\D/g, '').slice(0, 12).replace(/(\d{4})(?=\d)/g, '$1 ')
    default: return raw.slice(0, 30)
  }
}

function idNumberError(type: IdType | '', v: string): string | undefined {
  if (!v.trim()) return 'idNumberRequired'
  switch (type) {
    case 'Emirates ID': {
      const d = v.replace(/\D/g, '')
      if (d.length !== 15) return 'emiratesIdLength'
      if (!d.startsWith('784')) return 'emiratesIdPrefix'
      return undefined
    }
    case 'Passport': return /^[A-Z0-9]{6,9}$/i.test(v) ? undefined : 'passportFormat'
    case 'Aadhaar Card': return v.replace(/\D/g, '').length === 12 ? undefined : 'aadhaarFormat'
    default: return v.trim().length >= 4 && v.trim().length <= 40 ? undefined : 'otherIdFormat'
  }
}

/** Whole years between a YYYY-MM-DD birthday and `today`. */
export function ageOn(dob: string, today: Date): number {
  const [y, m, d] = dob.split('-').map(Number)
  let age = today.getFullYear() - y!
  if (today.getMonth() + 1 < m! || (today.getMonth() + 1 === m! && today.getDate() < d!)) age--
  return age
}

/** Local calendar date as YYYY-MM-DD. */
export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function common(f: RegisterForm, full: boolean): Errors {
  const e: Errors = {}
  const name = f.name.trim()
  if (!name) e.name = 'nameRequired'
  else if (name.split(/\s+/).length < 2) e.name = 'nameTwoWords'
  else if (!/^[a-zA-Z\s\-'.]+$/.test(name)) e.name = 'nameLetters'

  if (!f.email.trim()) e.email = 'emailRequired'
  else if (!EMAIL_RE.test(f.email.trim())) e.email = 'emailInvalid'

  if (!f.homeCountry) e.homeCountry = full ? 'homeCountryRequired' : 'countryRequired'
  return e
}

function account(f: RegisterForm, full: boolean): Errors {
  const e: Errors = {}
  if (!f.organizationSlug) e.organizationSlug = 'centerRequired'
  if (!f.password) e.password = 'passwordRequired'
  else if (f.password.length < 8) e.password = 'passwordLength'
  else if (!/[A-Z]/.test(f.password)) e.password = 'passwordUpper'
  else if (!/[0-9]/.test(f.password)) e.password = 'passwordNumber'
  if (full && f.password && f.confirmPassword !== f.password) e.confirmPassword = 'passwordMismatch'
  if (!f.terms) e.terms = 'termsRequired'
  return e
}

export function validateExpress(f: RegisterForm): Errors {
  return { ...common(f, false), ...account(f, false) }
}

/** One step of the full application. `phoneOk` is the caller's phone check. */
export function validateStep(step: number, f: RegisterForm, phoneOk: (v: string) => boolean, today = new Date()): Errors {
  const e: Errors = {}
  if (step === 0) {
    Object.assign(e, common(f, true))
    if (!f.hasPhoto) e.hasPhoto = 'photoRequired'
    if (!f.phone) e.phone = 'phoneRequired'
    else if (!phoneOk(f.phone)) e.phone = 'phoneInvalid'
    if (!f.emergencyContact) e.emergencyContact = 'emergencyRequired'
    else if (!phoneOk(f.emergencyContact)) e.emergencyContact = 'phoneInvalid'
    if (!f.gender) e.gender = 'genderRequired'
    if (!f.dateOfBirth) e.dateOfBirth = 'dobRequired'
    else if (!DATE_RE.test(f.dateOfBirth)) e.dateOfBirth = 'dateInvalid'
    else {
      const age = ageOn(f.dateOfBirth, today)
      if (age < 10) e.dateOfBirth = 'dobTooYoung'
      else if (age > 100) e.dateOfBirth = 'dobInvalid'
    }
    const nat = f.nationality.trim()
    if (!nat) e.nationality = 'nationalityRequired'
    else if (nat.length < 3) e.nationality = 'nationalityInvalid'
    else if (!/^[a-zA-Z\s-]+$/.test(nat)) e.nationality = 'nationalityLetters'
    if (!f.occupation.trim()) e.occupation = 'occupationRequired'
    else if (f.occupation.trim().length < 2) e.occupation = 'occupationInvalid'
    if (!f.idType) e.idType = 'idTypeRequired'
    else { const err = idNumberError(f.idType, f.idNumber); if (err) e.idNumber = err }
  }
  if (step === 1) {
    if (!f.countryAttendance) e.countryAttendance = 'attendanceRequired'
    if (!f.villa.trim()) e.villa = 'villaRequired'
    if (!f.city.trim()) e.city = 'cityRequired'
    if (!f.addressCountry) e.addressCountry = 'countryRequired'
    if (!f.hasPassport) e.hasPassport = 'passportDocRequired'
    if (f.idType !== 'Passport' && !f.hasIdDoc) e.hasIdDoc = f.idType ? 'idDocRequired' : 'idTypeFirst'
  }
  if (step === 2) {
    if (!f.experienceLevel) e.experienceLevel = 'experienceRequired'
    if (!f.preferredStartDate) e.preferredStartDate = 'startRequired'
    /* Today or later, compared as calendar dates. (The website compares a
       UTC-midnight date with "now", so it refuses today; an off-by-one we do
       not copy.) */
    else if (!DATE_RE.test(f.preferredStartDate) || f.preferredStartDate < isoDate(today)) e.preferredStartDate = 'startFuture'
    if (!f.hearAboutUs) e.hearAboutUs = 'hearRequired'
    if (f.programs.length === 0) e.programs = 'programsRequired'
  }
  if (step === 3) Object.assign(e, account(f, true))
  if (step === 3 && !f.paymentMethod) e.paymentMethod = 'paymentRequired'
  return e
}

/** 0–4 for the strength meter (display only). */
export function passwordStrength(p: string): number {
  return [p.length >= 8, /[A-Z]/.test(p), /[0-9]/.test(p), /[^A-Za-z0-9]/.test(p)].filter(Boolean).length
}

export function expressBody(f: RegisterForm) {
  return {
    name: f.name.trim(), email: f.email.trim().toLowerCase(), password: f.password,
    signupType: 'express' as const, organizationSlug: f.organizationSlug || undefined,
    enrollmentApplication: { homeCountry: f.homeCountry },
  }
}

export function fullBody(f: RegisterForm, docs: { passportUrl: string; idDocUrl: string; photoUrl: string }) {
  return {
    name: f.name.trim(), email: f.email.trim().toLowerCase(), password: f.password,
    /* Explicit: the website leaves this out and lets the server infer it. */
    signupType: 'full' as const,
    organizationSlug: f.organizationSlug || undefined,
    enrollmentApplication: {
      passportUrl: docs.passportUrl,
      /* Passport chosen as the ID: the passport copy is the ID document. */
      idDocUrl: f.idType === 'Passport' ? docs.passportUrl : docs.idDocUrl,
      photoUrl: docs.photoUrl,
      phone: f.phone, emergencyContact: f.emergencyContact, gender: f.gender, dateOfBirth: f.dateOfBirth,
      nationality: f.nationality.trim(), homeCountry: f.homeCountry, occupation: f.occupation.trim(),
      idType: f.idType, idNumber: f.idNumber, countryAttendance: f.countryAttendance,
      villa: f.villa.trim(), city: f.city.trim(), addressCountry: f.addressCountry,
      experienceLevel: f.experienceLevel, preferredStartDate: f.preferredStartDate, hearAboutUs: f.hearAboutUs,
      referralName: f.hearAboutUs === REFERRAL && f.referralName.trim() ? f.referralName.trim() : undefined,
      programs: f.programs, paymentMethod: f.paymentMethod,
    },
  }
}

/** PATCH /auth/me/complete-registration — an express (or rejected) account
 *  finishing the full registration while signed in. Flat, not nested in
 *  enrollmentApplication, and with no name / email / password: those exist. */
export function completeRegistrationBody(f: RegisterForm, docs: { passportUrl: string; idDocUrl: string; photoUrl?: string }) {
  return {
    phone: f.phone, emergencyContact: f.emergencyContact, gender: f.gender, dateOfBirth: f.dateOfBirth,
    nationality: f.nationality.trim(), homeCountry: f.homeCountry, occupation: f.occupation.trim(),
    idType: f.idType, idNumber: f.idNumber, countryAttendance: f.countryAttendance,
    villa: f.villa.trim(), city: f.city.trim(), addressCountry: f.addressCountry,
    passportUrl: docs.passportUrl,
    idDocUrl: f.idType === 'Passport' ? docs.passportUrl : docs.idDocUrl,
    photoUrl: docs.photoUrl,
    experienceLevel: f.experienceLevel, preferredStartDate: f.preferredStartDate, hearAboutUs: f.hearAboutUs,
    referralName: f.hearAboutUs === REFERRAL && f.referralName.trim() ? f.referralName.trim() : undefined,
    programs: f.programs, paymentMethod: f.paymentMethod,
  }
}

/* Where each field the API can refuse lives — a 422 names fields by payload
   key; the student needs the label and the step. (The website's table.) */
export const FIELD_STEP: Record<string, { label: string; step: number }> = {
  name: { label: 'Full Name', step: 0 }, email: { label: 'Email Address', step: 0 },
  phone: { label: 'Phone / WhatsApp', step: 0 }, emergencyContact: { label: 'Emergency Contact', step: 0 },
  gender: { label: 'Gender', step: 0 }, dateOfBirth: { label: 'Date of Birth', step: 0 },
  nationality: { label: 'Nationality', step: 0 }, homeCountry: { label: 'Home Country', step: 0 },
  occupation: { label: 'Occupation', step: 0 }, idType: { label: 'ID Type', step: 0 },
  idNumber: { label: 'ID Number', step: 0 }, photoUrl: { label: 'Profile photo', step: 0 },
  countryAttendance: { label: 'Country of Attendance', step: 1 }, villa: { label: 'Villa / Apartment', step: 1 },
  city: { label: 'City / Town', step: 1 }, addressCountry: { label: 'Country', step: 1 },
  passportUrl: { label: 'Passport Copy', step: 1 }, idDocUrl: { label: 'ID Document Copy', step: 1 },
  experienceLevel: { label: 'Experience Level', step: 2 }, preferredStartDate: { label: 'Preferred Start Date', step: 2 },
  hearAboutUs: { label: 'How did you hear about us?', step: 2 }, referralName: { label: 'Who referred you?', step: 2 },
  programs: { label: 'Programs & Courses', step: 2 }, organizationSlug: { label: 'Preferred Learning Center', step: 3 },
  paymentMethod: { label: 'Payment Method', step: 3 }, password: { label: 'Password', step: 3 },
}

/** A 422's `details` → each refused field's label and step, earliest step first. */
export function refusedFields(details: unknown): { label: string; step: number; message: string }[] {
  if (!Array.isArray(details)) return []
  return details
    .map(d => {
      const field = String((d as { field?: unknown }).field ?? '').replace(/^enrollmentApplication\./, '').split('.')[0]!
      const meta = FIELD_STEP[field]
      return meta ? { ...meta, message: String((d as { message?: unknown }).message ?? '') } : null
    })
    .filter((x): x is { label: string; step: number; message: string } => !!x)
    .sort((a, b) => a.step - b.step)
}
