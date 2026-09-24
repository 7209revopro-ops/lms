/* ─────────────────────────────────────────────────────
   zoneDay — calendar days in a named time zone, as UTC instants.

   academyClock says how a time is WRITTEN; this answers which instants a day
   COVERS. They are kept apart on purpose — academyClock's contract is "nothing
   here is about when something happens", and "which classes are tomorrow" is
   exactly that.

   Why not the server clock: the backend runs on Asia/Dubai, but "tomorrow" for
   a Bangalore instructor starts 90 minutes earlier. A class at 00:15 IST is
   tomorrow's to them and today's to a Dubai reading. Every function here takes
   the zone explicitly so a caller cannot fall back to the process zone by
   accident.

   Day keys are 'YYYY-MM-DD' strings — a calendar date, not an instant — so they
   compare and store without a zone attached.
───────────────────────────────────────────────────── */

interface ZonedParts {
  year: number; month: number; day: number
  hour: number; minute: number; second: number
}

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatterFor(zone: string): Intl.DateTimeFormat {
  let f = formatters.get(zone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      /* h23, not hour12:false — some engines print midnight as "24" otherwise,
         which would put 00:10 on the previous day. */
      hourCycle: 'h23',
    })
    formatters.set(zone, f)
  }
  return f
}

function zonedParts(when: Date, zone: string): ZonedParts {
  const parts = formatterFor(zone).formatToParts(when)
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(p => p.type === type)?.value)
  return {
    year: get('year'), month: get('month'), day: get('day'),
    hour: get('hour'), minute: get('minute'), second: get('second'),
  }
}

const pad = (n: number) => String(n).padStart(2, '0')

/** The calendar date `when` falls on in `zone`, as 'YYYY-MM-DD'. */
export function zoneDateKey(when: Date, zone: string): string {
  const p = zonedParts(when, zone)
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`
}

/** The wall-clock hour and minute of `when` in `zone` (0–23, 0–59). */
export function zoneHourMinute(when: Date, zone: string): { hour: number; minute: number } {
  const p = zonedParts(when, zone)
  return { hour: p.hour, minute: p.minute }
}

/** 'YYYY-MM-DD' shifted by `days` calendar days. Pure date arithmetic. */
export function addDaysToDateKey(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10)
}

/* How far `zone`'s wall clock is ahead of UTC at `when`, in ms. */
function zoneOffsetMs(when: Date, zone: string): number {
  const p = zonedParts(when, zone)
  const wallAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return wallAsUtc - Math.floor(when.getTime() / 1000) * 1000
}

/** The instant local midnight begins `key` in `zone`. */
export function zoneMidnight(key: string, zone: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  const wall = Date.UTC(y!, m! - 1, d!)
  /* Twice: the offset is read at a guess, and the guess is only right if the
     offset did not change between it and the true instant (a DST edge). Both
     academies are fixed-offset today; this keeps a future zone honest. */
  let t = wall - zoneOffsetMs(new Date(wall), zone)
  t = wall - zoneOffsetMs(new Date(t), zone)
  return new Date(t)
}

/** The half-open instant range [start, end) that calendar day `key` covers in `zone`. */
export function zoneDayBounds(key: string, zone: string): { start: Date; end: Date } {
  return { start: zoneMidnight(key, zone), end: zoneMidnight(addDaysToDateKey(key, 1), zone) }
}
