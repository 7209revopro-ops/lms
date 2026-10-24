import '@/i18n'
import { useEffect, useRef } from 'react'
import { Linking, Platform } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import * as SplashScreen from 'expo-splash-screen'
import { Stack } from 'expo-router/stack'
import { router } from 'expo-router'
import * as Notifications from 'expo-notifications'
import { useFonts } from 'expo-font'
import { DMSans_400Regular, DMSans_500Medium, DMSans_600SemiBold, DMSans_700Bold } from '@expo-google-fonts/dm-sans'
import { BricolageGrotesque_700Bold } from '@expo-google-fonts/bricolage-grotesque'
import * as Sentry from '@sentry/react-native'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import { AuthProvider, useAuth } from '@/lib/auth'
import { useAppGate } from '@/lib/appConfig'
import { registerForPush, screenForNotification } from '@/lib/push'
import { restoreThemePref } from '@/lib/themePref'
import { env } from '@/lib/env'
import { appVersion } from '@/lib/device'
import { Body, Button, Screen, Title } from '@/components/ui'
import { ToastProvider } from '@/components/toast'
import { useTheme } from '@/theme'

void SplashScreen.preventAutoHideAsync()
/* The student's light / dark choice, back before the first screen draws. */
void restoreThemePref()

/* A link that opens the app straight on a class, the bookings or the
   notifications (a Join button, a push) still has the tabs under it, so Back
   leads home instead of out of the app. */
export const unstable_settings = { anchor: '(tabs)' }

/* Crash reporting only when a DSN is configured, and never from a dev build. */
if (env.sentryDsn) {
  Sentry.init({ dsn: env.sentryDsn, environment: env.appEnv, release: appVersion, enabled: env.appEnv !== 'development' })
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
})

function GateScreen({ kind, storeUrl }: { kind: 'required' | 'maintenance'; storeUrl?: string | null }) {
  const { t } = useTranslation()
  return (
    <Screen scroll={false}>
      <Title>{t(kind === 'required' ? 'gate.updateTitle' : 'gate.maintenanceTitle')}</Title>
      <Body>{t(kind === 'required' ? 'gate.updateBody' : 'gate.maintenanceBody')}</Body>
      {kind === 'required' && storeUrl && <Button title={t('gate.update')} onPress={() => void Linking.openURL(storeUrl)} />}
    </Screen>
  )
}

function UnreachableScreen() {
  const { t } = useTranslation()
  const { retry } = useAuth()
  return (
    <Screen scroll={false}>
      <Title>{t('common.tryAgain')}</Title>
      <Body>{t('common.offline')}</Body>
      <Button title={t('common.tryAgain')} onPress={retry} />
    </Screen>
  )
}

/* Push: register this phone once signed in (asking for permission the first
   time), and open the screen of a tapped notification — also the one that
   launched the app. A tap while signed out is ignored: sign in first. */
function PushBridge({ signedIn }: { signedIn: boolean }) {
  const response = Notifications.useLastNotificationResponse()
  const handled = useRef<string | null>(null)

  useEffect(() => {
    if (signedIn) void registerForPush()
  }, [signedIn])

  useEffect(() => {
    if (!signedIn || !response) return
    const id = response.notification.request.identifier
    if (handled.current === id) return
    handled.current = id
    router.push(screenForNotification(response) as never, { withAnchor: true })
    void Notifications.clearLastNotificationResponseAsync()
  }, [signedIn, response])

  return null
}

function RootNavigator() {
  const { state } = useAuth()
  const { gate, config } = useAppGate()
  const { colors, scheme } = useTheme()
  const insets = useSafeAreaInsets()
  const { t } = useTranslation()

  useEffect(() => {
    if (state.status !== 'booting') void SplashScreen.hideAsync()
  }, [state.status])

  if (state.status === 'booting') return null
  if (gate === 'maintenance') return <GateScreen kind="maintenance" />
  if (gate === 'required') {
    return <GateScreen kind="required" storeUrl={Platform.OS === 'ios' ? config?.storeUrls.ios : config?.storeUrls.android} />
  }
  if (state.status === 'unreachable') return <UnreachableScreen />

  const signedIn = state.status === 'signedIn'
  const detail = {
    headerShown: true,
    headerBackTitle: 'Back',
    headerStyle: { backgroundColor: colors.bgSurface },
    headerTintColor: colors.primary,
    headerTitleStyle: { fontFamily: 'DMSans_600SemiBold', color: colors.textPrimary },
    /* No tab bar under these: keep their content clear of the system
       navigation bar, which the app draws behind (edge to edge). */
    contentStyle: { backgroundColor: colors.bgPage, paddingBottom: insets.bottom },
  }
  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <PushBridge signedIn={signedIn} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bgPage } }}>
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="(tabs)" />
          {/* Pushed over the tabs, with a native header and back button. */}
          <Stack.Screen name="bookings" options={detail} />
          <Stack.Screen name="class/[id]" options={detail} />
          <Stack.Screen name="watch/[id]" options={detail} />
          <Stack.Screen name="notifications" options={detail} />
          <Stack.Screen name="tutor" options={detail} />
          <Stack.Screen name="recordings" options={{ ...detail, title: t('recordings.title') }} />
        </Stack.Protected>
        {/* Join and sign-in links work signed in or out — they sign the app in. */}
        <Stack.Screen name="j/[token]" />
        <Stack.Screen name="s/[token]" />
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
      </Stack>
    </>
  )
}

function RootLayout() {
  const [fontsLoaded] = useFonts({
    DMSans_400Regular, DMSans_500Medium, DMSans_600SemiBold, DMSans_700Bold, BricolageGrotesque_700Bold,
  })
  if (!fontsLoaded) return null
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ToastProvider>
            <RootNavigator />
          </ToastProvider>
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  )
}

export default env.sentryDsn ? Sentry.wrap(RootLayout) : RootLayout
