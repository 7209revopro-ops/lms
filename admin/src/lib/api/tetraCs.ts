/* ─────────────────────────────────────────────────────
   Who looks after a student in CS Portal (the CS Portal): their
   CS and CS team, as the portal says now — it sends them here every few
   minutes for whoever changed (backend services/portalStudentCs.service.ts).
   On every admin list that carries a student; absent on a student the portal
   has not told us about — not a Forex student, or not there yet.
───────────────────────────────────────────────────── */
export interface TetraCs {
  /** Their CS; "" while they wait in Delta Open Students (`open`). */
  name?: string
  team?: string
  /** Their student code in CS Portal. */
  code?: string
  /** Waiting in Delta Open Students — no CS yet. */
  open?: boolean
  /** When the portal last said so. */
  at?:   string
  /** Onboarded there (their welcome went), and when — unset until the portal says (2026-10-13). */
  onboarded?:   boolean
  onboardedAt?: string | null
}
