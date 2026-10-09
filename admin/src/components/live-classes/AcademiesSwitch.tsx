'use client'

/* For a course shared by both academies: who this class is for. "This academy"
   is the default; "Both academies" lets the other academy's students on the
   same course see, book and join it, from one shared pool of seats. */
export function AcademiesSwitch({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const opt = (on: boolean, label: string) => (
    <button type="button" onClick={() => onChange(on)}
      className="flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition-all"
      style={{ background: value === on ? '#2F6BFF' : 'rgba(255,255,255,0.04)', color: value === on ? '#fff' : 'rgba(255,255,255,0.6)' }}>
      {label}
    </button>
  )
  return (
    <div>
      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.35)' }}>Academies</label>
      <div className="flex gap-1 rounded-xl p-1" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
        {opt(false, 'This academy')}
        {opt(true, 'Both academies')}
      </div>
      {value && (
        <p className="mt-1 text-[11px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
          Students of both academies on this course can book it — one shared set of seats.
        </p>
      )}
    </div>
  )
}
