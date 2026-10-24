import { useState } from 'react'
import { FlatList, KeyboardAvoidingView, Pressable, Text, TextInput, View } from 'react-native'
import { Stack, useLocalSearchParams } from 'expo-router'
import { useHeaderHeight } from 'expo-router/react-navigation'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useTranslation } from 'react-i18next'
import { useReply, useTicket } from '@/lib/api/support'
import { errorText } from '@/lib/errors'
import { fmtWhen } from '@/components/classes'
import { Notice } from '@/components/ui'
import { Failed, Loading } from '@/components/states'
import { useTheme } from '@/theme'

/* One support request: the conversation with the team, and a reply box
   while it is open. */
export default function Ticket() {
  const { id, subject } = useLocalSearchParams<{ id: string; subject?: string }>()
  const { t } = useTranslation()
  const { colors, fonts, radius } = useTheme()
  const headerHeight = useHeaderHeight()
  const ticket = useTicket(id!)
  const reply = useReply(id!)
  const [draft, setDraft] = useState('')

  if (ticket.isLoading) return <Loading />
  if (ticket.error || !ticket.data) return <Failed error={ticket.error} onRetry={() => void ticket.refetch()} />
  const tk = ticket.data
  const closed = tk.status === 'closed'

  const send = () => {
    const body = draft.trim()
    if (!body) return
    reply.mutate(body, { onSuccess: () => setDraft('') })
  }

  return (
    <>
      <Stack.Screen options={{ title: subject ?? tk.subject }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={headerHeight}>
        <FlatList
          data={tk.messages}
          keyExtractor={(m, i) => m._id ?? String(i)}
          contentContainerStyle={{ padding: 16, gap: 10 }}
          ListHeaderComponent={<Text style={{ fontFamily: fonts.medium, fontSize: 12, color: colors.textMuted }}>{`${t(`support.status.${tk.status}`)} · ${t(`support.categories.${tk.category}`)}`}</Text>}
          renderItem={({ item: m }) => {
            const mine = m.senderRole === 'student'
            return (
              <View style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '88%', gap: 3 }}>
                <Text style={{ alignSelf: mine ? 'flex-end' : 'flex-start', fontFamily: fonts.medium, fontSize: 11, color: colors.textMuted }}>
                  {`${mine ? t('support.you') : t('support.team')} · ${fmtWhen(m.createdAt)}`}
                </Text>
                <View style={{ padding: 12, borderRadius: radius.lg, backgroundColor: mine ? colors.primaryLight : colors.bgSurface, borderWidth: mine ? 0 : 1, borderColor: colors.border }}>
                  <Text selectable style={{ fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: colors.textPrimary }}>{m.body}</Text>
                </View>
              </View>
            )
          }}
        />
        {closed ? (
          <View style={{ padding: 12 }}><Notice tone="info">{t('support.closed')}</Notice></View>
        ) : (
          <View style={{ padding: 10, gap: 6, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.bgSurface }}>
            {reply.error && <Notice>{errorText(reply.error)}</Notice>}
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
              <TextInput value={draft} onChangeText={setDraft} multiline maxLength={5000} placeholder={t('support.reply')}
                placeholderTextColor={colors.textMuted} accessibilityLabel={t('support.reply')}
                style={{ flex: 1, maxHeight: 120, minHeight: 42, fontFamily: fonts.body, fontSize: 15, color: colors.textPrimary,
                  backgroundColor: colors.bgPage, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 10 }} />
              <Pressable onPress={send} hitSlop={6} disabled={!draft.trim() || reply.isPending} accessibilityRole="button" accessibilityLabel={t('support.send')}
                style={({ pressed }) => ({ width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center',
                  backgroundColor: pressed ? colors.primaryPressed : colors.primaryFill, opacity: !draft.trim() || reply.isPending ? 0.4 : 1 })}>
                <Ionicons name="send" size={18} color={colors.onPrimary} />
              </Pressable>
            </View>
          </View>
        )}
      </KeyboardAvoidingView>
    </>
  )
}
