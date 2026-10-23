import { useState } from 'react'
import { router, useLocalSearchParams } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { requestPasswordReset } from '@/lib/api/account'
import { errorText } from '@/lib/errors'
import { Body, Button, Field, Notice, Screen, Title } from '@/components/ui'
import { Empty } from '@/components/states'

/* Forgot password — asks the server to email a reset link. The link opens
   the website's reset page (it carries a one-hour token); the student then
   signs in here with the new password. The server answers the same whether
   or not the address has an account, and so does this screen. */
export default function Forgot() {
  const { t } = useTranslation()
  const params = useLocalSearchParams<{ email?: string }>()
  const [email, setEmail] = useState(params.email ?? '')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const send = async () => {
    const e = email.trim()
    if (!/^\S+@\S+\.\S+$/.test(e)) return setError(t('auth.emailRequired'))
    setError(null); setBusy(true)
    try {
      await requestPasswordReset(e)
      setSentTo(e)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  if (sentTo) {
    return (
      <Screen>
        <Empty icon="mail-open-outline" title={t('forgot.title')} body={t('forgot.sent', { email: sentTo })} />
        <Button title={t('forgot.back')} onPress={() => router.back()} />
      </Screen>
    )
  }

  return (
    <Screen>
      <Title>{t('forgot.title')}</Title>
      <Body>{t('forgot.body')}</Body>
      <Field label={t('auth.email')} value={email} onChangeText={setEmail} autoFocus={!email}
        autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress"
        returnKeyType="send" onSubmitEditing={() => void send()} invalid={!!error} />
      {error && <Notice>{error}</Notice>}
      <Button title={t('forgot.send')} loading={busy} onPress={() => void send()} />
      <Button variant="ghost" title={t('forgot.back')} onPress={() => router.back()} />
    </Screen>
  )
}
