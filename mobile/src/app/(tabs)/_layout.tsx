import { useSegments } from 'expo-router'
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
  /* A conversation gets the whole screen, as in any messaging app; the tab
     bar comes back on leaving it. */
  const segments = useSegments() as string[]
  const inThread = segments[1] === 'messages' && segments.length > 2
  const badge = (name: string) => (name === 'messages' ? unread : name === 'schedule' ? fresh : 0)
  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarActiveTintColor: colors.primary,
      tabBarInactiveTintColor: colors.textMuted,
      tabBarStyle: inThread
        ? { display: 'none' }
        : { backgroundColor: colors.bgSurface, borderTopColor: colors.border },
      tabBarLabelStyle: { fontFamily: fonts.medium, fontSize: 11 },
    }}>
      {TABS.map(tab => (
        <Tabs.Screen key={tab.name} name={tab.name} options={{
          title: t(`tabs.${tab.label}`),
          /* Spelled out: left to Android, the icon's glyph is read too. */
          tabBarAccessibilityLabel: `${t(`tabs.${tab.label}`)}${badge(tab.name) > 0 ? `, ${t('tabs.newCount', { count: badge(tab.name) })}` : ''}`,
          tabBarBadge: badge(tab.name) > 0 ? (badge(tab.name) > 99 ? '99+' : badge(tab.name)) : undefined,
          /* Filled glyph for the tab you are on, outline for the rest. */
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={(focused ? tab.icon.replace('-outline', '') : tab.icon) as IconName}
              color={String(color ?? colors.textMuted)} size={size} />
          ),
        }} />
      ))}
    </Tabs>
  )
}
