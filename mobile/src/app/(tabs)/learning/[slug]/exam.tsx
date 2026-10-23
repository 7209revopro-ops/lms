import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, AppState, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { Stack, router, useLocalSearchParams, usePreventRemove } from 'expo-router'
import { addScreenshotListener } from 'expo-screen-capture'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { countdown, problemOf, type ExamQuestion, type ExamStart } from '@shared'
import { engageKeys, exam, useExamInfo, useExamResult } from '@/lib/api/engage'
import { errorText } from '@/lib/errors'
import { haptic } from '@/lib/haptics'
import { useContentGuard } from '@/components/protected'
import { Badge, Body, Button, Card, Glyph, Notice, Screen, Title } from '@/components/ui'
import { Empty, Failed, Loading } from '@/components/states'
import { useTheme } from '@/theme'

/* ─────────────────────────────────────────────────────────────
   Course exam — the website's exam/[courseId] page. One attempt; the clock
   runs on the server from the moment it starts (leaving does not pause it).
   Answers save as the student goes (0.7 s after the last change) and all at
   once before submitting; at zero the attempt submits itself. Proctoring is
   the exam's own: leaving the app and taking a screenshot are logged when the
   exam asks for it, and the server decides when an attempt is suspended.
───────────────────────────────────────────────────────────── */
export default function Exam() {
  const { courseId } = useLocalSearchParams<{ slug: string; courseId: string }>()
  const { t } = useTranslation()
  const info = useExamInfo(courseId)
  const qc = useQueryClient()
  const [session, setSession] = useState<ExamStart | null>(null)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)

  const status = info.data?.attempt.status
  const done = status === 'submitted' || status === 'suspended'
  const finish = useCallback(() => { setSession(null); void qc.invalidateQueries({ queryKey: engageKeys.exam(courseId ?? '') }) }, [qc, courseId])

  const start = async () => {
    if (!info.data) return
    setStarting(true); setStartError(null)
    try {
      setSession(await exam.start(info.data.exam.id))
    } catch (e) {
      const p = problemOf(e)
      if (p.kind === 'refused' && p.status === 409) finish()
      else setStartError(errorText(e))
    } finally {
      setStarting(false)
    }
  }

  if (info.isLoading) return <Loading />
  if (info.error) return <Failed error={info.error} onRetry={() => void info.refetch()} />
  if (!info.data) return <Screen><Empty icon="ribbon-outline" title={t('exam.none')} /></Screen>

  const e = info.data.exam
  if (session) return <Attempt examId={e.id} session={session} antiCheat={e.antiCheat} maxViolations={e.maxViolations} onDone={finish} />
  if (done) return <Result examId={e.id} title={e.title} />

  const confirmStart = () => Alert.alert(t('exam.startTitle'), t('exam.startBody', { mins: e.durationMinutes }), [
    { text: t('common.back'), style: 'cancel' },
    { text: status === 'in_progress' ? t('exam.resume') : t('exam.take'), onPress: () => void start() },
  ])

  return (
    <Screen>
      <Stack.Screen options={{ title: t('exam.title') }} />
      <Title>{e.title}</Title>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Badge label={t('exam.questions', { count: e.questionCount })} icon="help-circle-outline" tone="muted" />
        <Badge label={t('exam.minutes', { count: e.durationMinutes })} icon="time-outline" tone="muted" />
        {status === 'in_progress' && info.data.attempt.timeRemainingMs != null && (
          <Badge label={t('exam.left', { time: countdown(info.data.attempt.timeRemainingMs) })} tone="warning" />
        )}
      </View>
      {!!e.instructions && <Body>{e.instructions}</Body>}
      <Card style={{ gap: 8 }}>
        <RulesTitle text={t('exam.rulesTitle')} />
        <Rule text={t('exam.ruleOnce')} />
        <Rule text={t('exam.ruleClock')} />
        {e.antiCheat.tabSwitchSuspend && <Rule text={t('exam.ruleLeave', { count: e.maxViolations })} warn />}
        {e.antiCheat.screenshotSuspend && <Rule text={t('exam.ruleScreenshot')} warn />}
      </Card>
      {startError && <Notice>{startError}</Notice>}
      <Button title={status === 'in_progress' ? t('exam.resume') : t('exam.take')} loading={starting} onPress={confirmStart} />
    </Screen>
  )
}

function RulesTitle({ text }: { text: string }) {
  const { colors, fonts } = useTheme()
  return <Text accessibilityRole="header" style={{ fontFamily: fonts.semibold, fontSize: 15, color: colors.textPrimary }}>{text}</Text>
}

function Rule({ text, warn }: { text: string; warn?: boolean }) {
  const { colors, fonts } = useTheme()
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      <Glyph name={warn ? 'warning-outline' : 'checkmark-circle-outline'} size={16} color={warn ? colors.warning : colors.success} />
      <Text style={{ flex: 1, fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.textSecondary }}>{text}</Text>
    </View>
  )
}

function Attempt({ examId, session, antiCheat, maxViolations, onDone }: {
  examId: string; session: ExamStart; antiCheat: { screenshotSuspend: boolean; tabSwitchSuspend: boolean }; maxViolations: number; onDone: () => void
}) {
  const { t } = useTranslation()
  const { colors, fonts, radius } = useTheme()
  useContentGuard()
  const [answers, setAnswers] = useState<Record<string, string>>(session.answers ?? {})
  /* Read by submit — a ref, so the clock's effect is not torn down on every keystroke. */
  const answersRef = useRef(answers)
  useEffect(() => { answersRef.current = answers }, [answers])
  const [left, setLeft] = useState(session.timeRemainingMs)
  const [violations, setViolations] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  /* Set once mounted (reading the clock during render is not allowed). */
  const deadline = useRef(Number.POSITIVE_INFINITY)
  const startMs = session.timeRemainingMs
  useEffect(() => { deadline.current = Date.now() + startMs }, [startMs])
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const finished = useRef(false)
  const questions = [...session.questions].sort((a, b) => a.order - b.order)

  const save = useCallback(async (qid: string, value: string) => {
    try {
      const r = await exam.answer(examId, qid, value)
      deadline.current = Date.now() + r.timeRemainingMs
    } catch { /* the full save before submitting catches anything missed */ }
  }, [examId])

  const submit = useCallback(async (auto = false) => {
    if (finished.current) return
    finished.current = true
    setSubmitting(true)
    Object.values(timers.current).forEach(clearTimeout)
    try {
      await Promise.all(Object.entries(answersRef.current).map(([q, a]) => exam.answer(examId, q, a).catch(() => null)))
      await exam.submit(examId)
      haptic.success()
      if (auto) Alert.alert(t('exam.timeUp'))
    } catch { /* time-up or suspended: the server already closed it */ }
    onDone()
  }, [examId, onDone, t])

  /* The clock: local ticks, re-synced with the server every 25 s. */
  useEffect(() => {
    const tick = setInterval(() => {
      const ms = deadline.current - Date.now()
      setLeft(ms)
      if (ms <= 0) void submit(true)
    }, 1000)
    const sync = setInterval(() => {
      void exam.status(examId).then(s => {
        if (s.status !== 'in_progress') { finished.current = true; onDone(); return }
        if (s.timeRemainingMs != null) deadline.current = Date.now() + s.timeRemainingMs
      }).catch(() => {})
    }, 25_000)
    return () => { clearInterval(tick); clearInterval(sync) }
  }, [examId, onDone, submit])

  /* Proctoring, as the exam asks. */
  const report = useCallback(async (event: string) => {
    try {
      const r = await exam.log(examId, event)
      setViolations(r.violations)
      if (r.suspended) { finished.current = true; haptic.warning(); onDone() }
    } catch { /* logging never blocks the student */ }
  }, [examId, onDone])
  useEffect(() => {
    const subs: { remove: () => void }[] = []
    if (antiCheat.tabSwitchSuspend) {
      subs.push(AppState.addEventListener('change', s => { if (s === 'background') void report('visibility_hidden') }))
    }
    if (antiCheat.screenshotSuspend) subs.push(addScreenshotListener(() => void report('screenshot')))
    return () => subs.forEach(s => s.remove())
  }, [antiCheat, report])

  /* Leaving the screen does not stop the clock — say so first. */
  const [guarding, setGuarding] = useState(true)
  usePreventRemove(guarding, ({ repeat }) => {
    Alert.alert(t('exam.leaveTitle'), t('exam.leaveBody'), [
      { text: t('exam.stay'), style: 'cancel' },
      { text: t('exam.leave'), style: 'destructive', onPress: () => { setGuarding(false); repeat() } },
    ])
  })

  const setAnswer = (q: ExamQuestion, value: string) => {
    setAnswers(a => ({ ...a, [q.id]: value }))
    clearTimeout(timers.current[q.id])
    timers.current[q.id] = setTimeout(() => void save(q.id, value), 700)
  }

  const answered = questions.filter(q => (answers[q.id] ?? '').trim()).length
  const confirmSubmit = () => Alert.alert(
    t('exam.submitTitle'),
    answered < questions.length ? t('exam.submitUnanswered', { count: questions.length - answered }) : t('exam.submitBody'),
    [{ text: t('exam.stay'), style: 'cancel' }, { text: t('exam.submit'), onPress: () => void submit() }],
  )
  const low = left < 60_000

  return (
    <View style={{ flex: 1, backgroundColor: colors.bgPage }}>
      <Stack.Screen options={{ title: t('exam.title') }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10,
        backgroundColor: colors.bgSurface, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <Text style={{ fontFamily: fonts.semibold, fontSize: 14, color: colors.textSecondary }}>{t('exam.answered', { n: answered, total: questions.length })}</Text>
        <View accessibilityLiveRegion="polite" accessibilityLabel={t('exam.left', { time: countdown(left) })}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: low ? colors.dangerLight : colors.bgMuted }}>
          <Glyph name="time-outline" size={15} color={low ? colors.danger : colors.textPrimary} />
          <Text style={{ fontFamily: fonts.bold, fontSize: 15, color: low ? colors.danger : colors.textPrimary, fontVariant: ['tabular-nums'] }}>{countdown(left)}</Text>
        </View>
      </View>
      {violations > 0 && antiCheat.tabSwitchSuspend && (
        <View style={{ padding: 12 }}><Notice>{t('exam.warning', { n: violations, max: maxViolations })}</Notice></View>
      )}
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        {questions.map((q, i) => (
          <Card key={q.id} style={{ gap: 12 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
              <Text style={{ flex: 1, fontFamily: fonts.semibold, fontSize: 15, lineHeight: 22, color: colors.textPrimary }}>{`${i + 1}. ${q.text}`}</Text>
              <Text style={{ fontFamily: fonts.medium, fontSize: 12, color: colors.textMuted }}>{t('exam.marks', { count: q.maxMarks })}</Text>
            </View>
            {q.type === 'mcq' || q.type === 'true_false' ? (
              (q.type === 'true_false' ? ['True', 'False'] : q.choices).map(choice => {
                const on = answers[q.id] === choice
                return (
                  <Pressable key={choice} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={choice}
                    onPress={() => { haptic.select(); setAnswer(q, choice) }}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: radius.md, borderWidth: 1.5,
                      borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primaryLight : 'transparent' }}>
                    <Glyph name={on ? 'radio-button-on' : 'radio-button-off'} size={20} color={on ? colors.primary : colors.textMuted} />
                    <Text style={{ flex: 1, fontFamily: fonts.body, fontSize: 15, color: colors.textPrimary }}>{choice}</Text>
                  </Pressable>
                )
              })
            ) : (
              <TextInput value={answers[q.id] ?? ''} onChangeText={v => setAnswer(q, v)} multiline accessibilityLabel={q.text}
                placeholder={t('exam.typeAnswer')} placeholderTextColor={colors.textMuted} textAlignVertical="top"
                style={{ minHeight: q.type === 'essay' ? 140 : 56, padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
                  backgroundColor: colors.bgSurface, fontFamily: fonts.body, fontSize: 15, color: colors.textPrimary }} />
            )}
          </Card>
        ))}
        <Button title={t('exam.submit')} loading={submitting} onPress={confirmSubmit} />
      </ScrollView>
    </View>
  )
}

function Result({ examId, title }: { examId: string; title: string }) {
  const { t } = useTranslation()
  const { colors, fonts } = useTheme()
  const r = useExamResult(examId, true)
  if (r.isLoading) return <Loading />
  if (r.error || !r.data) return <Failed error={r.error} onRetry={() => void r.refetch()} />
  const d = r.data
  const pct = d.maxMarks ? Math.round((d.totalMarks / d.maxMarks) * 100) : 0
  return (
    <Screen>
      <Stack.Screen options={{ title: t('exam.result') }} />
      <Title>{title}</Title>
      {d.status === 'suspended' ? (
        <Notice>{d.suspendedReason ? `${t('exam.suspended')}: ${d.suspendedReason}` : t('exam.suspended')}</Notice>
      ) : !d.graded ? (
        <Empty icon="hourglass-outline" title={t('exam.awaiting')} body={t('exam.awaitingBody')} />
      ) : (
        <Card style={{ alignItems: 'center', gap: 6 }}>
          <Glyph name={d.passed ? 'trophy' : 'refresh-circle-outline'} size={44} color={d.passed ? colors.warning : colors.textMuted} />
          <Text style={{ fontFamily: fonts.display, fontSize: 40, color: d.passed ? colors.success : colors.danger }}>{`${pct}%`}</Text>
          <Text style={{ fontFamily: fonts.semibold, fontSize: 15, color: colors.textPrimary }}>{d.passed ? t('exam.passed') : t('exam.failed')}</Text>
          <Text style={{ fontFamily: fonts.body, fontSize: 13, color: colors.textMuted }}>{t('exam.score', { got: d.totalMarks, max: d.maxMarks, pass: d.passPercent })}</Text>
        </Card>
      )}
      {d.questions.map((q, i) => (
        <Card key={q.id} style={{ gap: 6 }}>
          <Text style={{ fontFamily: fonts.semibold, fontSize: 14, lineHeight: 20, color: colors.textPrimary }}>{`${i + 1}. ${q.text}`}</Text>
          <Text style={{ fontFamily: fonts.body, fontSize: 14, color: colors.textSecondary }}>{`${t('exam.yourAnswer')}: ${q.yourAnswer || '—'}`}</Text>
          {q.marksAwarded != null && <Text style={{ fontFamily: fonts.medium, fontSize: 13, color: q.marksAwarded >= q.maxMarks ? colors.success : colors.textMuted }}>{t('exam.marksOf', { got: q.marksAwarded, max: q.maxMarks })}</Text>}
          {!!q.feedback && <Text style={{ fontFamily: fonts.body, fontSize: 13, color: colors.textSecondary }}>{q.feedback}</Text>}
          {!!q.explanation && <Text style={{ fontFamily: fonts.body, fontSize: 13, fontStyle: 'italic', color: colors.textMuted }}>{q.explanation}</Text>}
        </Card>
      ))}
      <Button variant="ghost" title={t('common.back')} onPress={() => router.back()} />
    </Screen>
  )
}
