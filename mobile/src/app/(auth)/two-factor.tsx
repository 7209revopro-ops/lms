import { useState } from 'react'
import { router, useLocalSearchParams } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/lib/auth'
import { handleSignInError } from '@/lib/authErrors'
import { Body, Button, Field, Notice, Screen, Title } from '@/components/ui'

export default function TwoFactor() {
  const { t } = useTranslation()
  const { challenge } = useLocalSearchParams<{ challenge: string }>()
  const { completeTwoFactor } = useAuth()
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!/^\d{6}$/.test(code.trim())) return setError(t('auth.codeRequired'))
    setError(null); setBusy(true)
    try { await completeTwoFactor(String(challenge ?? ''), code) }
    catch (err) { setError(handleSignInError(err, t)) }
    finally { setBusy(false) }
  }

  return (
    <Screen>
      <Title>{t('auth.twoFactorTitle')}</Title>
      <Body>{t('auth.twoFactorSubtitle')}</Body>
      <Field label={t('auth.code')} value={code} onChangeText={setCode} keyboardType="number-pad"
        autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={6} autoFocus
        returnKeyType="go" onSubmitEditing={() => void submit()} />
      {error && <Notice>{error}</Notice>}
      <Button title={t('auth.verify')} onPress={() => void submit()} loading={busy} />
      <Button variant="ghost" title={t('common.back')} onPress={() => router.back()} />
    </Screen>
  )
}
