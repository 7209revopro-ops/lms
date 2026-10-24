import { useRef, useState } from 'react'
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Pressable, Text, TextInput, View } from 'react-native'
import { Stack, useLocalSearchParams } from 'expo-router'
import { useHeaderHeight } from 'expo-router/react-navigation'
import { useTranslation } from 'react-i18next'
import { problemOf, type AiTurn } from '@shared'
import { askTutor } from '@/lib/api/engage'
import { errorText } from '@/lib/errors'
import { haptic } from '@/lib/haptics'
import { Glyph } from '@/components/ui'
import { useTheme } from '@/theme'

/* The AI tutor — the website's AI chat panel. It knows which course and
   lesson the student came from (both sent with each question), keeps the
   conversation on the phone, and answers in one go (no streaming). The
   server allows 100 questions a day and says so when the day is used up. */

type Msg = AiTurn & { id: number; failed?: boolean }

export default function Tutor() {
  const { courseSlug, lessonId, title } = useLocalSearchParams<{ courseSlug?: string; lessonId?: string; title?: string }>()
  const { t } = useTranslation()
  const { colors, fonts, radius } = useTheme()
  const headerHeight = useHeaderHeight()
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const seq = useRef(0)
  const list = useRef<FlatList<Msg>>(null)

  const send = async (text = draft, base: Msg[] = msgs) => {
    const q = text.trim()
    if (!q || busy) return
    haptic.tap()
    const history: AiTurn[] = base.filter(m => !m.failed).map(({ role, content }) => ({ role, content }))
    setMsgs(m => [...m, { id: ++seq.current, role: 'user', content: q }])
    setDraft('')
    setBusy(true)
    try {
      const reply = await askTutor(q, history, { courseSlug, lessonId })
      setMsgs(m => [...m, { id: ++seq.current, role: 'assistant', content: reply }])
    } catch (e) {
      const p = problemOf(e)
      const text = p.kind === 'refused' && p.code === 'AI_DAILY_LIMIT' ? t('ai.limit') : errorText(e)
      setMsgs(m => [...m, { id: ++seq.current, role: 'assistant', content: text, failed: true }])
    } finally {
      setBusy(false)
      requestAnimationFrame(() => list.current?.scrollToEnd({ animated: true }))
    }
  }

  /** Ask the last question again, dropping it and its failed answer first. */
  const retry = () => {
    const lastQ = [...msgs].reverse().find(m => m.role === 'user')
    if (!lastQ) return
    const base = msgs.filter(x => x.id < lastQ.id)
    setMsgs(base)
    void send(lastQ.content, base)
  }

  const suggestions = [t('ai.suggest1'), t('ai.suggest2'), t('ai.suggest3')]

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bgPage }} behavior="padding" keyboardVerticalOffset={headerHeight}>
      <Stack.Screen options={{ title: t('ai.tutor') }} />
      <FlatList
        ref={list}
        data={msgs}
        keyExtractor={m => String(m.id)}
        contentContainerStyle={{ padding: 16, gap: 12, flexGrow: 1 }}
        onContentSizeChange={() => list.current?.scrollToEnd({ animated: true })}
        ListEmptyComponent={
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingVertical: 32 }}>
            <View style={{ width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryLight }}>
              <Glyph name="sparkles" size={30} color={colors.primary} />
            </View>
            <Text style={{ fontFamily: fonts.bold, fontSize: 18, color: colors.textPrimary, textAlign: 'center' }}>{t('ai.hello')}</Text>
            <Text style={{ fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.textMuted, textAlign: 'center' }}>
              {title ? t('ai.contextLesson', { title }) : t('ai.contextGeneral')}
            </Text>
            <View style={{ gap: 8, alignSelf: 'stretch', marginTop: 8 }}>
              {suggestions.map(s => (
                <Pressable key={s} onPress={() => void send(s)} accessibilityRole="button"
                  style={({ pressed }) => ({ padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
                    backgroundColor: pressed ? colors.bgMuted : colors.bgSurface })}>
                  <Text style={{ fontFamily: fonts.medium, fontSize: 14, color: colors.textPrimary }}>{s}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        }
        renderItem={({ item: m }) => {
          const mine = m.role === 'user'
          return (
            <View style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '88%', paddingHorizontal: 14, paddingVertical: 10,
              borderRadius: 18, borderBottomRightRadius: mine ? 4 : 18, borderBottomLeftRadius: mine ? 18 : 4,
              backgroundColor: mine ? colors.primaryFill : m.failed ? colors.dangerLight : colors.bgSurface,
              borderWidth: mine ? 0 : 1, borderColor: colors.border }}>
              <Text selectable style={{ fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: mine ? colors.onPrimary : m.failed ? colors.danger : colors.textPrimary }}>
                {m.content}
              </Text>
              {m.failed && m.id === msgs[msgs.length - 1]?.id && !busy && (
                <Pressable onPress={retry} accessibilityRole="button" hitSlop={8}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 }}>
                  <Glyph name="refresh" size={16} color={colors.primary} />
                  <Text style={{ fontFamily: fonts.semibold, fontSize: 14, color: colors.primary }}>{t('common.tryAgain')}</Text>
                </Pressable>
              )}
            </View>
          )
        }}
        ListFooterComponent={busy ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 4 }}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={{ fontFamily: fonts.medium, fontSize: 13, color: colors.textMuted }}>{t('ai.thinking')}</Text>
          </View>
        ) : undefined}
      />
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 10,
        backgroundColor: colors.bgSurface, borderTopWidth: 1, borderTopColor: colors.border }}>
        <TextInput value={draft} onChangeText={setDraft} placeholder={t('ai.placeholder')} placeholderTextColor={colors.textMuted}
          accessibilityLabel={t('ai.placeholder')} multiline maxLength={4000}
          style={{ flex: 1, maxHeight: 120, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20, backgroundColor: colors.bgMuted,
            fontFamily: fonts.body, fontSize: 15, color: colors.textPrimary }} />
        <Pressable onPress={() => void send()} disabled={!draft.trim() || busy} accessibilityRole="button" accessibilityLabel={t('ai.send')}
          style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
            backgroundColor: draft.trim() && !busy ? colors.primaryFill : colors.bgMuted }}>
          <Glyph name="arrow-up" size={22} color={draft.trim() && !busy ? colors.onPrimary : colors.textMuted} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  )
}
