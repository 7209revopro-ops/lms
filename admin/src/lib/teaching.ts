/* Who teaches (2026-11-20) — the admin side of backend utils/teaching.ts.
   A mentor is an instructor, or a department's sub admin with "Also teaches
   classes" on: they keep their Manager pages and also get their own mentor
   screens (class-end questions, mentor chat, availability). */
export function teaches(u: { role?: string | null; alsoTeaches?: boolean | null } | null | undefined): boolean {
  return u?.role === 'instructor' || (u?.role === 'sub_admin' && u?.alsoTeaches === true)
}
