import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native'
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useCatalog } from '@/lib/catalog'
import { Empty, Failed, Loading } from '@/components/states'
import { Glyph } from '@/components/ui'
import { useTheme } from '@/theme'

/* Every course the student has sessions in, still ahead. */
export default function ScheduleCourses() {
  const { t } = useTranslation()
  const { colors, fonts, radius } = useTheme()
  const { catalog, isLoading, error, refreshing, refresh } = useCatalog()

  if (isLoading) return <Loading />
  if (error && catalog.length === 0) return <Failed error={error} onRetry={refresh} />

  return (
    <FlatList
      data={catalog}
      keyExtractor={c => c.id || 'unassigned'}
      contentContainerStyle={{ padding: 16, gap: 12 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}
      ListEmptyComponent={<Empty title={t('schedule.noneTitle')} body={t('schedule.noneBody')} />}
      renderItem={({ item: c }) => (
        <Pressable accessibilityRole="button"
          onPress={() => router.push({ pathname: '/schedule/[courseId]', params: { courseId: c.id || '_none' } })}
          style={({ pressed }) => ({
            backgroundColor: colors.bgSurface, borderColor: colors.border, borderWidth: 1,
            borderRadius: radius.lg, padding: 16, gap: 6, opacity: pressed ? 0.85 : 1,
          })}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <Text style={{ flex: 1, fontFamily: fonts.bold, fontSize: 16, color: colors.textPrimary }}>{c.title}</Text>
            <Glyph name="chevron-forward" size={18} color={colors.textMuted} />
          </View>
          <Text style={{ fontFamily: fonts.body, fontSize: 13, color: colors.textSecondary }}>
            {`${t('schedule.modules', { count: c.modules.length })} · ${t('schedule.sessionsAhead', { count: c.sessionCount })}`}
          </Text>
          {c.instructors.length > 0 && (
            <Text style={{ fontFamily: fonts.body, fontSize: 13, color: colors.textMuted }}>
              {c.instructors.map(i => i.name).join(', ')}
            </Text>
          )}
        </Pressable>
      )}
    />
  )
}
