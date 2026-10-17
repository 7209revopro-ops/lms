import { useState } from 'react'
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native'
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useMyTickets, type SupportTicket } from '@/lib/api/support'
import { fmtShort } from '@/components/classes'
import { Button } from '@/components/ui'
import { Empty, Failed, Loading } from '@/components/states'
import { useTheme } from '@/theme'

/* The student's support requests, newest activity first. */
export default function SupportList() {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const mine = useMyTickets()
  const [refreshing, setRefreshing] = useState(false)
  const refresh = async () => {
    setRefreshing(true)
    try { await mine.refetch() } finally { setRefreshing(false) }
  }
  if (mine.isLoading) return <Loading />
  if (mine.error && !mine.data) return <Failed error={mine.error} onRetry={() => void refresh()} />
  return (
    <FlatList
      data={mine.data ?? []}
      keyExtractor={x => x.id}
      contentContainerStyle={{ padding: 16, gap: 10 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.primary} />}
      ListHeaderComponent={<Button title={t('support.newTicket')} onPress={() => router.push('/profile/support/new')} />}
      ListHeaderComponentStyle={{ marginBottom: 4 }}
      ListEmptyComponent={<Empty title={t('support.none')} body={t('support.noneBody')} />}
      renderItem={({ item }) => <TicketRow tk={item} />}
    />
  )
}

function TicketRow({ tk }: { tk: SupportTicket }) {
  const { t } = useTranslation()
  const { colors, fonts, radius } = useTheme()
  const done = tk.status === 'resolved' || tk.status === 'closed'
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/profile/support/[id]', params: { id: tk.id, subject: tk.subject } })}
      style={({ pressed }) => ({ padding: 14, gap: 6, borderRadius: radius.lg, borderWidth: 1, borderColor: tk.userUnread ? colors.primary : colors.border, backgroundColor: pressed ? colors.bgMuted : colors.bgSurface })}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text numberOfLines={1} style={{ flex: 1, fontFamily: tk.userUnread ? fonts.bold : fonts.semibold, fontSize: 15, color: colors.textPrimary }}>{tk.subject}</Text>
        <Text style={{ fontFamily: fonts.body, fontSize: 12, color: colors.textMuted }}>{fmtShort(tk.lastMessageAt)}</Text>
      </View>
      <Text style={{ fontFamily: fonts.medium, fontSize: 12, color: done ? colors.textMuted : tk.status === 'pending' ? colors.warning : colors.primary }}>
        {`${t(`support.status.${tk.status}`)} · ${t(`support.categories.${tk.category}`)}`}
      </Text>
    </Pressable>
  )
}
