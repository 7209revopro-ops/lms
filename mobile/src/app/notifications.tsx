import { useMemo, useState } from 'react'
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native'
import { Stack, router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { appPathFor } from '@shared'
import { useMarkRead, useNotifications, type AppNotification } from '@/lib/api/notifications'
import { fmtShort } from '@/components/classes'
import { Empty, Failed, Loading } from '@/components/states'
import { useTheme } from '@/theme'

/* Notifications — newest first, paged. Tapping one marks it read and opens
   its screen in the app when there is one. */
export default function Notifications() {
  const { t } = useTranslation()
  const { colors, fonts } = useTheme()
  const feed = useNotifications()
  const markRead = useMarkRead()
  const [refreshing, setRefreshing] = useState(false)
  const items = useMemo(() => feed.data?.pages.flatMap(p => p.items) ?? [], [feed.data])
  const anyUnread = items.some(n => !n.readAt)

  const refresh = async () => {
    setRefreshing(true)
    try { await feed.refetch() } finally { setRefreshing(false) }
  }

  const open = (n: AppNotification) => {
    if (!n.readAt) markRead.mutate(n.id)
    const path = n.link ? appPathFor(n.link) : null
    if (path) router.push(path as never)
  }

  return (
    <>
      <Stack.Screen options={{
        title: t('notifications.title'),
        headerRight: anyUnread ? () => (
          <Pressable onPress={() => markRead.mutate('all')} accessibilityRole="button" hitSlop={8}>
            <Text style={{ fontFamily: fonts.semibold, fontSize: 14, color: colors.primary }}>{t('notifications.markAll')}</Text>
          </Pressable>
        ) : undefined,
      }} />
      {feed.isLoading ? <Loading />
        : feed.error && items.length === 0 ? <Failed error={feed.error} onRetry={() => void refresh()} />
        : (
          <FlatList
            data={items}
            keyExtractor={n => n.id}
            contentContainerStyle={{ paddingVertical: 8 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.primary} />}
            onEndReached={() => { if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage() }}
            onEndReachedThreshold={0.4}
            ListEmptyComponent={<Empty title={t('notifications.none')} body={t('notifications.noneBody')} />}
            ListFooterComponent={feed.isFetchingNextPage ? <Loading /> : undefined}
            renderItem={({ item: n }) => (
              <Pressable onPress={() => open(n)} accessibilityRole="button"
                style={({ pressed }) => ({
                  flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingVertical: 14,
                  backgroundColor: pressed ? colors.bgMuted : n.readAt ? 'transparent' : colors.primaryLight,
                  borderBottomWidth: 1, borderBottomColor: colors.border,
                })}>
                <View style={{ width: 8, height: 8, borderRadius: 4, marginTop: 7, backgroundColor: n.readAt ? 'transparent' : colors.primary }} />
                <View style={{ flex: 1, gap: 3 }}>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Text style={{ flex: 1, fontFamily: n.readAt ? fonts.medium : fonts.semibold, fontSize: 15, color: colors.textPrimary }}>{n.title}</Text>
                    <Text style={{ fontFamily: fonts.body, fontSize: 12, color: colors.textMuted }}>{fmtShort(n.createdAt)}</Text>
                  </View>
                  {!!n.body && <Text style={{ fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.textSecondary }}>{n.body}</Text>}
                </View>
              </Pressable>
            )}
          />
        )}
    </>
  )
}
