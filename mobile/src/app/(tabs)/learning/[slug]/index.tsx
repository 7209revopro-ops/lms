import { useMemo, useState } from 'react'
import { Pressable, RefreshControl, SectionList, Text, View } from 'react-native'
import { Stack, router, useLocalSearchParams } from 'expo-router'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useTranslation } from 'react-i18next'
import { lessonGate, lessonSequence, outlineOf, resumeLesson, type LessonOutline } from '@shared'
import { useCourse, useCourseProgress } from '@/lib/api/learning'
import { useAuth } from '@/lib/auth'
import { Button, ProgressBar } from '@/components/ui'
import { Empty, Failed, Loading } from '@/components/states'
import { useTheme } from '@/theme'

const TYPE_ICON = { video: 'play-circle-outline', article: 'document-text-outline', quiz: 'help-circle-outline' } as const

/* One course: progress, a Resume button, and every module with its lessons —
   done, locked or open. */
export default function CourseOutline() {
  const { slug } = useLocalSearchParams<{ slug: string }>()
  const { t } = useTranslation()
  const { colors, fonts, radius } = useTheme()
  const { state } = useAuth()
  const enrollmentStatus = state.status === 'signedIn' ? state.user.enrollmentStatus : undefined
  const pending = enrollmentStatus === 'pending'

  const course = useCourse(slug)
  /* /progress refuses pending students outright; they see the outline only. */
  const progress = useCourseProgress(slug, !pending)
  const [refreshing, setRefreshing] = useState(false)

  const modules = useMemo(() => (course.data ? outlineOf(course.data) : []), [course.data])
  const resume = useMemo(
    () => (course.data ? resumeLesson(lessonSequence(course.data), progress.data) : undefined),
    [course.data, progress.data],
  )
  const done = useMemo(() => new Set(progress.data?.completedLessons ?? []), [progress.data])

  const refresh = async () => {
    setRefreshing(true)
    try { await Promise.all([course.refetch(), pending ? null : progress.refetch()]) } finally { setRefreshing(false) }
  }

  if (course.isLoading) return <Loading />
  if (course.error || !course.data) return <Failed error={course.error} onRetry={() => void refresh()} />

  const open = (l: LessonOutline) => router.push({ pathname: '/learning/[slug]/[lessonId]', params: { slug: slug!, lessonId: l.id } })
  const percent = progress.data?.progressPercent ?? 0
  const started = (progress.data?.completedLessons.length ?? 0) > 0 || !!progress.data?.lastLessonId

  return (
    <>
      <Stack.Screen options={{ title: course.data.course.title }} />
      <SectionList
        sections={modules.map(m => ({ key: m.section.id || '_orphans', title: m.section.title || t('learning.untitledModule'), sectionId: m.section.id, data: m.lessons }))}
        keyExtractor={l => l.id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.primary} />}
        ListHeaderComponent={
          <View style={{ gap: 12, marginBottom: 8 }}>
            <Text style={{ fontFamily: fonts.display, fontSize: 24, color: colors.textPrimary }}>{course.data.course.title}</Text>
            {!pending && progress.data?.isEnrolled && <>
              <ProgressBar percent={percent} />
              <Text style={{ fontFamily: fonts.medium, fontSize: 13, color: colors.textSecondary }}>{t('learning.percent', { percent })}</Text>
            </>}
            {resume && !pending && progress.data?.isEnrolled && (
              <Button title={started ? t('learning.resume') : t('learning.start')} onPress={() => open(resume)} />
            )}
          </View>
        }
        ListEmptyComponent={<Empty title={t('lesson.notFound')} />}
        renderSectionHeader={({ section }) => (
          <Text style={{ marginTop: 18, marginBottom: 8, fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 1, color: colors.textMuted }}>
            {section.title.toUpperCase()}
          </Text>
        )}
        renderItem={({ item: l, index, section }) => {
          const gate = lessonGate(l, progress.data, enrollmentStatus)
          const isDone = done.has(l.id)
          const first = index === 0
          const last = index === section.data.length - 1
          return (
            <Pressable accessibilityRole="button" onPress={() => open(l)}
              accessibilityLabel={`${l.title}${isDone ? `, ${t('lesson.completed')}` : ''}`}
              style={({ pressed }) => ({
                flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14,
                backgroundColor: pressed ? colors.bgMuted : colors.bgSurface,
                borderColor: colors.border, borderWidth: 1, borderTopWidth: first ? 1 : 0,
                borderTopLeftRadius: first ? radius.lg : 0, borderTopRightRadius: first ? radius.lg : 0,
                borderBottomLeftRadius: last ? radius.lg : 0, borderBottomRightRadius: last ? radius.lg : 0,
              })}>
              <Ionicons
                name={isDone ? 'checkmark-circle' : gate !== 'open' ? 'lock-closed-outline' : TYPE_ICON[l.type] ?? 'ellipse-outline'}
                size={20}
                color={isDone ? colors.success : gate !== 'open' ? colors.textMuted : colors.primary} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ fontFamily: fonts.medium, fontSize: 15, color: gate === 'open' ? colors.textPrimary : colors.textMuted }}>{l.title}</Text>
                <Text style={{ fontFamily: fonts.body, fontSize: 12, color: colors.textMuted }}>
                  {[l.durationMins ? t('lesson.minutes', { mins: l.durationMins }) : null, l.isFree && !progress.data?.isEnrolled ? t('learning.free') : null].filter(Boolean).join(' · ')}
                </Text>
              </View>
            </Pressable>
          )
        }}
      />
    </>
  )
}
