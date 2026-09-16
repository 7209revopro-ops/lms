'use client'

import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, Plus, AlertCircle, MapPin, Building2,
  Users, Calendar, Clock, BookOpen, Globe, User, FileText,
} from 'lucide-react'
import { useCreateLiveClass } from '@/lib/api/liveClasses'
import { datetimeLocalToISO } from '@/lib/timezone'
import Spinner from '@/components/ui/Spinner'
import { useCourses } from '@/lib/api/courses'
import { useCourseOutline } from '@/lib/api/outline'
import { useUsers } from '@/lib/api/users'
import { Button } from '@/components/ui/button'
import { DarkSelect, DarkDateTimePicker } from './FormWidgets'

interface Props {
  onClose:          () => void
  onSuccess:        () => void
  categoryProgram?: string
  prefillDate?:     string   // YYYY-MM-DDTHH:MM — from timetable slot click
}

const LANGUAGE_OPTIONS = [
  { value: 'English',   label: '🇬🇧 English' },
  { value: 'Arabic',    label: '🇦🇪 Arabic' },
  { value: 'Hindi',     label: '🇮🇳 Hindi' },
  { value: 'Malayalam', label: '🇮🇳 Malayalam' },
  { value: 'Tamil',     label: '🇮🇳 Tamil' },
  { value: 'Urdu',      label: '🇵🇰 Urdu' },
  { value: 'French',    label: '🇫🇷 French' },
  { value: 'Spanish',   label: '🇪🇸 Spanish' },
]

export function CreateOfflineClassModal({ onClose, onSuccess, categoryProgram, prefillDate }: Props) {
  const createMutation = useCreateLiveClass()
  const { data: coursesData,     isLoading: loadingCourses }     = useCourses({ per_page: 200, ...(categoryProgram ? { program: categoryProgram } : {}) })
  const { data: instructorsData, isLoading: loadingInstructors } = useUsers('instructor', { per_page: 200 })

  const courses     = coursesData?.docs     ?? []
  const instructors = instructorsData?.docs ?? []

  const [courseId,        setCourseId]        = useState(courses[0]?.id ?? '')
  const [sectionId,       setSectionId]       = useState('')
  const [title,           setTitle]           = useState('')
  const [description,     setDescription]     = useState('')
  const [start,           setStart]           = useState(prefillDate ?? '')
  const [durationMins,    setDurationMins]    = useState(60)
  const [sessionCapacity, setSessionCapacity] = useState<number | ''>(30)
  const [location,        setLocation]        = useState('')
  const [room,            setRoom]            = useState('')
  const [instructorId,    setInstructorId]    = useState('')
  const [language,        setLanguage]        = useState('English')
  const [error,           setError]           = useState<string | null>(null)

  const { data: outline } = useCourseOutline(courseId)
  const sections = outline?.sections ?? []

  const base   = 'w-full rounded-xl px-3 py-2 text-sm text-white outline-none placeholder:text-white/30'
  const iStyle = { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)' } as const

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!courseId)     { setError('Please select a course.'); return }
    if (!title.trim()) { setError('Please enter a session title.'); return }
    if (!start)        { setError('Please select a date and start time.'); return }
    if (!location.trim()) { setError('Please enter the class location/venue.'); return }
    try {
      await createMutation.mutateAsync({
        courseId,
        title:           title.trim(),
        description:     description.trim() || undefined,
        scheduledStart:  datetimeLocalToISO(start),
        durationMins,
        sessionCapacity: sessionCapacity !== '' ? sessionCapacity : undefined,
        type:            'external',
        isOnline:        false,
        location:        location.trim(),
        room:            room.trim() || undefined,
        sectionId:       sectionId || undefined,
        instructorId:    instructorId || undefined,
        language,
      })
      onSuccess()
    } catch (err: any) {
      setError(
        err?.response?.data?.error?.message
        ?? err?.response?.data?.error?.details?.[0]?.message
        ?? 'Could not create offline class.',
      )
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.65)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-lg overflow-y-auto rounded-2xl p-6 shadow-2xl"
        style={{ background: '#161829', border: '1px solid rgba(255,255,255,0.10)', maxHeight: '92vh' }}
      >
        {/* Header */}
        <div className="mb-5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl"
              style={{ background: 'rgba(52,211,153,0.15)', border: '1px solid rgba(52,211,153,0.25)' }}>
              <Building2 size={16} style={{ color: '#34D399' }} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white" style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}>
                New Offline Class
              </h2>
              <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.35)' }}>In-person classroom session</p>
            </div>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose}
            className="h-8 w-8 rounded-xl" style={{ color: 'rgba(255,255,255,0.4)' }}>
            <X size={15} />
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">

          {/* Course */}
          <div>
            <label className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest"
              style={{ color: 'rgba(255,255,255,0.35)' }}>
              <BookOpen size={9} /> Course
            </label>
            <DarkSelect
              value={courseId}
              onChange={v => { setCourseId(v); setSectionId('') }}
              options={courses.map(c => ({ value: c.id, label: c.title }))}
              placeholder="Select a course…"
              loading={loadingCourses}
              loadingText="Loading courses…"
            />
          </div>

          {/* Module (optional) */}
          <div>
            <label className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest"
              style={{ color: 'rgba(255,255,255,0.35)' }}>
              <BookOpen size={9} /> Module / Session (optional)
            </label>
            <DarkSelect
              value={sectionId}
              onChange={setSectionId}
              options={sections.map(s => ({ value: s.id, label: s.title }))}
              placeholder="No specific module"
            />
          </div>

          {/* Title */}
          <div>
            <label className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest"
              style={{ color: 'rgba(255,255,255,0.35)' }}>
              <FileText size={9} /> Session Title
            </label>
            <input value={title} onChange={e => setTitle(e.target.value)}
              required minLength={3} maxLength={255}
              placeholder="e.g. Introduction to Trading — Classroom Session"
              className={base} style={iStyle} />
          </div>

          {/* Date, Duration, Max Seats */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest"
                style={{ color: 'rgba(255,255,255,0.35)' }}>
                <Calendar size={9} /> Date & Time
              </label>
              <DarkDateTimePicker value={start} onChange={setStart} />
            </div>
            <div>
              <label className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest"
                style={{ color: 'rgba(255,255,255,0.35)' }}>
                <Clock size={9} /> Duration (mins)
              </label>
              <input type="number" min={5} max={600} step={5} value={durationMins}
                onChange={e => setDurationMins(Number(e.target.value))}
                className={base} style={iStyle} />
            </div>
            <div>
              <label className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest"
                style={{ color: 'rgba(255,255,255,0.35)' }}>
                <Users size={9} /> Max Seats
              </label>
              <input type="number" min={1} max={5000} step={1}
                value={sessionCapacity}
                onChange={e => setSessionCapacity(e.target.value === '' ? '' : Number(e.target.value))}
                placeholder="30"
                className={base} style={iStyle} />
            </div>
          </div>

          {/* Location & Room */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest"
                style={{ color: 'rgba(255,255,255,0.35)' }}>
                <MapPin size={9} /> Venue / Location
              </label>
              <div className="relative">
                <MapPin size={13} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                  style={{ color: '#34D399' }} />
                <input value={location} onChange={e => setLocation(e.target.value)}
                  required placeholder="e.g. Main Campus, Dubai"
                  className={`${base} pl-9`} style={iStyle} />
              </div>
            </div>
            <div>
              <label className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest"
                style={{ color: 'rgba(255,255,255,0.35)' }}>
                <Building2 size={9} /> Classroom / Room
              </label>
              <div className="relative">
                <Building2 size={13} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                  style={{ color: '#34D399' }} />
                <input value={room} onChange={e => setRoom(e.target.value)}
                  placeholder="e.g. Room 204"
                  className={`${base} pl-9`} style={iStyle} />
              </div>
            </div>
          </div>

          {/* Instructor & Language */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest"
                style={{ color: 'rgba(255,255,255,0.35)' }}>
                <User size={9} /> Mentor / Instructor
              </label>
              <DarkSelect
                value={instructorId}
                onChange={setInstructorId}
                options={instructors.map(i => ({ value: i.id, label: i.name }))}
                placeholder="Default (current user)"
                loading={loadingInstructors}
                loadingText="Loading…"
              />
            </div>
            <div>
              <label className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest"
                style={{ color: 'rgba(255,255,255,0.35)' }}>
                <Globe size={9} /> Language
              </label>
              <DarkSelect
                value={language}
                onChange={setLanguage}
                options={LANGUAGE_OPTIONS}
              />
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest"
              style={{ color: 'rgba(255,255,255,0.35)' }}>
              <FileText size={9} /> Description (optional)
            </label>
            <textarea value={description} onChange={e => setDescription(e.target.value)}
              rows={3} maxLength={2000}
              placeholder="Topics covered, prerequisites, what to bring…"
              className={`${base} resize-none`} style={iStyle} />
          </div>

          {/* Info banner */}
          <div className="flex items-start gap-2.5 rounded-xl px-3 py-2.5"
            style={{ background: 'rgba(52,211,153,0.07)', border: '1px solid rgba(52,211,153,0.18)' }}>
            <Building2 size={13} className="mt-0.5 flex-shrink-0" style={{ color: '#34D399' }} />
            <p className="text-[11px] leading-relaxed" style={{ color: 'rgba(255,255,255,0.45)' }}>
              This is an <strong style={{ color: '#34D399' }}>offline in-person session</strong>. Students will receive location details in their booking confirmation. No online meeting link will be generated.
            </p>
          </div>

          {error && (
            <p className="flex items-center gap-1.5 text-xs" style={{ color: '#F87171' }}>
              <AlertCircle size={11} />{error}
            </p>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={onClose}
              className="rounded-xl px-4 py-2 text-sm font-medium"
              style={{ color: 'rgba(255,255,255,0.5)' }}>
              Cancel
            </Button>
            <Button type="submit" disabled={createMutation.isPending}
              className="flex items-center gap-2 rounded-xl px-5 py-2 text-sm font-bold disabled:opacity-60"
              style={{ background: 'linear-gradient(135deg,#059669,#34D399)', color: '#fff' }}>
              {createMutation.isPending
                ? <><Spinner size={14} />Creating…</>
                : <><Plus size={14} />Create Offline Class</>}
            </Button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  )
}
