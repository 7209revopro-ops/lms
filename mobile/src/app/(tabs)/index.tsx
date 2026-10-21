import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import { router } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/lib/auth'
import { useMyClasses } from '@/lib/myClasses'
import { useLiveClasses } from '@/lib/api/classes'
import { useMyEnrollments } from '@/lib/api/learning'
import { useNotificationUnread } from '@/lib/api/notifications'
import Ionicons from '@expo/vector-icons/Ionicons'
import { bucketOf } from '@shared'
import { useNow } from '@/hooks/useNow'
import { Button, Notice, ProgressBar, Title } from '@/components/ui'
import { ClassCard, SectionHeader } from '@/components/classes'
import { Empty, Failed, Loading } from '@/components/states'
import { useTheme } from '@/theme'

export default function Home() {
  const { t } = useTranslation()
  const { state } = useAuth()
  const { colors, fonts, radius } = useTheme()
  /* The clock ticks fast only near a booked class's join window. */
  const classes = useLiveClasses()
  const now = useNow(classes.data?.filter(c => c.isBooked))
  const { upcoming, bookingMap, isLoading, error, refreshing, refresh: refreshClasses } = useMyClasses(now)
  /* Courses already started, most recently active first (the API's order).
     A secondary section: while loading, or if it fails, it is simply absent —
     the Learning tab shows that list with its own error state. */
  const enrollments = useMyEnrollments()
  const continuing = (enrollments.data ?? []).filter(e => e.course && bucketOf(e) === 'inProgress').slice(0, 2)
  const bell = useNotificationUnread(true)
  const refresh = () => { refreshClasses(); void enrollments.refetch(); void bell.refetch() }
  if (state.status !== 'signedIn') return null
  const { user } = state
  const first = user.name.trim().split(/\s+/)[0] ?? user.name
  const [next, ...rest] = upcoming

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bgPage }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <View style={{ flex: 1 }}><Title>{t('home.hello', { name: first })}</Title></View>
          <Pressable onPress={() => router.push('/notifications')} accessibilityRole="button" hitSlop={10}
            accessibilityLabel={`${t('notifications.open')}${bell.data ? `, ${bell.data} unread` : ''}`}>
            <Ionicons name="notifications-outline" size={26} color={colors.textPrimary} />
            {!!bell.data && (
              <View style={{ position: 'absolute', top: -4, right: -6, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontFamily: fonts.bold, fontSize: 10, color: '#fff' }}>{bell.data > 99 ? '99+' : bell.data}</Text>
              </View>
            )}
          </Pressable>
        </View>
        {user.enrollmentStatus === 'pending' && <Notice tone="info">{t('home.pending')}</Notice>}
        {(user.enrollmentStatus === 'rejected' || user.enrollmentStatus === 'cancelled') && <Notice>{t('home.rejected')}</Notice>}

        <SectionHeader title={t('bookings.nextClass')} action={{ label: t('bookings.all'), onPress: () => router.push('/bookings') }} />
        {isLoading ? <Loading />
          : error && !next ? <Failed error={error} onRetry={refresh} />
          : !next ? (
            <View style={{ gap: 8 }}>
              <Empty title={t('bookings.noneBooked')} body={t('bookings.noneBookedBody')} />
              <Button title={t('bookings.browse')} onPress={() => router.push('/schedule')} />
            </View>
          ) : next.lc ? (
            <ClassCard lc={next.lc} booking={next.booking} hasOther={false} now={now} onPress={() => router.push(`/class/${next.lc!.id}`)} />
          ) : (
            <Text style={{ fontFamily: fonts.body, color: colors.textSecondary }}>{next.booking.liveClassId.title}</Text>
          )}

        {rest.length > 0 && <SectionHeader title={t('bookings.comingUp')} />}
        {rest.slice(0, 4).map(x => x.lc && (
          <ClassCard key={x.booking.id} lc={x.lc} booking={bookingMap.get(x.lc.id)} hasOther={false} now={now}
            onPress={() => router.push(`/class/${x.lc!.id}`)} />
        ))}

        {continuing.length > 0 && <SectionHeader title={t('learning.continue')} action={{ label: t('learning.title'), onPress: () => router.push('/learning') }} />}
        {continuing.map(e => (
          <Pressable key={e.id} accessibilityRole="button"
            onPress={() => router.push({ pathname: '/learning/[slug]', params: { slug: e.course!.slug } }, { withAnchor: true })}
            style={({ pressed }) => ({
              backgroundColor: colors.bgSurface, borderColor: colors.border, borderWidth: 1,
              borderRadius: radius.lg, padding: 14, gap: 8, opacity: pressed ? 0.85 : 1,
            })}>
            <Text style={{ fontFamily: fonts.bold, fontSize: 15, color: colors.textPrimary }}>{e.course!.title}</Text>
            <ProgressBar percent={e.progressPercent} />
            <Text style={{ fontFamily: fonts.medium, fontSize: 12, color: colors.textSecondary }}>{t('learning.percent', { percent: Math.round(e.progressPercent) })}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
  )
}
