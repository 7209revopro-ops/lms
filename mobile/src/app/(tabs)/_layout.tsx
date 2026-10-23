import { Tabs } from 'expo-router/js-tabs'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useTranslation } from 'react-i18next'
import { useChatUnread } from '@/lib/api/chat'
import { useNewClassCount } from '@/lib/api/engage'
import { useTheme } from '@/theme'

type IconName = keyof typeof Ionicons.glyphMap

const TABS: { name: string; label: 'home' | 'schedule' | 'learning' | 'messages' | 'profile'; icon: IconName }[] = [
  { name: 'index',    label: 'home',     icon: 'home-outline' },
  { name: 'schedule', label: 'schedule', icon: 'calendar-outline' },
  { name: 'learning', label: 'learning', icon: 'book-outline' },
  { name: 'messages', label: 'messages', icon: 'chatbubbles-outline' },
  { name: 'profile',  label: 'profile',  icon: 'person-circle-outline' },
]

export default function TabsLayout() {
  const { t } = useTranslation()
  const { colors, fonts } = useTheme()
  /* Unread mentor replies on the Messages tab. */
  const unread = useChatUnread(true).data ?? 0
  /* New classes scheduled on your courses — read when the Schedule opens. */
  const fresh = useNewClassCount().data ?? 0
  const badge = (name: string) => (name === 'messages' ? unread : name === 'schedule' ? fresh : 0)
  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarActiveTintColor: colors.primary,
      tabBarInactiveTintColor: colors.textMuted,
      tabBarStyle: { backgroundColor: colors.bgSurface, borderTopColor: colors.border },
      tabBarLabelStyle: { fontFamily: fonts.medium, fontSize: 11 },
    }}>
      {TABS.map(tab => (
        <Tabs.Screen key={tab.name} name={tab.name} options={{
          title: t(`tabs.${tab.label}`),
          /* Spelled out: left to Android, the icon's glyph is read too. */
          tabBarAccessibilityLabel: `${t(`tabs.${tab.label}`)}${badge(tab.name) > 0 ? `, ${badge(tab.name)} new` : ''}`,
          tabBarBadge: badge(tab.name) > 0 ? (badge(tab.name) > 99 ? '99+' : badge(tab.name)) : undefined,
          tabBarIcon: ({ color, size }) => <Ionicons name={tab.icon} color={String(color ?? colors.textMuted)} size={size} />,
        }} />
      ))}
    </Tabs>
  )
}
