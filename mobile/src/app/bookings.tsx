import { useState } from 'react'
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native'
import { Stack, router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useMyClasses, type BookedClass } from '@/lib/myClasses'
import { useLiveClasses } from '@/lib/api/classes'
import { useNow } from '@/hooks/useNow'
import { ClassCard, StatusPill, fmtWhen } from '@/components/classes'
import { Empty, Failed, Loading } from '@/components/states'
import { useTheme } from '@/theme'

/* My bookings — upcoming (with Join / Cancel) and past (attended, missed,
   cancelled), like the website's My Bookings page. */
export default function Bookings() {
  const { t } = useTranslation()
  const { colors, fonts, radius } = useTheme()
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming')
  const classes = useLiveClasses()
  const now = useNow(classes.data?.filter(c => c.isBooked))
  const { upcoming, past, bookingMap, isLoading, error, refreshing, refresh } = useMyClasses(now)
  const rows = tab === 'upcoming' ? upcoming : past

  const pastRow = (x: BookedClass) => {
    const b = x.booking
    const status = b.status === 'attended' ? 'attended' : b.status === 'missed' ? 'missed' : b.status === 'cancelled' ? 'cancelled' : 'ended'
    return (
      <Pressable onPress={() => x.lc && router.push(`/class/${x.lc.id}`)} disabled={!x.lc}
        style={{ backgroundColor: colors.bgSurface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.lg, padding: 14, gap: 6 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <Text style={{ fontFamily: fonts.semibold, fontSize: 13, color: colors.textSecondary }}>{fmtWhen(b.liveClassId.scheduledStart)}</Text>
          <StatusPill status={status} />
        </View>
        <Text style={{ fontFamily: fonts.bold, fontSize: 15, color: colors.textPrimary }}>{b.liveClassId.title}</Text>
        {(b.liveClassId.yourCohort?.courseTitle ?? b.liveClassId.courseId?.title) && (
          <Text style={{ fontFamily: fonts.body, fontSize: 13, color: colors.textMuted }}>
            {b.liveClassId.yourCohort?.courseTitle ?? b.liveClassId.courseId?.title}
          </Text>
        )}
      </Pressable>
    )
  }

  return (
    <>
      <Stack.Screen options={{ title: t('bookings.title') }} />
      <View style={{ flexDirection: 'row', margin: 16, marginBottom: 0, backgroundColor: colors.bgMuted, borderRadius: 12, padding: 4 }}>
        {(['upcoming', 'past'] as const).map(k => (
          <Pressable key={k} onPress={() => setTab(k)} accessibilityRole="tab" accessibilityState={{ selected: tab === k }}
            style={{ flex: 1, paddingVertical: 8, borderRadius: 9, alignItems: 'center', backgroundColor: tab === k ? colors.bgSurface : 'transparent' }}>
            <Text style={{ fontFamily: fonts.semibold, fontSize: 14, color: tab === k ? colors.textPrimary : colors.textMuted }}>
              {k === 'upcoming' ? `${t('bookings.upcoming')}${upcoming.length ? ` (${upcoming.length})` : ''}` : t('bookings.past')}
            </Text>
          </Pressable>
        ))}
      </View>
      {isLoading ? <Loading /> : error && rows.length === 0 ? <Failed error={error} onRetry={refresh} /> : (
        <FlatList
          data={rows}
          keyExtractor={x => x.booking.id}
          contentContainerStyle={{ padding: 16, gap: 12 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}
          ListEmptyComponent={tab === 'upcoming'
            ? <Empty icon="calendar-outline" title={t('bookings.noneUpcoming')} body={t('bookings.noneBookedBody')}
                action={{ label: t('bookings.browse'), onPress: () => router.navigate('/schedule') }} />
            : <Empty icon="time-outline" title={t('bookings.nonePast')} />}
          renderItem={({ item: x }) => tab === 'upcoming' && x.lc
            ? <ClassCard lc={x.lc} booking={bookingMap.get(x.lc.id)} hasOther={false} now={now} onPress={() => router.push(`/class/${x.lc!.id}`)} />
            : pastRow(x)}
        />
      )}
    </>
  )
}
