import { useMemo, useState } from 'react'
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import { Stack, router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import {
  BOOKING_TABS, bookingHaystack, bookingRow, bookingStats, bookingVerdict, inBookingTab,
  type BookingRow, type BookingTab, type BookingVerdict,
} from '@shared'
import { useMyClasses } from '@/lib/myClasses'
import { useLiveClasses } from '@/lib/api/classes'
import { useNow } from '@/hooks/useNow'
import { ClassCard, fmtWhen } from '@/components/classes'
import { Empty, Failed, Loading } from '@/components/states'
import { Glyph, SearchField } from '@/components/ui'
import { haptic } from '@/lib/haptics'
import { useTheme, type Colors } from '@/theme'

/* My bookings — the website's Booking History: the student's figures, a
   search, five tabs (All / Upcoming / Attended / Missed / Cancelled), the
   classes ahead with Join / Cancel, then the history by month. */
export default function Bookings() {
  const { t } = useTranslation()
  const { colors, fonts } = useTheme()
  const [tab, setTab] = useState<BookingTab>('upcoming')
  const [search, setSearch] = useState('')
  const classes = useLiveClasses()
  const now = useNow(classes.data?.filter(c => c.isBooked))
  const { upcoming, past, bookingMap, isLoading, error, refreshing, refresh } = useMyClasses(now)

  const rows = useMemo(() => [...upcoming, ...past].map(x => ({ ...bookingRow(x.booking), lc: x.lc })), [upcoming, past])
  const stats = useMemo(() => bookingStats(rows), [rows])
  /* Search first, then count, so a tab's number is what pressing it shows. */
  const searched = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? rows.filter(r => bookingHaystack(r.booking).includes(q)) : rows
  }, [rows, search])
  const counts = useMemo(() => Object.fromEntries(BOOKING_TABS.map(k => [k, searched.filter(r => inBookingTab(r, now, k)).length])) as Record<BookingTab, number>,
    [searched, now])

  /* Ahead soonest first; history newest first under month headings. */
  const sections = useMemo(() => {
    const visible = searched.filter(r => inBookingTab(r, now, tab))
    const ahead = visible.filter(r => bookingVerdict(r, now).lane === 'upcoming').sort((a, b) => a.start - b.start)
    const behind = visible.filter(r => bookingVerdict(r, now).lane === 'past').sort((a, b) => b.start - a.start)
    const out: { key: string; title: string; rows: typeof visible; ahead?: boolean }[] = []
    if (ahead.length) out.push({ key: 'ahead', title: t('bookings.upcoming'), rows: ahead, ahead: true })
    for (const r of behind) {
      const d = new Date(r.start)
      const key = `${d.getFullYear()}-${d.getMonth()}`
      if (out[out.length - 1]?.key !== key) out.push({ key, title: d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }), rows: [] })
      out[out.length - 1]!.rows.push(r)
    }
    return out
  }, [searched, now, tab, t])

  if (isLoading) return <><Stack.Screen options={{ title: t('bookings.title') }} /><Loading /></>
  if (error && rows.length === 0) return <><Stack.Screen options={{ title: t('bookings.title') }} /><Failed error={error} onRetry={refresh} /></>

  const empty = sections.length === 0
  return (
    <>
      <Stack.Screen options={{ title: t('bookings.title') }} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 32 }} keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}>
        {/* The student's figures — over the whole history, never the filter. */}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Figure value={String(stats.total)} label={t('bookings.statBooked')} />
          <Figure value={String(stats.attended)} label={t('bookings.statAttended')} tone={colors.successInk} />
          <Figure value={String(stats.missed)} label={t('bookings.statMissed')} tone={stats.missed ? colors.danger : undefined} />
          <Figure value={stats.rate == null ? '—' : `${stats.rate}%`} label={t('bookings.statRate')} tone={colors.primary} />
        </View>

        <SearchField value={search} onChangeText={setSearch} placeholder={t('bookings.search')} />

        <View accessibilityRole="tablist" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {BOOKING_TABS.map(k => {
            const on = tab === k
            return (
              <Pressable key={k} accessibilityRole="tab" accessibilityState={{ selected: on }}
                accessibilityLabel={`${t(`bookings.tabs.${k}`)}, ${counts[k]}`}
                onPress={() => { if (!on) { haptic.select(); setTab(k) } }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 38, paddingHorizontal: 14, borderRadius: 19, borderWidth: 1,
                  borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primaryLight : colors.bgSurface }}>
                <Text style={{ fontFamily: on ? fonts.semibold : fonts.medium, fontSize: 13, color: on ? colors.primary : colors.textSecondary }}>{t(`bookings.tabs.${k}`)}</Text>
                <Text style={{ fontFamily: fonts.bold, fontSize: 12, color: on ? colors.primary : colors.textMuted }}>{counts[k]}</Text>
              </Pressable>
            )
          })}
        </View>

        {empty ? (
          search.trim()
            ? <Empty icon="search-outline" title={t('bookings.noMatch')} action={{ label: t('schedule.clear'), onPress: () => setSearch('') }} />
            : <Empty icon={tab === 'cancelled' ? 'close-circle-outline' : tab === 'attended' ? 'checkmark-done-outline' : 'calendar-outline'}
                title={t(`bookings.empty.${tab}.title`)} body={t(`bookings.empty.${tab}.body`)}
                action={tab === 'all' || tab === 'upcoming' ? { label: t('bookings.browse'), onPress: () => router.navigate('/schedule') } : undefined} />
        ) : sections.map(sec => (
          <View key={sec.key} style={{ gap: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text accessibilityRole="header" style={{ fontFamily: fonts.display, fontSize: 17, color: sec.ahead ? colors.primary : colors.textPrimary }}>{sec.title}</Text>
              <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
              <Text style={{ fontFamily: fonts.bold, fontSize: 11, letterSpacing: 1, color: colors.textMuted }}>
                {t('schedule.classes', { count: sec.rows.length }).toUpperCase()}
              </Text>
            </View>
            {sec.rows.map(r => sec.ahead && r.lc
              ? <ClassCard key={r.booking.id} lc={r.lc} booking={bookingMap.get(r.lc.id)} hasOther={false} now={now} onPress={() => router.push(`/class/${r.lc!.id}`)} />
              : <HistoryRow key={r.booking.id} r={r} verdict={bookingVerdict(r, now).kind} onPress={r.lc ? () => router.push(`/class/${r.lc!.id}`) : undefined} />)}
          </View>
        ))}
      </ScrollView>
    </>
  )

}

/** One of the student's figures — a number over a label. */
function Figure({ value, label, tone }: { value: string; label: string; tone?: string }) {
  const { colors, fonts, radius } = useTheme()
  return (
    <View style={{ flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: radius.lg, backgroundColor: colors.bgSurface, borderWidth: 1, borderColor: colors.border }}>
      <Text style={{ fontFamily: fonts.display, fontSize: 20, color: tone ?? colors.textPrimary }}>{value}</Text>
      <Text numberOfLines={1} style={{ fontFamily: fonts.medium, fontSize: 11, color: colors.textMuted }}>{label}</Text>
    </View>
  )
}

function verdictLook(v: BookingVerdict, c: Colors): { color: string; icon: Parameters<typeof Glyph>[0]['name'] } {
  switch (v) {
    case 'attended': return { color: c.successInk, icon: 'checkmark-circle' }
    case 'missed': return { color: c.danger, icon: 'close-circle' }
    case 'cancelled': return { color: c.textMuted, icon: 'remove-circle-outline' }
    case 'called-off': return { color: c.warning, icon: 'calendar-clear-outline' }
    case 'live': return { color: c.danger, icon: 'radio-outline' }
    case 'unmarked': return { color: c.warning, icon: 'hourglass-outline' }
    default: return { color: c.primary, icon: 'ticket-outline' }
  }
}

/** One past booking: when, what, the verdict — and why, where it needs a word. */
function HistoryRow({ r, verdict, onPress }: { r: BookingRow; verdict: BookingVerdict; onPress?: () => void }) {
  const { t } = useTranslation()
  const { colors, fonts, radius } = useTheme()
  const b = r.booking
  const lc = b.liveClassId
  const look = verdictLook(verdict, colors)
  const course = lc.yourCohort?.courseTitle ?? lc.courseId?.title
  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const note = verdict === 'called-off' ? t('bookings.noteCalledOff') : verdict === 'unmarked' ? t('bookings.noteUnmarked') : null
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole="button"
      accessibilityLabel={`${lc.title}, ${fmtWhen(lc.scheduledStart)}, ${t(`bookings.verdict.${verdict}`)}`}
      style={({ pressed }) => ({ backgroundColor: colors.bgSurface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.lg,
        padding: 14, gap: 6, transform: [{ scale: pressed ? 0.985 : 1 }] })}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <Text style={{ flexShrink: 1, fontFamily: fonts.semibold, fontSize: 13, color: colors.textSecondary }}>{fmtWhen(lc.scheduledStart)}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3, backgroundColor: `${look.color}1F` }}>
          <Glyph name={look.icon} size={12} color={look.color} />
          <Text style={{ fontFamily: fonts.semibold, fontSize: 11, color: look.color }}>{t(`bookings.verdict.${verdict}`)}</Text>
        </View>
      </View>
      <Text numberOfLines={2} style={{ fontFamily: fonts.bold, fontSize: 15, color: colors.textPrimary }}>{lc.title}</Text>
      {!!course && <Text numberOfLines={1} style={{ fontFamily: fonts.body, fontSize: 13, color: colors.textMuted }}>{course}</Text>}
      <Text style={{ fontFamily: fonts.body, fontSize: 12, color: colors.textMuted }}>
        {[b.bookedAt && t('bookings.bookedOn', { date: fmtDate(b.bookedAt) }), b.cancelledAt && t('bookings.cancelledOn', { date: fmtDate(b.cancelledAt) })].filter(Boolean).join(' · ')}
      </Text>
      {!!note && (
        <View style={{ flexDirection: 'row', gap: 6, borderRadius: radius.md, padding: 10, backgroundColor: `${look.color}14` }}>
          <Glyph name="information-circle-outline" size={14} color={look.color} />
          <Text style={{ flex: 1, fontFamily: fonts.body, fontSize: 12, lineHeight: 17, color: colors.textSecondary }}>{note}</Text>
        </View>
      )}
    </Pressable>
  )
}
