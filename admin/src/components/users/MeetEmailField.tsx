'use client'

/* ── Gmail for Google Meet ─────────────────────────────
   Most instructors log in with a Zoho-hosted @deltainstitutions.com address,
   which is not a Google account. Google will still accept it as co-host and
   send the calendar invite there, but the co-host controls only appear for
   someone signed in to Google AS that address — which a Zoho mailbox is not.
   This is the Google account they actually join with (usually a Gmail).
   Empty means "use the login email", which is right when that login email is
   itself a Gmail. */

const GOOGLE_CONSUMER_DOMAINS = ['gmail.com', 'googlemail.com']

export function isGmailAddress(email: string): boolean {
  const domain = email.trim().toLowerCase().split('@')[1] ?? ''
  return GOOGLE_CONSUMER_DOMAINS.includes(domain)
}

/** The one-line status under the field — shared by every form that edits it. */
export function meetEmailHint(value: string, loginEmail: string): { color: string; text: string } {
  if (value.trim())               return { color: 'rgba(255,255,255,0.35)', text: 'Class Meet links will invite this Google account.' }
  if (isGmailAddress(loginEmail)) return { color: 'rgba(255,255,255,0.35)', text: 'Empty — their login Gmail is used.' }
  return { color: '#FBBF24', text: 'Not a Gmail — they get the calendar invite, but co-host controls need the Google account they join with. Add their Gmail.' }
}

export function MeetEmailField({ value, onChange, loginEmail, inputStyle, focusStyle }: {
  value:      string
  onChange:   (v: string) => void
  loginEmail: string
  inputStyle: React.CSSProperties
  focusStyle: {
    onFocus: (e: React.FocusEvent<HTMLInputElement>) => void
    onBlur:  (e: React.FocusEvent<HTMLInputElement>) => void
  }
}) {
  const hint = meetEmailHint(value, loginEmail)

  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium" style={{ color: 'rgba(255,255,255,0.45)' }}>
        Gmail for Google Meet <span style={{ color: 'rgba(255,255,255,0.3)' }}>(optional)</span>
      </label>
      <input
        type="email" value={value} onChange={e => onChange(e.target.value)}
        placeholder="e.g. name@gmail.com"
        className="w-full rounded-xl px-3 py-2.5 text-sm text-white transition-all placeholder:text-white/20"
        style={inputStyle} {...focusStyle}
      />
      <p className="mt-1 text-[11px]" style={{ color: hint.color }}>{hint.text}</p>
    </div>
  )
}
