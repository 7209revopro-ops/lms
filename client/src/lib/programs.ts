/* ─────────────────────────────────────────────────────
   Program catalogue — id → human label

   The signup form stores the OPTION ID ('forex-beginner'), and every admin
   screen used to render that string straight out of the database, so staff
   reviewing an application read machine slugs.

   Two things make this more than a lookup table:

   1. The stored data is MIXED. An older signup flow wrote the human label
      itself, so real rows hold 'AI', 'AI & Data Science', 'Data Science' and
      'Digital Marketing' alongside slugs like 'dm-seo'. Those are already
      readable and must pass through untouched.

   2. Ids outlive the catalogue. A program removed from the form still exists
      on every application that selected it, so an unrecognised slug has to
      degrade to something legible rather than vanish or show raw.

   Kept in step with admin/src/lib/programs.ts by hand — the two Next apps
   share no package. If you add a program here, add it there.
───────────────────────────────────────────────────── */

export interface ProgramOption {
  id:    string
  label: string
  group: string
}

export const PROGRAMS: ProgramOption[] = [
  { id: 'forex-beginner',     label: 'Forex: Beginner',        group: 'Forex Academy' },
  { id: 'forex-intermediate', label: 'Forex: Intermediate',    group: 'Forex Academy' },
  { id: 'forex-advanced',     label: 'Forex: Advanced',        group: 'Forex Academy' },
  { id: 'dm-social',          label: 'Social Media Marketing', group: 'Digital Marketing' },
  { id: 'dm-seo',             label: 'SEO & Content',          group: 'Digital Marketing' },
  { id: 'ai-fundamentals',    label: 'AI Fundamentals',        group: 'AI Academy' },
  { id: 'ai-trading',         label: 'AI Trading Automation',  group: 'AI Academy' },
  { id: 'jura-core',          label: 'JURA Program',           group: 'JURA Academy' },
  { id: 'jura-labour-law',    label: 'UAE Labour Law & HR Compliance', group: 'JURA Academy' },
  { id: 'cma-us',             label: 'CMA (US)',               group: 'Delta Commerce Academy' },
]

/* Picking it adds the CMA (US) terms to the registration form's agreement
   (lib/legal/cmaTerms.ts). */
export const CMA_PROGRAM_ID = 'cma-us'

const BY_ID = new Map(PROGRAMS.map(p => [p.id.toLowerCase(), p.label]))

/* Words the title-caser must not lowercase-ify when prettifying an unknown
   slug — 'ai-ethics' should read 'AI Ethics', not 'Ai Ethics'. */
const ACRONYMS = new Set(['ai', 'seo', 'hr', 'uae', 'kyc', 'dm', 'cv', 'ui', 'ux'])

/** True when a value looks like a machine id rather than a human label. */
function isSlug(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
}

/**
 * Render a stored program value for a human.
 *
 * Known id → its catalogue label.
 * Anything that is not slug-shaped → returned unchanged (legacy rows already
 * hold a readable label).
 * Unknown slug → title-cased, so a retired program still reads as words.
 */
export function programLabel(value: string | null | undefined): string {
  const raw = String(value ?? '').trim()
  if (!raw) return '—'

  const known = BY_ID.get(raw.toLowerCase())
  if (known) return known

  if (!isSlug(raw)) return raw

  return raw
    .split('-')
    .map(word => ACRONYMS.has(word) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/** Convenience for the common "render a list of chips" case. */
export function programLabels(values: readonly (string | null | undefined)[] | null | undefined): string[] {
  return (values ?? []).map(programLabel)
}

/* Group headings for the signup / request pickers, in first-appearance order.
   Derived rather than hand-listed: the render used to iterate a literal
   ['Forex Academy','Digital Marketing','AI Academy'], which silently omitted
   'JURA Academy' — so jura-core sat in PROGRAMS and never appeared on the
   form. Deriving means adding a program is enough to show it. */
export const PROGRAM_GROUPS: string[] = [...new Set(PROGRAMS.map(p => p.group))]
