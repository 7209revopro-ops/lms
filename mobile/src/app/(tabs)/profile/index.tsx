import { useCallback, useState, type ComponentProps } from 'react'
import { Linking, Pressable, ScrollView, Text, View } from 'react-native'
import { router, useFocusEffect } from 'expo-router'
import Ionicons from '@expo/vector-icons/Ionicons'
import * as Notifications from 'expo-notifications'
import * as WebBrowser from 'expo-web-browser'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/lib/auth'
import { appVersion } from '@/lib/device'
import { env } from '@/lib/env'
import { registerForPush } from '@/lib/push'
import { Body } from '@/components/ui'
import { useTheme } from '@/theme'

type Icon = ComponentProps<typeof Ionicons>['name']

/* Profile — who is signed in, and everything about the account: details,
   devices, notifications, help, legal, sign out, and deleting the account
   (which the stores require to be reachable in the app). */
export default function Profile() {
  const { t } = useTranslation()
  const { colors, fonts } = useTheme()
  const { state, signOut } = useAuth()
  const [push, setPush] = useState<'on' | 'off' | null>(null)

  /* Re-read on every visit: the student may have just changed it in Settings. */
  useFocusEffect(useCallback(() => {
    let alive = true
    void Notifications.getPermissionsAsync().then(p => {
      if (!alive) return
      setPush(p.granted ? 'on' : 'off')
      if (p.granted) void registerForPush()
    }).catch(() => {})
    return () => { alive = false }
  }, []))

  if (state.status !== 'signedIn') return null
  const { user } = state

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontFamily: fonts.bold, fontSize: 22, color: colors.primary }}>{user.name.trim().charAt(0).toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ fontFamily: fonts.display, fontSize: 22, color: colors.textPrimary }}>{user.name}</Text>
          <Text style={{ fontFamily: fonts.body, fontSize: 14, color: colors.textSecondary }}>{user.email}</Text>
          {user.enrollmentStatus && <Text style={{ fontFamily: fonts.medium, fontSize: 12, color: colors.textMuted }}>{`${t('profile.status')}: ${user.enrollmentStatus}`}</Text>}
        </View>
      </View>

      <Group>
        <Row icon="calendar-outline" label={t('profile.bookings')} onPress={() => router.push('/bookings')} />
        <Row icon="person-outline" label={t('account.details')} onPress={() => router.push('/profile/details')} />
        <Row icon="phone-portrait-outline" label={t('account.devices')} onPress={() => router.push('/profile/devices')} />
        <Row icon="notifications-outline" label={t('account.notifications')}
          detail={push === 'on' ? t('account.notificationsOn') : push === 'off' ? t('account.notificationsOff') : undefined}
          onPress={() => void Linking.openSettings()} />
      </Group>

      <Group>
        <Row icon="help-buoy-outline" label={t('account.support')} onPress={() => router.push('/profile/support')} />
        <Row icon="shield-checkmark-outline" label={t('account.privacy')} onPress={() => void WebBrowser.openBrowserAsync(`${env.siteUrl}/privacy`)} />
        <Row icon="document-text-outline" label={t('account.terms')} onPress={() => void WebBrowser.openBrowserAsync(`${env.siteUrl}/terms`)} />
      </Group>

      <Group>
        <Row icon="log-out-outline" label={t('common.signOut')} onPress={() => void signOut()} />
        <Row icon="trash-outline" label={t('account.deleteTitle')} danger onPress={() => router.push('/profile/delete')} />
      </Group>

      <Body muted>{t('profile.version', { version: appVersion })}</Body>
    </ScrollView>
  )
}

function Row({ icon, label, onPress, danger, detail }: { icon: Icon; label: string; onPress: () => void; danger?: boolean; detail?: string }) {
  const { colors, fonts } = useTheme()
  return (
    <Pressable onPress={onPress} accessibilityRole="button"
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14, backgroundColor: pressed ? colors.bgMuted : 'transparent' })}>
      <Ionicons name={icon} size={20} color={danger ? colors.danger : colors.primary} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontFamily: fonts.medium, fontSize: 15, color: danger ? colors.danger : colors.textPrimary }}>{label}</Text>
        {!!detail && <Text style={{ fontFamily: fonts.body, fontSize: 12, lineHeight: 17, color: colors.textMuted }}>{detail}</Text>}
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
    </Pressable>
  )
}

function Group({ children }: { children: React.ReactNode }) {
  const { colors, radius } = useTheme()
  return <View style={{ backgroundColor: colors.bgSurface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.lg, overflow: 'hidden' }}>{children}</View>
}
