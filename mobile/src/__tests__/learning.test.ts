import {
  answeredCount, bucketOf, choicesOf, clock, correctionsOf, fileProblem, lessonGate, lessonSequence,
  normalizeAssignment, normalizeCourseDetail, normalizeEnrollment, outlineOf, quizAnswers, resourceKind,
  resumeAt, resumeLesson, watchTick, WATCH_REPORT_MAX, type LessonOutline, type QuizQuestion, type WatchMark,
} from '@shared'

const lesson = (id: string, sectionId: string, order: number, extra: Partial<LessonOutline> = {}): LessonOutline => ({
  id, sectionId, courseId: 'c', title: id, type: 'video', durationMins: 5, order, isFree: false, ...extra,
})

describe('My learning buckets (the website\'s rules)', () => {
  it('completed by status or by 100%', () => {
    expect(bucketOf({ status: 'completed', progressPercent: 40 })).toBe('completed')
    expect(bucketOf({ status: 'active', progressPercent: 100 })).toBe('completed')
  })
  it('in progress above 0, not started at 0', () => {
    expect(bucketOf({ status: 'active', progressPercent: 1 })).toBe('inProgress')
    expect(bucketOf({ status: 'active', progressPercent: 0 })).toBe('notStarted')
  })
})

describe('normalising API rows', () => {
  it('an enrolment keeps its populated course, with the instructor', () => {
    const e = normalizeEnrollment({ _id: 'e1', status: 'active', progressPercent: 30, createdAt: '2026-01-01',
      courseId: { _id: 'c1', title: 'Forex', slug: 'forex', instructorId: { _id: 'i1', name: 'Sam' } } })
    expect(e).toMatchObject({ id: 'e1', progressPercent: 30, course: { id: 'c1', slug: 'forex', instructor: { name: 'Sam' } } })
  })
  it('an enrolment whose course was deleted has course null (unpopulated id)', () => {
    expect(normalizeEnrollment({ id: 'e1', courseId: '6ac0' }).course).toBeNull()
    expect(normalizeEnrollment({ id: 'e1', courseId: null }).course).toBeNull()
  })
  it('course detail: string ids, numeric order, isFree only when exactly true', () => {
    const d = normalizeCourseDetail({ course: { id: 'c', title: 'T', slug: 's' }, sections: [{ _id: 's1', title: 'M', order: '2' }],
      lessons: [{ _id: 'l1', sectionId: 's1', courseId: 'c', order: '3', isFree: 'yes', type: 'quiz' }] })
    expect(d.sections[0]).toEqual({ id: 's1', title: 'M', order: 2 })
    expect(d.lessons[0]).toMatchObject({ id: 'l1', order: 3, isFree: false, type: 'quiz' })
  })
  it('assignment rows map populated refs to named objects', () => {
    const a = normalizeAssignment({ _id: 'a', title: 'HW', status: 'rejected', attempt: 2, lastReason: 'Redo',
      liveClassId: { _id: 'lc', title: 'Class', scheduledStart: '2026-10-01T10:00:00Z' }, courseId: { id: 'c', title: 'Forex' } })
    expect(a).toMatchObject({ id: 'a', status: 'rejected', attempt: 2, files: [], liveClass: { id: 'lc', title: 'Class' }, course: { title: 'Forex' } })
  })
})

describe('course outline and lesson order', () => {
  const detail = {
    sections: [{ id: 'B', title: 'Second', order: 2 }, { id: 'A', title: 'First', order: 1 }],
    lessons: [lesson('b2', 'B', 2), lesson('a2', 'A', 2), lesson('b1', 'B', 1), lesson('a1', 'A', 1), lesson('x', 'gone', 1)],
  }
  it('modules by their order, lessons by theirs, across modules', () => {
    expect(lessonSequence(detail).map(l => l.id)).toEqual(['a1', 'a2', 'b1', 'b2', 'x'])
  })
  it('lessons of a deleted module are kept at the end, not dropped', () => {
    const out = outlineOf(detail)
    expect(out.at(-1)!.section.id).toBe('')
    expect(out.at(-1)!.lessons.map(l => l.id)).toEqual(['x'])
  })
  it('resume: last opened, else first not done, else first', () => {
    const seq = lessonSequence(detail)
    expect(resumeLesson(seq, { lastLessonId: 'b1', completedLessons: [] })!.id).toBe('b1')
    expect(resumeLesson(seq, { lastLessonId: null, completedLessons: ['a1', 'a2'] })!.id).toBe('b1')
    expect(resumeLesson(seq, { lastLessonId: 'deleted', completedLessons: seq.map(l => l.id) })!.id).toBe('a1')
    expect(resumeLesson([], undefined)).toBeUndefined()
  })
})

describe('lesson gate', () => {
  const enrolled = { isEnrolled: true, blockedLessons: [] as string[] }
  it('pending students are locked out, even from free lessons', () => {
    expect(lessonGate(lesson('l', 'A', 1, { isFree: true }), undefined, 'pending')).toBe('pending')
  })
  it('free lessons are open without enrolment', () => {
    expect(lessonGate(lesson('l', 'A', 1, { isFree: true }), { isEnrolled: false, blockedLessons: [] }, 'approved')).toBe('open')
  })
  it('not enrolled → notEnrolled', () => {
    expect(lessonGate(lesson('l', 'A', 1), { isEnrolled: false, blockedLessons: [] }, 'approved')).toBe('notEnrolled')
  })
  it('blockedLessons holds MODULE ids: a lesson in a blocked module is blocked', () => {
    expect(lessonGate(lesson('l', 'A', 1), { ...enrolled, blockedLessons: ['A'] }, 'approved')).toBe('blocked')
  })
  it('a blockedLessons entry equal to the LESSON id does not block it (the website\'s bug)', () => {
    expect(lessonGate(lesson('l', 'A', 1), { ...enrolled, blockedLessons: ['l'] }, 'approved')).toBe('open')
  })
  it('progress not loaded yet → open (the server still decides)', () => {
    expect(lessonGate(lesson('l', 'A', 1), undefined, 'approved')).toBe('open')
  })
})

describe('video resume point', () => {
  it('resumes from a real position', () => expect(resumeAt(125.7, 600)).toBe(125))
  it('starts over when barely started or nearly finished', () => {
    expect(resumeAt(9, 600)).toBe(0)
    expect(resumeAt(590, 600)).toBe(0)
  })
  it('unknown duration (live/HLS) still resumes', () => expect(resumeAt(120, NaN)).toBe(120))
})

describe('watch-time reporting', () => {
  const play = (from: WatchMark, positions: number[]) => {
    let s = from
    const reports: number[] = []
    for (const p of positions) {
      const r = watchTick(s, p)
      s = r.state
      if (r.report) reports.push(r.report)
    }
    return { reports, state: s }
  }
  const seconds = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i)

  it('reports every 15 s of playback', () => {
    expect(play({ mark: 0, last: 0 }, seconds(1, 31)).reports).toEqual([15, 15])
  })
  it('a forward seek is not counted as watched', () => {
    const { reports } = play({ mark: 0, last: 0 }, [...seconds(1, 10), 500, ...seconds(501, 515)])
    expect(reports).toEqual([15])
  })
  it('a rewind restarts counting, never negative', () => {
    const { reports } = play({ mark: 0, last: 0 }, [...seconds(1, 14), 2, ...seconds(3, 17)])
    expect(reports).toEqual([15])
  })
  it('2× playback (2 s per tick) still counts', () => {
    expect(play({ mark: 0, last: 0 }, [2, 4, 6, 8, 10, 12, 14, 16]).reports).toEqual([16])
  })
  it('never reports more than the server accepts', () => {
    expect(watchTick({ mark: 0, last: 1000 }, 1001).report).toBeLessThanOrEqual(WATCH_REPORT_MAX)
  })
  it('a resumed video counts from the resume point, not from 0', () => {
    expect(play({ mark: 120, last: 120 }, seconds(121, 135)).reports).toEqual([15])
  })
})

describe('article resource kind', () => {
  it.each([
    [undefined, 'none'], ['  ', 'none'], ['https://x/a.PNG', 'image'], ['https://x/a.jpg?sig=1', 'image'],
    ['https://x/doc.pdf', 'pdf'], ['https://x/doc.pdf#page=4', 'pdf'], ['https://docs.google.com/d/1', 'link'],
  ])('%s → %s', (url, kind) => expect(resourceKind(url as string | undefined)).toBe(kind))
})

describe('quiz', () => {
  const q = (id: string, type: QuizQuestion['type'], choices: string[] = []): QuizQuestion => ({ id, text: id, type, choices, points: 1 })
  it('choices are scored by INDEX — the label is display only', () => {
    expect(choicesOf(q('a', 'mcq', ['Buy', 'Sell']))).toEqual([{ label: 'Buy', value: '0' }, { label: 'Sell', value: '1' }])
  })
  it('true/false with no stored choices offers True="0", False="1"', () => {
    expect(choicesOf(q('a', 'true_false'))).toEqual([{ label: 'True', value: '0' }, { label: 'False', value: '1' }])
  })
  it('submits every question, blank when unanswered, trimmed', () => {
    const quiz = { questions: [q('a', 'mcq', ['x', 'y']), q('b', 'short'), q('c', 'short')] }
    expect(quizAnswers(quiz, { a: '1', b: '  pips ' })).toEqual([
      { questionId: 'a', answer: '1' }, { questionId: 'b', answer: 'pips' }, { questionId: 'c', answer: '' },
    ])
    expect(answeredCount(quiz, { a: '1', b: '   ' })).toBe(1)
  })
  it('a failed attempt shows no corrections (no answer-key oracle)', () => {
    const breakdown = [{ questionId: 'a', correct: false, correctAnswer: '1', points: 1 }]
    expect(correctionsOf({ score: 0, maxScore: 1, scorePercent: 0, passed: false, attempt: 1, breakdown })).toEqual([])
    expect(correctionsOf({ score: 1, maxScore: 1, scorePercent: 100, passed: true, attempt: 1, breakdown })).toHaveLength(1)
  })
  it('countdown clock', () => {
    expect(clock(605)).toBe('10:05')
    expect(clock(-3)).toBe('0:00')
  })
})

describe('assignment files (the server\'s /uploads/document rules)', () => {
  it('accepts PDF and images up to 10 MB', () => {
    expect(fileProblem({ mimeType: 'application/pdf', size: 10 * 1024 * 1024 })).toBeNull()
    expect(fileProblem({ mimeType: 'image/webp' })).toBeNull()
  })
  it('refuses other types and anything bigger', () => {
    expect(fileProblem({ mimeType: 'application/msword', size: 10 })).toBe('type')
    expect(fileProblem({ mimeType: undefined })).toBe('type')
    expect(fileProblem({ mimeType: 'image/png', size: 10 * 1024 * 1024 + 1 })).toBe('size')
  })
})
