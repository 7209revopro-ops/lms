import { useMemo } from 'react'
import { buildCatalog, GENERAL_MODULE_ID, type CourseNode } from '@shared'
import { bookingMapOf, useLiveClasses, useMyBookings } from './api/classes'

/* The schedule as a tree — course → module → weekly slot — built by the
   website's own buildCatalog over the same two requests. Route params cannot
   be empty, so "General sessions" (module id '') travels as GENERAL_PARAM. */
export const GENERAL_PARAM = '_general'
export const moduleParam = (id: string) => (id === GENERAL_MODULE_ID ? GENERAL_PARAM : id)
export const moduleIdOf = (param: string) => (param === GENERAL_PARAM ? GENERAL_MODULE_ID : param)

export function useCatalog() {
  /* Your own courses only, as the website's Class Schedule. */
  const classes = useLiveClasses(true)
  const bookings = useMyBookings()
  const bookingMap = useMemo(() => bookingMapOf(bookings.data), [bookings.data])
  const catalog: CourseNode[] = useMemo(
    () => (classes.data ? buildCatalog(classes.data, bookingMap) : []),
    [classes.data, bookingMap],
  )
  return {
    catalog,
    bookingMap,
    isLoading: classes.isLoading || bookings.isLoading,
    error: classes.error ?? bookings.error,
    refreshing: classes.isRefetching || bookings.isRefetching,
    refresh: () => { void classes.refetch(); void bookings.refetch() },
  }
}
