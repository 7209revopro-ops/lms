import { Stack } from 'expo-router/stack'
import { useTranslation } from 'react-i18next'
import { useTheme } from '@/theme'

export default function MessagesLayout() {
  const { t } = useTranslation()
  const { colors, fonts } = useTheme()
  return (
    <Stack screenOptions={{
      headerStyle: { backgroundColor: colors.bgSurface },
      headerTintColor: colors.primary,
      headerTitleStyle: { fontFamily: fonts.semibold, color: colors.textPrimary },
      contentStyle: { backgroundColor: colors.bgPage },
    }}>
      <Stack.Screen name="index" options={{ title: t('messages.title') }} />
      <Stack.Screen name="[instructorId]" options={{ title: '' }} />
    </Stack>
  )
}
