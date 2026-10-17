import { useMemo } from 'react'
import { type LiveClass, type MyBooking } from '@shared'
import { bookingMapOf, useLiveClasses, useMyBookings } from './api/classes'

/* The student's own classes: each booking joined with its live-class row (the
   row carries the join window and isBooked; the booking alone does not). */
export interface BookedClass { booking: MyBooking; lc: LiveClass | undefined; start: number; end: number }

export function useMyClasses(now: number) {
  const classes = useLiveClasses()
  const bookings = useMyBookings()

  const all = useMemo<BookedClass[]>(() => {
    const byId = new Map((classes.data ?? []).map(c => [c.id, c]))
    return (bookings.data ?? [])
      .filter(b => b.liveClassId?.id)
      .map(b => {
        const start = new Date(b.liveClassId.scheduledStart).getTime()
        return { booking: b, lc: byId.get(b.liveClassId.id), start, end: start + (b.liveClassId.durationMins || 60) * 60_000 }
      })
  }, [classes.data, bookings.data])

  const upcoming = useMemo(
    () => all.filter(x => x.booking.status === 'booked' && x.end > now && x.lc?.status !== 'cancelled')
      .sort((a, b) => a.start - b.start),
    [all, now],
  )
  const past = useMemo(
    () => all.filter(x => !upcoming.includes(x)).sort((a, b) => b.start - a.start),
    [all, upcoming],
  )

  return {
    upcoming, past,
    bookingMap: useMemo(() => bookingMapOf(bookings.data), [bookings.data]),
    isLoading: classes.isLoading || bookings.isLoading,
    error: classes.error ?? bookings.error,
    refreshing: classes.isRefetching || bookings.isRefetching,
    refresh: () => { void classes.refetch(); void bookings.refetch() },
  }
}
