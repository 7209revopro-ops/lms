import { useCallback, useMemo, useState } from 'react'
import { FlatList, RefreshControl, Text, View } from 'react-native'
import { router, useFocusEffect } from 'expo-router'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { ClassGroup } from '@shared'
import { journeyKeys, markNewClassesSeen, useJourney, useNewClassCount } from '@/lib/api/engage'
import { useCatalog } from '@/lib/catalog'
import { Empty, Failed, Loading } from '@/components/states'
import { Badge, Card, Glyph, SearchField, Segmented } from '@/components/ui'
import { Gradient } from '@/components/media'
import { CourseCard, SessionsBoard } from '@/components/schedule'
import { useTheme } from '@/theme'

type View_ = 'courses' | 'sessions'

/* The Class Schedule, as on the website: your journey on top, a search, then
   your own courses (the website's ?mine=1) — or every session ahead, by day.
   Opening it reads the "new class scheduled" notices, as the website does. */
export default function ScheduleCourses() {
  const { t } = useTranslation()
  const { colors, fonts } = useTheme()
  const qc = useQueryClient()
  const { catalog, bookingMap, isLoading, error, refreshing, refresh } = useCatalog()
  const journey = useJourney()
  const fresh = useNewClassCount()
  const [view, setView] = useState<View_>('courses')
  const [search, setSearch] = useState('')
  const levels = useMemo(() => (journey.data?.programmes ?? []).flatMap(p => p.levels), [journey.data])
  const held = levels.filter(l => l.state === 'completed' || l.state === 'current').length

  useFocusEffect(useCallback(() => {
    if (!fresh.data) return
    void markNewClassesSeen().then(() => qc.setQueryData(journeyKeys.newClasses, 0)).catch(() => {})
  }, [fresh.data, qc]))

  const q = search.trim().toLowerCase()
  /* A module or an instructor's name finds the course that holds it. */
  const courses = useMemo(() => !q ? catalog : catalog.filter(c =>
    c.title.toLowerCase().includes(q) || (c.program ?? '').toLowerCase().includes(q) ||
    c.modules.some(m => m.title.toLowerCase().includes(q)) ||
    c.instructors.some(i => i.name.toLowerCase().includes(q))), [catalog, q])
  const groups: ClassGroup[] = useMemo(() => {
    const all = catalog.flatMap(c => c.modules.flatMap(m => m.groups))
    return !q ? all : all.filter(g =>
      g.title.toLowerCase().includes(q) || (g.instructor?.name ?? '').toLowerCase().includes(q) ||
      ((g.slots[0] as { language?: string } | undefined)?.language ?? '').toLowerCase().includes(q))
  }, [catalog, q])

  const onRefresh = () => { refresh(); void journey.refetch() }

  const header = (
    <View style={{ gap: 12 }}>
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
      <SearchField value={search} onChangeText={setSearch} placeholder={t('schedule.search')} />
      <Segmented<View_> value={view} onChange={setView} options={[
        { value: 'courses', label: t('schedule.coursesTab') },
        { value: 'sessions', label: t('schedule.allSessionsTab') },
      ]} />
    </View>
  )

  if (isLoading) return <View style={{ padding: 16 }}><Loading cards={3} /></View>
  if (error && catalog.length === 0) return <Failed error={error} onRetry={refresh} />

  if (view === 'sessions') {
    return <SessionsBoard groups={groups} bookingMap={bookingMap} header={header} refreshing={refreshing} onRefresh={onRefresh} resetKey={q} />
  }

  return (
    <FlatList
      data={courses}
      keyExtractor={c => c.id || 'unassigned'}
      contentContainerStyle={{ padding: 16, gap: 14, flexGrow: 1 }}
      ListHeaderComponent={<View style={{ marginBottom: 2 }}>{header}</View>}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      ListEmptyComponent={q
        ? <Empty icon="search-outline" title={t('schedule.noCourseMatch')} body={t('schedule.noCourseMatchBody')} />
        : <Empty icon="calendar-outline" title={t('schedule.noneTitle')} body={t('schedule.noneBody')} />}
      renderItem={({ item: c }) => (
        <CourseCard node={c} journey={levels.find(l => l.courseId === c.id)}
          onPress={() => router.push({ pathname: '/schedule/[courseId]', params: { courseId: c.id || '_none' } })} />
      )}
    />
  )
}
