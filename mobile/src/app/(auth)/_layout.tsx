import { Stack } from 'expo-router/stack'
import { useTheme } from '@/theme'

/* Signed out, the app opens on the password sign-in. */
export const unstable_settings = { anchor: 'sign-in' }

export default function AuthLayout() {
  const { colors } = useTheme()
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bgPage } }} />
}
