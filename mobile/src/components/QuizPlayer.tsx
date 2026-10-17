import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react'
import { Alert, Pressable, Text, TextInput, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useTranslation } from 'react-i18next'
import {
  answeredCount, choicesOf, clock, correctionsOf, quizAnswers,
  type QuizQuestion, type QuizResult, type StudentQuiz,
} from '@shared'
import { useQuiz, useQuizSummary, useSubmitQuiz } from '@/lib/api/learning'
import { errorText } from '@/lib/errors'
import { Button, Notice } from './ui'
import { Empty, Failed, Loading } from './states'
import { useTheme } from '@/theme'

type Phase = 'summary' | 'taking' | 'result'

/* A lesson's quiz: summary → answering (with the time limit, if any) →
   result. Scoring, the pass mark and the attempt limit are the server's. */
export function QuizPlayer({ lessonId, onNext }: { lessonId: string; onNext?: () => void }) {
  const { t } = useTranslation()
  const quiz = useQuiz(lessonId)
  const summary = useQuizSummary(lessonId)
  const submit = useSubmitQuiz(lessonId)
  const [phase, setPhase] = useState<Phase>('summary')
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [result, setResult] = useState<QuizResult | null>(null)
  const [timedOut, setTimedOut] = useState(false)

  /* The timer submits whatever is answered at that moment — read through a
     ref. (The website's timer closes over the answers from when the quiz
     started, so a timed-out attempt is submitted blank.) */
  const answersRef = useRef<Record<string, string>>({})
  const answer = (questionId: string, value: string) => {
    answersRef.current = { ...answersRef.current, [questionId]: value }
    setAnswers(answersRef.current)
  }

  const { mutateAsync, isPending } = submit
  const send = useCallback(async () => {
    if (!quiz.data || isPending) return
    try {
      const res = await mutateAsync(quizAnswers(quiz.data, answersRef.current))
      setResult(res)
      setPhase('result')
    } catch { /* shown from submit.error */ }
  }, [quiz.data, isPending, mutateAsync])

  const start = () => {
    answersRef.current = {}
    setAnswers({})
    setResult(null)
    setTimedOut(false)
    submit.reset()
    setPhase('taking')
  }

  if (quiz.isLoading || summary.isLoading) return <Loading />
  if (quiz.error) {
    const notFound = (quiz.error as { response?: { status?: number } }).response?.status === 404
    return notFound ? <Empty title={t('quiz.noQuiz')} /> : <Failed error={quiz.error} onRetry={() => void quiz.refetch()} />
  }
  if (!quiz.data) return <Empty title={t('quiz.noQuiz')} />

  if (phase === 'taking') {
    return (
      <Taking quiz={quiz.data} answers={answers} busy={submit.isPending} error={submit.error}
        onAnswer={answer}
        onSubmit={() => void send()}
        onTimeUp={() => { setTimedOut(true); void send() }} />
    )
  }
  if (phase === 'result' && result) {
    return <Result quiz={quiz.data} result={result} timedOut={timedOut} onRetry={start} onNext={onNext} />
  }
  return <Summary quiz={quiz.data} summary={summary.data} onStart={start} />
}

function Card({ children }: { children: React.ReactNode }) {
  const { colors, radius } = useTheme()
  return (
    <View style={{ backgroundColor: colors.bgSurface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.lg, padding: 18, gap: 14 }}>
      {children}
    </View>
  )
}

function Summary({ quiz, summary, onStart }: {
  quiz: StudentQuiz
  summary: ReturnType<typeof useQuizSummary>['data']
  onStart: () => void
}) {
  const { t } = useTranslation()
  const { colors, fonts } = useTheme()
  const passed = !!summary?.passed
  return (
    <Card>
      <View style={{ alignItems: 'center', gap: 8 }}>
        <Ionicons name="trophy-outline" size={34} color={passed ? colors.success : colors.primary} />
        <Text style={{ fontFamily: fonts.display, fontSize: 22, color: colors.textPrimary }}>{passed ? t('quiz.done') : t('quiz.ready')}</Text>
        <Text style={{ fontFamily: fonts.body, fontSize: 14, color: colors.textSecondary, textAlign: 'center' }}>
          {t('quiz.meta', { count: quiz.questions.length, pass: quiz.passPercent })}
          {quiz.timeLimit ? t('quiz.timeLimit', { mins: quiz.timeLimit }) : ''}
        </Text>
      </View>
      {summary?.hasAttempted && (
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 32 }}>
          <Stat label={t('quiz.best')} value={`${Math.round(summary.bestScore ?? 0)}%`} color={passed ? colors.success : colors.danger} />
          <Stat label={t('quiz.attempts')} value={String(summary.attempts)} color={colors.textPrimary} />
        </View>
      )}
      <Button title={summary?.hasAttempted ? t('quiz.retry') : t('quiz.start')} onPress={onStart} />
    </Card>
  )
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  const { colors, fonts } = useTheme()
  return (
    <View style={{ alignItems: 'center', gap: 2 }}>
      <Text style={{ fontFamily: fonts.medium, fontSize: 11, letterSpacing: 1, color: colors.textMuted }}>{label.toUpperCase()}</Text>
      <Text style={{ fontFamily: fonts.bold, fontSize: 20, color }}>{value}</Text>
    </View>
  )
}

function Taking({ quiz, answers, busy, error, onAnswer, onSubmit, onTimeUp }: {
  quiz: StudentQuiz
  answers: Record<string, string>
  busy: boolean
  error: unknown
  onAnswer: (questionId: string, value: string) => void
  onSubmit: () => void
  onTimeUp: () => void
}) {
  const { t } = useTranslation()
  const { colors, fonts } = useTheme()
  const total = quiz.questions.length
  const answered = answeredCount(quiz, answers)

  /* Count down from the limit. The deadline is fixed once, when answering
     starts, so a re-render or a paused JS thread cannot stretch it. */
  const limitMins = quiz.timeLimit
  const [left, setLeft] = useState(limitMins ? limitMins * 60 : null)
  const timeUp = useEffectEvent(onTimeUp)
  useEffect(() => {
    if (!limitMins) return
    const deadline = Date.now() + limitMins * 60_000
    const id = setInterval(() => {
      const secs = Math.max(0, Math.round((deadline - Date.now()) / 1000))
      setLeft(secs)
      if (secs === 0) {
        clearInterval(id)
        timeUp()
      }
    }, 1000)
    return () => clearInterval(id)
  }, [limitMins])

  const confirmSubmit = () => {
    if (answered === total) return onSubmit()
    Alert.alert(t('quiz.submitUnanswered', { n: total - answered }), undefined, [
      { text: t('quiz.keepGoing'), style: 'cancel' },
      { text: t('quiz.submitAnyway'), onPress: onSubmit },
    ])
  }

  return (
    <View style={{ gap: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ fontFamily: fonts.semibold, fontSize: 14, color: colors.textPrimary }}>{t('quiz.answered', { n: answered, total })}</Text>
        {left !== null && (
          <Text accessibilityLiveRegion="polite" style={{ fontFamily: fonts.bold, fontSize: 15, color: left < 60 ? colors.danger : colors.textSecondary }}>
            {clock(left)}
          </Text>
        )}
      </View>
      {quiz.questions.map((q, i) => (
        <Question key={q.id} q={q} n={i + 1} value={answers[q.id] ?? ''} onChange={v => onAnswer(q.id, v)} />
      ))}
      {!!error && <Notice>{errorText(error)}</Notice>}
      <Button title={t('quiz.submit')} loading={busy} onPress={confirmSubmit} />
    </View>
  )
}

function Question({ q, n, value, onChange }: { q: QuizQuestion; n: number; value: string; onChange: (v: string) => void }) {
  const { t } = useTranslation()
  const { colors, fonts, radius } = useTheme()
  return (
    <Card>
      <Text style={{ fontFamily: fonts.semibold, fontSize: 15, lineHeight: 22, color: colors.textPrimary }}>{n}. {q.text}</Text>
      {q.type === 'short' ? (
        <TextInput value={value} onChangeText={onChange} placeholder={t('quiz.typeAnswer')} placeholderTextColor={colors.textMuted}
          accessibilityLabel={q.text} autoCorrect={false}
          style={{ fontFamily: fonts.body, fontSize: 15, color: colors.textPrimary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: 12 }} />
      ) : (
        <View accessibilityRole="radiogroup" style={{ gap: 8 }}>
          {choicesOf(q).map(c => {
            const on = value === c.value
            return (
              <Pressable key={c.value} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => onChange(c.value)}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: radius.md, borderWidth: 1.5,
                  borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primaryLight : 'transparent',
                }}>
                <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={20} color={on ? colors.primary : colors.textMuted} />
                <Text style={{ flex: 1, fontFamily: fonts.body, fontSize: 15, color: colors.textPrimary }}>{c.label}</Text>
              </Pressable>
            )
          })}
        </View>
      )}
    </Card>
  )
}

function Result({ quiz, result, timedOut, onRetry, onNext }: {
  quiz: StudentQuiz; result: QuizResult; timedOut: boolean; onRetry: () => void; onNext?: () => void
}) {
  const { t } = useTranslation()
  const { colors, fonts } = useTheme()
  const corrections = correctionsOf(result)
  const byId = new Map(quiz.questions.map(q => [q.id, q]))
  return (
    <View style={{ gap: 14 }}>
      <Card>
        {timedOut && <Notice tone="info">{t('quiz.timeUp')}</Notice>}
        <View style={{ alignItems: 'center', gap: 6 }}>
          <Ionicons name={result.passed ? 'checkmark-circle' : 'close-circle'} size={40} color={result.passed ? colors.success : colors.danger} />
          <Text style={{ fontFamily: fonts.display, fontSize: 32, color: colors.textPrimary }}>{t('quiz.score', { score: result.scorePercent })}</Text>
          <Text style={{ fontFamily: fonts.semibold, fontSize: 15, color: result.passed ? colors.success : colors.danger }}>
            {result.passed ? t('quiz.passed') : t('quiz.failed')}
          </Text>
          {!result.passed && <Text style={{ fontFamily: fonts.body, fontSize: 14, color: colors.textSecondary }}>{t('quiz.needed', { pass: quiz.passPercent })}</Text>}
        </View>
        {result.passed && onNext ? <Button title={t('quiz.nextLesson')} onPress={onNext} /> : null}
        {!result.passed && <Button title={t('quiz.retry')} onPress={onRetry} />}
      </Card>
      {corrections.map(b => {
        const q = byId.get(b.questionId)
        if (!q) return null
        const answer = q.type === 'short' ? b.correctAnswer : choicesOf(q)[Number(b.correctAnswer)]?.label ?? b.correctAnswer
        return (
          <Card key={b.questionId}>
            <Text style={{ fontFamily: fonts.semibold, fontSize: 14, color: colors.textPrimary }}>{q.text}</Text>
            <Text style={{ fontFamily: fonts.medium, fontSize: 14, color: b.correct ? colors.success : colors.danger }}>
              {b.correct ? t('quiz.correct') : t('quiz.wrong', { answer })}
            </Text>
            {!!b.explanation && <Text style={{ fontFamily: fonts.body, fontSize: 13, color: colors.textSecondary }}>{b.explanation}</Text>}
          </Card>
        )
      })}
    </View>
  )
}
