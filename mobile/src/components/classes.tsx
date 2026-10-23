import { useEffect, useState } from 'react'
import { Alert, Animated, Pressable, Text, View } from 'react-native'
import { router } from 'expo-router'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useTranslation } from 'react-i18next'
import {
  effCourseTitle, effSectionTitle, displayStatus, getJoinPhase, getSlotStatus, seatsLeft, bookingCutoffLabel,
  type LiveClass, type MyBooking, type DisplayStatus, type SlotStatus,
} from '@shared'
import { useBookClass, useCancelBooking } from '@/lib/api/classes'
import { joinMeet } from '@/lib/join'
import { errorText } from '@/lib/errors'
import { Button, Glyph } from './ui'
import { useTheme, type Colors } from '@/theme'

/* ─────────────────────────────────────────────────────────────
   One class, as a card, with the one action the student can take right now.
   The state comes from getSlotStatus — the website's rules, shared — so the
   app and the site can never disagree about "Book", "Reserved" or "Closed".
   Times are the student's device zone, as on the website.
───────────────────────────────────────────────────────────── */

const fmtDay  = (iso: string) => new Date(iso).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' })
export const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
export const fmtWhen = (iso: string) => `${fmtDay(iso)} · ${fmtTime(iso)}`
/** A list's "when": the time if today, else the date. */
export const fmtShort = (iso: string) => new Date(iso).toDateString() === new Date().toDateString()
  ? fmtTime(iso)
  : new Date(iso).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })

function tone(s: DisplayStatus, c: Colors): string {
  switch (s) {
    case 'live': return c.danger
    case 'startingSoon': return c.warning
    case 'booked': return c.successInk
    case 'bookable': return c.primary
    case 'attended': return c.primary
    case 'missed': return c.warning
    default: return c.textMuted
  }
}

export function StatusPill({ status }: { status: DisplayStatus }) {
  const { t } = useTranslation()
  const { colors, fonts } = useTheme()
  const color = tone(status, colors)
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3, backgroundColor: `${color}22` }}>
      {status === 'live' && <LiveDot color={color} />}
      <Text style={{ fontFamily: fonts.semibold, fontSize: 11, color }}>{t(`status.${status}`)}</Text>
    </View>
  )
}

/** A dot that breathes — "this is happening now". */
function LiveDot({ color }: { color: string }) {
  const [pulse] = useState(() => new Animated.Value(1))
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 0.25, duration: 650, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1, duration: 650, useNativeDriver: true }),
    ]))
    loop.start()
    return () => loop.stop()
  }, [pulse])
  return <Animated.View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: color, opacity: pulse }} />
}

/** The calendar tile: weekday, day number, month. */
function DateTile({ iso, live }: { iso: string; live: boolean }) {
  const { colors, fonts, radius } = useTheme()
  const d = new Date(iso)
  const today = d.toDateString() === new Date().toDateString()
  const ink = live ? colors.danger : today ? colors.onPrimary : colors.primary
  return (
    <View accessible={false} style={{ width: 54, alignSelf: 'flex-start', paddingVertical: 8, borderRadius: radius.md, alignItems: 'center',
      backgroundColor: live ? colors.dangerLight : today ? colors.primaryFill : colors.primaryLight }}>
      <Text style={{ fontFamily: fonts.semibold, fontSize: 11, letterSpacing: 0.6, color: ink }}>{d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()}</Text>
      <Text style={{ fontFamily: fonts.display, fontSize: 22, lineHeight: 26, color: ink }}>{d.getDate()}</Text>
      <Text style={{ fontFamily: fonts.medium, fontSize: 11, color: ink }}>{d.toLocaleDateString('en-US', { month: 'short' })}</Text>
    </View>
  )
}

/** Seats as a meter — amber when few are left. */
function Seats({ left, total }: { left: number; total: number }) {
  const { t } = useTranslation()
  const { colors, fonts } = useTheme()
  const few = left > 0 && left <= Math.max(3, Math.ceil(total * 0.15))
  const pct = total ? ((total - left) / total) * 100 : 0
  return (
    <View style={{ gap: 4 }}>
      {/* No bar while nobody has booked: an empty track reads as broken. */}
      {pct > 0 && (
        <View style={{ height: 4, borderRadius: 2, backgroundColor: colors.bgMuted, overflow: 'hidden' }}>
          <View style={{ width: `${pct}%`, height: '100%', backgroundColor: few || left === 0 ? colors.warning : colors.primary }} />
        </View>
      )}
      <Text style={{ fontFamily: fonts.medium, fontSize: 12, color: few ? colors.warning : colors.textMuted }}>{t('classes.seatsLeft', { left, total })}</Text>
    </View>
  )
}

function Meta({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  const { colors, fonts } = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Glyph name={icon} size={14} color={colors.textMuted} />
      <Text style={{ fontFamily: fonts.body, fontSize: 13, color: colors.textSecondary, flexShrink: 1 }}>{text}</Text>
    </View>
  )
}

export function ClassCard({ lc, booking, hasOther, heldTwin, now, onPress }: {
  lc: LiveClass; booking?: MyBooking; hasOther: boolean
  /** The seat held in the same weekly slot, when it is this class's hybrid twin. */
  heldTwin?: LiveClass
  now: number
  onPress?: () => void
}) {
  const { t } = useTranslation()
  const { colors, fonts, radius } = useTheme()
  const status = getSlotStatus(lc, booking, hasOther)
  const shown = displayStatus(status, lc, now)
  const inPerson = lc.isOnline === false
  const module = effSectionTitle(lc)
  const live = shown === 'live'
  const left = Math.max(0, seatsLeft(lc))
  return (
    <Pressable onPress={onPress} accessibilityRole="button" disabled={!onPress}
      accessibilityLabel={`${fmtWhen(lc.scheduledStart)}, ${t(`status.${shown}`)}, ${lc.title}`}
      style={({ pressed }) => ({
        backgroundColor: colors.bgSurface, borderColor: live ? colors.danger : colors.border,
        borderWidth: live ? 1.5 : 1, borderRadius: radius.lg, padding: 14, gap: 12,
        transform: [{ scale: pressed ? 0.985 : 1 }],
      })}>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <DateTile iso={lc.scheduledStart} live={live} />
        <View style={{ flex: 1, gap: 6 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <Text style={{ fontFamily: fonts.semibold, fontSize: 13, color: colors.textSecondary }}>
              {`${fmtTime(lc.scheduledStart)} · ${t('classes.minutesShort', { mins: lc.durationMins })}`}
            </Text>
            <StatusPill status={shown} />
          </View>
          <Text numberOfLines={2} style={{ fontFamily: fonts.bold, fontSize: 16, lineHeight: 21, color: colors.textPrimary }}>{lc.title}</Text>
          <View style={{ gap: 3 }}>
            {(effCourseTitle(lc) || module) && <Meta icon="book-outline" text={[effCourseTitle(lc), module].filter(Boolean).join(' · ')} />}
            {lc.instructor?.name && <Meta icon="person-outline" text={lc.instructor.name} />}
            <Meta icon={inPerson ? 'location-outline' : 'videocam-outline'}
              text={inPerson
                ? [lc.location, lc.room].filter(Boolean).join(' · ') || t('classes.inPerson')
                : `${t('classes.onlineLabel')}${lc.language ? ` · ${lc.language}` : ''}`} />
          </View>
        </View>
      </View>
      {(status === 'bookable' || status === 'full') && lc.sessionCapacity > 0 && <Seats left={left} total={lc.sessionCapacity} />}
      <ClassAction lc={lc} booking={booking} status={status} heldTwin={heldTwin} now={now} />
    </Pressable>
  )
}

/** Give the seat back — the confirm step, then DELETE /bookings/:id. */
export function CancelSeat({ lc, booking }: { lc: LiveClass; booking: MyBooking }) {
  const { t } = useTranslation()
  const cancel = useCancelBooking()
  const onPress = () => Alert.alert(t('classes.cancelTitle'), `${lc.title} · ${fmtWhen(lc.scheduledStart)}`, [
    { text: t('classes.keep'), style: 'cancel' },
    { text: t('classes.cancelConfirm'), style: 'destructive', onPress: () => cancel.mutate(booking.id, {
      onError: err => Alert.alert(t('classes.cancelFailed'), errorText(err)),
    }) },
  ])
  return <Button variant="ghost" title={t('classes.cancelSeat')} onPress={onPress} loading={cancel.isPending} />
}

/** The one thing to do with this class now: book, join, cancel — or why not. */
export function ClassAction({ lc, booking, status, heldTwin, now }: {
  lc: LiveClass; booking?: MyBooking; status: SlotStatus; heldTwin?: LiveClass; now: number
}) {
  const { t } = useTranslation()
  const { colors, fonts } = useTheme()
  const book = useBookClass()
  const [joining, setJoining] = useState(false)
  const note = (text: string) => <Text style={{ fontFamily: fonts.body, fontSize: 13, color: colors.textMuted }}>{text}</Text>
  const rule = bookingCutoffLabel(lc)
  const where = (c: LiveClass) => (c.isOnline === false ? t('classes.inPersonWord') : t('classes.online'))

  const doBook = () => book.mutate(lc.id, { onError: err => Alert.alert(t('classes.bookFailed'), errorText(err)) })
  const doJoin = async () => {
    setJoining(true)
    const r = await joinMeet(lc.id)
    setJoining(false)
    if (!r.ok) Alert.alert(t('classes.join'), r.message)
  }

  if (status === 'bookable') {
    return (
      <View style={{ gap: 6 }}>
        <Button title={t('classes.book')} onPress={doBook} loading={book.isPending} />
        {note(t('classes.closesBefore', { rule }))}
      </View>
    )
  }

  const held = booking?.status === 'booked'
  if (held && (status === 'booked' || status === 'live')) {
    if (lc.isOnline === false) {
      return (
        <View style={{ gap: 8 }}>
          {note(lc.location ? t('classes.inPersonAt', { place: lc.location }) : t('classes.inPersonHere'))}
          {status === 'booked' && <CancelSeat lc={lc} booking={booking} />}
        </View>
      )
    }
    if (lc.type === 'external') {
      const phase = getJoinPhase({ ...lc, isBooked: true }, now)
      return (
        <View style={{ gap: 8 }}>
          {phase === 'open' && <Button title={t('classes.join')} onPress={() => void doJoin()} loading={joining} />}
          {phase === 'before' && lc.joinOpensAt && note(t('classes.joinOpensAt', { time: fmtTime(lc.joinOpensAt) }))}
          {phase === 'closed' && note(t('classes.joinClosed'))}
          {status === 'booked' && phase !== 'open' && <CancelSeat lc={lc} booking={booking} />}
        </View>
      )
    }
    /* In-app classes are entered from their own screen (stream or room). */
    return (
      <View style={{ gap: 8 }}>
        <Button title={status === 'live' ? t('classes.openClass') : t('classes.details')} onPress={() => router.push(`/class/${lc.id}`)} />
        {status === 'booked' && <CancelSeat lc={lc} booking={booking} />}
      </View>
    )
  }

  switch (status) {
    case 'live':      return note(t('classes.liveNoSeat'))
    case 'closed':    return note(t('classes.closed', { rule }))
    case 'full':      return note(t('classes.full'))
    case 'locked':    return note(heldTwin ? t('classes.lockedTwin', { held: where(heldTwin), here: where(lc) }) : t('classes.lockedSlot'))
    case 'attended':  return note(t('classes.attended'))
    case 'missed':    return note(t('classes.missed'))
    case 'cancelled': return note(t('classes.cancelled'))
    case 'ended':     return note(t('classes.ended'))
    default:          return null
  }
}

/** A thin section header for lists. */
export function SectionHeader({ title, action }: { title: string; action?: { label: string; onPress: () => void } }) {
  const { colors, fonts } = useTheme()
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 8 }}>
      <Text accessibilityRole="header" style={{ fontFamily: fonts.bold, fontSize: 17, color: colors.textPrimary }}>{title}</Text>
      {action && <Text accessibilityRole="link" onPress={action.onPress} style={{ fontFamily: fonts.semibold, fontSize: 14, color: colors.primary }}>{action.label}</Text>}
    </View>
  )
}
