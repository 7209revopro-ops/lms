'use client'
/* ─────────────────────────────────────────────────────────────
   Filters live in the address bar (2026-10-24) — every list page keeps its
   search, status, programme, dates, tab, sort and page in the query string
   (?status=draft&q=mbt&page=2) and reads them back from it. A reload keeps
   the view, Back steps back through it, and the link can be sent to someone.

     const [status, setStatus] = useQueryState('status', 'all')
     const [page,   setPage]   = useQueryState('page', 1)
     const [q,      setQ]      = useQueryState('q', '', { history: 'replace' })   // typing: no history spam

   The type follows the default (string | number | boolean). A value equal to
   its default is left out of the URL, so a page with no filters has a clean
   address. Discrete changes push a history entry; pass history: 'replace' for
   text typed key by key.

   Read through useSyncExternalStore on window.location rather than Next's
   useSearchParams: no Suspense boundary is needed on any page, the server
   render and the first client render agree (defaults), and several setters
   called in one handler (setStatus(x); setPage(1)) compose — each reads the
   address as the previous one left it.
───────────────────────────────────────────────────────────── */
import { useCallback, useMemo, useSyncExternalStore } from 'react'

type Value = string | number | boolean
const EVENT = 'querystatechange'

function subscribe(cb: () => void) {
  window.addEventListener('popstate', cb)
  window.addEventListener(EVENT, cb)
  return () => { window.removeEventListener('popstate', cb); window.removeEventListener(EVENT, cb) }
}
const snapshot = () => window.location.search
const serverSnapshot = () => ''

function parse<T extends Value>(raw: string | null, def: T): T {
  if (raw === null) return def
  if (typeof def === 'number') { const n = Number(raw); return (Number.isFinite(n) ? n : def) as T }
  if (typeof def === 'boolean') return (raw === '1' || raw === 'true') as T
  return raw as T
}
const encode = (v: Value) => typeof v === 'boolean' ? (v ? '1' : '0') : String(v)

/** Write several keys at once (e.g. a "Clear filters" button). Undefined / default-like values are removed. */
export function setQueryParams(next: Record<string, Value | null | undefined>, history: 'push' | 'replace' = 'push') {
  const sp = new URLSearchParams(window.location.search)
  for (const [k, v] of Object.entries(next)) {
    if (v === null || v === undefined || v === '') sp.delete(k)
    else sp.set(k, encode(v))
  }
  commit(sp, history)
}

function commit(sp: URLSearchParams, history: 'push' | 'replace') {
  const qs = sp.toString()
  const url = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`
  if (url === `${window.location.pathname}${window.location.search}${window.location.hash}`) return
  if (history === 'replace') window.history.replaceState(window.history.state, '', url)
  else window.history.pushState(window.history.state, '', url)
  window.dispatchEvent(new Event(EVENT))
}

type Setter<T> = (next: T | ((prev: T) => T)) => void
type Opts = { history?: 'push' | 'replace' }

/* Overloads so a default of 1 means "a number" and 'all' means "a string" (or the union you name). */
export function useQueryState(key: string, defaultValue: number, opts?: Opts): [number, Setter<number>]
export function useQueryState(key: string, defaultValue: boolean, opts?: Opts): [boolean, Setter<boolean>]
export function useQueryState(key: string, defaultValue: string, opts?: Opts): [string, Setter<string>]
export function useQueryState<T extends string = string>(key: string, defaultValue: T, opts?: Opts): [T, Setter<T>]
export function useQueryState<T extends Value>(
  key: string, defaultValue: T, opts: Opts = {},
): [T, Setter<T>] {
  const search = useSyncExternalStore(subscribe, snapshot, serverSnapshot)
  const value = useMemo(() => parse(new URLSearchParams(search).get(key), defaultValue), [search, key, defaultValue])
  const history = opts.history ?? 'push'
  const set = useCallback((next: T | ((prev: T) => T)) => {
    const sp = new URLSearchParams(window.location.search)
    const prev = parse(sp.get(key), defaultValue)
    const v = typeof next === 'function' ? (next as (p: T) => T)(prev) : next
    if (v === defaultValue || v === '' || v === null || v === undefined) sp.delete(key)
    else sp.set(key, encode(v))
    commit(sp, history)
  }, [key, defaultValue, history])
  return [value, set]
}
