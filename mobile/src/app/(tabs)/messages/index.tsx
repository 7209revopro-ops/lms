import { useEffect, useMemo, useRef, useState } from 'react'
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useTranslation } from 'react-i18next'
import { programName, sortInstructors, type ChatInstructor } from '@shared'
import { useChatInstructors } from '@/lib/api/chat'
import { useAuth } from '@/lib/auth'
import { fmtShort } from '@/components/classes'
import { Notice } from '@/components/ui'
import { Empty, Failed, Loading } from '@/components/states'
import { useTheme } from '@/theme'

/* The mentors of the student's programme, each with the last message and
   unread replies. `?c=<conversation>` (from a notification or a link) opens
   that conversation directly. */
export default function MessagesList() {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const { state } = useAuth()
  const { c } = useLocalSearchParams<{ c?: string }>()
  const list = useChatInstructors()
  const [refreshing, setRefreshing] = useState(false)
  const rows = useMemo(() => sortInstructors(list.data ?? []), [list.data])
  const pending = state.status === 'signedIn' && state.user.enrollmentStatus !== 'approved'

  /* A link to one conversation: open it once the list says whose it is.
     Pushed over the list (not replacing it), so Back reaches the other
     mentors; `opened` stops the list re-opening it on the way back. */
  const opened = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!c || !list.data || opened.current === c) return
    const who = list.data.find(i => i.conversation?.id === c)
    if (who) { opened.current = c; openThread(who) }
  }, [c, list.data])

  const refresh = async () => {
    setRefreshing(true)
    try { await list.refetch() } finally { setRefreshing(false) }
  }

  if (list.isLoading) return <Loading />
  if (list.error && !list.data) return <Failed error={list.error} onRetry={() => void refresh()} />

  return (
    <FlatList
      data={rows}
      keyExtractor={i => i.id}
      contentContainerStyle={{ padding: 16, gap: 10 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.primary} />}
      ListHeaderComponent={pending ? <View style={{ marginBottom: 6 }}><Notice tone="info">{t('messages.pending')}</Notice></View> : undefined}
      ListEmptyComponent={<Empty title={t('messages.none')} body={t('messages.noneBody')} />}
      renderItem={({ item }) => <MentorRow i={item} />}
    />
  )
}

function openThread(i: ChatInstructor) {
  router.push({ pathname: '/messages/[instructorId]', params: { instructorId: i.id, name: i.name, c: i.conversation?.id ?? '' } })
}

function MentorRow({ i }: { i: ChatInstructor }) {
  const { t } = useTranslation()
  const { colors, fonts, radius } = useTheme()
  const conv = i.conversation
  const unread = conv?.unread ?? 0
  const preview = conv ? (conv.lastSenderRole === 'student' ? t('messages.you', { text: conv.lastMessagePreview }) : conv.lastMessagePreview) : t('messages.start')
  return (
    <Pressable accessibilityRole="button" onPress={() => openThread(i)}
      accessibilityLabel={`${i.name}${unread ? `, ${unread} unread` : ''}`}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: radius.lg,
        backgroundColor: pressed ? colors.bgMuted : colors.bgSurface, borderColor: colors.border, borderWidth: 1,
      })}>
      <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontFamily: fonts.bold, fontSize: 17, color: colors.primary }}>{i.name.trim().charAt(0).toUpperCase()}</Text>
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text numberOfLines={1} style={{ flex: 1, fontFamily: fonts.semibold, fontSize: 15, color: colors.textPrimary }}>{i.name}</Text>
          {conv && <Text style={{ fontFamily: fonts.body, fontSize: 12, color: unread ? colors.primary : colors.textMuted }}>{fmtShort(conv.lastMessageAt)}</Text>}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text numberOfLines={1} style={{ flex: 1, fontFamily: unread ? fonts.semibold : fonts.body, fontSize: 13, color: unread ? colors.textPrimary : colors.textMuted }}>
            {conv ? preview : i.programs.map(programName).join(' · ') || preview}
          </Text>
          {unread > 0 && (
            <View style={{ minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, backgroundColor: colors.primaryFill, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontFamily: fonts.bold, fontSize: 11, color: colors.onPrimary }}>{unread > 99 ? '99+' : unread}</Text>
            </View>
          )}
          {!conv && <Ionicons name="chatbubble-ellipses-outline" size={16} color={colors.primary} />}
        </View>
      </View>
    </Pressable>
  )
}
