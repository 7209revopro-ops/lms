import { useMemo, useState } from 'react'
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native'
import { router } from 'expo-router'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useTranslation } from 'react-i18next'
import { bucketOf, type LearningBucket, type MyEnrollment } from '@shared'
import { useMyEnrollments } from '@/lib/api/learning'
import { useAuth } from '@/lib/auth'
import { Chip, Notice, ProgressBar } from '@/components/ui'
import { Empty, Failed, Loading } from '@/components/states'
import { useTheme } from '@/theme'

type Filter = 'all' | LearningBucket

/* My learning — every course the student is enrolled on, with progress, the
   website's status filters, and the way into class assignments. */
export default function MyLearning() {
  const { t } = useTranslation()
  const { colors, fonts, radius } = useTheme()
  const { state } = useAuth()
  const enrollments = useMyEnrollments()
  const [filter, setFilter] = useState<Filter>('all')
  const [refreshing, setRefreshing] = useState(false)

  /* A course deleted after enrolment has nothing to open — leave it out. */
  const live = useMemo(() => (enrollments.data ?? []).filter(e => e.course), [enrollments.data])
  const rows = useMemo(() => (filter === 'all' ? live : live.filter(e => bucketOf(e) === filter)), [live, filter])
  const pending = state.status === 'signedIn' && state.user.enrollmentStatus === 'pending'

  const refresh = async () => {
    setRefreshing(true)
    try { await enrollments.refetch() } finally { setRefreshing(false) }
  }

  if (enrollments.isLoading) return <Loading />
  if (enrollments.error && !enrollments.data) return <Failed error={enrollments.error} onRetry={() => void refresh()} />

  const header = (
    <View style={{ gap: 14 }}>
      {pending && <Notice tone="info">{t('learning.pendingBody')}</Notice>}
      <Pressable accessibilityRole="button" onPress={() => router.push('/learning/assignments')}
        style={({ pressed }) => ({
          flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: radius.lg,
          backgroundColor: colors.primaryLight, opacity: pressed ? 0.85 : 1,
        })}>
        <Ionicons name="document-text-outline" size={22} color={colors.primary} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ fontFamily: fonts.semibold, fontSize: 15, color: colors.primary }}>{t('learning.assignments')}</Text>
          <Text style={{ fontFamily: fonts.body, fontSize: 13, color: colors.textSecondary }}>{t('learning.assignmentsBody')}</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.primary} />
      </Pressable>
      {live.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {(['all', 'inProgress', 'notStarted', 'completed'] as const).map(f => (
            <Chip key={f} label={t(`learning.${f}`)} active={filter === f} onPress={() => setFilter(f)} />
          ))}
        </View>
      )}
    </View>
  )

  return (
    <FlatList
      data={rows}
      keyExtractor={e => e.id}
      contentContainerStyle={{ padding: 16, gap: 12 }}
      ListHeaderComponent={header}
      ListHeaderComponentStyle={{ marginBottom: 4 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.primary} />}
      ListEmptyComponent={live.length === 0
        ? <Empty title={t('learning.noneTitle')} body={t('learning.noneBody')} />
        : <Empty title={t('learning.noMatch')} />}
      renderItem={({ item }) => <CourseRow e={item} />}
    />
  )
}

function CourseRow({ e }: { e: MyEnrollment }) {
  const { t } = useTranslation()
  const { colors, fonts, radius } = useTheme()
  const course = e.course!
  const bucket = bucketOf(e)
  return (
    <Pressable accessibilityRole="button"
      onPress={() => router.push({ pathname: '/learning/[slug]', params: { slug: course.slug } })}
      style={({ pressed }) => ({
        backgroundColor: colors.bgSurface, borderColor: colors.border, borderWidth: 1,
        borderRadius: radius.lg, padding: 16, gap: 10, opacity: pressed ? 0.85 : 1,
      })}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={{ flex: 1, fontFamily: fonts.bold, fontSize: 16, color: colors.textPrimary }}>{course.title}</Text>
        {bucket === 'completed'
          ? <Ionicons name="checkmark-circle" size={20} color={colors.success} />
          : <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />}
      </View>
      {course.instructor && (
        <Text style={{ fontFamily: fonts.body, fontSize: 13, color: colors.textMuted }}>{course.instructor.name}</Text>
      )}
      <ProgressBar percent={e.progressPercent} />
      <Text style={{ fontFamily: fonts.medium, fontSize: 12, color: bucket === 'completed' ? colors.success : colors.textSecondary }}>
        {bucket === 'notStarted' ? t('learning.notStarted') : t('learning.percent', { percent: Math.round(e.progressPercent) })}
      </Text>
    </Pressable>
  )
}
