import { useRef, useState, type ComponentRef } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { router } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import { useTranslation } from 'react-i18next'
import {
  CENTERS, EXPERIENCE, EMPTY_FORM, GENDERS, HEAR_ABOUT, ID_TYPES, PAYMENT_METHODS, PROGRAM_GROUPS, REFERRAL, STEPS,
  expressBody, formatIdNumber, fullBody, isoDate, passwordStrength, problemOf, refusedFields, validateExpress, validateStep,
  type Errors, type IdType, type RegisterForm,
} from '@shared'
import { useAuth } from '@/lib/auth'
import { handleSignInError } from '@/lib/authErrors'
import { env } from '@/lib/env'
import { forgetUpload, phoneOk, uploadSignupDoc, type PreparedFile } from '@/lib/register'
import { Body, Button, Chip, Field, Notice, Screen, Title } from '@/components/ui'
import { COUNTRY_OPTIONS, Checkbox, DateField, FieldError, FileField, PhoneField, Select } from '@/components/form'
import { useTheme } from '@/theme'

/* ─────────────────────────────────────────────────────────────
   Create an account — the website's two ways, with its rules and its body
   (shared/src/register.ts):
     Express  name · email · learning centre · country · password · terms
     Full     Personal → Address & documents → Program → Account, with the
              passport / ID / photo uploaded first (POST /uploads/signup-doc)
   Either way the student is signed in as "pending" — browse only until an
   admin approves the application, exactly as on the website.
───────────────────────────────────────────────────────────── */

type Files = { photo: PreparedFile | null; passport: PreparedFile | null; idDoc: PreparedFile | null }
const opts = (xs: readonly string[]) => xs.map(x => ({ value: x, label: x }))

export default function Register() {
  const { t } = useTranslation()
  const { colors, fonts } = useTheme()
  const { register } = useAuth()
  const [mode, setMode] = useState<'express' | 'full'>('express')
  const [step, setStep] = useState(0)
  const [f, setF] = useState<RegisterForm>(EMPTY_FORM)
  const [files, setFiles] = useState<Files>({ photo: null, passport: null, idDoc: null })
  const [errors, setErrors] = useState<Errors>({})
  const [banner, setBanner] = useState<{ text: string; signIn?: boolean } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [verifyEmail, setVerifyEmail] = useState<string | null>(null)
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null)

  const set = <K extends keyof RegisterForm>(k: K, v: RegisterForm[K]) => {
    setF(prev => ({ ...prev, [k]: v }))
    if (errors[k]) setErrors(e => ({ ...e, [k]: undefined }))
  }
  const setFile = (k: keyof Files, flag: 'hasPhoto' | 'hasPassport' | 'hasIdDoc') => (file: PreparedFile | null) => {
    const old = files[k]
    if (old) forgetUpload(old.uri)
    setFiles(prev => ({ ...prev, [k]: file }))
    set(flag, !!file)
  }
  const err = (k: keyof RegisterForm) => (errors[k] ? t(`register.errors.${errors[k]}`) : undefined)
  const top = () => scroll.current?.scrollTo({ y: 0, animated: true })

  const fail = (e: unknown) => {
    const p = problemOf(e)
    if (p.kind === 'refused' && p.code === 'EMAIL_TAKEN') {
      setBanner({ text: t('register.emailTaken'), signIn: true })
    } else if (p.kind === 'refused' && p.code === 'VALIDATION_ERROR') {
      const bad = refusedFields((e as { response?: { data?: { error?: { details?: unknown } } } }).response?.data?.error?.details)
      if (mode === 'full' && bad[0]) setStep(bad[0].step)
      setBanner({ text: bad.length ? t('register.checkFields', { fields: bad.map(b => b.label).join(', ') }) : p.message })
    } else if (e instanceof Error && !(e as { isAxiosError?: boolean }).isAxiosError) {
      /* An upload's own sentence (lib/register.ts). */
      setBanner({ text: e.message })
    } else {
      /* Device refusals get their own screen, as on sign-in. */
      const msg = handleSignInError(e, t)
      if (msg) setBanner({ text: msg })
    }
    top()
  }

  const done = (outcome: 'signedIn' | 'verify') => {
    /* Signed in: the app's guard swaps this screen for the tabs by itself. */
    if (outcome === 'verify') setVerifyEmail(f.email.trim())
  }

  const submitExpress = async () => {
    setBanner(null)
    const e = validateExpress(f)
    setErrors(e)
    if (Object.keys(e).length) { top(); return }
    setBusy(t('register.creating'))
    try { done(await register(expressBody(f))) } catch (x) { fail(x) } finally { setBusy(null) }
  }

  const next = () => {
    const e = validateStep(step, f, phoneOk)
    setErrors(e)
    if (Object.keys(e).length) { top(); return }
    setStep(s => s + 1)
    top()
  }

  const submitFull = async () => {
    setBanner(null)
    /* Every step again — something may have changed since it was passed. */
    for (let s = 0; s < STEPS.length; s++) {
      const e = validateStep(s, f, phoneOk)
      if (Object.keys(e).length) { setErrors(e); setStep(s); top(); return }
    }
    try {
      const passportLabel = t('register.passport')
      setBusy(t('register.uploading', { label: passportLabel }))
      const passportUrl = await uploadSignupDoc(files.passport!, 'kyc', passportLabel)
      let idDocUrl = passportUrl
      if (f.idType !== 'Passport') {
        const idLabel = ID_TYPES.find(x => x.value === f.idType)!.doc
        setBusy(t('register.uploading', { label: idLabel }))
        idDocUrl = await uploadSignupDoc(files.idDoc!, 'kyc', idLabel)
      }
      setBusy(t('register.uploading', { label: t('register.photo') }))
      const photoUrl = await uploadSignupDoc(files.photo!, 'photo', t('register.photo'))
      setBusy(t('register.submitting'))
      done(await register(fullBody(f, { passportUrl, idDocUrl, photoUrl }), 45_000))
    } catch (x) {
      fail(x)
    } finally {
      setBusy(null)
    }
  }

  if (verifyEmail) {
    return (
      <Screen scroll={false}>
        <Title>{t('register.verifyTitle')}</Title>
        <Body>{t('register.verifyBody', { email: verifyEmail })}</Body>
        <Button title={t('auth.signIn')} onPress={() => router.replace('/sign-in')} />
      </Screen>
    )
  }

  const strength = passwordStrength(f.password)
  const strengthLabels = t('register.strength', { returnObjects: true }) as string[]
  const password = (
    <View style={{ gap: 6 }}>
      <Field label={t('register.password')} value={f.password} onChangeText={v => set('password', v)} secureTextEntry
        autoComplete="new-password" textContentType="newPassword" autoCapitalize="none" />
      {!!f.password && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {[1, 2, 3, 4].map(i => <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i <= strength ? (strength >= 3 ? colors.success : colors.warning) : colors.bgMuted }} />)}
          <Text style={{ fontFamily: fonts.medium, fontSize: 12, color: colors.textMuted, width: 52 }}>{strengthLabels[strength]}</Text>
        </View>
      )}
      <FieldError text={err('password')} />
    </View>
  )
  const terms = (
    <Checkbox checked={f.terms} onChange={v => set('terms', v)} error={err('terms')}>
      <Text style={{ fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.textSecondary }}>
        {t('register.terms')}{mode === 'full' ? t('register.termsFull') : ''}
      </Text>
      <View style={{ flexDirection: 'row', gap: 16, marginTop: 6 }}>
        <Text onPress={() => void WebBrowser.openBrowserAsync(`${env.siteUrl}/terms`)} style={{ fontFamily: fonts.semibold, fontSize: 14, color: colors.primary }}>{t('register.readTerms')}</Text>
        <Text onPress={() => void WebBrowser.openBrowserAsync(`${env.siteUrl}/privacy`)} style={{ fontFamily: fonts.semibold, fontSize: 14, color: colors.primary }}>{t('register.readPrivacy')}</Text>
      </View>
    </Checkbox>
  )
  const center = <Select label={t('register.center')} value={f.organizationSlug} options={CENTERS} onChange={v => set('organizationSlug', v as RegisterForm['organizationSlug'])} error={err('organizationSlug')} />
  const name = (
    <View style={{ gap: 6 }}>
      <Field label={t('register.name')} value={f.name} onChangeText={v => set('name', v)} maxLength={120} autoComplete="name" textContentType="name" />
      <FieldError text={err('name')} />
    </View>
  )
  const email = (
    <View style={{ gap: 6 }}>
      <Field label={t('register.email')} value={f.email} onChangeText={v => set('email', v)} keyboardType="email-address" autoCapitalize="none" autoComplete="email" textContentType="emailAddress" />
      <FieldError text={err('email')} />
    </View>
  )

  const idMeta = ID_TYPES.find(x => x.value === f.idType)

  return (
    <Screen scroll={false}>
      <ScrollView ref={scroll} contentContainerStyle={{ gap: 16 }} keyboardShouldPersistTaps="handled">
        <Title>{mode === 'express' ? t('register.expressTitle') : t('register.full')}</Title>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Chip label={t('register.express')} active={mode === 'express'} onPress={() => { setMode('express'); setErrors({}); setBanner(null) }} />
          <Chip label={t('register.full')} active={mode === 'full'} onPress={() => { setMode('full'); setStep(0); setErrors({}); setBanner(null) }} />
        </View>
        <Body muted>{mode === 'express' ? t('register.expressSub') : t('register.stepOf', { n: step + 1, label: t(`register.steps.${STEPS[step]}`) })}</Body>
        {banner && (
          <View style={{ gap: 8 }}>
            <Notice>{banner.text}</Notice>
            {banner.signIn && <Button variant="ghost" title={t('auth.signIn')} onPress={() => router.replace('/sign-in')} />}
          </View>
        )}

        {mode === 'express' && <>
          {name}{email}{center}
          <Select label={t('register.countryRes')} value={f.homeCountry} options={COUNTRY_OPTIONS} onChange={v => set('homeCountry', v)} error={err('homeCountry')} />
          {password}{terms}
          <Button title={busy ?? t('register.create')} loading={!!busy} onPress={() => void submitExpress()} />
        </>}

        {mode === 'full' && step === 0 && <>
          <FileField label={t('register.photo')} hint={t('register.photoHint')} kind="avatar" value={files.photo} onChange={setFile('photo', 'hasPhoto')} error={err('hasPhoto')} />
          {name}{email}
          <PhoneField label={t('register.phone')} value={f.phone} onChange={v => set('phone', v)} error={err('phone')} placeholder="50 000 0000" />
          <PhoneField label={t('register.emergency')} value={f.emergencyContact} onChange={v => set('emergencyContact', v)} error={err('emergencyContact')} />
          <Select label={t('register.gender')} value={f.gender} options={opts(GENDERS)} onChange={v => set('gender', v)} error={err('gender')} />
          <DateField label={t('register.dob')} value={f.dateOfBirth} onChange={v => set('dateOfBirth', v)} error={err('dateOfBirth')}
            max={new Date(new Date().getFullYear() - 10, new Date().getMonth(), new Date().getDate())} />
          <View style={{ gap: 6 }}>
            <Field label={t('register.nationality')} placeholder={t('register.nationalityHint')} value={f.nationality} maxLength={80}
              onChangeText={v => set('nationality', v.replace(/[^a-zA-Z\s-]/g, ''))} />
            <FieldError text={err('nationality')} />
          </View>
          <Select label={t('register.homeCountry')} value={f.homeCountry} options={COUNTRY_OPTIONS} onChange={v => set('homeCountry', v)} error={err('homeCountry')} />
          <View style={{ gap: 6 }}>
            <Field label={t('register.occupation')} value={f.occupation} onChangeText={v => set('occupation', v)} maxLength={120} />
            <FieldError text={err('occupation')} />
          </View>
          <Select label={t('register.idType')} value={f.idType} options={ID_TYPES.map(x => ({ value: x.value, label: x.label }))}
            onChange={v => { set('idType', v as IdType); set('idNumber', '') }} error={err('idType')} />
          {idMeta && (
            <View style={{ gap: 6 }}>
              <Field label={t('register.idNumber', { type: idMeta.label })} value={f.idNumber}
                keyboardType={f.idType === 'Emirates ID' || f.idType === 'Aadhaar Card' ? 'number-pad' : 'default'}
                autoCapitalize={f.idType === 'Passport' ? 'characters' : 'none'}
                onChangeText={v => set('idNumber', formatIdNumber(f.idType, v))} />
              <FieldError text={err('idNumber')} />
            </View>
          )}
        </>}

        {mode === 'full' && step === 1 && <>
          <Select label={t('register.attendance')} value={f.countryAttendance} options={COUNTRY_OPTIONS} onChange={v => set('countryAttendance', v)} error={err('countryAttendance')} />
          <View style={{ gap: 6 }}>
            <Field label={t('register.villa')} value={f.villa} onChangeText={v => set('villa', v)} maxLength={120} autoComplete="street-address" />
            <FieldError text={err('villa')} />
          </View>
          <View style={{ gap: 6 }}>
            <Field label={t('register.city')} value={f.city} onChangeText={v => set('city', v)} maxLength={80} />
            <FieldError text={err('city')} />
          </View>
          <Select label={t('register.addressCountry')} value={f.addressCountry} options={COUNTRY_OPTIONS} onChange={v => set('addressCountry', v)} error={err('addressCountry')} />
          <FileField label={t('register.passport')} kind="doc" value={files.passport} onChange={setFile('passport', 'hasPassport')} error={err('hasPassport')} />
          {f.idType === 'Passport'
            ? <Notice tone="info">{t('register.passportIsId')}</Notice>
            : <FileField label={idMeta?.doc ?? 'ID Document Copy'} kind="doc" value={files.idDoc} onChange={setFile('idDoc', 'hasIdDoc')} error={err('hasIdDoc')} />}
        </>}

        {mode === 'full' && step === 2 && <>
          <Select label={t('register.experience')} value={f.experienceLevel} options={opts(EXPERIENCE)} onChange={v => set('experienceLevel', v)} error={err('experienceLevel')} />
          <DateField label={t('register.startDate')} value={f.preferredStartDate} onChange={v => set('preferredStartDate', v)} error={err('preferredStartDate')}
            min={new Date(`${isoDate(new Date())}T00:00:00`)} />
          <Select label={t('register.hear')} value={f.hearAboutUs} options={opts(HEAR_ABOUT)} onChange={v => set('hearAboutUs', v)} error={err('hearAboutUs')} />
          {f.hearAboutUs === REFERRAL && (
            <Field label={t('register.referral')} value={f.referralName} onChangeText={v => set('referralName', v)} maxLength={120} />
          )}
          <View style={{ gap: 10 }}>
            <Text style={{ fontFamily: fonts.medium, fontSize: 13, color: colors.textSecondary }}>{t('register.programs')}</Text>
            {PROGRAM_GROUPS.map(g => (
              <View key={g.title} style={{ gap: 6 }}>
                <Text style={{ fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 0.5, color: colors.textMuted }}>{g.title.toUpperCase()}</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {g.items.map(p => (
                    <Chip key={p.id} label={p.label} active={f.programs.includes(p.id)}
                      onPress={() => set('programs', f.programs.includes(p.id) ? f.programs.filter(x => x !== p.id) : [...f.programs, p.id])} />
                  ))}
                </View>
              </View>
            ))}
            <FieldError text={err('programs')} />
          </View>
        </>}

        {mode === 'full' && step === 3 && <>
          {center}
          <Select label={t('register.payment')} value={f.paymentMethod} options={opts(PAYMENT_METHODS)} onChange={v => set('paymentMethod', v)} error={err('paymentMethod')} />
          {password}
          <View style={{ gap: 6 }}>
            <Field label={t('register.confirmPassword')} value={f.confirmPassword} onChangeText={v => set('confirmPassword', v)} secureTextEntry autoCapitalize="none" />
            <FieldError text={err('confirmPassword')} />
          </View>
          {terms}
        </>}

        {mode === 'full' && (
          <View style={{ flexDirection: 'row', gap: 12 }}>
            {step > 0 && <View style={{ flex: 1 }}><Button variant="ghost" title={t('register.back')} disabled={!!busy} onPress={() => { setErrors({}); setStep(s => s - 1); top() }} /></View>}
            <View style={{ flex: 2 }}>
              {step < STEPS.length - 1
                ? <Button title={t('register.next')} onPress={next} />
                : <Button title={busy ?? t('register.submit')} loading={!!busy} onPress={() => void submitFull()} />}
            </View>
          </View>
        )}
        {!!busy && <Body muted>{busy}</Body>}

        <Pressable onPress={() => router.replace('/sign-in')} accessibilityRole="button" style={{ paddingVertical: 8 }}>
          <Text style={{ fontFamily: fonts.semibold, fontSize: 15, color: colors.primary, textAlign: 'center' }}>{t('register.haveAccount')}</Text>
        </Pressable>
      </ScrollView>
    </Screen>
  )
}
