'use client'

import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, Plus, AlertCircle, MapPin, Building2,
  Users, Calendar, Clock, BookOpen, Globe, User, FileText, Radio, Video, Wifi, Link2,
} from 'lucide-react'
import { useCreateLiveClass } from '@/lib/api/liveClasses'
import { datetimeLocalToISO } from '@/lib/timezone'
import Spinner from '@/components/ui/Spinner'
import { useCourses } from '@/lib/api/courses'
import { useCourseOutline } from '@/lib/api/outline'
import { useProgramInstructors, useDropInstructorOutside } from '@/lib/api/users'
import { Button } from '@/components/ui/button'
import { DarkSelect, DarkDateTimePicker, PillToggle } from './FormWidgets'
import { IN_APP_RGB, MEET_RGB, ROOM_RGB, BROADCAST_RGB, LIVEKIT_MAX_SEATS, OPEN_SEATS_DEFAULT } from '@/lib/liveClassTheme'
import type { LiveClassType } from '@/lib/api/liveClasses'
import { CLASS_LANGUAGES, withFlag } from '@/lib/languages'
import { useBackdropClose } from '@/hooks/useBackdropClose'

interface Props {
  onClose:          () => void
  onSuccess:        () => void
  categoryProgram?: string
  prefillDate?:     string   // YYYY-MM-DDTHH:MM — from timetable slot click
}

/* From lib/languages, which mirrors the backend's LIVE_LANGUAGES. This list
   used to be hand-kept and had drifted furthest of the nine: it offered
   French and Spanish, which the create validator rejects outright, so two of
   its eight options could only ever produce a 400. */
const LANGUAGE_OPTIONS = CLASS_LANGUAGES.map(l => ({ value: l.value, label: withFlag(l) }))

/* The online twin's seats follow its mode, exactly as in New Session: an
   interactive room is capped by the meeting platform, Meet and broadcast are not. */
const onlineSeatsFor = (t: LiveClassType, p: 'mux' | 'livekit') =>
  t === 'internal' && p === 'livekit' ? LIVEKIT_MAX_SEATS : OPEN_SEATS_DEFAULT
const GREEN = '52,211,153'

export function CreateOfflineClassModal({ onClose, onSuccess, categoryProgram, prefillDate }: Props) {
  const backdrop = useBackdropClose(onClose)
  const createMutation = useCreateLiveClass()
  const { data: coursesData,     isLoading: loadingCourses }     = useCourses({ per_page: 200, ...(categoryProgram ? { program: categoryProgram } : {}) })

  const courses     = coursesData?.docs     ?? []

  const [courseId,        setCourseId]        = useState(courses[0]?.id ?? '')
  /* Only the chosen course's programme teaches it. */
  const courseProgram    = courses.find(c => c.id === courseId)?.program
  const instructorsQuery = useProgramInstructors(courseProgram)
  const loadingInstructors = instructorsQuery.isLoading
  const instructors      = instructorsQuery.data?.docs ?? []
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
  /* Hybrid class (plan.md §12): the same class, also online — one request
     creates both, linked; students book one seat or the other. */
  const [alsoOnline,      setAlsoOnline]      = useState(false)
  const [onlineType,      setOnlineType]      = useState<LiveClassType>('internal')
  const [onlineProvider,  setOnlineProvider]  = useState<'mux' | 'livekit'>('livekit')
  const [onlineSeats,     setOnlineSeats]     = useState<number | ''>(onlineSeatsFor('internal', 'livekit'))
  const chooseOnlineType = (t: LiveClassType) => { setOnlineType(t); setOnlineSeats(onlineSeatsFor(t, onlineProvider)) }
  const chooseOnlineProvider = (p: 'mux' | 'livekit') => { setOnlineProvider(p); setOnlineSeats(onlineSeatsFor(onlineType, p)) }
  const onlineOverCap = onlineType === 'internal' && onlineProvider === 'livekit'
    && onlineSeats !== '' && Number(onlineSeats) > LIVEKIT_MAX_SEATS
  useDropInstructorOutside(instructorsQuery.isSuccess ? instructors : undefined, instructorId, setInstructorId)

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
    if (alsoOnline && onlineOverCap) { setError(`An interactive room holds up to ${LIVEKIT_MAX_SEATS} people — lower the online seats or choose Broadcast.`); return }
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
        ...(alsoOnline ? { alsoOnline: {
          type: onlineType,
          ...(onlineType === 'internal' ? { provider: onlineProvider } : {}),
          ...(onlineSeats !== '' ? { sessionCapacity: onlineSeats } : {}),
        } } : {}),
      })
      onSuccess()
    } catch (err: any) {
      setError(
        err?.response?.data?.error?.message
        ?? err?.response?.data?.error?.details?.[0]?.message
        ?? (alsoOnline ? 'Could not create the hybrid class. Nothing was created — try again.' : 'Could not create offline class.'),
      )
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.65)' }}
      {...backdrop}
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
              <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.35)' }}>
                {alsoOnline ? 'In-person + online (hybrid)' : 'In-person classroom session'}
              </p>
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

          {/* Date, Duration, Max Seats.
              Two columns on a phone, three from `sm` up, with the date taking
              the full first row below `sm`. A third of this modal at 375px is
              about 90px, and after the field's own padding that left ~45px for
              "Mon, 10 Mar 2026 · 09:00" — the one control whose whole job is to
              show you what you picked. Duration and Max Seats are short numbers
              and pair up happily underneath. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="col-span-2 sm:col-span-1">
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
                placeholder={courseProgram && instructorsQuery.isSuccess && instructors.length === 0
                  ? 'No instructors in this programme — default (current user)'
                  : 'Default (current user)'}
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

          {/* Also online — a hybrid class (plan.md §12). One card, closed by
              default so the ordinary in-person form looks as it always has;
              switched on, it opens in place (no second modal) and takes the
              same pills and colours as New Session, so the choice reads the
              same in both forms. */}
          <div className="rounded-xl transition-colors"
            style={{
              background: alsoOnline ? `rgba(${GREEN},0.06)` : 'rgba(255,255,255,0.03)',
              border: `1px solid ${alsoOnline ? `rgba(${GREEN},0.30)` : 'rgba(255,255,255,0.08)'}`,
            }}>
            <button type="button" role="switch" aria-checked={alsoOnline}
              onClick={() => setAlsoOnline(v => !v)}
              className="flex w-full items-center gap-3 px-3 py-2.5 text-left">
              <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg"
                style={{ background: alsoOnline ? `rgba(${GREEN},0.15)` : 'rgba(255,255,255,0.05)' }}>
                <Wifi size={14} style={{ color: alsoOnline ? `rgb(${GREEN})` : 'rgba(255,255,255,0.45)' }} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-white">Also run it online</span>
                <span className="block text-[11px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
                  Create a linked online class at the same time, for students who can&apos;t come in
                </span>
              </span>
              <span className="relative h-5 w-9 flex-shrink-0 rounded-full transition-colors"
                style={{ background: alsoOnline ? `rgb(${GREEN})` : 'rgba(255,255,255,0.15)' }}>
                <span className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all"
                  style={{ left: alsoOnline ? 18 : 2 }} />
              </span>
            </button>

            <AnimatePresence initial={false}>
              {alsoOnline && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  className="overflow-hidden">
                  <div className="space-y-2.5 border-t px-3 pb-3 pt-2.5" style={{ borderColor: `rgba(${GREEN},0.18)` }}>
                    <div className="flex flex-wrap items-end justify-between gap-3">
                      <div>
                        <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.35)' }}>Online via</p>
                        <div className="flex gap-2">
                          <PillToggle active={onlineType === 'internal'} onClick={() => chooseOnlineType('internal')} rgb={IN_APP_RGB}>
                            <Radio size={11} />In-App Stream
                          </PillToggle>
                          <PillToggle active={onlineType === 'external'} onClick={() => chooseOnlineType('external')} rgb={MEET_RGB}>
                            <Video size={11} />Google Meet
                          </PillToggle>
                        </div>
                      </div>
                      <div className="w-24">
                        <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.35)' }}>Online seats</p>
                        <input type="number" min={1} max={500} step={1} aria-label="Online seats"
                          value={onlineSeats}
                          onChange={e => setOnlineSeats(e.target.value === '' ? '' : Number(e.target.value))}
                          className={base} style={{ ...iStyle, ...(onlineOverCap ? { borderColor: 'rgba(248,113,113,0.6)' } : {}) }} />
                      </div>
                    </div>

                    {onlineType === 'internal' && (
                      <div>
                        <div className="flex gap-2">
                          <PillToggle small active={onlineProvider === 'livekit'} onClick={() => chooseOnlineProvider('livekit')} rgb={ROOM_RGB}>
                            Interactive room
                          </PillToggle>
                          <PillToggle small active={onlineProvider === 'mux'} onClick={() => chooseOnlineProvider('mux')} rgb={BROADCAST_RGB}>
                            Broadcast
                          </PillToggle>
                        </div>
                        <p className="mt-1.5 text-[10px]" style={{ color: onlineOverCap ? '#F87171' : 'rgba(255,255,255,0.35)' }}>
                          {onlineProvider === 'mux'
                            ? 'One-way stream. Students watch; no seat limit.'
                            : `Two-way room — students can speak and share. Up to ${LIVEKIT_MAX_SEATS} seats.`}
                        </p>
                      </div>
                    )}
                    {onlineType === 'external' && (
                      <p className="flex items-center gap-1 text-[10px]" style={{ color: `rgba(${MEET_RGB},0.75)` }}>
                        <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: `rgb(${MEET_RGB})` }} />
                        A Google Meet link is created for the online class — the mentor is invited
                      </p>
                    )}

                    <p className="flex items-start gap-1.5 text-[11px] leading-relaxed" style={{ color: 'rgba(255,255,255,0.5)' }}>
                      <Link2 size={11} className="mt-0.5 flex-shrink-0" style={{ color: `rgb(${GREEN})` }} />
                      <span>Same course, module, title, time and mentor. Students book <strong className="text-white/80">one</strong> seat — in the room or online — and are notified once.</span>
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
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
              {alsoOnline
                ? <>Two linked classes will be created: <strong style={{ color: '#34D399' }}>in person</strong> at the venue above, and <strong style={{ color: '#34D399' }}>online</strong> via {onlineType === 'external' ? 'Google Meet' : 'the in-app stream'}. Each is edited on its own afterwards.</>
                : <>This is an <strong style={{ color: '#34D399' }}>offline in-person session</strong>. Students will receive location details in their booking confirmation. No online meeting link will be generated.</>}
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
                : <><Plus size={14} />{alsoOnline ? 'Create Hybrid Class' : 'Create Offline Class'}</>}
            </Button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  )
}
