import { Stack } from 'expo-router/stack'
import { useTranslation } from 'react-i18next'
import { useTheme } from '@/theme'

/* A link straight into this tab (a course, a conversation) keeps its list under it. */
export const unstable_settings = { anchor: 'index' }

export default function LearningLayout() {
  const { t } = useTranslation()
  const { colors, fonts } = useTheme()
  return (
    <Stack screenOptions={{
      headerStyle: { backgroundColor: colors.bgSurface },
      headerTintColor: colors.primary,
      headerTitleStyle: { fontFamily: fonts.semibold, color: colors.textPrimary },
      contentStyle: { backgroundColor: colors.bgPage },
    }}>
      <Stack.Screen name="index" options={{ title: t('tabs.learning') }} />
      <Stack.Screen name="[slug]/index" options={{ title: '' }} />
      <Stack.Screen name="[slug]/[lessonId]" options={{ title: '' }} />
      <Stack.Screen name="[slug]/exam" options={{ title: t('exam.title') }} />
      <Stack.Screen name="paths/index" options={{ title: t('paths.title') }} />
      <Stack.Screen name="paths/[slug]" options={{ title: '' }} />
      <Stack.Screen name="favorites" options={{ title: t('favorites.title') }} />
      <Stack.Screen name="assignments/index" options={{ title: t('assignments.title') }} />
      <Stack.Screen name="assignments/submit" options={{ title: t('assignments.submit'), presentation: 'modal' }} />
    </Stack>
  )
}
