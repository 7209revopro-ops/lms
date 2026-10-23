import { Alert, FlatList, Pressable, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useTranslation } from 'react-i18next'
import { useRevokeSession, useSessions, type SessionRow } from '@/lib/api/account'
import { useAuth } from '@/lib/auth'
import { errorText } from '@/lib/errors'
import { fmtWhen } from '@/components/classes'
import { Empty, Failed, Loading } from '@/components/states'
import { useTheme } from '@/theme'

/* Where this account is signed in. Signing out another device ends its
   session at once; signing out this phone signs the app out. */
export default function Devices() {
  const { t } = useTranslation()
  const sessions = useSessions()
  if (sessions.isLoading) return <Loading />
  if (sessions.error && !sessions.data) return <Failed error={sessions.error} onRetry={() => void sessions.refetch()} />
  const rows = [...(sessions.data ?? [])].sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent))
  return (
    <FlatList data={rows} keyExtractor={s => s.id} contentContainerStyle={{ padding: 16, gap: 10 }}
      ListEmptyComponent={<Empty icon="phone-portrait-outline" title={t('account.devices')} />}
      renderItem={({ item }) => <SessionCard s={item} />} />
  )
}

/** "DeltaLMS/1.0.0 (Pixel 8; Android 15)" → "Delta app · Pixel 8 · Android 15";
 *  a browser's user agent → the browser and system it names. */
function deviceName(ua?: string): string {
  if (!ua) return 'Unknown device'
  const app = /DeltaLMS\/[\d.]+ \(([^;]+); ([^)]+)\)/.exec(ua)
  if (app) return `Delta app · ${app[1]} · ${app[2]}`
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser'
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : ''
  return [browser, os].filter(Boolean).join(' · ')
}

function SessionCard({ s }: { s: SessionRow }) {
  const { t } = useTranslation()
  const { colors, fonts, radius } = useTheme()
  const { signOut } = useAuth()
  const revoke = useRevokeSession()
  const isApp = /DeltaLMS\//.test(s.userAgent ?? '')
  const confirm = () => Alert.alert(t('account.signOutDeviceTitle'), deviceName(s.userAgent), [
    { text: t('common.back'), style: 'cancel' },
    { text: t('account.signOutDevice'), style: 'destructive', onPress: () => revoke.mutate(s.id, {
      onSuccess: r => { if (r.revokedCurrent) void signOut() },
      onError: e => Alert.alert(errorText(e)),
    }) },
  ])
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: radius.lg, backgroundColor: colors.bgSurface, borderWidth: 1, borderColor: s.isCurrent ? colors.primary : colors.border }}>
      <Ionicons name={isApp ? 'phone-portrait-outline' : 'desktop-outline'} size={22} color={colors.primary} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontFamily: fonts.semibold, fontSize: 15, color: colors.textPrimary }}>{deviceName(s.userAgent)}</Text>
        <Text style={{ fontFamily: fonts.body, fontSize: 12, color: colors.textMuted }}>
          {s.isCurrent ? t('account.thisDevice') : t('account.lastUsed', { when: fmtWhen(s.lastUsedAt ?? s.createdAt) })}
        </Text>
      </View>
      <Pressable onPress={confirm} accessibilityRole="button" disabled={revoke.isPending} hitSlop={8}>
        <Text style={{ fontFamily: fonts.semibold, fontSize: 14, color: colors.danger }}>{t('account.signOutDevice')}</Text>
      </Pressable>
    </View>
  )
}
