import { problemOf } from '@shared'
import i18n from '@/i18n'

/** What to tell the student when a request fails: the server's own sentence
    when it answered, ours when it did not. */
export function errorText(err: unknown): string {
  const p = problemOf(err)
  if (p.kind === 'refused') return p.message
  return i18n.t(p.kind === 'timeout' ? 'common.timeout' : 'common.offline')
}
