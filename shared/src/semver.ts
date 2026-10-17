/* Version comparison for the forced-update gate (GET /app/config, plan.md
   §13.4 B5). Plain x.y.z only — the backend refuses anything else in env. */

const parse = (v: string): [number, number, number] | null => {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v.trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/** -1 if a < b, 0 if equal, 1 if a > b. An unparseable version sorts lowest. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = parse(a), pb = parse(b)
  if (!pa && !pb) return 0
  if (!pa) return -1
  if (!pb) return 1
  for (let i = 0; i < 3; i++) {
    if (pa[i]! < pb[i]!) return -1
    if (pa[i]! > pb[i]!) return 1
  }
  return 0
}

export type UpdateState = 'ok' | 'available' | 'required'

/** Where the installed version stands against the server's min and latest. */
export function updateState(installed: string, cfg: { minVersion: string; latestVersion: string }): UpdateState {
  if (compareVersions(installed, cfg.minVersion) < 0) return 'required'
  if (compareVersions(installed, cfg.latestVersion) < 0) return 'available'
  return 'ok'
}
