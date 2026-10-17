import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native'
import { Stack, router, useLocalSearchParams } from 'expo-router'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useTranslation } from 'react-i18next'
import { moduleParam, useCatalog } from '@/lib/catalog'
import { Empty, Failed, Loading } from '@/components/states'
import { useTheme } from '@/theme'

/* A course's modules, in course order; "General sessions" last. */
export default function CourseModules() {
  const { courseId } = useLocalSearchParams<{ courseId: string }>()
  const { t } = useTranslation()
  const { colors, fonts, radius } = useTheme()
  const { catalog, isLoading, error, refreshing, refresh } = useCatalog()
  const course = catalog.find(c => (c.id || '_none') === courseId)

  if (isLoading) return <Loading />
  if (!course) return error ? <Failed error={error} onRetry={refresh} /> : <Empty title={t('schedule.courseEmpty')} />

  return (
    <>
      <Stack.Screen options={{ title: course.title }} />
      <FlatList
        data={course.modules}
        keyExtractor={m => moduleParam(m.id)}
        contentContainerStyle={{ padding: 16, gap: 12 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}
        renderItem={({ item: m }) => (
          <Pressable accessibilityRole="button"
            onPress={() => router.push({ pathname: '/schedule/[courseId]/[moduleId]', params: { courseId: courseId!, moduleId: moduleParam(m.id) } })}
            style={({ pressed }) => ({
              backgroundColor: colors.bgSurface, borderColor: colors.border, borderWidth: 1,
              borderRadius: radius.lg, padding: 16, gap: 6, opacity: pressed ? 0.85 : 1,
            })}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {m.number != null && (
                <Text style={{ fontFamily: fonts.bold, fontSize: 12, color: colors.primary }}>{t('schedule.moduleNo', { n: String(m.number).padStart(2, '0') })}</Text>
              )}
              {m.blocked && <Ionicons name="lock-closed" size={14} color={colors.textMuted} accessibilityLabel="Locked" />}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ flex: 1, fontFamily: fonts.bold, fontSize: 16, color: colors.textPrimary }}>{m.title}</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </View>
            <Text style={{ fontFamily: fonts.body, fontSize: 13, color: colors.textSecondary }}>
              {t('schedule.moduleMeta', { slots: m.groups.length, sessions: m.sessionCount })}
              {m.languages.length ? ` · ${m.languages.join(', ')}` : ''}
            </Text>
            {m.blocked && (
              <Text style={{ fontFamily: fonts.body, fontSize: 13, color: colors.textMuted }}>
                {t('schedule.blocked')}
              </Text>
            )}
          </Pressable>
        )}
      />
    </>
  )
}
