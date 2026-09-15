/* ─────────────────────────────────────────────────────
   System settings — operator switches, read hot, written cold
   ─────────────────────────────────────────────────────
   Today there is one: whether the student two-device limit is enforced.

   The limit is checked on every student sign-in and on every token refresh,
   so reading it from Mongo each time would put a query on the hottest path in
   the system to answer a question whose answer changes about once a year.
   It is therefore cached in-process with a short TTL.

   The TTL is the price of not having a shared cache. A write invalidates the
   cache in the process that served it immediately; other PM2 instances keep
   serving the old value until their own entry expires. So an admin flipping
   the switch sees it take effect everywhere within CACHE_TTL_MS, not
   instantly — which is the right trade for a setting that is toggled by hand
   and read thousands of times a minute, but it does mean the UI should not
   promise "applied immediately".
───────────────────────────────────────────────────── */
import { logger } from '@/utils/logger.ts'

export const SETTING_DEVICE_LIMIT = 'deviceLimit.enabled'

/* Short enough that a toggle is live across instances in seconds.

   Configurable because it is the one number that decides how long a flipped
   switch takes to reach every PM2 instance — an operator may want it tighter,
   and a test needs it short enough to observe an expiry without sleeping for
   a quarter of a minute. */
export const CACHE_TTL_MS = (() => {
  const raw = Number(process.env['SETTINGS_CACHE_TTL_MS'])
  return Number.isFinite(raw) && raw >= 0 && raw <= 300_000 ? Math.floor(raw) : 15_000
})()

type Entry = { value: unknown; at: number }
const cache = new Map<string, Entry>()

/** Drop a cached value — used by writes in this process, and by tests. */
export function invalidateSetting(key?: string): void {
  if (key) cache.delete(key)
  else cache.clear()
}

async function readSetting(key: string): Promise<unknown> {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value

  try {
    const { SystemSettingModel } = await import('@/models/schema.ts')
    const row = await SystemSettingModel.findOne({ key }).lean() as { value?: unknown } | null
    const value = row?.value
    cache.set(key, { value, at: Date.now() })
    return value
  } catch (err) {
    /* A settings read must never be what takes sign-in down. Falling back to
       the caller's default means a database blip leaves the device limit in
       its DEFAULT state (enforced), never silently disabled. */
    logger.error({ err, key }, '[Settings] read failed — falling back to default')
    return undefined
  }
}

/**
 * Is the student two-device limit being enforced?
 *
 * Defaults to TRUE. An absent row, an unreadable database, or a value of the
 * wrong shape all mean "enforced": a security control must fail closed, so
 * nothing short of somebody deliberately storing `false` turns it off.
 */
export async function isDeviceLimitEnabled(): Promise<boolean> {
  const raw = await readSetting(SETTING_DEVICE_LIMIT)
  return raw === false ? false : true
}

/** Flip the switch. Returns the value now stored. */
export async function setDeviceLimitEnabled(
  enabled: boolean,
  updatedBy?: string,
): Promise<boolean> {
  const { SystemSettingModel } = await import('@/models/schema.ts')
  await SystemSettingModel.updateOne(
    { key: SETTING_DEVICE_LIMIT },
    { $set: { value: enabled, ...(updatedBy ? { updatedBy } : {}) } },
    { upsert: true },
  )
  invalidateSetting(SETTING_DEVICE_LIMIT)
  logger.warn({ enabled, updatedBy }, '[Settings] student device limit toggled')
  return enabled
}

/** Who last changed it and when — shown next to the switch in the admin UI. */
export async function deviceLimitMeta(): Promise<{
  enabled: boolean; updatedAt: Date | null; updatedByName: string | null
}> {
  const { SystemSettingModel, UserModel } = await import('@/models/schema.ts')
  const row = await SystemSettingModel.findOne({ key: SETTING_DEVICE_LIMIT }).lean() as any
  const enabled = row?.value === false ? false : true
  if (!row?.updatedBy) return { enabled, updatedAt: row?.updatedAt ?? null, updatedByName: null }

  const who = await UserModel.findById(row.updatedBy).select('name email').lean() as any
  return {
    enabled,
    updatedAt: row.updatedAt ?? null,
    updatedByName: who?.name ?? who?.email ?? null,
  }
}
