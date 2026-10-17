import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Text, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { problemOf, type ApiSuccess, type SessionTokens } from '@shared'
import { http } from '@/lib/http'
import { useAuth } from '@/lib/auth'
import { joinMeet } from '@/lib/join'
import { errorText } from '@/lib/errors'
import { Body, Button, Screen, Title } from '@/components/ui'
import { useTheme } from '@/theme'

/* ─────────────────────────────────────────────────────────────
   /j/<code> — the Join button in a booked student's class reminders (email,
   WhatsApp, push), opened in the app (plan.md §13.4 B4). The website's
   /j page, step for step:
     1. POST /auth/join-link/redeem — signs the app in if it is not (no
        password), and answers which class the code is for;
     2. a Meet class: POST /live-classes/:id/join (records attendance) and
        straight into Meet; an in-app class: its class screen;
     3. too early: a countdown, then it opens by itself.
   Every step ends in a screen with a way forward — never an endless spinner.
───────────────────────────────────────────────────────────── */

type View_ =
  | { kind: 'working'; label: string }
  | { kind: 'wait'; until: number; classId: string }
  | { kind: 'error'; title: string; message: string; classId?: string }
  | { kind: 'signIn' }

interface Redeemed { liveClassId: string; inApp?: boolean; signedIn: boolean; tokens?: SessionTokens }

const TRANSIENT = new Set([408, 429, 500, 502, 503, 504])
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export default function JoinLink() {
  const { token } = useLocalSearchParams<{ token: string }>()
  const { t } = useTranslation()
  const { colors } = useTheme()
  const { state, signInWithTokens } = useAuth()
  const [view, setView] = useState<View_>({ kind: 'working', label: t('link.signingIn') })
  const [now, setNow] = useState(() => Date.now())
  const ran = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /* The class the code is for — opened once the app is signed in, so the
     class screen (signed-in only) exists by the time we go there. */
  const [target, setTarget] = useState<{ classId: string; inApp: boolean } | null>(null)
  const opened = useRef(false)

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  useEffect(() => {
    if (view.kind !== 'wait') return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [view.kind])

  useEffect(() => {
    if (!target || state.status !== 'signedIn' || opened.current) return
    opened.current = true
    const join = async (classId: string): Promise<void> => {
      setView({ kind: 'working', label: t('link.opening') })
      const r = await joinMeet(classId)
      if (r.ok) { router.replace({ pathname: '/class/[id]', params: { id: classId } }); return }
      if (r.retryAfter) {
        setView({ kind: 'wait', until: Date.now() + r.retryAfter * 1000, classId })
        timer.current = setTimeout(() => { void join(classId) }, r.retryAfter * 1000 + 500)
        return
      }
      setView({ kind: 'error', title: t('link.failedTitle'), message: r.message, classId })
    }
    if (target.inApp) router.replace({ pathname: '/class/[id]', params: { id: target.classId } })
    else void join(target.classId)
  }, [target, state.status, t])

  useEffect(() => {
    if (ran.current || state.status === 'booting') return
    ran.current = true

    void (async () => {
      /* The redeem is safe to repeat: retried on a dropped connection or a
         gateway hiccup, never on a refusal with a reason. */
      let res: Redeemed | null = null
      for (let attempt = 0; ; attempt++) {
        try {
          res = (await http.post<ApiSuccess<Redeemed>>('/auth/join-link/redeem', { token })).data.data
          break
        } catch (err) {
          const p = problemOf(err)
          const transient = p.kind !== 'refused' || TRANSIENT.has(p.status)
          if (transient && attempt < 2) { await sleep(attempt ? 3500 : 1500); continue }
          if (p.kind === 'refused' && p.code === 'JOIN_LINK_OTHER_ACCOUNT') {
            setView({ kind: 'error', title: t('link.failedTitle'), message: t('link.otherAccount') })
          } else {
            setView({ kind: 'error', title: t('link.failedTitle'), message: errorText(err) })
          }
          return
        }
      }

      if (res.tokens) {
        try { await signInWithTokens(res.tokens) } catch (err) {
          setView({ kind: 'error', title: t('link.failedTitle'), message: errorText(err) })
          return
        }
      } else if (state.status !== 'signedIn') {
        /* The code was good but could not sign this phone in (used up, or
           the phone is a device waiting for approval). */
        setView({ kind: 'signIn' })
        return
      }

      setView({ kind: 'working', label: t('link.opening') })
      setTarget({ classId: res.liveClassId, inApp: !!res.inApp })
    })()
  }, [state.status, token, t, signInWithTokens])

  if (view.kind === 'working') {
    return (
      <Screen scroll={false}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 }}>
          <ActivityIndicator color={colors.primary} />
          <Body>{view.label}</Body>
        </View>
      </Screen>
    )
  }
  if (view.kind === 'wait') {
    const secs = Math.max(0, Math.ceil((view.until - now) / 1000))
    const wait = secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s` : `${secs}s`
    return (
      <Screen scroll={false}>
        <Title>{t('link.waitTitle')}</Title>
        <Body>{t('link.waitBody', { wait })}</Body>
        <Text accessibilityLiveRegion="polite" style={{ fontSize: 40, fontWeight: '700', color: colors.primary }}>{wait}</Text>
        <Button variant="ghost" title={t('link.openClass')} onPress={() => router.replace({ pathname: '/class/[id]', params: { id: view.classId } })} />
      </Screen>
    )
  }
  if (view.kind === 'signIn') {
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
      <Title>{view.title}</Title>
      <Body>{view.message}</Body>
      {view.classId && state.status === 'signedIn' && (
        <Button title={t('link.openClass')} onPress={() => router.replace({ pathname: '/class/[id]', params: { id: view.classId! } })} />
      )}
      <Button variant="ghost" title={t('link.goHome')} onPress={() => router.replace('/')} />
    </Screen>
  )
}
