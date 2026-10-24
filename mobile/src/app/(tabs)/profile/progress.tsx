import { useState } from 'react'
import { RefreshControl, ScrollView, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { streakWeek, type Achievement } from '@shared'
import { useAchievements, useActivity, useSetWeeklyGoal, useStreak } from '@/lib/api/engage'
import { errorText } from '@/lib/errors'
import { haptic } from '@/lib/haptics'
import { Badge, Card, Glyph, IconButton, ProgressBar } from '@/components/ui'
import { Failed, Loading } from '@/components/states'
import { useToast } from '@/components/toast'
import { useTheme } from '@/theme'

/* My progress — the website's Streaks and Achievements pages on one screen:
   the learning streak and this week's days, the weekly goal (lessons a week,
   adjustable), this week's numbers, and every badge earned or under way. */
export default function Progress() {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const streak = useStreak()
  const ach = useAchievements()
  const activity = useActivity(1)
  const [refreshing, setRefreshing] = useState(false)
  const refresh = async () => {
    setRefreshing(true)
    try { await Promise.all([streak.refetch(), ach.refetch(), activity.refetch()]) } finally { setRefreshing(false) }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.primary} />}>
      {streak.isLoading ? <Loading cards={1} />
        : streak.error ? <Failed error={streak.error} onRetry={() => void streak.refetch()} />
        : streak.data && <StreakCard s={streak.data} week={activity.data?.week} />}
      {ach.isLoading ? <Loading cards={2} />
        : ach.error ? <Failed error={ach.error} onRetry={() => void ach.refetch()} />
        : ach.data && <AchievementList items={ach.data.items} earned={ach.data.earnedCount} total={ach.data.total} />}
      <Text style={{ textAlign: 'center', color: colors.textMuted, fontSize: 12 }}>{t('progress.footnote')}</Text>
    </ScrollView>
  )
}

function StreakCard({ s, week }: { s: NonNullable<ReturnType<typeof useStreak>['data']>; week?: { lessonsCompleted: number; minutesWatched: number } }) {
  const { t } = useTranslation()
  const { colors, fonts } = useTheme()
  const toast = useToast()
  const setGoal = useSetWeeklyGoal()
  const days = streakWeek(s)
  const active = days.filter(d => d.active).length
  const change = (d: number) => {
    const g = Math.max(1, Math.min(50, s.weeklyGoal + d))
    if (g === s.weeklyGoal) return
    haptic.select()
    setGoal.mutate(g, { onError: e => toast(errorText(e), 'danger') })
  }
  return (
    <Card style={{ gap: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <View style={{ width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(245,158,11,0.15)' }}>
          <Glyph name="flame" size={34} color={colors.warning} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: fonts.display, fontSize: 30, color: colors.textPrimary }}>{t('progress.days', { count: s.currentStreak })}</Text>
          <Text style={{ fontFamily: fonts.medium, fontSize: 13, color: colors.textMuted }}>{t('progress.currentStreak')}</Text>
        </View>
      </View>

      <View accessible accessibilityLabel={t('progress.weekA11y', { n: active })} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        {days.map(d => {
          const on = d.active
          return (
            <View key={d.date} style={{ alignItems: 'center', gap: 6 }}>
              <View style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center',
                backgroundColor: on ? colors.warning : colors.bgMuted, borderWidth: d.isToday ? 2 : 0, borderColor: colors.primary }}>
                {on && <Glyph name="flame" size={16} color="#fff" />}
              </View>
              <Text style={{ fontFamily: d.isToday ? fonts.bold : fonts.medium, fontSize: 12, color: d.isToday ? colors.primary : colors.textMuted }}>{d.label}</Text>
            </View>
          )
        })}
      </View>

      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Stat label={t('progress.longest')} value={t('progress.days', { count: s.longestStreak })} />
        <Stat label={t('progress.activeDays')} value={String(s.totalDaysActive)} />
        {week && <Stat label={t('progress.minutesWeek')} value={String(Math.round(week.minutesWatched))} />}
      </View>

      <View style={{ gap: 8, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: fonts.semibold, fontSize: 15, color: colors.textPrimary }}>{t('progress.weeklyGoal')}</Text>
            <Text style={{ fontFamily: fonts.body, fontSize: 12, color: colors.textMuted }}>
              {t('progress.goalOf', { done: s.weekProgress, goal: s.weeklyGoal })}
            </Text>
          </View>
          <IconButton icon="remove-circle-outline" label={t('progress.goalDown')} color={colors.primary} onPress={() => change(-1)} />
          <Text accessibilityLiveRegion="polite" style={{ minWidth: 28, textAlign: 'center', fontFamily: fonts.bold, fontSize: 18, color: colors.textPrimary }}>{s.weeklyGoal}</Text>
          <IconButton icon="add-circle-outline" label={t('progress.goalUp')} color={colors.primary} onPress={() => change(1)} />
        </View>
        <ProgressBar percent={s.weeklyGoal ? (s.weekProgress / s.weeklyGoal) * 100 : 0} tone="primary" />
      </View>
    </Card>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  const { colors, fonts, radius } = useTheme()
  return (
    <View style={{ flex: 1, padding: 10, gap: 2, borderRadius: radius.md, backgroundColor: colors.bgMuted }}>
      <Text style={{ fontFamily: fonts.bold, fontSize: 17, color: colors.textPrimary }}>{value}</Text>
      <Text style={{ fontFamily: fonts.medium, fontSize: 11, color: colors.textMuted }}>{label}</Text>
    </View>
  )
}

const ICON: Record<string, React.ComponentProps<typeof Glyph>['name']> = {
  rocket: 'rocket', flame: 'flame', trophy: 'trophy', star: 'star', medal: 'medal', crown: 'diamond', heart: 'heart', graduation: 'school',
}

function AchievementList({ items, earned, total }: { items: Achievement[]; earned: number; total: number }) {
  const { t } = useTranslation()
  const { colors, fonts } = useTheme()
  const done = items.filter(a => a.earned)
  const open = items.filter(a => !a.earned).sort((a, b) => b.progress / Math.max(1, b.target) - a.progress / Math.max(1, a.target))
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text accessibilityRole="header" style={{ fontFamily: fonts.bold, fontSize: 18, color: colors.textPrimary }}>{t('progress.achievements')}</Text>
        <Badge label={t('progress.earnedOf', { earned, total })} tone="warning" icon="trophy" />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {[...done, ...open].map(a => {
          const pct = Math.min(100, (a.progress / Math.max(1, a.target)) * 100)
          return (
            <View key={a.id} accessible accessibilityLabel={`${a.title}. ${a.description}. ${a.earned ? t('progress.earned') : `${a.progress} / ${a.target}`}`}
              style={{ width: '48%', flexGrow: 1, padding: 12, gap: 8, borderRadius: 16, borderWidth: 1,
                borderColor: a.earned ? colors.warning : colors.border, backgroundColor: colors.bgSurface, opacity: a.earned ? 1 : 0.85 }}>
              <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
                backgroundColor: a.earned ? 'rgba(245,158,11,0.15)' : colors.bgMuted }}>
                <Glyph name={ICON[a.iconKey] ?? 'star'} size={20} color={a.earned ? colors.warning : colors.textMuted} />
              </View>
              <Text numberOfLines={1} style={{ fontFamily: fonts.semibold, fontSize: 14, color: colors.textPrimary }}>{a.title}</Text>
              <Text numberOfLines={2} style={{ fontFamily: fonts.body, fontSize: 12, lineHeight: 16, color: colors.textMuted }}>{a.description}</Text>
              {a.earned
                ? <Text style={{ fontFamily: fonts.semibold, fontSize: 11, color: colors.warningInk }}>{t('progress.earned')}</Text>
                : <><ProgressBar percent={pct} tone="primary" /><Text style={{ fontFamily: fonts.medium, fontSize: 11, color: colors.textMuted }}>{`${a.progress} / ${a.target}`}</Text></>}
            </View>
          )
        })}
      </View>
    </View>
  )
}
