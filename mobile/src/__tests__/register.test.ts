import {
  COUNTRIES, EMPTY_FORM, ageOn, expressBody, formatIdNumber, fullBody, passwordStrength, refusedFields,
  validateExpress, validateStep, type RegisterForm,
} from '@shared'

/* Node's fs, typed here only — the app's own types stay free of Node globals. */
declare const __dirname: string
const { readFileSync } = jest.requireActual('fs') as { readFileSync(path: string, enc: 'utf8'): string }

const phoneOk = (v: string) => /^\+\d{8,15}$/.test(v)
const TODAY = new Date(2026, 9, 17)  // 17 Oct 2026, local

const base: RegisterForm = {
  ...EMPTY_FORM,
  name: 'Amal Rahman', email: 'amal@example.com', password: 'Secret123', confirmPassword: 'Secret123',
  organizationSlug: 'dubai', homeCountry: 'United Arab Emirates', terms: true,
  phone: '+971501234567', emergencyContact: '+971509876543', gender: 'Female', dateOfBirth: '1998-04-02',
  nationality: 'Emirati', occupation: 'Analyst', idType: 'Emirates ID', idNumber: '784-1998-1234567-1',
  countryAttendance: 'United Arab Emirates', villa: 'Villa 12', city: 'Dubai', addressCountry: 'United Arab Emirates',
  experienceLevel: 'Beginner', preferredStartDate: '2026-11-01', hearAboutUs: 'Instagram', programs: ['forex-beginner'],
  paymentMethod: 'Card / Full', hasPhoto: true, hasPassport: true, hasIdDoc: true,
}

describe('parity with the website form', () => {
  const client = `${__dirname}/../../../client/src`
  const site = readFileSync(`${client}/components/auth/RegisterForm.tsx`, 'utf8')
  /* The website moved its country list into lib/countries.ts (2026-10-18,
     shared with /explore); before that it lived in the form itself. */
  const countriesSrc = (() => {
    try { return readFileSync(`${client}/lib/countries.ts`, 'utf8') } catch { return site }
  })()
  it('the country list is the website\'s, name for name and dial for dial', () => {
    const theirs = [...countriesSrc.matchAll(/\{ name: '([^']+)',\s*dial: '([^']+)'/g)].map(m => `${m[1]}|${m[2]}`)
    expect(theirs.length).toBe(158)
    expect(COUNTRIES.map(c => `${c.name}|${c.dial}`)).toEqual(theirs)
  })
  it('the email rule is the website\'s (and so the server\'s)', () => {
    expect(site).toContain(String.raw`/^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i`)
  })
})

describe('express', () => {
  it('a complete form passes', () => expect(validateExpress(base)).toEqual({}))
  it.each([
    ['name', '', 'nameRequired'], ['name', 'Amal', 'nameTwoWords'], ['name', 'Amal 2pac', 'nameLetters'],
    ['email', 'ahmed.@gmail.com', 'emailInvalid'], ['email', 'ahmed@gmail.com.', 'emailInvalid'],
    ['password', 'short1A', 'passwordLength'], ['password', 'nouppercase1', 'passwordUpper'], ['password', 'NoNumberHere', 'passwordNumber'],
    ['organizationSlug', '', 'centerRequired'], ['homeCountry', '', 'countryRequired'], ['terms', false, 'termsRequired'],
  ] as const)('%s = %j → %s', (k, v, err) => {
    expect(validateExpress({ ...base, [k]: v })[k]).toBe(err)
  })
  it('the body: trimmed, lower-cased email, signupType express, only homeCountry in the application', () => {
    expect(expressBody({ ...base, name: '  Amal Rahman ', email: ' Amal@Example.COM ' })).toEqual({
      name: 'Amal Rahman', email: 'amal@example.com', password: 'Secret123', signupType: 'express',
      organizationSlug: 'dubai', enrollmentApplication: { homeCountry: 'United Arab Emirates' },
    })
  })
})

describe('full application, step by step', () => {
  it('every step passes for a complete form', () => {
    for (const s of [0, 1, 2, 3]) expect(validateStep(s, base, phoneOk, TODAY)).toEqual({})
  })
  it('step 0: photo, phones, age 10–100, ID rules', () => {
    const e = validateStep(0, { ...base, hasPhoto: false, phone: '+97150', dateOfBirth: '2020-01-01' }, phoneOk, TODAY)
    expect(e).toMatchObject({ hasPhoto: 'photoRequired', phone: 'phoneInvalid', dateOfBirth: 'dobTooYoung' })
    expect(validateStep(0, { ...base, dateOfBirth: '1900-01-01' }, phoneOk, TODAY).dateOfBirth).toBe('dobInvalid')
    expect(validateStep(0, { ...base, idNumber: '123-1998-1234567-1' }, phoneOk, TODAY).idNumber).toBe('emiratesIdPrefix')
    expect(validateStep(0, { ...base, idType: 'Aadhaar Card', idNumber: '1234 5678' }, phoneOk, TODAY).idNumber).toBe('aadhaarFormat')
    expect(validateStep(0, { ...base, idType: 'Passport', idNumber: 'A12' }, phoneOk, TODAY).idNumber).toBe('passportFormat')
  })
  it('the 10th birthday is the day it becomes allowed', () => {
    expect(ageOn('2016-10-17', TODAY)).toBe(10)
    expect(ageOn('2016-10-18', TODAY)).toBe(9)
  })
  it('step 1: an ID copy is needed unless the ID IS the passport', () => {
    expect(validateStep(1, { ...base, hasIdDoc: false }, phoneOk, TODAY).hasIdDoc).toBe('idDocRequired')
    expect(validateStep(1, { ...base, idType: 'Passport', idNumber: 'A1234567', hasIdDoc: false }, phoneOk, TODAY)).toEqual({})
  })
  it('step 2: a start date of today is allowed (the website refuses it — UTC midnight vs now)', () => {
    expect(validateStep(2, { ...base, preferredStartDate: '2026-10-17' }, phoneOk, TODAY)).toEqual({})
    expect(validateStep(2, { ...base, preferredStartDate: '2026-10-16' }, phoneOk, TODAY).preferredStartDate).toBe('startFuture')
    expect(validateStep(2, { ...base, programs: [] }, phoneOk, TODAY).programs).toBe('programsRequired')
  })
  it('step 3: passwords must match; payment and terms required', () => {
    const e = validateStep(3, { ...base, confirmPassword: 'Other123', paymentMethod: '', terms: false }, phoneOk, TODAY)
    expect(e).toMatchObject({ confirmPassword: 'passwordMismatch', paymentMethod: 'paymentRequired', terms: 'termsRequired' })
  })
  it('the body: documents in, Passport-as-ID reuses the passport, referral only for Friend / Referral', () => {
    const docs = { passportUrl: 'kyc/p.pdf', idDocUrl: 'kyc/id.jpg', photoUrl: 'https://cdn/x.jpg' }
    const b = fullBody(base, docs)
    expect(b.signupType).toBe('full')
    expect(b.enrollmentApplication).toMatchObject({ passportUrl: 'kyc/p.pdf', idDocUrl: 'kyc/id.jpg', photoUrl: 'https://cdn/x.jpg', programs: ['forex-beginner'] })
    expect(b.enrollmentApplication.referralName).toBeUndefined()
    expect(fullBody({ ...base, idType: 'Passport' }, docs).enrollmentApplication.idDocUrl).toBe('kyc/p.pdf')
    expect(fullBody({ ...base, hearAboutUs: 'Friend / Referral', referralName: ' Sam ' }, docs).enrollmentApplication.referralName).toBe('Sam')
    expect(fullBody({ ...base, hearAboutUs: 'Google', referralName: 'Sam' }, docs).enrollmentApplication.referralName).toBeUndefined()
  })
})

describe('helpers', () => {
  it('ID numbers format as typed', () => {
    expect(formatIdNumber('Emirates ID', '784199812345671')).toBe('784-1998-1234567-1')
    expect(formatIdNumber('Aadhaar Card', '123456789012')).toBe('1234 5678 9012')
    expect(formatIdNumber('Passport', 'a12-345 67x')).toBe('A1234567X')
  })
  it('password strength 0–4', () => {
    expect(passwordStrength('')).toBe(0)
    expect(passwordStrength('Secret123!')).toBe(4)
  })
  it('a 422 names the label and the step to go back to, earliest first', () => {
    expect(refusedFields([
      { field: 'enrollmentApplication.paymentMethod', message: 'x' },
      { field: 'enrollmentApplication.phone', message: 'y' },
      { field: 'unknownThing', message: 'z' },
    ])).toEqual([{ label: 'Phone / WhatsApp', step: 0, message: 'y' }, { label: 'Payment Method', step: 3, message: 'x' }])
    expect(refusedFields('nope')).toEqual([])
  })
})

describe('sign-up by emailed code (the website since 2026-10-22)', () => {
  const ready = { ...base, organizationSlug: 'dubai', paymentMethod: 'Card', terms: true } as RegisterForm
  it('a 6-digit code passes step 4 with no password at all', () => {
    expect(validateStep(3, { ...ready, password: '', confirmPassword: '', emailCode: '123456' }, phoneOk, new Date(), true)).toEqual({})
  })
  it.each([['', 'empty'], ['12345', 'short'], ['12a456', 'letters'], ['dddddd', 'the letter d']])('%s (%s) is refused', code => {
    expect(validateStep(3, { ...ready, emailCode: code }, phoneOk, new Date(), true).emailCode).toBe('emailCodeRequired')
  })
  it('the body carries the code and never a password', () => {
    const b = fullBody({ ...ready, password: 'Secret123', emailCode: ' 654321 ' }, { passportUrl: 'p', idDocUrl: 'i', photoUrl: 'ph' })
    expect(b).not.toHaveProperty('password')
    expect((b as { emailCode?: string }).emailCode).toBe('654321')
  })
  it('without a code the password path is unchanged', () => {
    expect(fullBody({ ...ready, password: 'Secret123', emailCode: '' }, { passportUrl: 'p', idDocUrl: 'i', photoUrl: 'ph' })).toHaveProperty('password', 'Secret123')
  })
})
