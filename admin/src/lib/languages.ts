/* ─────────────────────────────────────────────────────
   languages — the single list of languages the academy teaches in.

   This file already claimed to be that list, and was not. It held English,
   Malayalam, Hindi and Tamil while the backend gate — LIVE_LANGUAGES in
   backend/src/routes/admin.routes.ts, which both the create and update
   validators enforce as a z.enum — held English, Arabic, Hindi, Malayalam
   and Urdu. So it had drifted in BOTH directions at once: it offered Tamil,
   which the API would reject with a 400, and it omitted Arabic and Urdu,
   which classes genuinely are taught in and which therefore could not be
   filtered for at all.

   That is the same failure the client's own language dropdown documents
   having had, and it kept recurring because there were nine copies of this
   list across the two apps. There is now one per app, and each mirrors the
   backend's.

   ADDING A LANGUAGE means two edits, in this order: LIVE_LANGUAGES in the
   backend first, because nothing can be saved that it does not allow, then
   this file and its client twin. Adding it here alone puts an option in
   front of somebody that the API will refuse.
───────────────────────────────────────────────────── */
export interface LanguageOption {
  value: string
  label: string
  flag:  string
  /** The language's own name, where it has a distinct script. Shown beside
      the English label in the pickers that already did so. */
  native?: string
}

/** Mirrors LIVE_LANGUAGES, in the order a picker should offer them. */
export const CLASS_LANGUAGES: LanguageOption[] = [
  { value: 'English',       label: 'English',       flag: '🇬🇧' },
  /* A bilingual class, not a third language — one stored value, because a
     class is delivered one way and a student filtering for it wants that one
     thing. The globe rather than a flag: no single country names it. */
  { value: 'Hindi/English', label: 'Hindi/English', flag: '🌐' },
  { value: 'Hindi',         label: 'Hindi',         flag: '🇮🇳', native: 'हिंदी' },
  { value: 'Malayalam',     label: 'Malayalam',     flag: '🇮🇳', native: 'മലയാളം' },
  { value: 'Tamil',         label: 'Tamil',         flag: '🇮🇳', native: 'தமிழ்' },
  { value: 'Arabic',        label: 'Arabic',        flag: '🇦🇪', native: 'عربي' },
  { value: 'Urdu',          label: 'Urdu',          flag: '🇵🇰', native: 'اردو' },
]

/** `🇬🇧 English` — the one label shape every picker in the admin uses. */
export const withFlag = (l: LanguageOption): string => `${l.flag} ${l.label}`

/** `🇮🇳 Hindi (हिंदी)` — for the pickers that show the native script too. */
export const withFlagAndNative = (l: LanguageOption): string =>
  l.native ? `${l.flag} ${l.label} (${l.native})` : `${l.flag} ${l.label}`

/** Flag for a stored value, for tables that show one beside a language.
 *  Falls back to a globe so a legacy value still renders something. */
export const flagFor = (value?: string): string =>
  CLASS_LANGUAGES.find(l => l.value === value)?.flag ?? '🌐'

/* Options for a plain <Select>. `current` keeps a legacy value (a course
   saved as "Spanish" before this list shrank) selectable, so opening and
   saving an old course cannot silently relabel its language. */
export function courseLanguageOptions(current?: string): { value: string; label: string }[] {
  const base = CLASS_LANGUAGES.map(l => ({ value: l.value, label: l.label }))
  if (current && !base.some(o => o.value === current)) {
    base.push({ value: current, label: `${current} (legacy)` })
  }
  return base
}
