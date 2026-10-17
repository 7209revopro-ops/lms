import type { MyBooking } from '@shared'
import { GENERAL_MODULE_ID } from '@shared'
import { bookingMapOf } from '../lib/api/classes'
import { GENERAL_PARAM, moduleIdOf, moduleParam } from '../lib/catalog'

jest.mock('../lib/http', () => ({ apiGet: jest.fn(), http: { get: jest.fn(), post: jest.fn(), delete: jest.fn() } }))

const booking = (id: string, classId: string, status: MyBooking['status']): MyBooking => ({
  id, status, bookedAt: '2026-10-01T00:00:00Z',
  liveClassId: { id: classId, title: 'C', scheduledStart: '2026-10-20T10:00:00Z', durationMins: 60, status: 'scheduled', type: 'external' },
})

describe('bookingMapOf', () => {
  it('maps each class to its booking', () => {
    const m = bookingMapOf([booking('b1', 'c1', 'booked'), booking('b2', 'c2', 'attended')])
    expect(m.get('c1')?.id).toBe('b1')
    expect(m.get('c2')?.status).toBe('attended')
  })

  it('an active seat wins over an older cancelled row for the same class, in either order', () => {
    expect(bookingMapOf([booking('old', 'c1', 'cancelled'), booking('new', 'c1', 'booked')]).get('c1')?.id).toBe('new')
    expect(bookingMapOf([booking('new', 'c1', 'booked'), booking('old', 'c1', 'cancelled')]).get('c1')?.id).toBe('new')
  })

  it('skips a booking whose class no longer resolves', () => {
    const orphan = { ...booking('b', 'x', 'booked'), liveClassId: undefined as unknown as MyBooking['liveClassId'] }
    expect(bookingMapOf([orphan]).size).toBe(0)
  })

  it('tolerates no data', () => expect(bookingMapOf(undefined).size).toBe(0))
})

describe('module route params', () => {
  it('"General sessions" (empty id) travels as a non-empty param and comes back', () => {
    expect(moduleParam(GENERAL_MODULE_ID)).toBe(GENERAL_PARAM)
    expect(moduleIdOf(GENERAL_PARAM)).toBe(GENERAL_MODULE_ID)
  })
  it('a real module id passes through unchanged', () => {
    expect(moduleIdOf(moduleParam('6ac0abc'))).toBe('6ac0abc')
  })
})
