import { useState } from 'react'
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import { router } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import { bucketOf, needsFullRegistration, type Announcement } from '@shared'
import { useAuth } from '@/lib/auth'
import { useMyClasses } from '@/lib/myClasses'
import { useLiveClasses } from '@/lib/api/classes'
import { useMyEnrollments } from '@/lib/api/learning'
import { useNotificationUnread } from '@/lib/api/notifications'
import { useAnnouncements, usePendingRatings, useStreak } from '@/lib/api/engage'
import { resendVerification } from '@/lib/api/account'
import { errorText } from '@/lib/errors'
import { bucketOfDayGreeting } from '@/lib/greeting'
import { useNow } from '@/hooks/useNow'
import { Button, Card, Glyph, IconButton, Notice, ProgressBar } from '@/components/ui'
import { Gradient, Img } from '@/components/media'
import { ClassCard, SectionHeader } from '@/components/classes'
import { Empty, Failed, Loading } from '@/components/states'
import { useToast } from '@/components/toast'
import { useTheme } from '@/theme'

/* Dismissed for this run of the app — the website keeps them in
   sessionStorage, so they come back next session the same way. */
const dismissedAnnouncements = new Set<string>()
let verifyBannerHidden = false

export default function Home() {
  const { t } = useTranslation()
  const { state } = useAuth()
  const { colors, fonts } = useTheme()
  /* The clock ticks fast only near a booked class's join window. */
  const classes = useLiveClasses()
  const now = useNow(classes.data?.filter(c => c.isBooked))
  const { upcoming, bookingMap, isLoading, error, refreshing, refresh: refreshClasses } = useMyClasses(now)
  const enrollments = useMyEnrollments()
  const continuing = (enrollments.data ?? []).filter(e => e.course && bucketOf(e) === 'inProgress').slice(0, 2)
  const bell = useNotificationUnread(true)
  const announcements = useAnnouncements()
  const streak = useStreak()
  const ratings = usePendingRatings()
  const [, rerender] = useState(0)
  const refresh = () => {
    refreshClasses()
    void enrollments.refetch(); void bell.refetch(); void announcements.refetch(); void streak.refetch(); void ratings.refetch()
  }
  if (state.status !== 'signedIn') return null
  const { user } = state
  const first = user.name.trim().split(/\s+/)[0] ?? user.name
  const [next, ...rest] = upcoming
  const news = (announcements.data ?? []).filter(a => !dismissedAnnouncements.has(a.id))
  const toRate = ratings.data?.length ?? 0

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bgPage }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 14, paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}>
        <Hero greeting={t(`home.greeting.${bucketOfDayGreeting(new Date())}`)} name={first} unread={bell.data ?? 0} streak={streak.data} />

        {user.enrollmentStatus === 'pending' && <Notice tone="info">{t('home.pending')}</Notice>}
        {(user.enrollmentStatus === 'rejected' || user.enrollmentStatus === 'cancelled') && <Notice>{t('home.rejected')}</Notice>}
        {user.isVerified === false && !verifyBannerHidden && (
          <VerifyBanner email={user.email} onHide={() => { verifyBannerHidden = true; rerender(n => n + 1) }} />
        )}
        {needsFullRegistration(user) && (
          <Card onPress={() => router.push('/profile/complete')} accessibilityLabel={t('account.completeRegistration')}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.primaryLight, borderColor: colors.primary }}>
            <Glyph name="document-attach-outline" size={22} color={colors.primary} />
            <Text style={{ flex: 1, fontFamily: fonts.semibold, fontSize: 14, color: colors.primary }}>{t('account.completeRegistration')}</Text>
            <Glyph name="chevron-forward" size={18} color={colors.primary} />
          </Card>
        )}

        {news.map(a => (
          <AnnouncementCard key={a.id} a={a} onDismiss={() => { dismissedAnnouncements.add(a.id); rerender(n => n + 1) }} />
        ))}


        <SectionHeader title={t('bookings.nextClass')} action={{ label: t('bookings.all'), onPress: () => router.push('/bookings') }} />
        {isLoading ? <Loading cards={1} />
          : error && !next ? <Failed error={error} onRetry={refresh} />
          : !next ? (
            <Card style={{ gap: 4 }}>
              <Empty compact icon="calendar-outline" title={t('bookings.noneBooked')} body={t('bookings.noneBookedBody')} />
              <Button title={t('bookings.browse')} onPress={() => router.push('/schedule')} />
            </Card>
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

        {toRate > 0 && (
          <Card onPress={() => router.push('/profile/rate')} accessibilityLabel={t('rate.prompt', { count: toRate })}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Glyph name="star" size={22} color={colors.warning} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: fonts.semibold, fontSize: 15, color: colors.textPrimary }}>{t('rate.prompt', { count: toRate })}</Text>
              <Text style={{ fontFamily: fonts.body, fontSize: 12, color: colors.textMuted }}>{t('rate.promptBody')}</Text>
            </View>
            <Glyph name="chevron-forward" size={16} color={colors.textMuted} />
          </Card>
        )}

        {continuing.length > 0 && <SectionHeader title={t('learning.continue')} action={{ label: t('learning.title'), onPress: () => router.push('/learning') }} />}
        {continuing.map(e => (
          <Card key={e.id} padded={false} accessibilityLabel={`${e.course!.title}, ${t('learning.percent', { percent: Math.round(e.progressPercent) })}`}
            onPress={() => router.push({ pathname: '/learning/[slug]', params: { slug: e.course!.slug } }, { withAnchor: true })}
            style={{ flexDirection: 'row' }}>
            <Img cover uri={e.course!.thumbnailUrl} style={{ width: 96, alignSelf: 'stretch', minHeight: 84 }} placeholderColor={colors.primaryLight} />
            <View style={{ flex: 1, padding: 12, gap: 8, justifyContent: 'center' }}>
              <Text numberOfLines={2} style={{ fontFamily: fonts.bold, fontSize: 15, color: colors.textPrimary }}>{e.course!.title}</Text>
              <ProgressBar percent={e.progressPercent} />
              <Text style={{ fontFamily: fonts.medium, fontSize: 12, color: colors.textSecondary }}>{t('learning.percent', { percent: Math.round(e.progressPercent) })}</Text>
            </View>
          </Card>
        ))}

        <SectionHeader title={t('home.quick')} />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Quick icon="compass-outline" label={t('home.explore')} onPress={() => router.push('/learning')} />
          <Quick icon="film-outline" label={t('recordings.title')} onPress={() => router.push('/recordings')} />
          <Quick icon="sparkles-outline" label={t('ai.tutor')} onPress={() => router.push('/tutor')} />
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

/** The top of Home: the brand gradient, who you are, the bell, and this
    week's learning streak — one card instead of three. */
function Hero({ greeting, name, unread, streak }: {
  greeting: string; name: string; unread: number
  streak?: { currentStreak: number; weekProgress: number; weeklyGoal: number }
}) {
  const { t } = useTranslation()
  const { colors, fonts, radius } = useTheme()
  const pct = streak?.weeklyGoal ? Math.min(100, (streak.weekProgress / streak.weeklyGoal) * 100) : 0
  return (
    <Gradient colors={[colors.navy, colors.primaryFill]} style={{ borderRadius: radius.xl, padding: 20, gap: 18, overflow: 'hidden' }}>
      {/* The logo's ring and dot, large and faint, in the corner. */}
      <View pointerEvents="none" style={{ position: 'absolute', right: -40, top: -40, width: 170, height: 170, borderRadius: 85, borderWidth: 22, borderColor: 'rgba(255,255,255,0.07)' }} />
      <Gradient colors={[colors.accentFrom, colors.accentTo]} style={{ position: 'absolute', right: 114, top: 34, width: 22, height: 22, borderRadius: 11 }} />

      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: fonts.medium, fontSize: 14, color: 'rgba(255,255,255,0.75)' }}>{greeting}</Text>
          <Text accessibilityRole="header" numberOfLines={1} style={{ fontFamily: fonts.display, fontSize: 30, color: '#fff' }}>{name}</Text>
        </View>
        <Pressable onPress={() => router.push('/notifications')} accessibilityRole="button" hitSlop={8}
          accessibilityLabel={`${t('notifications.open')}${unread ? `, ${unread} unread` : ''}`}
          style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
            backgroundColor: pressed ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.16)' })}>
          <Glyph name="notifications-outline" size={22} color="#fff" />
          {!!unread && (
            <View style={{ position: 'absolute', top: -2, right: -2, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4,
              backgroundColor: colors.danger, borderWidth: 2, borderColor: colors.navy, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontFamily: fonts.bold, fontSize: 9, color: '#fff' }}>{unread > 99 ? '99+' : unread}</Text>
            </View>
          )}
        </Pressable>
      </View>

      {streak && (
        <Pressable onPress={() => router.push('/profile/progress')} accessibilityRole="button"
          accessibilityLabel={`${t('progress.streakShort', { count: streak.currentStreak })}. ${t('progress.goalOf', { done: streak.weekProgress, goal: streak.weeklyGoal })}`}
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: radius.lg,
            backgroundColor: pressed ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.10)' })}>
          <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(245,158,11,0.22)' }}>
            <Glyph name="flame" size={22} color={streak.currentStreak ? '#FBBF24' : 'rgba(255,255,255,0.6)'} />
          </View>
          <View style={{ flex: 1, gap: 6 }}>
            <Text style={{ fontFamily: fonts.bold, fontSize: 15, color: '#fff' }}>{t('progress.streakShort', { count: streak.currentStreak })}</Text>
            <View style={{ height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.18)', overflow: 'hidden' }}>
              <Gradient colors={[colors.accentFrom, colors.accentTo]} style={{ width: `${pct}%`, height: '100%' }} />
            </View>
            <Text style={{ fontFamily: fonts.medium, fontSize: 12, color: 'rgba(255,255,255,0.75)' }}>{t('progress.goalOf', { done: streak.weekProgress, goal: streak.weeklyGoal })}</Text>
          </View>
          <Glyph name="chevron-forward" size={16} color="rgba(255,255,255,0.7)" />
        </Pressable>
      )}
    </Gradient>
  )
}

function Quick({ icon, label, onPress }: { icon: React.ComponentProps<typeof Glyph>['name']; label: string; onPress: () => void }) {
  const { colors, fonts } = useTheme()
  return (
    <Card onPress={onPress} accessibilityLabel={label} style={{ flex: 1, alignItems: 'center', gap: 8, paddingVertical: 16, paddingHorizontal: 8 }}>
      <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryLight }}>
        <Glyph name={icon} size={20} color={colors.primary} />
      </View>
      <Text numberOfLines={1} style={{ fontFamily: fonts.semibold, fontSize: 12, color: colors.textPrimary }}>{label}</Text>
    </Card>
  )
}

function AnnouncementCard({ a, onDismiss }: { a: Announcement; onDismiss: () => void }) {
  const { t } = useTranslation()
  const { colors, fonts } = useTheme()
  return (
    <Card padded={false} style={{ borderColor: colors.primary }}>
      {!!a.mediaUrl && /\.(png|jpe?g|webp|gif)(\?|$)/i.test(a.mediaUrl) && (
        <Img cover uri={a.mediaUrl} style={{ width: '100%', aspectRatio: 2 }} placeholderColor={colors.primaryLight} />
      )}
      <View style={{ padding: 14, gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Glyph name="megaphone-outline" size={18} color={colors.primary} />
          <Text style={{ flex: 1, fontFamily: fonts.bold, fontSize: 15, color: colors.textPrimary }}>{a.title}</Text>
          <IconButton icon="close" size={18} color={colors.textMuted} label={t('home.dismiss')} onPress={onDismiss} />
        </View>
        <Text style={{ fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.textSecondary }}>{a.description}</Text>
      </View>
    </Card>
  )
}

function VerifyBanner({ email, onHide }: { email: string; onHide: () => void }) {
  const { t } = useTranslation()
  const { colors, fonts } = useTheme()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const resend = async () => {
    setBusy(true)
    try { await resendVerification(); toast(t('verify.sent')) } catch (e) { toast(errorText(e), 'danger') } finally { setBusy(false) }
  }
  return (
    <Card style={{ gap: 8, backgroundColor: 'rgba(245,158,11,0.10)', borderColor: colors.warning }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Glyph name="mail-unread-outline" size={20} color={colors.warning} />
        <Text style={{ flex: 1, fontFamily: fonts.bold, fontSize: 15, color: colors.textPrimary }}>{t('verify.title')}</Text>
      </View>
      <Text style={{ fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: colors.textSecondary }}>{t('verify.body', { email })}</Text>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}><Button title={t('verify.resend')} loading={busy} onPress={() => void resend()} /></View>
        <View style={{ flex: 1 }}><Button variant="ghost" title={t('verify.later')} onPress={onHide} /></View>
      </View>
    </Card>
  )
}
