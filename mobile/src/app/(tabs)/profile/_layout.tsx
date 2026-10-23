import { Stack } from 'expo-router/stack'
import { useTranslation } from 'react-i18next'
import { useTheme } from '@/theme'

/* A link straight into this tab (a course, a conversation) keeps its list under it. */
export const unstable_settings = { anchor: 'index' }

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
      <Stack.Screen name="security" options={{ title: t('account.security') }} />
      <Stack.Screen name="purchases" options={{ title: t('account.purchases') }} />
      <Stack.Screen name="complete" options={{ title: t('account.completeRegistration') }} />
      <Stack.Screen name="progress" options={{ title: t('progress.title') }} />
      <Stack.Screen name="rate" options={{ title: t('rate.title') }} />
    </Stack>
  )
}
