'use client'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/axios'

export type LevelState = 'completed' | 'current' | 'next' | 'locked'
export interface JourneyModule { id: string; title: string; number: number; locked: boolean }
export interface JourneyLevel {
  courseId: string; title: string; slug?: string; thumbnailUrl?: string; description?: string
  level: number; state: LevelState; progressPercent: number
  modules: JourneyModule[]; modulesOpen: number; modulesTotal: number
  lockReason?: 'payment' | 'academy'; classesAttended: number
}
export interface Journey {
  programmes: Array<{ program: string; label: string; levels: JourneyLevel[] }>
  advisor: { name?: string; team?: string } | null
}

/** GET /live-classes/journey — the student's programme levels. */
export function useJourney() {
  return useQuery({
    queryKey: ['live-classes', 'journey'],
    queryFn: () => apiGet<Journey>('/live-classes/journey'),
    staleTime: 60_000,
  })
}

/** Ask the Class Schedule's journey bar to explain a locked module. */
export function showModuleLocked(detail: { courseId?: string; courseTitle?: string; moduleTitle?: string }) {
  window.dispatchEvent(new CustomEvent('lms:module-locked', { detail }))
}
