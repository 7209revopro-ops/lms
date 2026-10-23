import {
  catalogParams, clockLabel, compactCount, completeRegistrationBody, countdown, courseOf, durationLabel, EMPTY_FORM,
  favoriteCoursesOf, needsFullRegistration, normalizeActivity, normalizePath, normalizeReview, normalizeThread, pageMetaOf,
  streakWeek, weekDays,
} from '@shared'

describe('courseOf — one shape from DTOs and raw populated documents', () => {
  it('reads the catalogue DTO', () => {
    const c = courseOf({
      id: 'c1', title: 'Forex', slug: 'forex', level: 'Beginner', durationMins: 90, ratingAvg: 4.6, ratingCount: 12,
      enrolledCount: 300, isFree: false, price: 499, instructor: { id: 'i1', name: 'Sam', headline: 'Trader' },
      category: { id: 'k', name: 'Trading', slug: 'trading' }, tags: ['fx', 'risk'],
    })!
    expect(c).toMatchObject({ id: 'c1', level: 'beginner', durationMins: 90, ratingAvg: 4.6, isFree: false, category: { slug: 'trading' } })
    expect(c.instructor).toEqual({ id: 'i1', name: 'Sam', avatarUrl: undefined, headline: 'Trader' })
    expect(c.tags).toEqual(['fx', 'risk'])
  })
  it('reads a raw populated document (_id, instructorId as object)', () => {
    const c = courseOf({ _id: 'c2', title: 'T', slug: 't', instructorId: { _id: 'i2', name: 'Ana' }, categoryId: { _id: 'k2', name: 'AI', slug: 'ai' } })!
    expect(c.id).toBe('c2')
    expect(c.instructor?.name).toBe('Ana')
    expect(c.category?.slug).toBe('ai')
  })
  it('free means isFree, or a zero price — the website rule', () => {
    expect(courseOf({ id: 'a', slug: 'a', isFree: true })!.isFree).toBe(true)
    expect(courseOf({ id: 'a', slug: 'a', price: 0 })!.isFree).toBe(true)
    expect(courseOf({ id: 'a', slug: 'a', price: 100 })!.isFree).toBe(false)
    expect(courseOf({ id: 'a', slug: 'a', isFree: false, price: 0 })!.isFree).toBe(false)
    expect(courseOf({ id: 'a', slug: 'a' })!.isFree).toBe(false)
  })
  it('an unknown level is dropped, not shown raw', () => expect(courseOf({ id: 'a', slug: 'a', level: 'expert' })!.level).toBeUndefined())
  it('nothing in, nothing out', () => expect(courseOf(null)).toBeNull())
})

describe('catalogue params', () => {
  it('defaults: page 1, 12 a page, popular', () => expect(catalogParams({})).toEqual({ page: 1, per_page: 12, sort: 'popular' }))
  it('search goes as a prefix search, trimmed; empty filters are left out', () => {
    expect(catalogParams({ search: '  fore ', program: '', level: 'beginner', page: 3 }))
      .toEqual({ page: 3, per_page: 12, sort: 'popular', search: 'fore', search_mode: 'prefix', level: 'beginner' })
  })
  it('page meta from the snake_case wire format', () => {
    expect(pageMetaOf({ total_count: 40, page: 2, total_pages: 4, has_next: true })).toEqual({ total: 40, page: 2, totalPages: 4, hasNext: true })
    expect(pageMetaOf(undefined)).toEqual({ total: 0, page: 1, totalPages: 1, hasNext: false })
  })
})

describe('labels', () => {
  it('durations', () => {
    expect(durationLabel(45)).toBe('45m')
    expect(durationLabel(120)).toBe('2h')
    expect(durationLabel(150)).toBe('2h 30m')
    expect(durationLabel(0)).toBeNull()
  })
  it('counts', () => {
    expect(compactCount(950)).toBe('950')
    expect(compactCount(1200)).toBe('1.2k')
    expect(compactCount(12_400)).toBe('12k')
  })
  it('clock and countdown', () => {
    expect(clockLabel(75)).toBe('1:15')
    expect(clockLabel(3725)).toBe('1:02:05')
    expect(countdown(61_000)).toBe('1:01')
    expect(countdown(-5)).toBe('0:00')
  })
})

describe('streak week', () => {
  const today = new Date('2026-10-22T10:00:00Z') // a Thursday
  it('Monday to Sunday of the given week, today marked, future days marked', () => {
    const d = weekDays('2026-10-19', today)
    expect(d.map(x => x.date)).toEqual(['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'])
    expect(d.find(x => x.isToday)?.date).toBe('2026-10-22')
    expect(d.filter(x => x.isFuture).length).toBe(3)
  })
  it('works out the week itself when the server has none yet', () => {
    expect(weekDays(null, today)[0]!.date).toBe('2026-10-19')
  })
  it('active days are the current run, not the first N lesson-count days (the website guess)', () => {
    const w = streakWeek({ weekStartDate: '2026-10-19', lastActiveDate: '2026-10-22', currentStreak: 2 }, today)
    expect(w.filter(x => x.active).map(x => x.date)).toEqual(['2026-10-21', '2026-10-22'])
  })
  it('a run that began last week lights this week from Monday', () => {
    const w = streakWeek({ weekStartDate: '2026-10-19', lastActiveDate: '2026-10-21', currentStreak: 9 }, today)
    expect(w.filter(x => x.active).map(x => x.date)).toEqual(['2026-10-19', '2026-10-20', '2026-10-21'])
  })
  it('no streak, nothing lit', () => {
    expect(streakWeek({ weekStartDate: '2026-10-19', lastActiveDate: null, currentStreak: 0 }, today).some(x => x.active)).toBe(false)
  })
})

describe('full registration', () => {
  it('express and not yet submitted: owed', () => expect(needsFullRegistration({ signupType: 'express', enrollmentStatus: 'pending' })).toBe(true))
  it('already submitted: not owed again', () => expect(needsFullRegistration({ signupType: 'express', enrollmentStatus: 'pending', fullRegistrationSubmittedAt: '2026-10-01' })).toBe(false))
  it('approved express student: not asked', () => expect(needsFullRegistration({ signupType: 'express', enrollmentStatus: 'approved' })).toBe(false))
  it('rejected or cancelled: asked to resubmit, whatever the signup type', () => {
    expect(needsFullRegistration({ signupType: 'full', enrollmentStatus: 'rejected' })).toBe(true)
    expect(needsFullRegistration({ signupType: 'full', enrollmentStatus: 'cancelled' })).toBe(true)
  })
  it('body: flat, no account fields, passport doubles as the ID when chosen', () => {
    const f = { ...EMPTY_FORM, name: 'X', email: 'x@y.z', password: 'Secret123', idType: 'Passport' as const, nationality: ' Emirati ', programs: ['fx'] }
    const b = completeRegistrationBody(f, { passportUrl: 'p', idDocUrl: 'other', photoUrl: 'ph' })
    expect(b).not.toHaveProperty('name')
    expect(b).not.toHaveProperty('password')
    expect(b).not.toHaveProperty('enrollmentApplication')
    expect(b.idDocUrl).toBe('p')
    expect(b.nationality).toBe('Emirati')
  })
})

describe('list normalisers', () => {
  it('reviews: the author comes from populated userId', () => {
    const r = normalizeReview({ _id: 'r1', rating: 5, comment: 'Great', userId: { _id: 'u1', name: 'Lina' }, helpfulVotes: 2, createdAt: 'x' })
    expect(r).toMatchObject({ id: 'r1', rating: 5, author: { id: 'u1', name: 'Lina' }, helpfulVotes: 2 })
  })
  it('favourites: courses from the populated rows, broken rows skipped', () => {
    const list = favoriteCoursesOf([{ courseId: { _id: 'c1', title: 'A', slug: 'a' } }, { courseId: 'deleted-id' }, { courseId: null }])
    expect(list.map(c => c.slug)).toEqual(['a'])
  })
  it('paths: steps in order, prerequisites flagged, missing courses dropped', () => {
    const p = normalizePath({ _id: 'p', title: 'P', slug: 'p', courses: [
      { order: 2, courseId: { _id: 'b', title: 'B', slug: 'b' } },
      { order: 1, isPrerequisite: true, courseId: { _id: 'a', title: 'A', slug: 'a' } },
      { order: 3, courseId: null },
    ] })
    expect(p.steps.map(s => [s.course.slug, s.isPrerequisite])).toEqual([['a', true], ['b', false]])
    expect(p.courseCount).toBe(3)
  })
  it('threads: a plain author id is not a person', () => {
    expect(normalizeThread({ _id: 't', body: 'q', authorId: 'u1' }).author).toBeNull()
    expect(normalizeThread({ _id: 't', body: 'q', authorId: { _id: 'u1', name: 'Omar', role: 'instructor' } }).author?.role).toBe('instructor')
  })
  it('activity: populated lesson and course, week totals', () => {
    const a = normalizeActivity({ items: [{ _id: 'x', isCompleted: true, lessonId: { _id: 'l', title: 'L', type: 'video' }, courseId: 'cid' }], week: { lessonsCompleted: 3, minutesWatched: 42 } })
    expect(a.week).toEqual({ lessonsCompleted: 3, minutesWatched: 42 })
    expect(a.items[0]!.lesson?.title).toBe('L')
    expect(a.items[0]!.course).toBeNull()
  })
})
