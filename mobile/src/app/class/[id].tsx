import { useMemo, useState } from 'react'
import { Alert, ScrollView, Text, View } from 'react-native'
import { Stack, router, useLocalSearchParams } from 'expo-router'
import { effCourseTitle, effSectionTitle, getSlotStatus, isInteractiveRoom } from '@shared'
import { bookingMapOf, useLiveClasses, useMyBookings, useWatchAccess } from '@/lib/api/classes'
import { enterRoom } from '@/lib/join'
import { useTranslation } from 'react-i18next'
import { useNow } from '@/hooks/useNow'
import { CancelSeat, ClassAction, StatusPill, fmtWhen } from '@/components/classes'
import { Button, Body } from '@/components/ui'
import { Empty, Loading } from '@/components/states'
import { useTheme } from '@/theme'

/* One class: what it is, and the way in for its kind —
     Google Meet          → Join (ClassAction, inside the server's window)
     in-app broadcast     → Watch (the native player)
     interactive room     → Enter room (in-app browser hand-off)
     in person            → where to go
   plus its recording once it has one. */
export default function ClassDetail() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { t } = useTranslation()
  const { colors, fonts, radius } = useTheme()
  const classes = useLiveClasses()
  const bookings = useMyBookings()
  const bookingMap = useMemo(() => bookingMapOf(bookings.data), [bookings.data])
  const lc = classes.data?.find(c => c.id === id)
  const now = useNow(lc ? [lc] : undefined)
  const booking = lc ? bookingMap.get(lc.id) : undefined
  const internal = lc?.type === 'internal'
  const watch = useWatchAccess(id, internal)
  const [entering, setEntering] = useState(false)

  if (classes.isLoading) return <Loading />
  if (!lc) return <><Stack.Screen options={{ title: '' }} /><Empty title={t('classes.gone')} /></>

  /* Same-slot rule: another seat held in this class's weekly group. */
  const status = getSlotStatus(lc, booking, false)
  const held = booking?.status === 'booked' || booking?.status === 'attended'
  const interactive = internal && isInteractiveRoom({ ...lc, ...(watch.data ?? {}) })
  const live = (watch.data?.status ?? lc.status) === 'live' || status === 'live'

  const room = async () => {
    setEntering(true)
    const r = await enterRoom(lc.id)
    setEntering(false)
    if (!r.ok) Alert.alert(lc.title, r.message)
  }

  return (
    <>
      <Stack.Screen options={{ title: lc.title }} />
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ fontFamily: fonts.semibold, fontSize: 14, color: colors.primary }}>{fmtWhen(lc.scheduledStart)}</Text>
          <StatusPill status={status} />
        </View>
        <Text accessibilityRole="header" style={{ fontFamily: fonts.display, fontSize: 24, color: colors.textPrimary }}>{lc.title}</Text>

        <View style={{ backgroundColor: colors.bgSurface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.lg, padding: 16, gap: 8 }}>
          {effCourseTitle(lc) && <Body>{effCourseTitle(lc)}{effSectionTitle(lc) ? ` · ${effSectionTitle(lc)}` : ''}</Body>}
          {lc.instructor?.name && <Body>{t('classes.mentor', { name: lc.instructor.name })}</Body>}
          <Body>{t('classes.minutes', { mins: lc.durationMins })}{lc.language ? ` · ${lc.language}` : ''}</Body>
          <Body>
            {lc.isOnline === false
              ? `${t('classes.inPerson')}${lc.location ? ` · ${lc.location}` : ''}${lc.room ? ` · ${lc.room}` : ''}`
              : internal ? (interactive ? t('classes.viaRoom') : t('classes.viaStream')) : t('classes.viaMeet')}
          </Body>
          {lc.description ? <Body muted>{lc.description}</Body> : null}
        </View>

        {/* Book / cancel / Meet join — the shared rules decide which. */}
        {!internal || !held ? <ClassAction lc={lc} booking={booking} status={status} now={now} /> : null}

        {internal && held && lc.isOnline !== false && (
          <View style={{ gap: 8 }}>
            {interactive
              ? <Button title={live ? t('classes.enterRoom') : t('classes.roomLater')} onPress={() => void room()} loading={entering} disabled={!live} />
              : <Button title={live ? t('classes.watchLive') : t('classes.streamLater')} onPress={() => router.push(`/watch/${lc.id}`)} disabled={!live} />}
            {status === 'booked' && booking && <CancelSeat lc={lc} booking={booking} />}
          </View>
        )}

        {(watch.data?.recordingUrl || lc.recordingUrl) && (
          <Button variant="ghost" title={t('classes.watchRecording')} onPress={() => router.push({ pathname: '/watch/[id]', params: { id: lc.id, recording: '1' } })} />
        )}
      </ScrollView>
    </>
  )
}
