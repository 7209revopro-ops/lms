'use client'

import React from 'react'
import { Building2 } from 'lucide-react'
import { useClassRoomsFree } from '@/lib/api/pods'

/* The room an offline class is held in (2026-10-19): one of the academy's class rooms — Class Room 1, Class Room 2,
   Ball Room 1, Meeting Room 3 — booked in the HRMS so two classes never share one; or "Any free room", the LMS
   picking the first free at that time. Each shows whether it is free for the class's time. With the HRMS not set up
   on this server it is the old free-text box. */

interface Props {
  value: string
  onChange: (room: string) => void
  /** The class's start, as an ISO string (null until picked) and its length. */
  startISO: string | null
  durationMins: number
  /** Editing: the class's own booking doesn't make its room look taken. */
  classId?: string
  inputClassName: string
  inputStyle: React.CSSProperties
}

export function ClassRoomPicker({ value, onChange, startISO, durationMins, classId, inputClassName, inputStyle }: Props) {
  const { data, isLoading } = useClassRoomsFree(startISO, durationMins, classId)
  const rooms = data?.rooms ?? []

  if (data && (!data.configured || !rooms.length)) {
    return (
      <div className="relative">
        <Building2 size={13} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: '#34D399' }} />
        <input value={value} onChange={e => onChange(e.target.value)} placeholder="e.g. Room 204"
          className={`${inputClassName} pl-9`} style={inputStyle} />
      </div>
    )
  }

  const picked = rooms.find(r => r.name.toLowerCase() === value.trim().toLowerCase())
  // A room typed before the picker (e.g. "Room 1") reads as "Any free room": the LMS takes it as a wish.
  const current = picked?.name ?? ''
  return (
    <div className="space-y-1">
      <select value={current} onChange={e => onChange(e.target.value)} className={inputClassName} style={inputStyle}>
        <option value="">Any free room (the LMS picks)</option>
        {(rooms.length ? rooms : [{ name: 'Class Room 1' }, { name: 'Class Room 2' }, { name: 'Ball Room 1' }, { name: 'Meeting Room 3' }] as Array<{ name: string; free?: boolean; holder?: string | null }>).map(r => (
          <option key={r.name} value={r.name}>
            {r.name}{'free' in r && r.free === false ? ` — taken${r.holder ? ` (${r.holder})` : ''}` : 'free' in r && r.free ? ' — free' : ''}
          </option>
        ))}
      </select>
      <p className="text-[10px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
        {!startISO ? 'Pick the date and time to see which rooms are free.'
          : isLoading ? 'Checking the rooms…'
          : picked && !picked.free ? `${picked.name} is taken then — the class will show "no room" until it's free.`
          : `${rooms.filter(r => r.free).length} of ${rooms.length} free at that time.`}
      </p>
    </div>
  )
}
