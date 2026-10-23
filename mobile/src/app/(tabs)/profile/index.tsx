import { useCallback, useState } from 'react'
import { Linking, ScrollView, Text, View } from 'react-native'
import { router, useFocusEffect } from 'expo-router'
import * as Notifications from 'expo-notifications'
import * as WebBrowser from 'expo-web-browser'
import { useTranslation } from 'react-i18next'
import { needsFullRegistration } from '@shared'
import { usePendingRatings, useStreak } from '@/lib/api/engage'
import { useAuth } from '@/lib/auth'
import { appVersion } from '@/lib/device'
import { env } from '@/lib/env'
import { registerForPush } from '@/lib/push'
import { Avatar, Badge, Body, Card, Glyph, Group, ListRow } from '@/components/ui'
import { useTheme } from '@/theme'

const STATUS_TONE = { approved: 'success', pending: 'warning', rejected: 'danger', cancelled: 'danger' } as const

/* Profile — who is signed in and everything about the account, grouped the
   way the website's settings are: learning (progress, ratings, bookings,
   purchases), the account (details, security, notifications), help, and
   leaving (sign out; delete — which the stores require to be easy to find). */
export default function Profile() {
  const { t } = useTranslation()
  const { colors, fonts } = useTheme()
  const { state, signOut } = useAuth()
  const [push, setPush] = useState<'on' | 'off' | null>(null)
  const streak = useStreak()
  const ratings = usePendingRatings()

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
  const status = user.enrollmentStatus
  const toRate = ratings.data?.length ?? 0

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 18 }}>
      <Card onPress={() => router.push('/profile/details')} accessibilityLabel={`${user.name}, ${user.email}. ${t('account.editProfile')}`}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <Avatar name={user.name} uri={user.avatarUrl} size={60} />
        <View style={{ flex: 1, gap: 3 }}>
          <Text numberOfLines={1} style={{ fontFamily: fonts.display, fontSize: 21, color: colors.textPrimary }}>{user.name}</Text>
          {!!user.headline && <Text numberOfLines={1} style={{ fontFamily: fonts.medium, fontSize: 13, color: colors.textSecondary }}>{user.headline}</Text>}
          <Text numberOfLines={1} style={{ fontFamily: fonts.body, fontSize: 13, color: colors.textMuted }}>{user.email}</Text>
          {status && <View style={{ marginTop: 4 }}><Badge label={t(`profile.statuses.${status}`)} tone={STATUS_TONE[status]} /></View>}
        </View>
        <Glyph name="chevron-forward" size={18} color={colors.textMuted} />
      </Card>

      {needsFullRegistration(user) && (
        <Card onPress={() => router.push('/profile/complete')} accessibilityLabel={t('account.completeRegistration')}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.primaryLight, borderColor: colors.primary }}>
          <Glyph name="document-attach-outline" size={24} color={colors.primary} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ fontFamily: fonts.semibold, fontSize: 15, color: colors.primary }}>
              {status === 'rejected' || status === 'cancelled' ? t('account.registrationRejected') : t('account.completeRegistration')}
            </Text>
            <Text style={{ fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.textSecondary }}>{t('account.completeRegistrationBody')}</Text>
          </View>
          <Glyph name="chevron-forward" size={18} color={colors.primary} />
        </Card>
      )}

      <Group title={t('account.sections.learning')}>
        <ListRow icon="flame-outline" label={t('progress.title')}
          detail={streak.data ? t('progress.rowDetail', { count: streak.data.currentStreak }) : undefined}
          onPress={() => router.push('/profile/progress')} />
        <ListRow icon="star-outline" label={t('rate.title')} detail={toRate ? t('rate.waiting', { count: toRate }) : undefined}
          right={toRate ? <Badge label={String(toRate)} tone="danger" /> : undefined}
          onPress={() => router.push('/profile/rate')} />
        <ListRow icon="calendar-outline" label={t('profile.bookings')} onPress={() => router.push('/bookings')} />
        <ListRow icon="film-outline" label={t('recordings.title')} onPress={() => router.push('/recordings')} />
        <ListRow icon="receipt-outline" label={t('account.purchases')} onPress={() => router.push('/profile/purchases')} />
      </Group>

      <Group title={t('account.sections.account')}>
        <ListRow icon="person-outline" label={t('account.details')} onPress={() => router.push('/profile/details')} />
        <ListRow icon="shield-checkmark-outline" label={t('account.security')} detail={t('account.securityDetail')} onPress={() => router.push('/profile/security')} />
        <ListRow icon="notifications-outline" label={t('account.notifications')}
          detail={push === 'on' ? t('account.notificationsOn') : push === 'off' ? t('account.notificationsOff') : undefined}
          onPress={() => void Linking.openSettings()} />
      </Group>

      <Group title={t('account.sections.support')}>
        <ListRow icon="help-buoy-outline" label={t('account.support')} onPress={() => router.push('/profile/support')} />
        <ListRow icon="document-text-outline" label={t('account.privacy')} onPress={() => void WebBrowser.openBrowserAsync(`${env.siteUrl}/privacy`)} />
        <ListRow icon="reader-outline" label={t('account.terms')} onPress={() => void WebBrowser.openBrowserAsync(`${env.siteUrl}/terms`)} />
      </Group>

      <Group title={t('account.sections.danger')}>
        <ListRow icon="log-out-outline" label={t('common.signOut')} onPress={() => void signOut()} />
        <ListRow icon="trash-outline" label={t('account.deleteTitle')} danger onPress={() => router.push('/profile/delete')} />
      </Group>

      <Body muted>{t('profile.version', { version: appVersion })}</Body>
    </ScrollView>
  )
}
