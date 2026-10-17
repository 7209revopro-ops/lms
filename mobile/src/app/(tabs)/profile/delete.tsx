import { useState } from 'react'
import { Alert, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { deleteAccount, requestDeleteCode } from '@/lib/api/account'
import { useAuth } from '@/lib/auth'
import { errorText } from '@/lib/errors'
import { Body, Button, Field, Notice, Screen, Title } from '@/components/ui'
import { useTheme } from '@/theme'

/* ─────────────────────────────────────────────────────────────
   Delete account — in the app, as the stores require (Apple 5.1.1(v),
   Google Play's account-deletion policy; plan.md §13.4 B6).

   A real deletion, the same one the website runs: the account and everything
   attached to it go at once (services/userCascade.ts). Three deliberate
   steps so nobody does it by accident: read what it means, type DELETE, and
   prove it is you — the password, or for a student who signs in without one,
   a code emailed to them.
───────────────────────────────────────────────────────────── */
export default function DeleteAccount() {
  const { t } = useTranslation()
  const { colors, fonts } = useTheme()
  const { signOut } = useAuth()
  const [typed, setTyped] = useState('')
  const [useCode, setUseCode] = useState(false)
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const armed = typed.trim().toUpperCase() === 'DELETE'

  const sendCode = async () => {
    setProblem(null)
    setBusy(true)
    try { await requestDeleteCode(); setCodeSent(true) } catch (e) { setProblem(errorText(e)) } finally { setBusy(false) }
  }

  const run = async () => {
    setProblem(null)
    setBusy(true)
    try {
      await deleteAccount(useCode ? { code: code.trim() } : { password })
      /* The server has already revoked every session; clear this phone. */
      await signOut()
      Alert.alert(t('account.deleted'))
    } catch (e) {
      setProblem(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen>
      <Title>{t('account.deleteTitle')}</Title>
      <Body>{t('account.deleteIntro')}</Body>
      <Body muted>{t('account.deleteKept')}</Body>

      <Field label={t('account.deleteTypeConfirm')} value={typed} onChangeText={setTyped} autoCapitalize="characters" autoCorrect={false} />

      {armed && (
        <View style={{ gap: 12 }}>
          {!useCode ? <>
            <Field label={t('account.deleteWithPassword')} value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" />
            <Text onPress={() => { setUseCode(true); setProblem(null) }} accessibilityRole="button"
              style={{ fontFamily: fonts.semibold, fontSize: 14, color: colors.primary }}>{t('account.deleteWithCode')}</Text>
          </> : <>
            {!codeSent
              ? <Button variant="ghost" title={t('account.deleteWithCode')} loading={busy} onPress={() => void sendCode()} />
              : <>
                <Notice tone="info">{t('account.codeSent')}</Notice>
                <Field label={t('account.code')} value={code} onChangeText={v => setCode(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="one-time-code" />
              </>}
            <Text onPress={() => { setUseCode(false); setProblem(null) }} accessibilityRole="button"
              style={{ fontFamily: fonts.semibold, fontSize: 14, color: colors.primary }}>{t('account.deleteWithPassword')}</Text>
          </>}

          {problem && <Notice>{problem}</Notice>}
          <Button variant="danger" title={t('account.deleteButton')} loading={busy && (useCode ? codeSent : true)}
            disabled={useCode ? code.length !== 6 : !password} onPress={() => void run()} />
        </View>
      )}
    </Screen>
  )
}
