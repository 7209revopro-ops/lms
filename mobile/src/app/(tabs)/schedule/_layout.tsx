import { Stack } from 'expo-router/stack'
import { useTranslation } from 'react-i18next'
import { useTheme } from '@/theme'

export default function ScheduleLayout() {
  const { t } = useTranslation()
  const { colors, fonts } = useTheme()
  return (
    <Stack screenOptions={{
      headerStyle: { backgroundColor: colors.bgSurface },
      headerTintColor: colors.primary,
      headerTitleStyle: { fontFamily: fonts.semibold, color: colors.textPrimary },
      contentStyle: { backgroundColor: colors.bgPage },
    }}>
      <Stack.Screen name="index" options={{ title: t('schedule.title') }} />
      <Stack.Screen name="[courseId]/index" options={{ title: t('schedule.modules') }} />
      <Stack.Screen name="[courseId]/[moduleId]" options={{ title: t('schedule.sessions') }} />
    </Stack>
  )
}
