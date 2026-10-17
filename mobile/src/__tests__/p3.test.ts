import {
  appPathFor, isFatalSendError, isSeen, lastServerId, mergeMessages, pathOf, sortInstructors,
  type ChatInstructor, type ChatMessage,
} from '@shared'
import { redirectSystemPath } from '../app/+native-intent'

const SITE = 'https://lms.deltainstitutions.com'

describe('website links → app screens', () => {
  it.each([
    [`${SITE}/j/AbC123xyz_-`, '/j/AbC123xyz_-'],
    [`${SITE}/j/AbC123xyz?m=abc-defg-hij`, '/j/AbC123xyz?m=abc-defg-hij'],
    [`${SITE}/s/tok3n`, '/s/tok3n'],
    [`${SITE}/messages`, '/messages'],
    [`${SITE}/messages?c=6ad0`, '/messages?c=6ad0'],
    [`${SITE}/class-bookings`, '/schedule'],
    [`${SITE}/my-bookings/`, '/bookings'],
    ['/live-classes/6ad0/watch', '/class/6ad0'],
    ['/live-classes/6ad0', '/class/6ad0'],
    ['/courses/forex-foundations', '/learning/forex-foundations'],
    ['/learn/6ad0/lesson/77?tab=qa', '/learning'],
    ['/assignments', '/learning/assignments'],
    ['/', '/'],
    ['deltalms://j/AbC123', '/j/AbC123'],
    ['deltalms://messages?c=9', '/messages?c=9'],
  ])('%s → %s', (link, app) => expect(appPathFor(link)).toBe(app))

  it.each([['/support'], ['/reviews'], ['/j/'], ['mailto:x@y.z'], [''], ['/j/bad%20token']])('%s → no app screen', link => {
    expect(appPathFor(link)).toBeNull()
  })

  it('only the token travels — extra path is dropped, dot-segments cannot smuggle a route', () => {
    expect(appPathFor('/j/abc/extra/bits')).toBe('/j/abc')
    expect(appPathFor('/j/abc/../../admin')).toBeNull()
  })
  it('pathOf strips a trailing slash but keeps the root', () => {
    expect(pathOf(`${SITE}/messages/`)!.path).toBe('/messages')
    expect(pathOf(SITE)!.path).toBe('/')
  })
})

describe('native intent (every link that opens the app)', () => {
  it('maps website links', () => expect(redirectSystemPath({ path: `${SITE}/class-bookings`, initial: true })).toBe('/schedule'))
  it('a website page the app lacks goes Home, not "not found"', () => {
    expect(redirectSystemPath({ path: `${SITE}/support`, initial: true })).toBe('/')
  })
  it('the app\'s own paths pass through untouched', () => {
    expect(redirectSystemPath({ path: '/class/abc', initial: false })).toBe('/class/abc')
    expect(redirectSystemPath({ path: '/learning/forex', initial: false })).toBe('/learning/forex')
  })
  it('never throws on junk', () => expect(redirectSystemPath({ path: '%%%', initial: true })).toBe('%%%'))
})

const msg = (id: string, at: number, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id, senderRole: 'student', body: id, createdAt: new Date(Date.UTC(2026, 9, 17, 10, 0, at)).toISOString(), ...extra,
})

describe('chat thread merge (the website\'s rule)', () => {
  it('a poll that repeats what is shown returns the SAME array (no re-render)', () => {
    const prev = [msg('a', 1), msg('b', 2)]
    expect(mergeMessages(prev, [msg('b', 2)])).toBe(prev)
    expect(mergeMessages(prev, [])).toBe(prev)
  })
  it('a late-committed older message is slotted in by time', () => {
    const out = mergeMessages([msg('a', 1), msg('c', 3)], [msg('b', 2)])
    expect(out.map(m => m.id)).toEqual(['a', 'b', 'c'])
  })
  it('the acknowledged message replaces its optimistic bubble (clientMsgId)', () => {
    const optimistic = msg('tmp-x', 9, { clientMsgId: 'x', pending: true })
    const out = mergeMessages([msg('a', 1), optimistic], [msg('srv', 5, { clientMsgId: 'x' })])
    expect(out.map(m => m.id)).toEqual(['a', 'srv'])
  })
  it('unsent bubbles stay last, even when older than a new reply', () => {
    const failed = msg('tmp-f', 1, { clientMsgId: 'f', failed: true })
    const out = mergeMessages([failed], [msg('r', 5, { senderRole: 'instructor' })])
    expect(out.map(m => m.id)).toEqual(['r', 'tmp-f'])
  })
  it('the poll cursor skips unsent bubbles', () => {
    expect(lastServerId([msg('a', 1), msg('tmp', 2, { pending: true })])).toBe('a')
    expect(lastServerId([msg('tmp', 2, { failed: true })])).toBeUndefined()
  })
  it('refusals no retry can fix are fatal; network, 5xx and 429 are not', () => {
    expect([400, 403, 404, 409, 422].every(isFatalSendError)).toBe(true)
    expect([undefined, 429, 500, 502].some(isFatalSendError)).toBe(false)
  })
  it('✓✓ seen only for my acknowledged messages read at or after they were sent', () => {
    const m = msg('a', 1)
    expect(isSeen(m, m.createdAt)).toBe(true)
    expect(isSeen(m, null)).toBe(false)
    expect(isSeen(m, new Date(Date.parse(m.createdAt) - 1000).toISOString())).toBe(false)
    expect(isSeen({ ...m, pending: true }, m.createdAt)).toBe(false)
    expect(isSeen({ ...m, senderRole: 'instructor' }, m.createdAt)).toBe(false)
  })
})

describe('mentor list order', () => {
  const mentor = (name: string, conv?: { unread: number; at: number }): ChatInstructor => ({
    id: name, name, programs: [],
    conversation: conv ? { id: `c-${name}`, unread: conv.unread, lastMessageAt: new Date(conv.at * 1000).toISOString(), lastMessagePreview: '', lastSenderRole: 'instructor' } : null,
  })
  it('unread first, then most recent, then never-written by name', () => {
    const out = sortInstructors([mentor('Zed'), mentor('Old', { unread: 0, at: 1 }), mentor('New', { unread: 0, at: 9 }), mentor('Ann'), mentor('Ping', { unread: 2, at: 0 })])
    expect(out.map(i => i.name)).toEqual(['Ping', 'New', 'Old', 'Ann', 'Zed'])
  })
})
