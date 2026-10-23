import { useState } from 'react'
import { Alert, Linking, Share, Text, View } from 'react-native'
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { problemOf } from '@shared'
import { deactivateAccount, disableTwoFactor, enableTwoFactor, startTwoFactorSetup } from '@/lib/api/account'
import { useAuth } from '@/lib/auth'
import { errorText } from '@/lib/errors'
import { copyText } from '@/lib/files'
import { Badge, Body, Button, Card, Field, Group, ListRow, Notice, Screen } from '@/components/ui'
import { useToast } from '@/components/toast'
import { useTheme } from '@/theme'

/* Security — the website's Settings → Privacy & security: two-step
   verification (an authenticator app, TOTP), the signed-in devices, and
   switching the account off. Deleting it stays on the Profile screen, where
   the stores require it to be easy to find. */
export default function Security() {
  const { t } = useTranslation()
  const { state } = useAuth()
  if (state.status !== 'signedIn') return null
  return (
    <Screen>
      <TwoFactor enabled={!!state.user.twoFactorEnabled} />
      <Group>
        <ListRow icon="phone-portrait-outline" label={t('account.devices')} onPress={() => router.push('/profile/devices')} />
      </Group>
      <Deactivate />
    </Screen>
  )
}

function noPassword(e: unknown, t: (k: string) => string) {
  const p = problemOf(e)
  return p.kind === 'refused' && p.code === 'NO_PASSWORD_SET' ? t('account.noPassword') : errorText(e)
}

type Step = { kind: 'idle' } | { kind: 'password'; action: 'on' | 'off' } | { kind: 'app'; secret: string; otpauthUrl: string }

function TwoFactor({ enabled }: { enabled: boolean }) {
  const { t } = useTranslation()
  const { colors, fonts, radius } = useTheme()
  const { refreshUser } = useAuth()
  const toast = useToast()
  const [step, setStep] = useState<Step>({ kind: 'idle' })
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const reset = () => { setStep({ kind: 'idle' }); setPassword(''); setCode(''); setError(null) }

  const confirmPassword = async () => {
    if (step.kind !== 'password') return
    setError(null); setBusy(true)
    try {
      if (step.action === 'on') {
        const s = await startTwoFactorSetup(password)
        setPassword('')
        setStep({ kind: 'app', ...s })
      } else {
        await disableTwoFactor(password)
        await refreshUser()
        reset()
        toast(t('account.twoFactorDisabled'), 'info')
      }
    } catch (e) {
      setError(noPassword(e, t))
    } finally {
      setBusy(false)
    }
  }

  const verify = async () => {
    setError(null); setBusy(true)
    try {
      await enableTwoFactor(code)
      await refreshUser()
      reset()
      toast(t('account.twoFactorEnabled'))
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const openApp = async (url: string) => {
    try { await Linking.openURL(url) } catch { setError(t('account.noAuthenticator')) }
  }

  return (
    <Card style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Text accessibilityRole="header" style={{ flex: 1, fontFamily: fonts.bold, fontSize: 17, color: colors.textPrimary }}>{t('account.twoFactor')}</Text>
        <Badge label={enabled ? t('account.twoFactorOn') : t('account.twoFactorOff')} tone={enabled ? 'success' : 'muted'} icon={enabled ? 'shield-checkmark' : 'shield-outline'} />
      </View>
      <Body muted>{t('account.twoFactorIntro')}</Body>

      {step.kind === 'idle' && (
        <Button variant={enabled ? 'ghost' : 'primary'} title={enabled ? t('account.twoFactorTurnOff') : t('account.twoFactorTurnOn')}
          onPress={() => {
            if (!enabled) return setStep({ kind: 'password', action: 'on' })
            Alert.alert(t('account.twoFactorOffConfirm'), undefined, [
              { text: t('common.back'), style: 'cancel' },
              { text: t('account.twoFactorTurnOff'), style: 'destructive', onPress: () => setStep({ kind: 'password', action: 'off' }) },
            ])
          }} />
      )}

      {step.kind === 'password' && (
        <>
          <Field label={t('account.twoFactorPassword')} value={password} onChangeText={setPassword} secureTextEntry autoFocus
            autoComplete="current-password" textContentType="password" returnKeyType="go" onSubmitEditing={() => void confirmPassword()} />
          {error && <Notice>{error}</Notice>}
          <Button title={step.action === 'on' ? t('common.continue') : t('account.twoFactorTurnOff')} variant={step.action === 'off' ? 'danger' : 'primary'}
            loading={busy} disabled={!password} onPress={() => void confirmPassword()} />
          <Button variant="ghost" title={t('common.back')} onPress={reset} />
        </>
      )}

      {step.kind === 'app' && (
        <>
          <StepLabel n={1} text={t('account.twoFactorStepApp')} />
          <Button title={t('account.openAuthenticator')} onPress={() => void openApp(step.otpauthUrl)} />
          <View style={{ gap: 6, padding: 12, borderRadius: radius.md, backgroundColor: colors.bgMuted }}>
            <Text style={{ fontFamily: fonts.medium, fontSize: 12, color: colors.textMuted }}>{t('account.setupKey')}</Text>
            <Text selectable style={{ fontFamily: fonts.semibold, fontSize: 16, letterSpacing: 1.5, color: colors.textPrimary }}>
              {step.secret.replace(/(.{4})(?=.)/g, '$1 ')}
            </Text>
          </View>
          <Button variant="ghost" title={t('account.copyKey')} onPress={() => void copyText(step.secret).then(ok => {
            if (ok) toast(t('account.keyCopied'), 'info')
            else void Share.share({ message: step.secret })
          })} />
          <StepLabel n={2} text={t('account.twoFactorStepCode')} />
          <Field label={t('account.code')} value={code} onChangeText={v => setCode(v.replace(/\D/g, '').slice(0, 6))}
            keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="one-time-code" />
          {error && <Notice>{error}</Notice>}
          <Button title={t('account.verifyAndTurnOn')} loading={busy} disabled={code.length !== 6} onPress={() => void verify()} />
          <Button variant="ghost" title={t('common.back')} onPress={reset} />
        </>
      )}
    </Card>
  )
}

function StepLabel({ n, text }: { n: number; text: string }) {
  const { colors, fonts } = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <View style={{ width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryFill }}>
        <Text style={{ fontFamily: fonts.bold, fontSize: 12, color: colors.onPrimary }}>{n}</Text>
      </View>
      <Text style={{ flex: 1, fontFamily: fonts.semibold, fontSize: 15, color: colors.textPrimary }}>{text}</Text>
    </View>
  )
}

function Deactivate() {
  const { t } = useTranslation()
  const { colors, fonts } = useTheme()
  const { signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const run = () => Alert.alert(t('account.deactivate'), t('account.deactivateIntro'), [
    { text: t('common.back'), style: 'cancel' },
    {
      text: t('account.deactivateButton'), style: 'destructive', onPress: async () => {
        setError(null); setBusy(true)
        try {
          await deactivateAccount(password)
          await signOut()
          Alert.alert(t('account.deactivated'))
        } catch (e) {
          setError(noPassword(e, t))
        } finally {
          setBusy(false)
        }
      },
    },
  ])

  return (
    <Card style={{ gap: 12 }}>
      <Text accessibilityRole="header" style={{ fontFamily: fonts.bold, fontSize: 17, color: colors.danger }}>{t('account.deactivate')}</Text>
      <Body muted>{t('account.deactivateIntro')}</Body>
      {!open ? (
        <Button variant="dangerGhost" title={t('account.deactivate')} onPress={() => setOpen(true)} />
      ) : (
        <>
          <Field label={t('account.twoFactorPassword')} value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" textContentType="password" />
          {error && <Notice>{error}</Notice>}
          <Button variant="danger" title={t('account.deactivateButton')} loading={busy} disabled={!password} onPress={run} />
        </>
      )}
    </Card>
  )
}
