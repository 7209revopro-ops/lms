/* ─────────────────────────────────────────────────────
   check-languages — fail the build if the three language lists disagree.

   A class's language is gated by LIVE_LANGUAGES in routes/admin.routes.ts:
   both the create and the update validator are a z.enum over it, so a value
   missing from there cannot be saved however many pickers offer it. The two
   apps each carry a mirror of that list for their dropdowns and filters.

   When a mirror drifts, it fails in one of two silent ways and both had
   happened at once:

     AHEAD of the gate — the admin offered Tamil, French and Spanish. Picking
     one produced a 400 from a dropdown that showed it as an ordinary option.

     BEHIND the gate — the client's filter omitted Arabic and Urdu, which
     classes genuinely are taught in, so those sessions could not be filtered
     for at all. A filter that cannot name a thing hides it.

   Neither shows up in a type-check, in a test, or on the screen of whoever
   made the change. Before this there were NINE hand-kept copies across the
   two apps; there is now one per app, and this is what keeps them equal.

   Run: bun run check:languages
───────────────────────────────────────────────────── */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(process.cwd(), '..')

/** Pull the quoted values out of a source list, in order. */
function values(file: string, startMarker: string): string[] {
  const src = readFileSync(resolve(ROOT, file), 'utf8')
  const at = src.indexOf(startMarker)
  if (at === -1) {
    console.error(`check:languages — could not find ${startMarker} in ${file}`)
    process.exit(1)
  }
  /* Close the block from AFTER the marker: `LanguageOption[] = [` contains a
     `]` of its own, and searching from `at` stopped on that one and read an
     empty list — which the check then reported as both mirrors missing
     everything. A parser that fails loud is still a parser that was wrong. */
  const from  = at + startMarker.length
  const block = src.slice(from, src.indexOf(']', from) + 1)
  /* The gate is a flat list of strings; the mirrors are objects with a
     `value:` key. Reading `value:` first and falling back to bare strings
     keeps one parser honest for both shapes. */
  const keyed = [...block.matchAll(/value:\s*'([^']+)'/g)].map(m => m[1]!)
  if (keyed.length) return keyed
  return [...block.matchAll(/'([^']+)'/g)].map(m => m[1]!)
}

const gate   = values('backend/src/routes/admin.routes.ts', 'const LIVE_LANGUAGES = [')
const admin  = values('admin/src/lib/languages.ts',         'export const CLASS_LANGUAGES: LanguageOption[] = [')
const client = values('client/src/lib/languages.ts',        'export const CLASS_LANGUAGES: LanguageOption[] = [')

const problems: string[] = []
const compare = (name: string, mirror: string[]) => {
  const ahead  = mirror.filter(v => !gate.includes(v))
  const behind = gate.filter(v => !mirror.includes(v))
  if (ahead.length) {
    problems.push(`${name} offers ${ahead.map(v => `"${v}"`).join(', ')} — the API rejects ${ahead.length > 1 ? 'these' : 'this'} with a 400`)
  }
  if (behind.length) {
    problems.push(`${name} is missing ${behind.map(v => `"${v}"`).join(', ')} — classes can be taught in ${behind.length > 1 ? 'these' : 'this'} and cannot be filtered for`)
  }
}
compare('admin/src/lib/languages.ts', admin)
compare('client/src/lib/languages.ts', client)

if (gate.length === 0) problems.push('LIVE_LANGUAGES parsed as empty — the marker or the shape changed')

if (problems.length) {
  console.error('check:languages — the language lists disagree:\n')
  for (const p of problems) console.error('  · ' + p)
  console.error(`\n  gate   (backend): ${gate.join(', ')}`)
  console.error(`  admin  mirror   : ${admin.join(', ')}`)
  console.error(`  client mirror   : ${client.join(', ')}`)
  console.error('\n  Add to LIVE_LANGUAGES first — nothing can be saved that it does not allow.')
  process.exit(1)
}

console.log(`check:languages — ${gate.length} languages, all three lists agree`)
