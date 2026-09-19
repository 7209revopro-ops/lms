'use client'

import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown, ChevronLeft, ChevronRight, Check, Calendar, Clock } from 'lucide-react'

/* ─────────────────────────────────────────────────────────────
   PillToggle — one pill in a mutually-exclusive row
───────────────────────────────────────────────────────────── */
/* The accent arrives as an "r,g,b" triple so idle, hover and selected are three
   tints of ONE colour instead of three unrelated ones. Hover has to live in
   state rather than a `hover:` class: the idle look is an inline style, and an
   inline background beats any class. */
export function PillToggle({ active, onClick, rgb, small, children }: {
  active: boolean
  onClick: () => void
  rgb: string
  small?: boolean
  children: React.ReactNode
}) {
  const [hover, setHover] = useState(false)
  const style = active
    ? { background: `rgba(${rgb},0.18)`, color: `rgb(${rgb})`, border: `1px solid rgba(${rgb},0.35)` }
    : hover
      ? { background: `rgba(${rgb},0.10)`, color: `rgb(${rgb})`, border: `1px solid rgba(${rgb},0.22)` }
      : { background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.45)', border: '1px solid rgba(255,255,255,0.08)' }
  return (
    <button type="button" onClick={onClick}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl font-semibold transition-all ${small ? 'py-1.5 text-[11px]' : 'py-2 text-xs'}`}
      style={style}>
      {children}
    </button>
  )
}

/* ─────────────────────────────────────────────────────────────
   DarkSelect — custom animated dropdown for dark modal forms
───────────────────────────────────────────────────────────── */
export interface SelectOption { value: string; label: string }

export function DarkSelect({
  value, onChange, options, placeholder, disabled, loading, loadingText,
}: {
  value: string
  onChange: (v: string) => void
  options: SelectOption[]
  placeholder?: string
  disabled?: boolean
  loading?: boolean
  loadingText?: string
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos]   = useState({ top: 0, left: 0, width: 0 })
  const btnRef   = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const selected     = options.find(o => o.value === value)
  const displayLabel = loading
    ? (loadingText ?? 'Loading…')
    : (selected?.label ?? placeholder ?? 'Select…')
  const hasValue = !loading && !!selected

  const toggle = () => {
    if (disabled || loading) return
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setPos({ top: r.bottom + 4, left: r.left, width: r.width })
    }
    setOpen(v => !v)
  }

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (!btnRef.current?.contains(e.target as Node) && !panelRef.current?.contains(e.target as Node))
        setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        disabled={disabled || loading}
        onClick={toggle}
        className="w-full flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-left transition-all outline-none disabled:opacity-50 disabled:cursor-not-allowed"
        style={{
          background: '#1e2035',
          border: open ? '1px solid rgba(96,165,250,0.45)' : '1px solid rgba(255,255,255,0.11)',
          color: hasValue ? '#fff' : 'rgba(255,255,255,0.3)',
          boxShadow: open ? '0 0 0 3px rgba(96,165,250,0.07)' : 'none',
        }}
      >
        <span className="flex-1 truncate">{displayLabel}</span>
        <ChevronDown
          size={13}
          className="flex-shrink-0 transition-transform duration-200"
          style={{ color: 'rgba(255,255,255,0.3)', transform: open ? 'rotate(180deg)' : 'none' }}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            ref={panelRef}
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.12 }}
            style={{
              position: 'fixed',
              top: pos.top,
              left: pos.left,
              width: pos.width,
              zIndex: 9999,
              background: '#181a2e',
              border: '1px solid rgba(255,255,255,0.10)',
              borderRadius: 12,
              boxShadow: '0 16px 48px rgba(0,0,0,0.55)',
              overflow: 'hidden',
            }}
          >
            <div className="py-1.5 max-h-56 overflow-y-auto">
              {placeholder && (
                <SelectOpt
                  label={placeholder}
                  selected={!value}
                  dimmed
                  onClick={() => { onChange(''); setOpen(false) }}
                />
              )}
              {options.map(o => (
                <SelectOpt
                  key={o.value}
                  label={o.label}
                  selected={o.value === value}
                  onClick={() => { onChange(o.value); setOpen(false) }}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function SelectOpt({ label, selected, onClick, dimmed }: {
  label: string; selected: boolean; onClick: () => void; dimmed?: boolean
}) {
  const [hov, setHov] = useState(false)
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left"
      style={{
        color: selected ? '#60a5fa' : dimmed ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.8)',
        background: selected ? 'rgba(96,165,250,0.09)' : hov ? 'rgba(255,255,255,0.05)' : 'transparent',
        transition: 'background 0.1s',
      }}
    >
      <span className="flex-1 truncate">{label}</span>
      {selected && !dimmed && <Check size={12} style={{ color: '#60a5fa', flexShrink: 0 }} />}
    </button>
  )
}

/* ─────────────────────────────────────────────────────────────
   DarkDateTimePicker — calendar grid + scrollable time columns
   Value in / out: "YYYY-MM-DDTHH:MM" (datetime-local format)
───────────────────────────────────────────────────────────── */
const CAL_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
const CAL_DAYS   = ['Su','Mo','Tu','We','Th','Fr','Sa']
const HOURS      = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const MINUTES    = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'))

/* The panel's real measurements, declared once and used both to lay it out and
   to place it. They used to live only in the placement maths, as a magic 376
   that did not match the box it was reserving room for. */
const CAL_W   = 268                        // calendar column
const TIME_W  = 126                        // HH / MM column
const PANEL_W = CAL_W + 1 + TIME_W         // + 1px divider = 395
const PANEL_H = 340

function parseVal(v: string): Date | null {
  if (!v) return null
  const [dp, tp] = v.split('T')
  if (!dp) return null
  const [y, mo, d] = dp.split('-').map(Number)
  const [h = 9, m = 0] = (tp ?? '').split(':').map(Number)
  return new Date(y, mo - 1, d, h, m)
}

function fmtVal(d: Date, h: string, m: string): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${h}:${m}`
}

export function DarkDateTimePicker({ value, onChange }: {
  value: string
  onChange: (v: string) => void
}) {
  const init = parseVal(value)

  const [calOpen,   setCalOpen]   = useState(false)
  const [viewYear,  setViewYear]  = useState(init?.getFullYear()  ?? new Date().getFullYear())
  const [viewMonth, setViewMonth] = useState(init?.getMonth()     ?? new Date().getMonth())
  const [selDate,   setSelDate]   = useState<Date | null>(init)
  const [hour,      setHour]      = useState(init ? String(init.getHours()).padStart(2, '0')   : '09')
  const [minute,    setMinute]    = useState(init ? String(init.getMinutes()).padStart(2, '0') : '00')

  const btnRef    = useRef<HTMLButtonElement>(null)
  const panelRef  = useRef<HTMLDivElement>(null)
  const hourRef   = useRef<HTMLDivElement>(null)
  const minuteRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })

  /* The panel is a FIXED-position element, so anything that lands outside the
     viewport is not merely off to the side — it is unreachable. A fixed box
     adds nothing to the scrollable area, so no amount of scrolling the page or
     the modal will ever bring it back.

     That is exactly what happened at 375px. The panel is 268 + 1 + 126 = 395px
     wide and was pinned at `left: r.left`. Opened from the Date & Time column
     of the offline-class modal the trigger starts at x=40 (16px backdrop +
     24px modal padding), so the panel ran 40 → 435 on a 375px screen and the
     whole MM column sat past the right edge: on a phone you could not set the
     minutes of a class at all.

     Vertically the old constant was simply wrong — it reserved 376px for a
     panel that measures about 340 — and `r.top - 376` was never floored, so a
     trigger 350px down a 667px screen produced top: -68 and hid the month
     arrows above the top edge.

     So: measure honestly, flip up only when down will not fit, and clamp both
     axes into the viewport. On a laptop every clamp is a no-op and the panel
     opens exactly where it always did. */
  const toggle = () => {
    if (!calOpen && btnRef.current) {
      const r   = btnRef.current.getBoundingClientRect()
      const M   = 8   // breathing room against the viewport edge

      const below = window.innerHeight - r.bottom >= PANEL_H + M
      const top   = below
        ? r.bottom + 6
        : Math.max(M, Math.min(r.top - PANEL_H - 6, window.innerHeight - PANEL_H - M))

      const left = Math.max(M, Math.min(r.left, window.innerWidth - PANEL_W - M))

      setPos({ top, left })
    }
    setCalOpen(v => !v)
  }

  // Scroll time columns to selected value when calendar opens
  useEffect(() => {
    if (!calOpen) return
    const hi = HOURS.indexOf(hour)
    const mi = MINUTES.indexOf(minute)
    setTimeout(() => {
      if (hourRef.current   && hi >= 0) hourRef.current.scrollTop   = hi * 36
      if (minuteRef.current && mi >= 0) minuteRef.current.scrollTop = mi * 36
    }, 50)
  }, [calOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (!btnRef.current?.contains(e.target as Node) && !panelRef.current?.contains(e.target as Node))
        setCalOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const emit = (d: Date | null, h: string, m: string) => {
    if (d) onChange(fmtVal(d, h, m))
  }

  const pickDay = (d: Date) => { setSelDate(d); emit(d, hour, minute) }
  const pickHour = (h: string) => { setHour(h); emit(selDate, h, minute) }
  const pickMin  = (m: string) => { setMinute(m); emit(selDate, hour, m) }

  const goToday = () => {
    const now = new Date()
    setViewYear(now.getFullYear()); setViewMonth(now.getMonth()); setSelDate(now)
    const h = String(now.getHours()).padStart(2, '0')
    const m = String(now.getMinutes()).padStart(2, '0')
    setHour(h); setMinute(m); emit(now, h, m)
  }

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1) }
    else setViewMonth(m => m - 1)
  }
  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1) }
    else setViewMonth(m => m + 1)
  }

  // Build calendar grid (6 rows × 7 cols = 42 cells)
  const firstDay    = new Date(viewYear, viewMonth, 1).getDay()
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const daysInPrev  = new Date(viewYear, viewMonth, 0).getDate()

  const today  = new Date()
  const todayK = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`
  const selK   = selDate ? `${selDate.getFullYear()}-${selDate.getMonth()}-${selDate.getDate()}` : null

  type Cell = { day: number; current: boolean; date: Date }
  const cells: Cell[] = []
  for (let i = firstDay - 1; i >= 0; i--) {
    const pmo = viewMonth === 0 ? 11 : viewMonth - 1
    const pyr = viewMonth === 0 ? viewYear - 1 : viewYear
    cells.push({ day: daysInPrev - i, current: false, date: new Date(pyr, pmo, daysInPrev - i) })
  }
  for (let i = 1; i <= daysInMonth; i++)
    cells.push({ day: i, current: true, date: new Date(viewYear, viewMonth, i) })
  const rem = 42 - cells.length
  for (let i = 1; i <= rem; i++) {
    const nmo = viewMonth === 11 ? 0 : viewMonth + 1
    const nyr = viewMonth === 11 ? viewYear + 1 : viewYear
    cells.push({ day: i, current: false, date: new Date(nyr, nmo, i) })
  }

  const displayDate = selDate
    ? selDate.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
    : 'Select a date & time…'

  return (
    <div className="relative">
      {/* ── Trigger ── */}
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        className="w-full flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-left transition-all outline-none"
        style={{
          background: 'rgba(255,255,255,0.05)',
          border: calOpen ? '1px solid rgba(96,165,250,0.45)' : '1px solid rgba(255,255,255,0.09)',
          boxShadow: calOpen ? '0 0 0 3px rgba(96,165,250,0.07)' : 'none',
        }}
      >
        <Calendar size={13} style={{ color: 'rgba(255,255,255,0.35)', flexShrink: 0 }} />
        <span className="flex-1 truncate" style={{ color: selDate ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.3)' }}>
          {displayDate}
        </span>
        {selDate && (
          <span className="text-xs font-semibold flex-shrink-0" style={{ color: '#60a5fa' }}>
            {hour}:{minute}
          </span>
        )}
      </button>

      {/* ── Calendar + time panel ── */}
      <AnimatePresence>
        {calOpen && (
          <motion.div
            ref={panelRef}
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            className="flex"
            style={{
              position: 'fixed',
              top: pos.top,
              left: pos.left,
              zIndex: 99999,
              background: '#131526',
              border: '1px solid rgba(255,255,255,0.09)',
              borderRadius: 16,
              boxShadow: '0 24px 64px rgba(0,0,0,0.65)',
              /* The clamp in toggle() keeps the panel's top-left on screen, but
                 395px still does not fit a 375px phone, so the last ~30px would
                 stay cut off with nowhere to scroll. Capping to the viewport and
                 swapping `hidden` for `auto` makes the remainder reachable by
                 swiping inside the panel. Both caps are larger than the panel on
                 any laptop, so no scrollbar ever appears there. */
              maxWidth:  'calc(100vw - 16px)',
              maxHeight: 'calc(100vh - 16px)',
              overflow: 'auto',
            }}
          >
            {/* ── Calendar section ── */}
            <div style={{ width: CAL_W, flexShrink: 0, padding: '16px 14px 12px' }}>
              {/* Month navigation */}
              <div className="flex items-center justify-between mb-3">
                <button type="button" onClick={prevMonth}
                  className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-white/10"
                  style={{ color: 'rgba(255,255,255,0.4)' }}>
                  <ChevronLeft size={14} />
                </button>
                <span className="text-sm font-bold text-white">
                  {CAL_MONTHS[viewMonth]}, {viewYear}
                </span>
                <button type="button" onClick={nextMonth}
                  className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-white/10"
                  style={{ color: 'rgba(255,255,255,0.4)' }}>
                  <ChevronRight size={14} />
                </button>
              </div>

              {/* Day headers */}
              <div className="grid grid-cols-7 mb-1">
                {CAL_DAYS.map(d => (
                  <div key={d} className="flex h-7 items-center justify-center text-[10px] font-bold"
                    style={{ color: 'rgba(255,255,255,0.22)' }}>
                    {d}
                  </div>
                ))}
              </div>

              {/* Day cells */}
              <div className="grid grid-cols-7">
                {cells.map((cell, i) => {
                  const k      = `${cell.date.getFullYear()}-${cell.date.getMonth()}-${cell.date.getDate()}`
                  const isSel  = k === selK
                  const isToday = k === todayK
                  return (
                    <DayCell
                      key={i}
                      day={cell.day}
                      current={cell.current}
                      selected={isSel}
                      today={isToday}
                      onClick={() => pickDay(cell.date)}
                    />
                  )
                })}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between mt-2 pt-2"
                style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <button type="button"
                  onClick={() => { setSelDate(null); onChange('') }}
                  className="text-[11px] font-semibold px-2.5 py-1 rounded-lg transition-colors hover:bg-white/5"
                  style={{ color: 'rgba(255,255,255,0.35)' }}>
                  Clear
                </button>
                <button type="button" onClick={goToday}
                  className="text-[11px] font-semibold px-2.5 py-1 rounded-lg transition-colors hover:bg-blue-500/20"
                  style={{ color: '#60a5fa', background: 'rgba(96,165,250,0.10)' }}>
                  Today
                </button>
              </div>
            </div>

            {/* Divider */}
            <div style={{ width: 1, background: 'rgba(255,255,255,0.07)', alignSelf: 'stretch', flexShrink: 0 }} />

            {/* ── Time picker ── */}
            <div style={{ width: TIME_W, flexShrink: 0, padding: '16px 10px' }}>
              <div className="flex items-center gap-1 justify-center mb-3">
                <Clock size={11} style={{ color: 'rgba(255,255,255,0.3)' }} />
                <span className="text-[10px] font-bold uppercase tracking-widest"
                  style={{ color: 'rgba(255,255,255,0.3)' }}>
                  Time
                </span>
              </div>

              <div className="flex items-start justify-center gap-1">
                {/* Hours */}
                <div style={{ width: 46 }}>
                  <div className="text-center text-[9px] font-bold uppercase tracking-widest mb-1"
                    style={{ color: 'rgba(255,255,255,0.2)' }}>HH</div>
                  <div
                    ref={hourRef}
                    style={{ height: 180, overflowY: 'auto', scrollBehavior: 'smooth', scrollbarWidth: 'none' }}
                  >
                    {HOURS.map(h => (
                      <TimeItem key={h} value={h} selected={h === hour} onSelect={pickHour} />
                    ))}
                  </div>
                </div>
                <span className="pt-8 text-sm font-bold" style={{ color: 'rgba(255,255,255,0.25)' }}>:</span>
                {/* Minutes */}
                <div style={{ width: 46 }}>
                  <div className="text-center text-[9px] font-bold uppercase tracking-widest mb-1"
                    style={{ color: 'rgba(255,255,255,0.2)' }}>MM</div>
                  <div
                    ref={minuteRef}
                    style={{ height: 180, overflowY: 'auto', scrollBehavior: 'smooth', scrollbarWidth: 'none' }}
                  >
                    {MINUTES.map(m => (
                      <TimeItem key={m} value={m} selected={m === minute} onSelect={pickMin} />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function DayCell({ day, current, selected, today, onClick }: {
  day: number; current: boolean; selected: boolean; today: boolean; onClick: () => void
}) {
  const [hov, setHov] = useState(false)
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      className="flex h-8 items-center justify-center text-xs transition-all"
      style={{
        width: 32,
        margin: '0 auto',
        borderRadius: '50%',
        color: selected ? '#fff'
          : today    ? '#60a5fa'
          : current  ? 'rgba(255,255,255,0.75)'
          :            'rgba(255,255,255,0.2)',
        background: selected ? '#0057b8'
          : hov && !selected ? 'rgba(255,255,255,0.08)'
          : 'transparent',
        border: today && !selected ? '1px solid rgba(96,165,250,0.4)' : '1px solid transparent',
        fontWeight: selected || today ? 700 : 400,
      }}
    >
      {day}
    </button>
  )
}

function TimeItem({ value, selected, onSelect }: {
  value: string; selected: boolean; onSelect: (v: string) => void
}) {
  const [hov, setHov] = useState(false)
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      className="flex h-9 w-full items-center justify-center rounded-lg text-sm font-semibold transition-all"
      style={{
        color: selected ? '#fff' : 'rgba(255,255,255,0.3)',
        background: selected ? '#0057b8' : hov ? 'rgba(255,255,255,0.07)' : 'transparent',
      }}
    >
      {value}
    </button>
  )
}
