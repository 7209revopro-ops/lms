'use client'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/axios'

export interface Announcement {
  id:          string
  title:       string
  description: string
  mediaUrl?:   string
  startDate:   string
  endDate:     string
}

/* GET /announcements/active — the server has already decided "is this live
   right now" against its own clock and the caller's academy; this hook just
   asks and renders. A 5-minute refetch means a newly published announcement
   can appear mid-session without requiring a fresh login, while the actual
   trigger the popup relies on is still the once-per-session mount below. */
export function useActiveAnnouncements() {
  return useQuery({
    queryKey:        ['announcements', 'active'],
    queryFn:         () => apiGet<Announcement[]>('/announcements/active'),
    staleTime:       5 * 60_000,
    refetchInterval: 5 * 60_000,
    /* A failed fetch here must stay silent and simply show nothing — an
       announcement popup is not the thing to put an error state in front of
       a student for. See the class-schedule fix earlier this session for
       why that reasoning does NOT apply to a page whose entire content is
       this one query; that page has nothing else to show instead. */
    retry: 1,
  })
}
