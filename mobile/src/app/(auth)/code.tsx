import { useState } from 'react'
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/lib/auth'
import { handleSignInError } from '@/lib/authErrors'
import { Body, Button, Field, Notice, Screen, Title } from '@/components/ui'

/* Passwordless sign-in: many students joined through sales and never set a
   password — the email code is their way in. */
export default function CodeSignIn() {
  const { t } = useTranslation()
  const { requestCode, verifyCode } = useAuth()
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const send = async () => {
    if (!email.trim()) return setError(t('auth.emailRequired'))
    setError(null); setBusy(true)
    try { await requestCode(email); setSent(true) }
    catch (err) { setError(handleSignInError(err, t)) }
    finally { setBusy(false) }
  }
  const verify = async () => {
    if (!/^\d{6}$/.test(code.trim())) return setError(t('auth.codeRequired'))
    setError(null); setBusy(true)
    try { await verifyCode(email, code) }
    catch (err) { setError(handleSignInError(err, t)) }
    finally { setBusy(false) }
  }

  return (
    <Screen>
      <Title>{t('auth.codeTitle')}</Title>
      <Body>{t('auth.codeSubtitle')}</Body>
      <Field label={t('auth.email')} value={email} onChangeText={v => { setEmail(v); setSent(false) }}
        autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress"
        editable={!busy} />
      {sent && (
        <>
          <Notice tone="info">{t('auth.codeSent', { email: email.trim() })}</Notice>
          {/* Digits only, so a pasted "123 456" still works. */}
          <Field label={t('auth.code')} value={code} onChangeText={v => setCode(v.replace(/\D/g, '').slice(0, 6))}
            keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode"
            returnKeyType="go" onSubmitEditing={() => void verify()} />
        </>
      )}
      {error && <Notice>{error}</Notice>}
      {sent
        ? <Button title={t('auth.verify')} onPress={() => void verify()} loading={busy} />
        : <Button title={t('auth.sendCode')} onPress={() => void send()} loading={busy} />}
      {sent && <Button variant="ghost" title={t('auth.resendCode')} onPress={() => void send()} disabled={busy} />}
      <Button variant="ghost" title={t('auth.usePassword')} onPress={() => router.back()} />
    </Screen>
  )
}
