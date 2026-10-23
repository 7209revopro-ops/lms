'use client'

import { DoorOpen } from 'lucide-react'
import type { ClassPod } from '@/lib/api/liveClasses'

/** An online class's HRMS meeting pod (2026-10-18): which pod, "No pod free", or "Pod pending" while the HRMS is unreachable. */
export function PodBadge({ pod }: { pod?: ClassPod | null }) {
  if (!pod) return null
  const tone = pod.state === 'booked'
    ? { bg: 'rgba(16,185,129,0.14)', color: '#34D399', text: pod.roomName ?? 'Pod' }
    : pod.state === 'no_room'
      ? { bg: 'rgba(244,63,94,0.14)', color: '#FDA4AF', text: 'No pod free' }
      : { bg: 'rgba(251,191,36,0.14)', color: '#FBBF24', text: 'Pod pending' }
  const title = pod.state === 'booked'
    ? `${pod.roomName} is booked in the HRMS for this class`
    : pod.note || (pod.state === 'no_room' ? 'Every pod is booked at this time' : 'The HRMS could not be reached — tried again shortly')
  return (
    <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-semibold" style={{ background: tone.bg, color: tone.color }} title={title}>
      <DoorOpen size={8} />{tone.text}
    </span>
  )
}
