import { useRef, useState, type ComponentRef } from 'react'
import { ScrollView, Text, View } from 'react-native'
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import {
  EMPTY_FORM, EXPERIENCE, GENDERS, HEAR_ABOUT, ID_TYPES, PAYMENT_METHODS, PROGRAM_GROUPS, REFERRAL,
  completeRegistrationBody, formatIdNumber, isoDate, problemOf, refusedFields, validateStep,
  type Errors, type IdType, type RegisterForm,
} from '@shared'
import { useAuth } from '@/lib/auth'
import { http } from '@/lib/http'
import { forgetUpload, phoneOk, uploadAccountDoc, type PreparedFile } from '@/lib/register'
import { errorText } from '@/lib/errors'
import { Body, Button, Chip, Field, Notice, Screen } from '@/components/ui'
import { COUNTRY_OPTIONS, Checkbox, DateField, FieldError, FileField, PhoneField, Select } from '@/components/form'
import { useToast } from '@/components/toast'
import { useTheme } from '@/theme'

/* ─────────────────────────────────────────────────────────────
   Complete your registration — the website's Settings → Request, for an
   express account (or one sent back for changes): the full application's
   personal, address-and-documents and programme steps, then the payment
   method and terms. Uploads go to the signed-in endpoints (identity scans
   to private storage), then PATCH /auth/me/complete-registration. The
   account returns to "pending" for an admin to review.
───────────────────────────────────────────────────────────── */

const STEP_KEYS = ['personal', 'address', 'program', 'payment'] as const
type Files = { photo: PreparedFile | null; passport: PreparedFile | null; idDoc: PreparedFile | null }
const opts = (xs: readonly string[]) => xs.map(x => ({ value: x, label: x }))
/* Name and email belong to the account already; the shared step check asks for them. */
const strip = (e: Errors): Errors => { const { name: _n, email: _e, ...rest } = e; return rest }

export default function CompleteRegistration() {
  const { t } = useTranslation()
  const { colors, fonts } = useTheme()
  const toast = useToast()
  const { state, refreshUser } = useAuth()
  const user = state.status === 'signedIn' ? state.user : null
  const [step, setStep] = useState(0)
  const [f, setF] = useState<RegisterForm>(() => ({ ...EMPTY_FORM, name: user?.name ?? '', email: user?.email ?? '' }))
  const [files, setFiles] = useState<Files>({ photo: null, passport: null, idDoc: null })
  const [errors, setErrors] = useState<Errors>({})
  const [banner, setBanner] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null)
  if (!user) return null

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

  const check = (s: number): Errors => {
    if (s < 3) return strip(validateStep(s, f, phoneOk))
    const e: Errors = {}
    if (!f.paymentMethod) e.paymentMethod = 'paymentRequired'
    if (!f.terms) e.terms = 'termsRequired'
    return e
  }

  const next = () => {
    const e = check(step)
    setErrors(e)
    if (Object.keys(e).length) { top(); return }
    setStep(s => s + 1)
    top()
  }

  const submit = async () => {
    setBanner(null)
    for (let s = 0; s < STEP_KEYS.length; s++) {
      const e = check(s)
      if (Object.keys(e).length) { setErrors(e); setStep(s); top(); return }
    }
    try {
      const passportLabel = t('register.passport')
      setBusy(t('register.uploading', { label: passportLabel }))
      const passportUrl = await uploadAccountDoc(files.passport!, 'kyc', passportLabel)
      let idDocUrl = passportUrl
      if (f.idType !== 'Passport') {
        const idLabel = ID_TYPES.find(x => x.value === f.idType)!.doc
        setBusy(t('register.uploading', { label: idLabel }))
        idDocUrl = await uploadAccountDoc(files.idDoc!, 'kyc', idLabel)
      }
      setBusy(t('register.uploading', { label: t('register.photo') }))
      const photoUrl = await uploadAccountDoc(files.photo!, 'photo', t('register.photo'))
      setBusy(t('register.submitting'))
      await http.patch('/auth/me/complete-registration', completeRegistrationBody(f, { passportUrl, idDocUrl, photoUrl }), { timeout: 45_000 })
      await refreshUser()
      toast(t('complete.sent'))
      router.back()
    } catch (x) {
      const p = problemOf(x)
      if (p.kind === 'refused' && p.code === 'VALIDATION_ERROR') {
        const bad = refusedFields((x as { response?: { data?: { error?: { details?: unknown } } } }).response?.data?.error?.details)
        if (bad[0]) setStep(Math.min(bad[0].step, 2))
        setBanner(bad.length ? t('register.checkFields', { fields: bad.map(b => b.label).join(', ') }) : p.message)
      } else {
        setBanner(x instanceof Error && !(x as { isAxiosError?: boolean }).isAxiosError ? x.message : errorText(x))
      }
      top()
    } finally {
      setBusy(null)
    }
  }

  const idMeta = ID_TYPES.find(x => x.value === f.idType)
  const reason = user.rejectionReason || user.enrollmentCancellationReason

  return (
    <Screen scroll={false}>
      <ScrollView ref={scroll} contentContainerStyle={{ gap: 16, paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
        <Stepper step={step} />
        {(user.enrollmentStatus === 'rejected' || user.enrollmentStatus === 'cancelled') && (
          <Notice>{reason ? `${t('account.registrationRejected')}: ${reason}` : t('account.registrationRejected')}</Notice>
        )}
        {step === 0 && <Body muted>{t('account.completeRegistrationBody')}</Body>}
        {banner && <Notice>{banner}</Notice>}

        {step === 0 && <>
          <FileField label={t('register.photo')} hint={t('register.photoHint')} kind="avatar" value={files.photo} onChange={setFile('photo', 'hasPhoto')} error={err('hasPhoto')} />
          <PhoneField label={t('register.phone')} value={f.phone} onChange={v => set('phone', v)} error={err('phone')} placeholder="50 000 0000" />
          <PhoneField label={t('register.emergency')} value={f.emergencyContact} onChange={v => set('emergencyContact', v)} error={err('emergencyContact')} />
          <Select label={t('register.gender')} value={f.gender} options={opts(GENDERS)} onChange={v => set('gender', v)} error={err('gender')} />
          <DateField label={t('register.dob')} value={f.dateOfBirth} onChange={v => set('dateOfBirth', v)} error={err('dateOfBirth')}
            max={new Date(new Date().getFullYear() - 10, new Date().getMonth(), new Date().getDate())} />
          <View style={{ gap: 6 }}>
            <Field label={t('register.nationality')} invalid={!!err('nationality')} placeholder={t('register.nationalityHint')} value={f.nationality} maxLength={80}
              onChangeText={v => set('nationality', v.replace(/[^a-zA-Z\s-]/g, ''))} />
            <FieldError text={err('nationality')} />
          </View>
          <Select label={t('register.homeCountry')} value={f.homeCountry} options={COUNTRY_OPTIONS} onChange={v => set('homeCountry', v)} error={err('homeCountry')} />
          <View style={{ gap: 6 }}>
            <Field label={t('register.occupation')} invalid={!!err('occupation')} value={f.occupation} onChangeText={v => set('occupation', v)} maxLength={120} />
            <FieldError text={err('occupation')} />
          </View>
          <Select label={t('register.idType')} value={f.idType} options={ID_TYPES.map(x => ({ value: x.value, label: x.label }))}
            onChange={v => { set('idType', v as IdType); set('idNumber', '') }} error={err('idType')} />
          {idMeta && (
            <View style={{ gap: 6 }}>
              <Field label={t('register.idNumber', { type: idMeta.label })} invalid={!!err('idNumber')} value={f.idNumber}
                keyboardType={f.idType === 'Emirates ID' || f.idType === 'Aadhaar Card' ? 'number-pad' : 'default'}
                autoCapitalize={f.idType === 'Passport' ? 'characters' : 'none'}
                onChangeText={v => set('idNumber', formatIdNumber(f.idType, v))} />
              <FieldError text={err('idNumber')} />
            </View>
          )}
        </>}

        {step === 1 && <>
          <Select label={t('register.attendance')} value={f.countryAttendance} options={COUNTRY_OPTIONS} onChange={v => set('countryAttendance', v)} error={err('countryAttendance')} />
          <View style={{ gap: 6 }}>
            <Field label={t('register.villa')} invalid={!!err('villa')} value={f.villa} onChangeText={v => set('villa', v)} maxLength={120} autoComplete="street-address" />
            <FieldError text={err('villa')} />
          </View>
          <View style={{ gap: 6 }}>
            <Field label={t('register.city')} invalid={!!err('city')} value={f.city} onChangeText={v => set('city', v)} maxLength={80} />
            <FieldError text={err('city')} />
          </View>
          <Select label={t('register.addressCountry')} value={f.addressCountry} options={COUNTRY_OPTIONS} onChange={v => set('addressCountry', v)} error={err('addressCountry')} />
          <FileField label={t('register.passport')} kind="doc" value={files.passport} onChange={setFile('passport', 'hasPassport')} error={err('hasPassport')} />
          {f.idType === 'Passport'
            ? <Notice tone="info">{t('register.passportIsId')}</Notice>
            : <FileField label={idMeta?.doc ?? 'ID Document Copy'} kind="doc" value={files.idDoc} onChange={setFile('idDoc', 'hasIdDoc')} error={err('hasIdDoc')} />}
        </>}

        {step === 2 && <>
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

        {step === 3 && <>
          <Select label={t('register.payment')} value={f.paymentMethod} options={opts(PAYMENT_METHODS)} onChange={v => set('paymentMethod', v)} error={err('paymentMethod')} />
          <Checkbox checked={f.terms} onChange={v => set('terms', v)} error={err('terms')} label={`${t('register.terms')}${t('register.termsFull')}`}>
            <Text style={{ fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.textSecondary }}>{t('register.terms')}{t('register.termsFull')}</Text>
          </Checkbox>
        </>}

        <View style={{ flexDirection: 'row', gap: 12 }}>
          {step > 0 && <View style={{ flex: 1 }}><Button variant="ghost" title={t('register.back')} disabled={!!busy} onPress={() => { setErrors({}); setStep(s => s - 1); top() }} /></View>}
          <View style={{ flex: 2 }}>
            {step < STEP_KEYS.length - 1
              ? <Button title={t('register.next')} onPress={next} />
              : <Button title={busy ?? t('register.submit')} loading={!!busy} onPress={() => void submit()} />}
          </View>
        </View>
        {!!busy && <Body muted>{busy}</Body>}
      </ScrollView>
    </Screen>
  )
}

/** "Step 2 of 4 · Address & documents" with a four-segment bar. */
function Stepper({ step }: { step: number }) {
  const { t } = useTranslation()
  const { colors, fonts } = useTheme()
  return (
    <View style={{ gap: 8 }} accessibilityRole="progressbar" accessibilityValue={{ min: 1, max: STEP_KEYS.length, now: step + 1 }}>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {STEP_KEYS.map((k, i) => (
          <View key={k} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i <= step ? colors.primary : colors.bgMuted }} />
        ))}
      </View>
      <Text style={{ fontFamily: fonts.semibold, fontSize: 13, color: colors.textSecondary }}>
        {t('complete.stepOf', { n: step + 1, total: STEP_KEYS.length, label: t(`complete.steps.${STEP_KEYS[step]}`) })}
      </Text>
    </View>
  )
}
