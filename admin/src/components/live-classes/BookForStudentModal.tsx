'use client'
import { zoneOf, foreignZoneTag } from '@/lib/timezone'

import React, { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Search, UserPlus, Check, AlertCircle, Building2 } from 'lucide-react'
import { useUsers } from '@/lib/api/users'
import Spinner from '@/components/ui/Spinner'
import { useAdminBookForStudent } from '@/lib/api/adminBookings'
import type { LiveClass } from '@/lib/api/liveClasses'
import type { AdminUser } from '@/lib/api/users'

interface Props {
  live: LiveClass
  onClose: () => void
  onSuccess?: () => void
}

export function BookForStudentModal({ live, onClose, onSuccess }: Props) {
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [selectedStudent, setSelectedStudent] = useState<AdminUser | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const { mutate: bookForStudent, isPending } = useAdminBookForStudent()

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  /* Debounce search */
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  const { data, isLoading: searching } = useUsers('student', {
    search: debouncedSearch || undefined,
    per_page: 20,
    status: 'active',
    enrollmentStatus: 'approved',
  })

  const students = data?.docs ?? []

  function handleBook() {
    if (!selectedStudent) return
    setError(null)
    bookForStudent(
      { liveClassId: live.id, studentId: selectedStudent.id },
      {
        onSuccess: () => {
          onSuccess?.()
          onClose()
        },
        onError: (err: any) => {
          const msg = err?.response?.data?.error?.message ?? 'Booking failed'
          setError(msg)
        },
      },
    )
  }

  /* The session this student is being booked into. Showing it in the wrong
     academy's clock is a mistake that reaches the student, so it is read in
     the class's own zone and tagged when that differs from the panel's. */
  const scheduledDate = new Date(live.scheduledStart).toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
    timeZone: zoneOf(live.organizationSlug),
  }) + (foreignZoneTag(live.organizationSlug) ? ' ' + foreignZoneTag(live.organizationSlug) : '')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 8 }}
        transition={{ duration: 0.18 }}
        className="relative w-full max-w-md rounded-2xl border shadow-2xl overflow-hidden"
        style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.08)' }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: 'rgba(52,211,153,0.12)' }}>
              <Building2 size={14} style={{ color: '#34D399' }} />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">Book Seat for Student</h2>
              <p className="text-[11px] mt-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
                {live.title} · {scheduledDate}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-white/10"
            style={{ color: 'rgba(255,255,255,0.4)' }}>
            <X size={14} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Capacity info */}
          <div className="flex items-center justify-between text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
            <span>Capacity</span>
            <span>
              <span className="text-white font-semibold">{live.bookedCount}</span>
              {' / '}
              <span>{live.sessionCapacity}</span>
              {live.bookedCount >= live.sessionCapacity && (
                <span className="ml-1.5 text-red-400 font-semibold">FULL</span>
              )}
            </span>
          </div>

          {/* Search */}
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'rgba(255,255,255,0.55)' }}>
              Search Student
            </label>
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'rgba(255,255,255,0.3)' }} />
              <input
                ref={inputRef}
                value={search}
                onChange={e => { setSearch(e.target.value); setSelectedStudent(null); setError(null) }}
                placeholder="Name or email…"
                className="w-full rounded-lg border py-2 pl-8 pr-3 text-sm text-white placeholder-white/25 outline-none transition-colors focus:border-orange-500/50"
                style={{ background: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.1)' }}
              />
              {searching && (
                <Spinner size={12} variant="muted" className="absolute right-3 top-1/2 -translate-y-1/2" />
              )}
            </div>
          </div>

          {/* Student list */}
          {students.length > 0 && !selectedStudent && (
            <div className="max-h-48 overflow-y-auto rounded-xl border" style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)' }}>
              {students.map(s => (
                <button
                  key={s.id}
                  onClick={() => { setSelectedStudent(s); setError(null) }}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-white/[0.04]"
                  style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold"
                    style={{ background: 'rgba(0,87,184,0.15)', color: '#0057b8' }}>
                    {s.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-white truncate">{s.name}</p>
                    <p className="text-[11px] truncate" style={{ color: 'rgba(255,255,255,0.4)' }}>{s.email}</p>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Selected student */}
          {selectedStudent && (
            <div className="flex items-center gap-3 rounded-xl px-3 py-2.5" style={{ background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.18)' }}>
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold"
                style={{ background: 'rgba(52,211,153,0.15)', color: '#34D399' }}>
                {selectedStudent.name.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-white">{selectedStudent.name}</p>
                <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.5)' }}>{selectedStudent.email}</p>
              </div>
              <button
                onClick={() => { setSelectedStudent(null); setSearch(''); setError(null) }}
                className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-white/10"
                style={{ color: 'rgba(255,255,255,0.4)' }}>
                <X size={12} />
              </button>
            </div>
          )}

          {/* Error */}
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="flex items-start gap-2 rounded-xl px-3 py-2.5 text-xs"
                style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#FCA5A5' }}>
                <AlertCircle size={13} className="mt-0.5 flex-shrink-0" />
                {error}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 pb-5">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-xs font-medium transition-colors hover:bg-white/[0.06]"
            style={{ color: 'rgba(255,255,255,0.5)' }}>
            Cancel
          </button>
          <button
            onClick={handleBook}
            disabled={!selectedStudent || isPending || live.bookedCount >= live.sessionCapacity}
            className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: selectedStudent ? '#34D399' : 'rgba(52,211,153,0.3)', color: '#0a2a1e' }}>
            {isPending ? <Spinner size={12} /> : <UserPlus size={12} />}
            {isPending ? 'Booking…' : 'Book Seat'}
          </button>
        </div>
      </motion.div>
    </div>
  )
}
