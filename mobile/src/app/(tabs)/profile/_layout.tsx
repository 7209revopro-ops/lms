import { Stack } from 'expo-router/stack'
import { useTranslation } from 'react-i18next'
import { useTheme } from '@/theme'

export default function ProfileLayout() {
  const { t } = useTranslation()
  const { colors, fonts } = useTheme()
  return (
    <Stack screenOptions={{
      headerStyle: { backgroundColor: colors.bgSurface },
      headerTintColor: colors.primary,
      headerTitleStyle: { fontFamily: fonts.semibold, color: colors.textPrimary },
      contentStyle: { backgroundColor: colors.bgPage },
    }}>
      <Stack.Screen name="index" options={{ title: t('tabs.profile') }} />
      <Stack.Screen name="details" options={{ title: t('account.details') }} />
      <Stack.Screen name="devices" options={{ title: t('account.devices') }} />
      <Stack.Screen name="support/index" options={{ title: t('support.title') }} />
      <Stack.Screen name="support/new" options={{ title: t('support.newTicket'), presentation: 'modal' }} />
      <Stack.Screen name="support/[id]" options={{ title: '' }} />
      <Stack.Screen name="delete" options={{ title: t('account.deleteTitle') }} />
    </Stack>
  )
}
