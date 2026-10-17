import { useState } from 'react'
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { SUPPORT_CATEGORIES, useCreateTicket, type SupportCategory } from '@/lib/api/support'
import { errorText } from '@/lib/errors'
import { Select } from '@/components/form'
import { Button, Field, Notice, Screen } from '@/components/ui'

/* A new support request: topic, subject, first message (the server's limits:
   subject 3–200, message 1–5000). */
export default function NewTicket() {
  const { t } = useTranslation()
  const create = useCreateTicket()
  const [category, setCategory] = useState<SupportCategory>('account')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const ready = subject.trim().length >= 3 && message.trim().length >= 1

  const send = () => create.mutate({ category, subject: subject.trim(), message: message.trim() }, {
    onSuccess: tk => router.replace({ pathname: '/profile/support/[id]', params: { id: tk.id, subject: tk.subject } }),
  })

  return (
    <Screen>
      <Select label={t('support.category')} value={category} onChange={v => setCategory(v as SupportCategory)}
        options={SUPPORT_CATEGORIES.map(c => ({ value: c, label: t(`support.categories.${c}`) }))} />
      <Field label={t('support.subject')} value={subject} onChangeText={setSubject} maxLength={200} />
      <Field label={t('support.message')} value={message} onChangeText={setMessage} maxLength={5000} multiline
        style={{ minHeight: 140, textAlignVertical: 'top' }} />
      {create.error && <Notice>{errorText(create.error)}</Notice>}
      <Button title={t('support.send')} loading={create.isPending} disabled={!ready} onPress={send} />
    </Screen>
  )
}
