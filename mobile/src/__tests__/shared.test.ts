import { compareVersions, updateState, problemOf, isDeviceCode } from '@shared'

describe('compareVersions', () => {
  it.each([
    ['1.0.0', '1.0.0', 0],
    ['1.0.0', '1.0.1', -1],
    ['1.10.0', '1.9.9', 1],     // numeric, not string, comparison
    ['2.0.0', '10.0.0', -1],
    ['junk', '0.0.1', -1],      // unparseable sorts lowest
    ['1.0.0', 'junk', 1],
  ] as const)('%s vs %s → %s', (a, b, want) => {
    expect(compareVersions(a, b)).toBe(want)
  })
})

describe('updateState', () => {
  const cfg = { minVersion: '1.2.0', latestVersion: '1.4.0' }
  it('below min → required', () => expect(updateState('1.1.9', cfg)).toBe('required'))
  it('between → available', () => expect(updateState('1.3.0', cfg)).toBe('available'))
  it('at latest → ok', () => expect(updateState('1.4.0', cfg)).toBe('ok'))
  it('ahead of latest (a build not yet announced) → ok', () => expect(updateState('1.5.0', cfg)).toBe('ok'))
})

describe('problemOf', () => {
  it('a refusal keeps the server code and sentence', () => {
    expect(problemOf({ response: { status: 403, data: { success: false, error: { code: 'DEVICE_PENDING', message: 'Wait' } } } }))
      .toEqual({ kind: 'refused', status: 403, code: 'DEVICE_PENDING', message: 'Wait' })
  })
  it('an answer without our envelope still has a code', () => {
    expect(problemOf({ response: { status: 502 } })).toMatchObject({ kind: 'refused', code: 'HTTP_502' })
  })
  it('a timeout', () => expect(problemOf({ code: 'ECONNABORTED' })).toEqual({ kind: 'timeout' }))
  it('no answer', () => expect(problemOf(new Error('Network Error'))).toEqual({ kind: 'offline' }))
})

describe('isDeviceCode', () => {
  it('knows the three device refusals and nothing else', () => {
    expect(['DEVICE_PENDING', 'DEVICE_LIMIT', 'DEVICE_REVOKED'].every(isDeviceCode)).toBe(true)
    expect(isDeviceCode('INVALID_CREDENTIALS')).toBe(false)
  })
})
