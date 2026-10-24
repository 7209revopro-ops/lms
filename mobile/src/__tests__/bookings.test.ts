import { bookingHaystack, bookingRow, bookingStats, bookingVerdict, inBookingTab, type MyBooking } from '@shared'

const NOW = Date.parse('2026-10-24T10:00:00Z')
const HOUR = 3_600_000

function booking(over: Partial<MyBooking> & { start: number; lcStatus?: string }): MyBooking {
  const { start, lcStatus = 'scheduled', ...rest } = over
  return {
    id: `b${start}`, status: 'booked', bookedAt: '2026-10-01T00:00:00Z',
    liveClassId: {
      id: `c${start}`, title: 'Price action', scheduledStart: new Date(start).toISOString(), durationMins: 60,
      status: lcStatus, type: 'external', language: 'Hindi',
      courseId: { id: 'k', title: 'Forex Foundations', slug: 'ff' }, instructorId: { id: 'i', name: 'Faris' },
    },
    ...rest,
  }
}

describe('booking history (the website’s My Bookings rules)', () => {
  test('a seat ahead is booked and upcoming; one that has ended is unmarked and past', () => {
    expect(bookingVerdict(bookingRow(booking({ start: NOW + HOUR })), NOW)).toEqual({ kind: 'booked', lane: 'upcoming' })
    expect(bookingVerdict(bookingRow(booking({ start: NOW - 2 * HOUR })), NOW)).toEqual({ kind: 'unmarked', lane: 'past' })
  })

  test('a class that started ten minutes ago is still upcoming — over is decided by the end', () => {
    expect(bookingVerdict(bookingRow(booking({ start: NOW - 10 * 60_000 })), NOW).lane).toBe('upcoming')
  })

  test('the server owns "live" and "ended"', () => {
    expect(bookingVerdict(bookingRow(booking({ start: NOW + HOUR, lcStatus: 'live' })), NOW).kind).toBe('live')
    expect(bookingVerdict(bookingRow(booking({ start: NOW + HOUR, lcStatus: 'ended' })), NOW).kind).toBe('unmarked')
  })

  test('the register wins over the clock; an academy-cancelled class is called off', () => {
    expect(bookingVerdict(bookingRow(booking({ start: NOW + HOUR, status: 'cancelled' })), NOW).kind).toBe('cancelled')
    expect(bookingVerdict(bookingRow(booking({ start: NOW - 2 * HOUR, status: 'attended' })), NOW).kind).toBe('attended')
    expect(bookingVerdict(bookingRow(booking({ start: NOW + HOUR, lcStatus: 'cancelled' })), NOW)).toEqual({ kind: 'called-off', lane: 'past' })
  })

  test('tabs: upcoming reads the clock, the others read the register', () => {
    const ahead = bookingRow(booking({ start: NOW + HOUR }))
    const missed = bookingRow(booking({ start: NOW - 3 * HOUR, status: 'missed' }))
    expect(inBookingTab(ahead, NOW, 'upcoming')).toBe(true)
    expect(inBookingTab(missed, NOW, 'upcoming')).toBe(false)
    expect(inBookingTab(missed, NOW, 'missed')).toBe(true)
    expect(inBookingTab(missed, NOW, 'all')).toBe(true)
    expect(inBookingTab(ahead, NOW, 'attended')).toBe(false)
  })

  test('the attendance rate counts only classes that happened, and is null before any', () => {
    expect(bookingStats([bookingRow(booking({ start: NOW + HOUR }))]).rate).toBeNull()
    const s = bookingStats([
      bookingRow(booking({ start: 1, status: 'attended' })), bookingRow(booking({ start: 2, status: 'attended' })),
      bookingRow(booking({ start: 3, status: 'attended' })), bookingRow(booking({ start: 4, status: 'missed' })),
      bookingRow(booking({ start: 5, status: 'cancelled' })), bookingRow(booking({ start: NOW + HOUR })),
    ])
    expect(s).toEqual({ total: 6, attended: 3, missed: 1, cancelled: 1, rate: 75 })
  })

  test('search matches the class, course, mentor and language', () => {
    const h = bookingHaystack(booking({ start: NOW }))
    for (const q of ['price', 'forex foundations', 'faris', 'hindi']) expect(h).toContain(q)
  })
})
