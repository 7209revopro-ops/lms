import { useRef, useState } from 'react'
import { Image, Pressable, Text, View } from 'react-native'
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { problemOf } from '@shared'
import { useAuth } from '@/lib/auth'
import { handleSignInError } from '@/lib/authErrors'
import { Body, Button, Field, Notice, Screen, Title, type FieldRef } from '@/components/ui'
import { useTheme } from '@/theme'

/* Sign in — by a code emailed each time, first (the website since 2026-10-22:
   new students have no password at all), or by a password for those who set
   one. A password attempt on an account without one moves to the code. */
export default function SignIn() {
  const { t } = useTranslation()
  const { colors, fonts } = useTheme()
  const { signInWithPassword, requestCode, verifyCode } = useAuth()
  const [mode, setMode] = useState<'code' | 'password'>('code')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const secondRef = useRef<FieldRef>(null)
  const sent = !!sentTo && sentTo === email.trim().toLowerCase()

  const run = async (fn: () => Promise<void>) => {
    setError(null); setBusy(true)
    try { await fn() } catch (err) { setError(handleSignInError(err, t)) } finally { setBusy(false) }
  }

  const sendCode = () => {
    if (!email.trim()) return setError(t('auth.emailRequired'))
    void run(async () => {
      await requestCode(email)
      setSentTo(email.trim().toLowerCase())
      setInfo(null)
      setTimeout(() => secondRef.current?.focus(), 50)
    })
  }

  const verify = () => {
    if (!/^\d{6}$/.test(code.trim())) return setError(t('auth.codeRequired'))
    void run(() => verifyCode(email, code))
  }

  const withPassword = async () => {
    if (!email.trim()) return setError(t('auth.emailRequired'))
    if (!password) return setError(t('auth.passwordRequired'))
    setError(null); setBusy(true)
    try {
      const r = await signInWithPassword(email, password)
      if (r?.twoFactor) router.push({ pathname: '/(auth)/two-factor', params: { challenge: r.twoFactor } })
    } catch (err) {
      const p = problemOf(err)
      if (p.kind === 'refused' && p.code === 'NO_PASSWORD_SET') {
        /* No password on this account: the code is the way in. */
        setMode('code'); setPassword(''); setInfo(t('auth.noPasswordUseCode'))
      } else {
        setError(handleSignInError(err, t))
      }
    } finally {
      setBusy(false)
    }
  }

  const switchMode = (m: 'code' | 'password') => { setMode(m); setError(null); setInfo(null) }

  return (
    <Screen>
      <View style={{ alignItems: 'flex-start', marginTop: 24, marginBottom: 8 }}>
        <Image source={require('../../../assets/icon.png')} style={{ width: 56, height: 56, borderRadius: 14 }} accessibilityIgnoresInvertColors />
      </View>
      <Title>{t('auth.welcome')}</Title>
      <Body>{mode === 'code' ? t('auth.codeSubtitle') : t('auth.subtitle')}</Body>

      <Field label={t('auth.email')} value={email} onChangeText={v => { setEmail(v); setError(null) }}
        autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress"
        editable={!busy} returnKeyType={mode === 'code' && !sent ? 'send' : 'next'}
        onSubmitEditing={() => (mode === 'code' && !sent ? sendCode() : secondRef.current?.focus())} />

      {mode === 'code' ? (
        <>
          {sent && (
            <>
              <Notice tone="info">{t('auth.codeSent', { email: email.trim() })}</Notice>
              <Field ref={secondRef} label={t('auth.code')} value={code} onChangeText={v => setCode(v.replace(/\D/g, '').slice(0, 6))}
                keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={6}
                returnKeyType="go" onSubmitEditing={verify} />
            </>
          )}
          {info && <Notice tone="info">{info}</Notice>}
          {error && <Notice>{error}</Notice>}
          {sent
            ? <>
                <Button title={t('auth.verify')} onPress={verify} loading={busy} disabled={code.length !== 6} />
                <Button variant="ghost" title={t('register.resendCode')} onPress={sendCode} disabled={busy} />
              </>
            : <Button title={t('auth.sendCode')} onPress={sendCode} loading={busy} />}
          <Button variant="ghost" title={t('auth.usePassword')} onPress={() => switchMode('password')} />
        </>
      ) : (
        <>
          <Field ref={secondRef} label={t('auth.password')} value={password} onChangeText={setPassword}
            secureTextEntry autoComplete="current-password" textContentType="password"
            returnKeyType="go" onSubmitEditing={() => void withPassword()} />
          <Pressable onPress={() => router.push({ pathname: '/(auth)/forgot', params: { email: email.trim() } })}
            accessibilityRole="link" hitSlop={8} style={{ alignSelf: 'flex-end', marginTop: -6 }}>
            <Text style={{ fontFamily: fonts.semibold, fontSize: 14, color: colors.primary }}>{t('forgot.link')}</Text>
          </Pressable>
          {error && <Notice>{error}</Notice>}
          <Button title={t('auth.signIn')} onPress={() => void withPassword()} loading={busy} />
          <Button variant="ghost" title={t('auth.useCode')} onPress={() => switchMode('code')} />
        </>
      )}

      <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 4 }} />
      <Button variant="ghost" title={t('register.cta')} onPress={() => router.push('/(auth)/register')} />
    </Screen>
  )
}
