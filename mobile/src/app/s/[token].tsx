import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { appPathFor, problemOf, type ApiSuccess, type SessionTokens } from '@shared'
import { http } from '@/lib/http'
import { useAuth } from '@/lib/auth'
import { errorText } from '@/lib/errors'
import { Body, Button, Screen, Title } from '@/components/ui'
import { useTheme } from '@/theme'

/* /s/<code> — a one-tap sign-in link (welcome and reminder messages), opened
   in the app: POST /auth/signin-link/redeem signs the app in and says where
   the link was going; that website path is mapped to the app's screen. */

interface Redeemed { next: string; signedIn: boolean; tokens?: SessionTokens }

export default function SignInLink() {
  const { token } = useLocalSearchParams<{ token: string }>()
  const { t } = useTranslation()
  const { colors } = useTheme()
  const { state, signInWithTokens } = useAuth()
  const [problem, setProblem] = useState<string | null>(null)
  const [needsSignIn, setNeedsSignIn] = useState(false)
  const [next, setNext] = useState<string | null>(null)
  const ran = useRef(false)

  useEffect(() => {
    if (ran.current || state.status === 'booting') return
    ran.current = true
    void (async () => {
      try {
        const res = (await http.post<ApiSuccess<Redeemed>>('/auth/signin-link/redeem', { token })).data.data
        if (res.tokens) await signInWithTokens(res.tokens)
        else if (state.status !== 'signedIn') { setNeedsSignIn(true); return }
        setNext(appPathFor(res.next) ?? '/')
      } catch (err) {
        const p = problemOf(err)
        setProblem(p.kind === 'refused' && p.code === 'SIGNIN_LINK_OTHER_ACCOUNT' ? t('link.otherAccount') : errorText(err))
      }
    })()
  }, [state.status, token, t, signInWithTokens])

  /* Go once the app is signed in, so the destination screen exists. */
  useEffect(() => {
    if (next && state.status === 'signedIn') router.replace(next as never)
  }, [next, state.status])

  if (problem) {
    return (
      <Screen scroll={false}>
        <Title>{t('link.failedTitle')}</Title>
        <Body>{problem}</Body>
        <Button variant="ghost" title={t('link.goHome')} onPress={() => router.replace('/')} />
      </Screen>
    )
  }
  if (needsSignIn) {
    return (
      <Screen scroll={false}>
        <Title>{t('link.signInTitle')}</Title>
        <Body>{t('link.signInBody')}</Body>
        <Button title={t('link.signIn')} onPress={() => router.replace('/sign-in')} />
      </Screen>
    )
  }
  return (
    <Screen scroll={false}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 }}>
        <ActivityIndicator color={colors.primary} />
        <Body>{t('link.signingIn')}</Body>
      </View>
    </Screen>
  )
}
