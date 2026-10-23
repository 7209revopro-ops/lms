import { useState } from 'react'
import { Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { LiveClass, MyBooking } from '@shared'
import { submitHomework, useHomework, useMyFeedback, useSendFeedback } from '@/lib/api/engage'
import { errorText } from '@/lib/errors'
import { useTheme } from '@/theme'
import { StarInput, Stars } from './catalog'
import { useToast } from './toast'
import { Badge, Button, Card, Field, Glyph } from './ui'

/* Under a class: the session's homework (the website's SessionHomework —
   answered with text or a link) and, once it has ended and the student was
   there, "Rate this session" (the website's SessionFeedback). */
export function ClassExtras({ lc, booking, ended }: { lc: LiveClass; booking?: MyBooking; ended: boolean }) {
  const held = booking && booking.status !== 'cancelled'
  return (
    <View style={{ gap: 16 }}>
      {held && <Homework classId={lc.id} />}
      {ended && booking?.status === 'attended' && <RateSession classId={lc.id} />}
    </View>
  )
}

function Homework({ classId }: { classId: string }) {
  const { t } = useTranslation()
  const { colors, fonts } = useTheme()
  const list = useHomework(classId)
  if (!list.data?.length) return null
  return (
    <View style={{ gap: 10 }}>
      <Text accessibilityRole="header" style={{ fontFamily: fonts.bold, fontSize: 17, color: colors.textPrimary }}>{t('homework.title')}</Text>
      {list.data.map(h => <HomeworkCard key={h.id} id={h.id} title={h.title} description={h.description} dueDate={h.dueDate} />)}
    </View>
  )
}

function HomeworkCard({ id, title, description, dueDate }: { id: string; title: string; description: string; dueDate?: string }) {
  const { t } = useTranslation()
  const { colors, fonts } = useTheme()
  const toast = useToast()
  const [text, setText] = useState('')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [now] = useState(Date.now)
  const overdue = !!dueDate && new Date(dueDate).getTime() < now
  const urlOk = !url.trim() || /^https?:\/\/\S+\.\S+/.test(url.trim())

  const send = async () => {
    setBusy(true)
    try {
      await submitHomework(id, { submissionText: text.trim() || undefined, submissionUrl: url.trim() || undefined })
      setSent(true)
      toast(t('homework.sent'))
    } catch (e) {
      toast(errorText(e), 'danger')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Glyph name="clipboard-outline" size={18} color={colors.primary} />
        <Text style={{ flex: 1, fontFamily: fonts.semibold, fontSize: 15, color: colors.textPrimary }}>{title}</Text>
        {sent ? <Badge label={t('homework.submitted')} tone="success" /> : dueDate && <Badge label={t('homework.due', { date: new Date(dueDate).toLocaleDateString() })} tone={overdue ? 'danger' : 'warning'} />}
      </View>
      {!!description && <Text style={{ fontFamily: fonts.body, fontSize: 14, lineHeight: 21, color: colors.textSecondary }}>{description}</Text>}
      {!sent && <>
        <Field label={t('homework.answer')} value={text} onChangeText={setText} maxLength={10000} multiline textAlignVertical="top" style={{ minHeight: 80 }} />
        <Field label={t('homework.link')} placeholder="https://" value={url} onChangeText={setUrl} autoCapitalize="none" keyboardType="url" invalid={!urlOk} />
        <Button title={t('homework.submit')} disabled={(!text.trim() && !url.trim()) || !urlOk} loading={busy} onPress={() => void send()} />
      </>}
    </Card>
  )
}

function RateSession({ classId }: { classId: string }) {
  const { t } = useTranslation()
  const { colors, fonts } = useTheme()
  const toast = useToast()
  const mine = useMyFeedback()
  const send = useSendFeedback()
  const existing = mine.data?.find(f => f.liveClassId === classId)
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState('')
  const [editing, setEditing] = useState(false)

  if (mine.isLoading) return null
  if (existing && !editing) {
    return (
      <Card style={{ gap: 8 }}>
        <Text style={{ fontFamily: fonts.semibold, fontSize: 15, color: colors.textPrimary }}>{t('feedback.yours')}</Text>
        <Stars value={existing.rating} size={14} />
        {!!existing.comment && <Text style={{ fontFamily: fonts.body, fontSize: 14, color: colors.textSecondary }}>{existing.comment}</Text>}
        <Button variant="ghost" title={t('feedback.edit')} onPress={() => { setRating(existing.rating); setComment(existing.comment ?? ''); setEditing(true) }} />
      </Card>
    )
  }
  return (
    <Card style={{ gap: 12 }}>
      <Text accessibilityRole="header" style={{ fontFamily: fonts.bold, fontSize: 16, color: colors.textPrimary }}>{t('feedback.title')}</Text>
      <StarInput value={rating} onChange={setRating} />
      <Field label={t('feedback.comment')} value={comment} onChangeText={setComment} maxLength={1000} multiline textAlignVertical="top" style={{ minHeight: 72 }} />
      <Button title={t('feedback.send')} disabled={!rating} loading={send.isPending}
        onPress={() => send.mutate({ liveClassId: classId, rating, comment: comment.trim() || undefined }, {
          onSuccess: () => { setEditing(false); toast(t('feedback.thanks')) },
          onError: e => toast(errorText(e), 'danger'),
        })} />
    </Card>
  )
}
