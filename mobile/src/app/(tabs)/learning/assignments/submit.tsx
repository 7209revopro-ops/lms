import { useRef, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import * as DocumentPicker from 'expo-document-picker'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useTranslation } from 'react-i18next'
import { ASSIGNMENT_MAX_FILES, ASSIGNMENT_MIME, fileProblem, type AssignmentFile } from '@shared'
import {
  uploadFile, useMyAssignments, useResubmitAssignment, useSubmittableClasses, useSubmitAssignment, type PickedFile,
} from '@/lib/api/assignments'
import { errorText } from '@/lib/errors'
import { fmtWhen } from '@/components/classes'
import { Body, Button, Field, Notice, Screen, Glyph } from '@/components/ui'
import { Failed, Loading } from '@/components/states'
import { useTheme } from '@/theme'

/* Submit a class assignment — or, with ?id=, a revision of one that was sent
   back. Files are checked on the phone first (type, 10 MB, count), uploaded
   one by one, then submitted. A retry after a failed upload does not upload
   the files that already went through. */
export default function SubmitAssignment() {
  const { id } = useLocalSearchParams<{ id?: string }>()
  const { t } = useTranslation()
  const { colors, fonts, radius } = useTheme()
  const revising = !!id
  const classes = useSubmittableClasses()
  const mine = useMyAssignments()
  const original = revising ? mine.data?.find(a => a.id === id) : undefined
  const submit = useSubmitAssignment()
  const resubmit = useResubmitAssignment()

  const [classId, setClassId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [files, setFiles] = useState<PickedFile[]>([])
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const uploaded = useRef(new Map<string, AssignmentFile>())

  const pick = async () => {
    setProblem(null)
    const res = await DocumentPicker.getDocumentAsync({ type: [...ASSIGNMENT_MIME], multiple: true, copyToCacheDirectory: true })
    if (res.canceled) return
    const next = [...files]
    for (const a of res.assets) {
      const issue = fileProblem({ mimeType: a.mimeType, size: a.size })
      if (issue) { setProblem(t(issue === 'type' ? 'assignments.badType' : 'assignments.tooBig', { name: a.name })); continue }
      if (next.length >= ASSIGNMENT_MAX_FILES) { setProblem(t('assignments.tooMany', { max: ASSIGNMENT_MAX_FILES })); break }
      if (!next.some(f => f.uri === a.uri)) next.push({ uri: a.uri, name: a.name, mimeType: a.mimeType!, size: a.size })
    }
    setFiles(next)
  }

  const send = async () => {
    if (!revising && !classId) return setProblem(t('assignments.needClass'))
    if (!revising && title.trim().length < 3) return setProblem(t('assignments.needTitle'))
    if (files.length === 0) return setProblem(t('assignments.needFile'))
    setProblem(null)
    try {
      const refs: AssignmentFile[] = []
      for (const [i, f] of files.entries()) {
        setBusy(t('assignments.uploading', { n: i + 1, total: files.length }))
        let ref = uploaded.current.get(f.uri)
        if (!ref) {
          ref = await uploadFile(f)
          uploaded.current.set(f.uri, ref)
        }
        refs.push(ref)
      }
      setBusy(t('assignments.send'))
      const body = { note: note.trim() || undefined, files: refs }
      if (revising) await resubmit.mutateAsync({ id: id!, ...body })
      else await submit.mutateAsync({ liveClassId: classId!, title: title.trim(), ...body })
      router.back()
    } catch (err) {
      setProblem(errorText(err))
    } finally {
      setBusy(null)
    }
  }

  if (!revising && classes.isLoading) return <Loading />
  if (!revising && classes.error) return <Failed error={classes.error} onRetry={() => void classes.refetch()} />
  if (revising && mine.isLoading) return <Loading />

  const options = classes.data ?? []

  return (
    <Screen>
      {revising ? (
        <View style={{ gap: 6 }}>
          <Text style={{ fontFamily: fonts.bold, fontSize: 18, color: colors.textPrimary }}>{original?.title}</Text>
          {!!original?.lastReason && <Notice tone="info">{t('assignments.reason', { reason: original.lastReason })}</Notice>}
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          <Text style={{ fontFamily: fonts.medium, fontSize: 13, color: colors.textSecondary }}>{t('assignments.pickClass')}</Text>
          {options.length === 0 && <Body muted>{t('assignments.noClasses')}</Body>}
          <View accessibilityRole="radiogroup" style={{ gap: 8 }}>
            {options.map(c => {
              const on = classId === c.id
              return (
                <Pressable key={c.id} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => setClassId(c.id)}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: radius.md, borderWidth: 1.5,
                    borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primaryLight : colors.bgSurface,
                  }}>
                  <Glyph name={on ? 'radio-button-on' : 'radio-button-off'} size={20} color={on ? colors.primary : colors.textMuted} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ fontFamily: fonts.semibold, fontSize: 15, color: colors.textPrimary }}>{c.title}</Text>
                    <Text style={{ fontFamily: fonts.body, fontSize: 12, color: colors.textMuted }}>
                      {[c.scheduledStart ? fmtWhen(c.scheduledStart) : null, c.course?.title].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                </Pressable>
              )
            })}
          </View>
        </View>
      )}

      {!revising && (
        <Field label={t('assignments.titleLabel')} value={title} onChangeText={setTitle} maxLength={200}
          placeholder={t('assignments.titleHint')} returnKeyType="next" />
      )}
      <Field label={t('assignments.noteLabel')} value={note} onChangeText={setNote} maxLength={5000}
        multiline style={{ minHeight: 90, textAlignVertical: 'top' }} />

      <View style={{ gap: 8 }}>
        {files.map(f => (
          <View key={f.uri} style={{
            flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: radius.md,
            backgroundColor: colors.bgSurface, borderColor: colors.border, borderWidth: 1,
          }}>
            <Ionicons name={f.mimeType === 'application/pdf' ? 'document-outline' : 'image-outline'} size={20} color={colors.primary} />
            <Text numberOfLines={1} style={{ flex: 1, fontFamily: fonts.body, fontSize: 14, color: colors.textPrimary }}>{f.name}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={`${t('assignments.remove')} ${f.name}`} hitSlop={10} disabled={!!busy}
              onPress={() => { setFiles(files.filter(x => x.uri !== f.uri)); uploaded.current.delete(f.uri) }}>
              <Ionicons name="close-circle" size={20} color={colors.textMuted} />
            </Pressable>
          </View>
        ))}
        {files.length < ASSIGNMENT_MAX_FILES && <Button variant="ghost" title={t('assignments.addFile')} onPress={() => void pick()} disabled={!!busy} />}
        <Body muted>{t('assignments.fileHelp', { max: ASSIGNMENT_MAX_FILES })}</Body>
      </View>

      {problem && <Notice>{problem}</Notice>}
      {busy && <Body muted>{busy}</Body>}
      <Button title={revising ? t('assignments.resubmit') : t('assignments.send')} loading={!!busy} onPress={() => void send()}
        disabled={!revising && options.length === 0} />
    </Screen>
  )
}
