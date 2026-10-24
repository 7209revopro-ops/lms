import { useMemo, useState } from 'react'
import { FlatList, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { bucketOf, type LearningBucket, type MyEnrollment } from '@shared'
import { useMyEnrollments } from '@/lib/api/learning'
import { useAuth } from '@/lib/auth'
import { Card, Chip, Glyph, Notice, ProgressBar, SearchField, Segmented } from '@/components/ui'
import { Img } from '@/components/media'
import { ExploreCatalog } from '@/components/explore'
import { Empty, Failed, Loading } from '@/components/states'
import { useTheme } from '@/theme'

type Filter = 'all' | LearningBucket
type View_ = 'mine' | 'explore'

/* Learning — two views of one tab: My courses (every enrolment, with
   progress, the website's status filters and the ways into assignments,
   learning paths and saved courses) and Explore (the whole catalogue). */
export default function Learning() {
  const { t } = useTranslation()
  const [view, setView] = useState<View_>('mine')
  const switcher = (
    <Segmented<View_> value={view} onChange={setView}
      options={[{ value: 'mine', label: t('learning.myCourses') }, { value: 'explore', label: t('catalog.explore') }]} />
  )
  return view === 'explore' ? <ExploreCatalog header={switcher} /> : <MyCourses header={switcher} onExplore={() => setView('explore')} />
}

function MyCourses({ header, onExplore }: { header: React.ReactElement; onExplore: () => void }) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const { state } = useAuth()
  const enrollments = useMyEnrollments()
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')
  const [refreshing, setRefreshing] = useState(false)

  /* A course deleted after enrolment has nothing to open — leave it out. */
  const live = useMemo(() => (enrollments.data ?? []).filter(e => e.course), [enrollments.data])
  /* The website's My Learning search: the course and its instructor. */
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase()
    return live.filter(e => (filter === 'all' || bucketOf(e) === filter)
      && (!term || `${e.course!.title} ${e.course!.instructor?.name ?? ''}`.toLowerCase().includes(term)))
  }, [live, filter, q])
  const pending = state.status === 'signedIn' && state.user.enrollmentStatus === 'pending'

  const refresh = async () => {
    setRefreshing(true)
    try { await enrollments.refetch() } finally { setRefreshing(false) }
  }

  const top = (
    <View style={{ gap: 14 }}>
      {header}
      {pending && <Notice tone="info">{t('learning.pendingBody')}</Notice>}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
        <QuickLink icon="document-text-outline" label={t('learning.assignments')} onPress={() => router.push('/learning/assignments')} />
        <QuickLink icon="git-network-outline" label={t('paths.title')} onPress={() => router.push('/learning/paths')} />
        <QuickLink icon="heart-outline" label={t('favorites.title')} onPress={() => router.push('/learning/favorites')} />
      </ScrollView>
      {live.length > 3 && <SearchField value={q} onChangeText={setQ} placeholder={t('learning.searchMine')} />}
      {live.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {(['all', 'inProgress', 'notStarted', 'completed'] as const).map(f => (
            <Chip key={f} label={t(`learning.${f}`)} active={filter === f} onPress={() => setFilter(f)} />
          ))}
        </ScrollView>
      )}
    </View>
  )

  return (
    <FlatList
      data={enrollments.isLoading || (enrollments.error && !enrollments.data) ? [] : rows}
      keyExtractor={e => e.id}
      contentContainerStyle={{ padding: 16, gap: 12, flexGrow: 1 }}
      ListHeaderComponent={top}
      ListHeaderComponentStyle={{ marginBottom: 4 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.primary} />}
      ListEmptyComponent={
        enrollments.isLoading ? <Loading cards={3} />
          : enrollments.error && !enrollments.data ? <Failed error={enrollments.error} onRetry={() => void refresh()} />
          : live.length === 0
            ? <Empty icon="school-outline" title={t('learning.noneTitle')} body={t('learning.noneBody')} action={{ label: t('catalog.browse'), onPress: onExplore }} />
            : <Empty icon="filter-outline" title={t('learning.noMatch')} />
      }
      renderItem={({ item }) => <EnrolledCard e={item} />}
    />
  )
}

function QuickLink({ icon, label, onPress }: { icon: React.ComponentProps<typeof Glyph>['name']; label: string; onPress: () => void }) {
  const { colors, fonts, radius } = useTheme()
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10,
        borderRadius: radius.md, backgroundColor: pressed ? colors.primaryLight : colors.bgSurface, borderWidth: 1, borderColor: colors.border })}>
      <Glyph name={icon} size={18} color={colors.primary} />
      <Text style={{ fontFamily: fonts.semibold, fontSize: 14, color: colors.textPrimary }}>{label}</Text>
    </Pressable>
  )
}

function EnrolledCard({ e }: { e: MyEnrollment }) {
  const { t } = useTranslation()
  const { colors, fonts, radius } = useTheme()
  const course = e.course!
  const bucket = bucketOf(e)
  const done = bucket === 'completed'
  const label = done ? t('learning.completed') : bucket === 'notStarted' ? t('learning.notStarted') : t('learning.percent', { percent: Math.round(e.progressPercent) })
  /* The website's "continue": straight back into the last lesson. */
  const resume = !done && e.lastLessonId
  return (
    <Card padded={false}>
      <Pressable onPress={() => router.push({ pathname: '/learning/[slug]', params: { slug: course.slug } })}
        accessibilityRole="button" accessibilityLabel={`${course.title}, ${label}`}
        style={({ pressed }) => ({ flexDirection: 'row', gap: 14, padding: 12, opacity: pressed ? 0.85 : 1 })}>
        <Img cover uri={course.thumbnailUrl} style={{ width: 92, height: 92, borderRadius: radius.md }} placeholderColor={colors.primaryLight} />
        <View style={{ flex: 1, gap: 6, justifyContent: 'center' }}>
          <Text numberOfLines={2} style={{ fontFamily: fonts.bold, fontSize: 15, lineHeight: 20, color: colors.textPrimary }}>{course.title}</Text>
          {course.instructor && <Text numberOfLines={1} style={{ fontFamily: fonts.body, fontSize: 13, color: colors.textMuted }}>{course.instructor.name}</Text>}
          <ProgressBar percent={e.progressPercent} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {done && <Glyph name="checkmark-circle" size={14} color={colors.successInk} />}
            <Text style={{ fontFamily: fonts.semibold, fontSize: 12, color: done ? colors.successInk : colors.textSecondary }}>{label}</Text>
          </View>
        </View>
      </Pressable>
      {resume && (
        <Pressable onPress={() => router.push({ pathname: '/learning/[slug]/[lessonId]', params: { slug: course.slug, lessonId: e.lastLessonId! } })}
          accessibilityRole="button" accessibilityLabel={`${t('learning.continue')}, ${course.title}`}
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 46,
            borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: pressed ? colors.primaryLight : 'transparent' })}>
          <Glyph name="play-circle" size={18} color={colors.primary} />
          <Text style={{ fontFamily: fonts.semibold, fontSize: 14, color: colors.primary }}>{t('learning.continue')}</Text>
        </Pressable>
      )}
    </Card>
  )
}
