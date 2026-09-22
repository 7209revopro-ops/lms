/* ─────────────────────────────────────────────────────
   languages — the languages a class can be taught in, for the student app.

   The twin of admin/src/lib/languages.ts, and a mirror of the one list that
   actually decides: LIVE_LANGUAGES in backend/src/routes/admin.routes.ts,
   which the create and update validators enforce as a z.enum.

   A filter must offer what the system ACCEPTS and nothing else. Both halves
   of that have been got wrong here before — the class-schedule dropdown once
   offered Tamil, which no class could be saved as, so picking it could only
   empty the page; and it omitted Arabic and Urdu, which classes genuinely
   are, so those sessions were unreachable from the filter at all. The cause
   was nine hand-kept copies of this list across the two apps. There is now
   one per app.

   ADDING A LANGUAGE means the backend first, because nothing can be saved
   that LIVE_LANGUAGES does not allow, then the two mirrors.

   NOT TO BE CONFUSED WITH the per-module facet filter in classSchedule.ts,
   which offers only the languages a given module is actually taught in. That
   one narrows to what is on screen; this one is the full set.
───────────────────────────────────────────────────── */
export interface LanguageOption {
  value: string
  label: string
  flag:  string
}

/** Mirrors LIVE_LANGUAGES, in the order a picker should offer them. */
export const CLASS_LANGUAGES: LanguageOption[] = [
  { value: 'English',       label: 'English',       flag: '🇬🇧' },
  /* A bilingual class, not a third language — one stored value, because a
     class is delivered one way and a student filtering for it wants that one
     thing. A globe rather than a flag: no single country names it. */
  { value: 'Hindi/English', label: 'Hindi/English', flag: '🌐' },
  { value: 'Hindi',         label: 'Hindi',         flag: '🇮🇳' },
  { value: 'Malayalam',     label: 'Malayalam',     flag: '🇮🇳' },
  { value: 'Tamil',         label: 'Tamil',         flag: '🇮🇳' },
  { value: 'Arabic',        label: 'Arabic',        flag: '🇦🇪' },
  { value: 'Urdu',          label: 'Urdu',          flag: '🇵🇰' },
]

/** Flag for a stored value; a globe for anything saved before this list. */
export const flagFor = (value?: string): string =>
  CLASS_LANGUAGES.find(l => l.value === value)?.flag ?? '🌐'
