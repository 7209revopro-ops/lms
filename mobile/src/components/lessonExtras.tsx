import { useState } from 'react'
import { Alert, Pressable, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { clockLabel, type Thread } from '@shared'
import { useBookmarkMutations, useBookmarks, useComments, useQaMutations, useThreads, useTranscript } from '@/lib/api/engage'
import { useAuth } from '@/lib/auth'
import { errorText } from '@/lib/errors'
import { haptic } from '@/lib/haptics'
import { useTheme } from '@/theme'
import { NoteCard, type PlayerHandle } from './lesson'
import { Empty, Failed, Loading } from './states'
import { useToast } from './toast'
import { Avatar, Badge, Button, Card, Field, Glyph, IconButton, Segmented } from './ui'

/* Everything under a lesson the website has in its sidebar: the private
   note, video bookmarks (jump back to a moment), the lesson's Q&A with
   classmates and mentors, and the transcript. */

type Tab = 'notes' | 'bookmarks' | 'qa' | 'transcript'

export function LessonExtras({ lessonId, isVideo, player }: { lessonId: string; isVideo: boolean; player: () => PlayerHandle | null }) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<Tab>('notes')
  const tabs: { value: Tab; label: string }[] = [
    { value: 'notes', label: t('extras.notes') },
    ...(isVideo ? [{ value: 'bookmarks' as const, label: t('extras.bookmarks') }] : []),
    { value: 'qa', label: t('extras.qa') },
    ...(isVideo ? [{ value: 'transcript' as const, label: t('extras.transcript') }] : []),
  ]
  return (
    <View style={{ gap: 14 }}>
      <Segmented<Tab> value={tab} onChange={setTab} options={tabs} />
      {tab === 'notes' && <NoteCard key={lessonId} lessonId={lessonId} />}
      {tab === 'bookmarks' && <Bookmarks lessonId={lessonId} player={player} />}
      {tab === 'qa' && <Qa lessonId={lessonId} />}
      {tab === 'transcript' && <Transcript lessonId={lessonId} />}
    </View>
  )
}

function Bookmarks({ lessonId, player }: { lessonId: string; player: () => PlayerHandle | null }) {
  const { t } = useTranslation()
  const { colors, fonts, radius } = useTheme()
  const toast = useToast()
  const list = useBookmarks(lessonId)
  const { add, remove } = useBookmarkMutations(lessonId)
  const [label, setLabel] = useState('')

  const save = () => {
    const p = player()
    if (!p) return toast(t('extras.playFirst'), 'info')
    const at = p.time()
    add.mutate({ timeSecs: at, label }, {
      onSuccess: () => { setLabel(''); toast(t('extras.bookmarked', { time: clockLabel(at) })) },
      onError: e => toast(errorText(e), 'danger'),
    })
  }

  return (
    <View style={{ gap: 12 }}>
      <Card style={{ gap: 10 }}>
        <Field label={t('extras.bookmarkLabel')} placeholder={t('extras.bookmarkHint')} value={label} onChangeText={setLabel} maxLength={200} />
        <Button title={t('extras.addBookmark')} loading={add.isPending} onPress={save} />
      </Card>
      {list.isLoading ? <Loading />
        : list.error ? <Failed error={list.error} onRetry={() => void list.refetch()} />
        : !list.data?.length ? <Empty icon="bookmark-outline" title={t('extras.noBookmarks')} body={t('extras.noBookmarksBody')} />
        : list.data.map(b => (
          <Pressable key={b.id} accessibilityRole="button" accessibilityLabel={`${clockLabel(b.timeSecs)}${b.label ? `, ${b.label}` : ''}`}
            onPress={() => { haptic.tap(); player()?.seek(b.timeSecs) }}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: radius.md,
              backgroundColor: pressed ? colors.bgMuted : colors.bgSurface, borderWidth: 1, borderColor: colors.border })}>
            <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: colors.primaryLight }}>
              <Text style={{ fontFamily: fonts.bold, fontSize: 13, color: colors.primary, fontVariant: ['tabular-nums'] }}>{clockLabel(b.timeSecs)}</Text>
            </View>
            <Text numberOfLines={2} style={{ flex: 1, fontFamily: fonts.medium, fontSize: 14, color: b.label ? colors.textPrimary : colors.textMuted }}>
              {b.label || t('extras.untitled')}
            </Text>
            <IconButton icon="trash-outline" size={18} color={colors.textMuted} label={t('extras.deleteBookmark')} onPress={() => remove.mutate(b.id)} />
          </Pressable>
        ))}
    </View>
  )
}

function Qa({ lessonId }: { lessonId: string }) {
  const { t } = useTranslation()
  const { colors, fonts } = useTheme()
  const toast = useToast()
  const list = useThreads(lessonId)
  const m = useQaMutations(lessonId)
  const [asking, setAsking] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')

  const ask = () => m.ask.mutate({ title: title.trim() || undefined, body: body.trim() }, {
    onSuccess: () => { setAsking(false); setTitle(''); setBody(''); toast(t('qa.posted')) },
    onError: e => toast(errorText(e), 'danger'),
  })

  return (
    <View style={{ gap: 12 }}>
      {asking ? (
        <Card style={{ gap: 10 }}>
          <Field label={t('qa.titleLabel')} placeholder={t('qa.titleHint')} value={title} onChangeText={setTitle} maxLength={255} />
          <Field label={t('qa.question')} value={body} onChangeText={setBody} maxLength={10000} multiline textAlignVertical="top" style={{ minHeight: 90 }} autoFocus />
          <Button title={t('qa.post')} disabled={!body.trim()} loading={m.ask.isPending} onPress={ask} />
          <Button variant="ghost" title={t('common.back')} onPress={() => setAsking(false)} />
        </Card>
      ) : (
        <Button variant="ghost" title={t('qa.ask')} onPress={() => setAsking(true)} />
      )}
      {list.isLoading ? <Loading />
        : list.error ? <Failed error={list.error} onRetry={() => void list.refetch()} />
        : !list.data?.length ? <Empty icon="chatbubbles-outline" title={t('qa.none')} body={t('qa.noneBody')} />
        : list.data.map(th => <ThreadCard key={th.id} th={th} lessonId={lessonId} />)}
      <Text style={{ fontFamily: fonts.body, fontSize: 12, color: colors.textMuted, textAlign: 'center' }}>{t('qa.public')}</Text>
    </View>
  )
}

function ThreadCard({ th, lessonId }: { th: Thread; lessonId: string }) {
  const { t } = useTranslation()
  const { colors, fonts } = useTheme()
  const toast = useToast()
  const { state } = useAuth()
  const me = state.status === 'signedIn' ? state.user.id : ''
  const mine = th.author?.id === me
  const m = useQaMutations(lessonId)
  const [open, setOpen] = useState(false)
  const [reply, setReply] = useState('')
  const comments = useComments(open ? th.id : undefined)

  const send = () => m.reply.mutate({ threadId: th.id, body: reply.trim() }, {
    onSuccess: () => setReply(''),
    onError: e => toast(errorText(e), 'danger'),
  })

  return (
    <Card style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Avatar name={th.author?.name ?? '?'} uri={th.author?.avatarUrl} size={32} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: fonts.semibold, fontSize: 14, color: colors.textPrimary }}>{th.author?.name ?? '—'}</Text>
          <Text style={{ fontFamily: fonts.body, fontSize: 11, color: colors.textMuted }}>{new Date(th.createdAt).toLocaleDateString()}</Text>
        </View>
        {th.isPinned && <Badge label={t('qa.pinned')} tone="primary" icon="pin" />}
        {th.isResolved && <Badge label={t('qa.resolved')} tone="success" icon="checkmark-circle" />}
      </View>
      {!!th.title && <Text style={{ fontFamily: fonts.bold, fontSize: 15, color: colors.textPrimary }}>{th.title}</Text>}
      <Text style={{ fontFamily: fonts.body, fontSize: 14, lineHeight: 21, color: colors.textSecondary }}>{th.body}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
        <Small icon="arrow-up-circle-outline" label={String(th.upvoteCount)} a11y={t('qa.upvote')} onPress={() => { haptic.tap(); m.upvote.mutate(th.id) }} />
        <Small icon="chatbubble-outline" label={t('qa.replies', { count: th.commentCount })} a11y={t('qa.showReplies')} onPress={() => setOpen(o => !o)} />
        {mine && <Small icon={th.isResolved ? 'refresh-outline' : 'checkmark-done-outline'} label={th.isResolved ? t('qa.reopen') : t('qa.markResolved')}
          onPress={() => m.resolve.mutate({ threadId: th.id, isResolved: !th.isResolved })} />}
        {mine && <Small icon="trash-outline" a11y={t('qa.delete')} onPress={() => Alert.alert(t('qa.deleteTitle'), undefined, [
          { text: t('common.back'), style: 'cancel' },
          { text: t('qa.delete'), style: 'destructive', onPress: () => m.remove.mutate(th.id) },
        ])} />}
      </View>
      {open && (
        <View style={{ gap: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border }}>
          {comments.isLoading ? <Loading />
            : (comments.data ?? []).map(c => (
              <View key={c.id} style={{ flexDirection: 'row', gap: 8 }}>
                <Avatar name={c.author?.name ?? '?'} uri={c.author?.avatarUrl} size={26} />
                <View style={{ flex: 1, gap: 2 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <Text style={{ fontFamily: fonts.semibold, fontSize: 13, color: colors.textPrimary }}>{c.author?.name ?? '—'}</Text>
                    {c.isInstructorAnswer && <Badge label={t('qa.mentorAnswer')} tone="success" />}
                  </View>
                  <Text style={{ fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.textSecondary }}>{c.body}</Text>
                  <Small icon="arrow-up-circle-outline" label={String(c.upvoteCount)} a11y={t('qa.upvote')}
                    onPress={() => m.upvoteComment.mutate({ threadId: th.id, commentId: c.id })} />
                </View>
              </View>
            ))}
          <Field label={t('qa.reply')} value={reply} onChangeText={setReply} maxLength={10000} multiline />
          <Button title={t('qa.send')} disabled={!reply.trim()} loading={m.reply.isPending} onPress={send} />
        </View>
      )}
    </Card>
  )
}

function Small({ icon, label, a11y, onPress }: { icon: React.ComponentProps<typeof Glyph>['name']; label?: string; a11y?: string; onPress: () => void }) {
  const { colors, fonts } = useTheme()
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={a11y ? `${a11y}${label ? `, ${label}` : ''}` : label} hitSlop={8}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <Glyph name={icon} size={17} color={colors.textMuted} />
      {!!label && <Text style={{ fontFamily: fonts.medium, fontSize: 12, color: colors.textMuted }}>{label}</Text>}
    </Pressable>
  )
}

function Transcript({ lessonId }: { lessonId: string }) {
  const { t } = useTranslation()
  const { colors, fonts } = useTheme()
  const tr = useTranscript(lessonId)
  if (tr.isLoading) return <Loading />
  if (tr.error) return <Failed error={tr.error} onRetry={() => void tr.refetch()} />
  if (!tr.data?.trim()) return <Empty icon="document-text-outline" title={t('extras.noTranscript')} />
  return (
    <Card style={{ gap: 12 }}>
      {tr.data.split(/\n\s*\n/).map((para, i) => (
        <Text key={i} selectable style={{ fontFamily: fonts.body, fontSize: 15, lineHeight: 23, color: colors.textSecondary }}>{para.trim()}</Text>
      ))}
    </Card>
  )
}
