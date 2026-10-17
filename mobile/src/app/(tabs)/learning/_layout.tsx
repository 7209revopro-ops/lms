import { Stack } from 'expo-router/stack'
import { useTranslation } from 'react-i18next'
import { useTheme } from '@/theme'

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
      <Stack.Screen name="index" options={{ title: t('learning.title') }} />
      <Stack.Screen name="[slug]/index" options={{ title: t('learning.contents') }} />
      <Stack.Screen name="[slug]/[lessonId]" options={{ title: '' }} />
      <Stack.Screen name="assignments/index" options={{ title: t('assignments.title') }} />
      <Stack.Screen name="assignments/submit" options={{ title: t('assignments.submit'), presentation: 'modal' }} />
    </Stack>
  )
}
