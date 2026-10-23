import { useCallback } from 'react'
import { FlatList, RefreshControl, Text, View } from 'react-native'
import { router, useFocusEffect } from 'expo-router'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { journeyKeys, markNewClassesSeen, useJourney, useNewClassCount } from '@/lib/api/engage'
import { useCatalog } from '@/lib/catalog'
import { Empty, Failed, Loading } from '@/components/states'
import { Badge, Card, Glyph } from '@/components/ui'
import { Gradient, Img } from '@/components/media'
import { useTheme } from '@/theme'

/* The Class Schedule — your journey on top, then every one of your own
   courses with sessions still ahead (the website's ?mine=1). Opening it
   reads the "new class scheduled" notices, as the website does. */
export default function ScheduleCourses() {
  const { t } = useTranslation()
  const { colors, fonts, radius } = useTheme()
  const qc = useQueryClient()
  const { catalog, isLoading, error, refreshing, refresh } = useCatalog()
  const journey = useJourney()
  const fresh = useNewClassCount()
  const levels = (journey.data?.programmes ?? []).flatMap(p => p.levels)
  const held = levels.filter(l => l.state === 'completed' || l.state === 'current').length

  useFocusEffect(useCallback(() => {
    if (!fresh.data) return
    void markNewClassesSeen().then(() => qc.setQueryData(journeyKeys.newClasses, 0)).catch(() => {})
  }, [fresh.data, qc]))

  const header = (
    <View style={{ gap: 12, marginBottom: 4 }}>
      {levels.length > 0 && (
        <Card padded={false} onPress={() => router.push('/schedule/journey')} accessibilityLabel={`${t('journey.entry')}. ${t('journey.entryBody')}`}>
          <Gradient colors={[colors.navy, colors.primaryFill]} style={{ padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <View style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.16)' }}>
              <Glyph name="trail-sign-outline" size={22} color="#fff" />
            </View>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={{ fontFamily: fonts.bold, fontSize: 16, color: '#fff' }}>{t('journey.entry')}</Text>
              <Text style={{ fontFamily: fonts.medium, fontSize: 12, color: 'rgba(255,255,255,0.78)' }}>
                {`${held}/${levels.length} · ${t('journey.entryBody')}`}
              </Text>
            </View>
            <Glyph name="chevron-forward" size={18} color="rgba(255,255,255,0.8)" />
          </Gradient>
        </Card>
      )}
      {!!fresh.data && <Badge label={t('journey.newClasses', { count: fresh.data })} tone="primary" icon="sparkles" />}
    </View>
  )

  if (isLoading) return <View style={{ padding: 16 }}><Loading cards={3} /></View>
  if (error && catalog.length === 0) return <Failed error={error} onRetry={refresh} />

  return (
    <FlatList
      data={catalog}
      keyExtractor={c => c.id || 'unassigned'}
      contentContainerStyle={{ padding: 16, gap: 12, flexGrow: 1 }}
      ListHeaderComponent={header}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { refresh(); void journey.refetch() }} tintColor={colors.primary} />}
      ListEmptyComponent={<Empty icon="calendar-outline" title={t('schedule.noneTitle')} body={t('schedule.noneBody')} />}
      renderItem={({ item: c }) => (
        <Card onPress={() => router.push({ pathname: '/schedule/[courseId]', params: { courseId: c.id || '_none' } })}
          accessibilityLabel={`${c.title}. ${t('schedule.modules', { count: c.modules.length })}, ${t('schedule.sessionsAhead', { count: c.sessionCount })}`}
          style={{ flexDirection: 'row', gap: 12, padding: 12 }}>
          <Img cover uri={c.thumbnailUrl} style={{ width: 64, height: 64, borderRadius: radius.md }} placeholderColor={colors.primaryLight} />
          <View style={{ flex: 1, gap: 4, justifyContent: 'center' }}>
            <Text numberOfLines={2} style={{ fontFamily: fonts.bold, fontSize: 16, color: colors.textPrimary }}>{c.title}</Text>
            <Text style={{ fontFamily: fonts.medium, fontSize: 13, color: colors.textSecondary }}>
              {`${t('schedule.modules', { count: c.modules.length })} · ${t('schedule.sessionsAhead', { count: c.sessionCount })}`}
            </Text>
            {c.instructors.length > 0 && (
              <Text numberOfLines={1} style={{ fontFamily: fonts.body, fontSize: 12, color: colors.textMuted }}>{c.instructors.map(i => i.name).join(', ')}</Text>
            )}
          </View>
          <Glyph name="chevron-forward" size={18} color={colors.textMuted} />
        </Card>
      )}
    />
  )
}
