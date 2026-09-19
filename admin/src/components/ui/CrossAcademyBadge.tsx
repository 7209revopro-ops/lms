'use client'
/* ─────────────────────────────────────────────────────
   "This one serves both academies."

   ONE VOCABULARY FOR ONE IDEA. A class shared with another academy and an
   instructor lent to one are the same fact wearing different nouns: the row
   in front of you is not only yours. Two surfaces invented two treatments for
   that once already, so the badge, the colour and the icon live here and both
   import them.

   WHY VIOLET, and not the blue the first version used. Blue is this panel's
   BRAND accent — the avatar ring, the primary button, the active nav item are
   all rgb(0,87,184). A "look, this one is different" marker painted in the
   colour everything else already wears is not a marker. Violet is the one
   accent in the palette carrying no status meaning: green is live/in-app,
   amber is Google Meet, red is live-now and destructive, blue is the brand.

   WHY NOT A STAR. A star means favourite or rating in every product a user has
   ever used, and this is neither — it is not a thing they chose or scored, it
   is a fact about who the row belongs to. Share2 says "this reaches somewhere
   else", which is exactly the fact.

   THE NAMES ARE IN THE BADGE, not only the tooltip. "Shared" alone makes an
   admin hover to learn the one thing they need — WHICH academy — and a tooltip
   is unreachable on a touch screen.
───────────────────────────────────────────────────── */
import { Share2 } from 'lucide-react'

/* The accent, exported so a row or card can tint its edge to match without
   copying the literal and drifting. */
export const CROSS_ACCENT_RGB = '167,139,250'
export const crossAccent = {
  bg:     `rgba(${CROSS_ACCENT_RGB},0.16)`,
  border: `1px solid rgba(${CROSS_ACCENT_RGB},0.38)`,
  text:   '#C4B5FD',
  edge:   `rgba(${CROSS_ACCENT_RGB},0.55)`,
} as const

export function CrossAcademyBadge({
  label, title, size = 'sm', icon = true,
}: {
  /** What it serves, already humanised — "Dubai + Bangalore", "Both academies". */
  label: string
  /** The sentence that explains the consequence, not a restatement of the label. */
  title?: string
  size?: 'sm' | 'md'
  icon?: boolean
}) {
  const pad = size === 'md' ? 'px-2 py-1 text-[10px] gap-1.5' : 'px-1.5 py-0.5 text-[9px] gap-1'
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-md font-semibold ${pad}`}
      style={{ background: crossAccent.bg, border: crossAccent.border, color: crossAccent.text }}
      title={title}>
      {icon && <Share2 size={size === 'md' ? 11 : 9} strokeWidth={2.5} />}
      {label}
    </span>
  )
}

/* A 2px violet edge on the row or card. Scannable without reading a word,
   which is the point: an admin looking down a list of forty classes should see
   the shared ones without parsing forty badges. */
export const crossEdgeStyle = (on: boolean) =>
  on ? { boxShadow: `inset 3px 0 0 0 ${crossAccent.edge}` } : undefined
