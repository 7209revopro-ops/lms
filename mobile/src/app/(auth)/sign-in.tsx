import { useRef, useState } from 'react'
import { Image, Pressable, Text, View } from 'react-native'
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/lib/auth'
import { handleSignInError } from '@/lib/authErrors'
import { Body, Button, Field, Notice, Screen, Title, type FieldRef } from '@/components/ui'
import { useTheme } from '@/theme'

export default function SignIn() {
  const { t } = useTranslation()
  const { colors, fonts } = useTheme()
  const { signInWithPassword } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const passwordRef = useRef<FieldRef>(null)

  const submit = async () => {
    if (!email.trim()) return setError(t('auth.emailRequired'))
    if (!password) return setError(t('auth.passwordRequired'))
    setError(null); setBusy(true)
    try {
      const r = await signInWithPassword(email, password)
      if (r?.twoFactor) router.push({ pathname: '/(auth)/two-factor', params: { challenge: r.twoFactor } })
    } catch (err) {
      setError(handleSignInError(err, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen>
      <View style={{ alignItems: 'flex-start', marginTop: 24, marginBottom: 8 }}>
        <Image source={require('../../../assets/icon.png')} style={{ width: 56, height: 56, borderRadius: 14 }} accessibilityIgnoresInvertColors />
      </View>
      <Title>{t('auth.welcome')}</Title>
      <Body>{t('auth.subtitle')}</Body>

      <Field label={t('auth.email')} value={email} onChangeText={setEmail}
        autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress"
        returnKeyType="next" onSubmitEditing={() => passwordRef.current?.focus()} />
      <Field ref={passwordRef} label={t('auth.password')} value={password} onChangeText={setPassword}
        secureTextEntry autoComplete="current-password" textContentType="password"
        returnKeyType="go" onSubmitEditing={() => void submit()} />
      <Pressable onPress={() => router.push({ pathname: '/(auth)/forgot', params: { email: email.trim() } })}
        accessibilityRole="link" hitSlop={8} style={{ alignSelf: 'flex-end', marginTop: -6 }}>
        <Text style={{ fontFamily: fonts.semibold, fontSize: 14, color: colors.primary }}>{t('forgot.link')}</Text>
      </Pressable>

      {error && <Notice>{error}</Notice>}
      <Button title={t('auth.signIn')} onPress={() => void submit()} loading={busy} />
      <Button variant="ghost" title={t('auth.useCode')} onPress={() => router.push('/(auth)/code')} />
      <Button variant="ghost" title={t('register.cta')} onPress={() => router.push('/(auth)/register')} />
    </Screen>
  )
}
