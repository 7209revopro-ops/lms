import { useMemo, useState } from 'react'
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Pressable, Text, TextInput, View } from 'react-native'
import { Stack, useLocalSearchParams } from 'expo-router'
import { useHeaderHeight } from 'expo-router/react-navigation'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useTranslation } from 'react-i18next'
import { CHAT_MAX_CHARS, dayKey, isSeen, type ChatMessage } from '@shared'
import { useChatThread } from '@/lib/api/chat'
import { useAuth } from '@/lib/auth'
import { fmtTime } from '@/components/classes'
import { Notice } from '@/components/ui'
import { Failed, Loading } from '@/components/states'
import { useTheme } from '@/theme'

/* One conversation with a mentor: newest at the bottom, older pages on
   demand, optimistic sends with ✓ / ✓✓, and failed sends that say whether a
   retry can help. Plain text only (plan.md §11.2 C6). */
export default function Thread() {
  const { instructorId, name, c } = useLocalSearchParams<{ instructorId: string; name?: string; c?: string }>()
  const { t } = useTranslation()
  const { colors, fonts, radius } = useTheme()
  const { state } = useAuth()
  const headerHeight = useHeaderHeight()
  const thread = useChatThread(c || null, instructorId!)
  const [draft, setDraft] = useState('')
  const [olderBusy, setOlderBusy] = useState(false)
  const approved = state.status === 'signedIn' && state.user.enrollmentStatus === 'approved'

  /* Inverted list: newest first in data, drawn at the bottom. Each message
     carries whether a day label goes above it (i.e. after it, inverted). */
  const rows = useMemo(() => {
    const desc = [...thread.messages].reverse()
    return desc.map((m, i) => ({ m, dayLabel: i === desc.length - 1 || dayKey(desc[i + 1]!.createdAt) !== dayKey(m.createdAt) }))
  }, [thread.messages])

  const send = () => {
    const body = draft.trim()
    if (!body || body.length > CHAT_MAX_CHARS) return
    setDraft('')
    void thread.send(body)
  }

  const loadOlder = async () => {
    if (!thread.hasMore || olderBusy) return
    setOlderBusy(true)
    try { await thread.loadOlder() } catch { /* the button stays for another try */ } finally { setOlderBusy(false) }
  }

  const tooLong = draft.trim().length > CHAT_MAX_CHARS

  return (
    <>
      <Stack.Screen options={{ title: name ?? '' }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={headerHeight}>
        {thread.loading ? <Loading />
          : thread.loadError && thread.messages.length === 0 ? <Failed error={thread.loadError} onRetry={() => void thread.retryOpen()} />
          : (
            <FlatList
              inverted
              data={rows}
              keyExtractor={r => r.m.clientMsgId ?? r.m.id}
              contentContainerStyle={{ padding: 12, gap: 6, flexGrow: 1 }}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', transform: [{ scaleY: -1 }] }}>
                  <Text style={{ fontFamily: fonts.body, fontSize: 14, color: colors.textMuted }}>{t('messages.empty')}</Text>
                </View>
              }
              ListFooterComponent={thread.hasMore ? (
                <Pressable onPress={() => void loadOlder()} accessibilityRole="button" style={{ alignSelf: 'center', padding: 10 }}>
                  {olderBusy ? <ActivityIndicator color={colors.primary} />
                    : <Text style={{ fontFamily: fonts.semibold, fontSize: 13, color: colors.primary }}>{t('messages.earlier')}</Text>}
                </Pressable>
              ) : undefined}
              renderItem={({ item }) => (
                <View style={{ gap: 6 }}>
                  {item.dayLabel && <DayLabel iso={item.m.createdAt} />}
                  <Bubble m={item.m} seen={isSeen(item.m, thread.peerLastReadAt)}
                    onRetry={item.m.failed && !item.m.fatal ? () => void thread.send(item.m.body, item.m) : undefined} />
                </View>
              )}
            />
          )}

        {approved ? (
          <View style={{ padding: 10, gap: 6, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.bgSurface }}>
            {tooLong && <Text style={{ fontFamily: fonts.medium, fontSize: 12, color: colors.danger }}>{t('messages.tooLong', { max: CHAT_MAX_CHARS })}</Text>}
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
              <TextInput
                value={draft} onChangeText={setDraft} multiline placeholder={t('messages.placeholder')}
                placeholderTextColor={colors.textMuted} accessibilityLabel={t('messages.placeholder')}
                style={{
                  flex: 1, maxHeight: 120, minHeight: 42, fontFamily: fonts.body, fontSize: 15, color: colors.textPrimary,
                  backgroundColor: colors.bgPage, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
                  paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10,
                }} />
              <Pressable onPress={send} accessibilityRole="button" accessibilityLabel={t('messages.send')}
                disabled={!draft.trim() || tooLong}
                style={({ pressed }) => ({
                  width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center',
                  backgroundColor: pressed ? colors.primaryPressed : colors.primaryFill, opacity: !draft.trim() || tooLong ? 0.4 : 1,
                })}>
                <Ionicons name="send" size={18} color={colors.onPrimary} />
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={{ padding: 12 }}><Notice tone="info">{t('messages.pending')}</Notice></View>
        )}
      </KeyboardAvoidingView>
    </>
  )
}

function DayLabel({ iso }: { iso: string }) {
  const { t } = useTranslation()
  const { colors, fonts } = useTheme()
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
  const label = dayKey(iso) === dayKey(today.toISOString()) ? t('messages.today')
    : dayKey(iso) === dayKey(yesterday.toISOString()) ? t('messages.yesterday')
    : d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' })
  return (
    <Text style={{ alignSelf: 'center', marginVertical: 6, fontFamily: fonts.medium, fontSize: 12, color: colors.textMuted }}>{label}</Text>
  )
}

function Bubble({ m, seen, onRetry }: { m: ChatMessage; seen: boolean; onRetry?: () => void }) {
  const { t } = useTranslation()
  const { colors, fonts } = useTheme()
  const mine = m.senderRole === 'student'
  const state = m.failed ? (m.fatal ? t('messages.notSent') : t('messages.retry'))
    : m.pending ? t('messages.sending') : mine ? (seen ? t('messages.seen') : t('messages.sent')) : null
  return (
    <Pressable disabled={!onRetry} onPress={onRetry} accessibilityRole={onRetry ? 'button' : undefined}
      accessibilityLabel={[m.body, fmtTime(m.createdAt), state].filter(Boolean).join('. ')}
      style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '82%', gap: 3 }}>
      <View style={{
        paddingHorizontal: 13, paddingVertical: 9, borderRadius: 18,
        borderBottomRightRadius: mine ? 6 : 18, borderBottomLeftRadius: mine ? 18 : 6,
        backgroundColor: mine ? colors.primaryFill : colors.bgSurface,
        borderWidth: mine ? 0 : 1, borderColor: colors.border, opacity: m.pending ? 0.7 : 1,
      }}>
        <Text selectable style={{ fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: mine ? colors.onPrimary : colors.textPrimary }}>{m.body}</Text>
      </View>
      <View style={{ flexDirection: 'row', alignSelf: mine ? 'flex-end' : 'flex-start', alignItems: 'center', gap: 4 }}>
        <Text style={{ fontFamily: fonts.body, fontSize: 11, color: colors.textMuted }}>{fmtTime(m.createdAt)}</Text>
        {mine && !m.failed && !m.pending && <Ionicons name={seen ? 'checkmark-done' : 'checkmark'} size={13} color={seen ? colors.primary : colors.textMuted} />}
        {(m.failed || m.pending) && state && (
          <Text style={{ fontFamily: fonts.medium, fontSize: 11, color: m.failed ? colors.danger : colors.textMuted }}>{state}</Text>
        )}
      </View>
    </Pressable>
  )
}
