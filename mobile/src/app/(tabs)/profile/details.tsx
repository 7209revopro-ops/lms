import { useState } from 'react'
import { Text } from 'react-native'
import { useTranslation } from 'react-i18next'
import { passwordStrength, problemOf } from '@shared'
import { cancelEmailChange, changePassword, requestEmailChange, updateProfile } from '@/lib/api/account'
import { useAuth } from '@/lib/auth'
import { errorText } from '@/lib/errors'
import { Button, Card, Field, Notice, Screen } from '@/components/ui'
import { useToast } from '@/components/toast'
import { useTheme } from '@/theme'

/* Your details — the website's Settings → Profile: name, job title and bio;
   the email address (changed through a link sent to the new inbox); and the
   password. Each section saves on its own. */
export default function Details() {
  const { state, refreshUser } = useAuth()
  const user = state.status === 'signedIn' ? state.user : null
  if (!user) return null
  return (
    <Screen>
      <ProfileSection key={user.id} name={user.name} headline={user.headline ?? ''} bio={user.bio ?? ''} onSaved={refreshUser} />
      <EmailSection email={user.email} pending={user.pendingEmail ?? null} onChanged={refreshUser} />
      <PasswordSection />
    </Screen>
  )
}

function SectionTitle({ children }: { children: string }) {
  const { colors, fonts } = useTheme()
  return <Text accessibilityRole="header" style={{ fontFamily: fonts.bold, fontSize: 17, color: colors.textPrimary }}>{children}</Text>
}

/** The server's reason, except "no password" — that one deserves a way out. */
function reason(e: unknown, t: (k: string) => string): string {
  const p = problemOf(e)
  return p.kind === 'refused' && p.code === 'NO_PASSWORD_SET' ? t('account.noPassword') : errorText(e)
}

function ProfileSection({ name: n0, headline: h0, bio: b0, onSaved }: { name: string; headline: string; bio: string; onSaved: () => Promise<void> }) {
  const { t } = useTranslation()
  const toast = useToast()
  const [name, setName] = useState(n0)
  const [headline, setHeadline] = useState(h0)
  const [bio, setBio] = useState(b0)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const dirty = name.trim() !== n0 || headline.trim() !== h0 || bio.trim() !== b0

  const save = async () => {
    setError(null); setBusy(true)
    try {
      await updateProfile({ name, headline, bio })
      await onSaved()
      toast(t('account.profileSaved'))
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card style={{ gap: 14 }}>
      <SectionTitle>{t('account.editProfile')}</SectionTitle>
      <Field label={t('register.name')} value={name} onChangeText={setName} maxLength={120} autoComplete="name" invalid={name.trim().length < 2} />
      <Field label={t('account.headline')} placeholder={t('account.headlineHint')} value={headline} onChangeText={setHeadline} maxLength={255} />
      <Field label={t('account.bio')} placeholder={t('account.bioHint')} value={bio} onChangeText={setBio} maxLength={2000}
        multiline textAlignVertical="top" style={{ minHeight: 96 }} />
      {error && <Notice>{error}</Notice>}
      <Button title={t('account.save')} loading={busy} disabled={!dirty || name.trim().length < 2} onPress={() => void save()} />
    </Card>
  )
}

function EmailSection({ email, pending, onChanged }: { email: string; pending: string | null; onChanged: () => Promise<void> }) {
  const { t } = useTranslation()
  const { colors, fonts } = useTheme()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [next, setNext] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const send = async () => {
    setError(null); setBusy(true)
    try {
      await requestEmailChange(next, password)
      await onChanged()
      setOpen(false); setNext(''); setPassword('')
    } catch (e) {
      setError(reason(e, t))
    } finally {
      setBusy(false)
    }
  }
  const cancel = async () => {
    setBusy(true)
    try {
      await cancelEmailChange()
      await onChanged()
      toast(t('account.emailChangeCancelled'), 'info')
    } catch (e) {
      toast(errorText(e), 'danger')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card style={{ gap: 12 }}>
      <SectionTitle>{t('account.emailTitle')}</SectionTitle>
      <Text selectable style={{ fontFamily: fonts.medium, fontSize: 15, color: colors.textPrimary }}>{email}</Text>
      {pending ? (
        <>
          <Notice tone="info">{`${t('account.emailPending')}. ${t('account.emailPendingBody', { email: pending, current: email })}`}</Notice>
          <Button variant="ghost" title={t('account.cancelEmailChange')} loading={busy} onPress={() => void cancel()} />
        </>
      ) : !open ? (
        <Button variant="ghost" title={t('account.changeEmail')} onPress={() => setOpen(true)} />
      ) : (
        <>
          <Field label={t('account.newEmail')} value={next} onChangeText={setNext} autoCapitalize="none" autoComplete="email"
            keyboardType="email-address" textContentType="emailAddress" autoFocus />
          <Field label={t('account.current')} value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" textContentType="password" />
          {error && <Notice>{error}</Notice>}
          <Button title={t('account.sendConfirmation')} loading={busy} disabled={!/^\S+@\S+\.\S+$/.test(next.trim()) || !password} onPress={() => void send()} />
          <Button variant="ghost" title={t('common.back')} onPress={() => { setOpen(false); setError(null) }} />
        </>
      )}
    </Card>
  )
}

function PasswordSection() {
  const { t } = useTranslation()
  const { colors, fonts } = useTheme()
  const toast = useToast()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setError(null)
    if (next.length < 8) return setError(t('register.errors.passwordLength'))
    if (!/[A-Z]/.test(next)) return setError(t('register.errors.passwordUpper'))
    if (!/[0-9]/.test(next)) return setError(t('register.errors.passwordNumber'))
    setBusy(true)
    try {
      await changePassword(current, next)
      setCurrent(''); setNext('')
      toast(t('account.passwordChanged'))
    } catch (e) {
      setError(reason(e, t))
    } finally {
      setBusy(false)
    }
  }

  const strength = (t('register.strength', { returnObjects: true }) as string[])[passwordStrength(next)]
  return (
    <Card style={{ gap: 12 }}>
      <SectionTitle>{t('account.password')}</SectionTitle>
      <Field label={t('account.current')} value={current} onChangeText={setCurrent} secureTextEntry autoComplete="current-password" textContentType="password" />
      <Field label={t('account.newPassword')} value={next} onChangeText={setNext} secureTextEntry autoComplete="new-password" textContentType="newPassword" />
      {!!next && <Text style={{ fontFamily: fonts.medium, fontSize: 12, color: colors.textMuted }}>{strength}</Text>}
      {error && <Notice>{error}</Notice>}
      <Button title={t('account.password')} loading={busy} disabled={!current || !next} onPress={() => void save()} />
    </Card>
  )
}
