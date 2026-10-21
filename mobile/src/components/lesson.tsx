import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Image, StyleSheet, Text, TextInput, View } from 'react-native'
import { useEventListener } from 'expo'
import { useVideoPlayer, VideoView, type VideoPlayer } from 'expo-video'
import * as WebBrowser from 'expo-web-browser'
import { useTranslation } from 'react-i18next'
import { clock, resourceKind, resumeAt, savedPosition, watchTick, type LessonOutline, type WatchMark } from '@shared'
import { reportWatchTime, useLessonPlayUrl, useLessonProgress, useMyNote, useSaveNote } from '@/lib/api/learning'
import { errorText } from '@/lib/errors'
import { Watermark } from './protected'
import { Button, Notice } from './ui'
import { Failed } from './states'
import { useTheme } from '@/theme'

/* ── Video ──────────────────────────────────────────────────────
   The address is a short-lived signed URL asked for just before playback
   (GET /lessons/:id/play-url — enrolment and module locks are checked there).
   Resumes where the student stopped, reports watched time as the website
   does, and carries the email watermark. */

export function LessonVideo({ lesson }: { lesson: LessonOutline }) {
  const { t } = useTranslation()
  const play = useLessonPlayUrl(lesson.id, !!lesson.hasVideo)
  const saved = useLessonProgress(lesson.id, !!lesson.hasVideo)

  if (!lesson.hasVideo) return <VideoBox><Text style={styles.onBlack}>{t('lesson.noVideo')}</Text></VideoBox>
  if (play.error) return <VideoBox><Text style={styles.onBlack}>{errorText(play.error)}</Text></VideoBox>
  /* Wait for the saved position too, so the first frame is already the
     right one instead of jumping a second after it starts. */
  if (!play.data || saved.isLoading) return <VideoBox><ActivityIndicator color="#fff" /></VideoBox>
  return <Player lessonId={lesson.id} url={play.data.url} savedSecs={savedPosition(saved.data)} />
}

function Player({ lessonId, url, savedSecs }: { lessonId: string; url: string; savedSecs: number }) {
  const { t } = useTranslation()
  const { fonts } = useTheme()
  const player = useVideoPlayer(url, p => { p.timeUpdateEventInterval = 1 })
  const [failed, setFailed] = useState(false)
  const [resumedFrom, setResumedFrom] = useState(0)
  const watch = useRef<WatchMark>({ mark: 0, last: 0 })

  useEventListener(player, 'sourceLoad', ({ duration }) => {
    const at = resumeAt(savedSecs, duration)
    if (at > 0) {
      seek(player, at)
      setResumedFrom(at)
    }
    watch.current = { mark: at, last: at }
  })
  useEventListener(player, 'statusChange', ({ status }) => setFailed(status === 'error'))
  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    const { report, state } = watchTick(watch.current, currentTime)
    watch.current = state
    if (report) reportWatchTime(lessonId, report, currentTime)
  })

  /* Leaving the lesson reports the seconds played since the last report,
     which the website loses (up to 14 s every time). */
  useEffect(() => () => {
    const { mark, last } = watch.current
    if (last - mark >= 1) reportWatchTime(lessonId, last - mark, last)
  }, [lessonId])

  /* The resume hint fades after a few seconds. */
  useEffect(() => {
    if (!resumedFrom) return
    const id = setTimeout(() => setResumedFrom(0), 4000)
    return () => clearTimeout(id)
  }, [resumedFrom])

  return (
    <VideoBox>
      <VideoView player={player} style={StyleSheet.absoluteFill} nativeControls contentFit="contain"
        fullscreenOptions={{ enable: true }} allowsPictureInPicture={false} />
      <Watermark />
      {failed && <Text style={[styles.onBlack, styles.center]}>{t('lesson.videoFailed')}</Text>}
      {resumedFrom > 0 && (
        <Text pointerEvents="none" style={{
          position: 'absolute', left: 10, top: 10, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999,
          backgroundColor: 'rgba(13,15,26,0.72)', color: '#fff', fontFamily: fonts.semibold, fontSize: 11, overflow: 'hidden',
        }}>
          {t('lesson.resuming', { at: clock(resumedFrom) })}
        </Text>
      )}
    </VideoBox>
  )
}


/* The player is a native object driven by commands; seeking is one of them,
   not React state (so it lives outside the component). */
function seek(player: VideoPlayer, secs: number): void {
  player.currentTime = secs
}
function VideoBox({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
      {children}
    </View>
  )
}

/* ── Article ────────────────────────────────────────────────────
   The body is plain text (never HTML, as on the website). A PDF or link opens
   in the in-app browser; an image shows inline. */

export function ArticleView({ lesson }: { lesson: LessonOutline }) {
  const { t } = useTranslation()
  const { colors, fonts, radius } = useTheme()
  const body = lesson.contentBody?.trim()
  const url = lesson.contentUrl?.trim()
  const kind = resourceKind(url)

  if (!body && kind === 'none') return <View style={{ padding: 16 }}><Notice tone="info">{t('lesson.emptyArticle')}</Notice></View>

  return (
    <View style={{ padding: 16, gap: 14 }}>
      {!!body && (
        <View style={{ backgroundColor: colors.bgSurface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.lg, padding: 16 }}>
          <Text style={{ fontFamily: fonts.body, fontSize: 16, lineHeight: 25, color: colors.textPrimary }}>{body}</Text>
        </View>
      )}
      {kind === 'image' && (
        <Image source={{ uri: url }} accessibilityLabel={lesson.title} resizeMode="contain"
          style={{ width: '100%', aspectRatio: 4 / 3, borderRadius: radius.lg, backgroundColor: colors.bgMuted }} />
      )}
      {kind !== 'none' && (
        <Button variant={body ? 'ghost' : 'primary'}
          title={kind === 'pdf' ? t('lesson.openPdf') : kind === 'image' ? t('lesson.openImage') : t('lesson.openLink')}
          onPress={() => void WebBrowser.openBrowserAsync(url!)} />
      )}
    </View>
  )
}

/* ── Note ───────────────────────────────────────────────────────
   One private note per lesson (PUT/DELETE /lessons/:id/my-note). Emptying it
   deletes it. */

export function NoteCard({ lessonId }: { lessonId: string }) {
  const { t } = useTranslation()
  const { colors, fonts, radius } = useTheme()
  const note = useMyNote(lessonId)
  const save = useSaveNote(lessonId)
  const [draft, setDraft] = useState<string | null>(null)
  const stored = note.data?.body ?? ''
  const text = draft ?? stored
  const dirty = draft !== null && draft !== stored

  /* The saved note could not be read: an empty, editable box here would let
     a save overwrite it. Offer a retry instead. */
  if (note.error && !note.data) {
    return (
      <View style={{ backgroundColor: colors.bgSurface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.lg, padding: 14, gap: 4 }}>
        <Text style={{ fontFamily: fonts.semibold, fontSize: 15, color: colors.textPrimary }}>{t('notes.title')}</Text>
        <Failed error={note.error} onRetry={() => void note.refetch()} />
      </View>
    )
  }

  return (
    <View style={{ backgroundColor: colors.bgSurface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.lg, padding: 14, gap: 10 }}>
      <Text style={{ fontFamily: fonts.semibold, fontSize: 15, color: colors.textPrimary }}>{t('notes.title')}</Text>
      <TextInput
        value={text} onChangeText={setDraft} multiline maxLength={50_000}
        placeholder={t('notes.placeholder')} placeholderTextColor={colors.textMuted}
        accessibilityLabel={t('notes.title')} editable={!note.isLoading}
        style={{
          minHeight: 96, textAlignVertical: 'top', fontFamily: fonts.body, fontSize: 15, color: colors.textPrimary,
          backgroundColor: colors.bgPage, borderRadius: radius.md, borderColor: colors.border, borderWidth: 1, padding: 12,
        }} />
      {save.error && <Notice>{t('notes.failed')}</Notice>}
      {(dirty || save.isPending) && (
        <Button title={t('notes.save')} loading={save.isPending}
          onPress={() => save.mutate(text, { onSuccess: () => setDraft(null) })} />
      )}
      {!dirty && save.isSuccess && <Text style={{ fontFamily: fonts.medium, fontSize: 13, color: colors.success }}>{t('notes.saved')}</Text>}
    </View>
  )
}

const styles = StyleSheet.create({
  onBlack: { color: 'rgba(255,255,255,0.7)', fontSize: 14, textAlign: 'center', paddingHorizontal: 24 },
  center: { position: 'absolute', alignSelf: 'center' },
})
