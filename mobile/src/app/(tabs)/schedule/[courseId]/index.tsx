import { FlatList, RefreshControl, Text, View } from 'react-native'
import { Stack, router, useLocalSearchParams } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { GENERAL_MODULE_ID, programName } from '@shared'
import { moduleParam, useCatalog } from '@/lib/catalog'
import { Empty, Failed, Loading } from '@/components/states'
import { Badge } from '@/components/ui'
import { ModuleCard } from '@/components/schedule'
import { useTheme } from '@/theme'

/* A course's modules, in course order; "General sessions" last. A module's
   number is its place in the course (the server's, else its position). */
export default function CourseModules() {
  const { courseId } = useLocalSearchParams<{ courseId: string }>()
  const { t } = useTranslation()
  const { colors, fonts } = useTheme()
  const { catalog, isLoading, error, refreshing, refresh } = useCatalog()
  const course = catalog.find(c => (c.id || '_none') === courseId)

  if (isLoading) return <Loading />
  if (!course) return error ? <Failed error={error} onRetry={refresh} /> : <Empty icon="calendar-outline" title={t('schedule.courseEmpty')} />

  const ordered = course.modules.filter(m => m.id !== GENERAL_MODULE_ID)
  return (
    <>
      <Stack.Screen options={{ title: '' }} />
      <FlatList
        data={course.modules}
        keyExtractor={m => moduleParam(m.id)}
        contentContainerStyle={{ padding: 16, gap: 10 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}
        ListHeaderComponent={
          <View style={{ gap: 6, marginBottom: 8 }}>
            <Text accessibilityRole="header" style={{ fontFamily: fonts.display, fontSize: 24, lineHeight: 30, color: colors.textPrimary }}>{course.title}</Text>
            <Text style={{ fontFamily: fonts.medium, fontSize: 13, color: colors.textMuted }}>
              {[course.program && programName(course.program), t('schedule.modules', { count: course.modules.length }), t('schedule.sessionsAhead', { count: course.sessionCount })].filter(Boolean).join(' · ')}
            </Text>
            {course.shared && <Badge label={t('schedule.shared')} tone="muted" icon="share-social-outline" />}
          </View>
        }
        renderItem={({ item: m }) => (
          <ModuleCard node={m} courseTitle={course.title}
            position={m.id === GENERAL_MODULE_ID ? null : (m.number ?? ordered.indexOf(m) + 1)}
            onPress={() => router.push({ pathname: '/schedule/[courseId]/[moduleId]', params: { courseId: courseId!, moduleId: moduleParam(m.id) } })} />
        )}
      />
    </>
  )
}
