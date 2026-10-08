import { Types } from 'mongoose'
import { DeviceModel, UserModel, type IDevice, type DeviceStatus } from '@/models/schema.ts'

/* ─────────────────────────────────────────────────────
   Device whitelist logic (student two-device limit)
   ─────────────────────────────────────────────────────
   The first browser a student signs in on is auto-approved as their main
   device; a second is a pending request an admin approves; a third is refused
   until an admin frees a slot. Enforced by auth.service on login and refresh.
   Mirrors academy-api/src/auth/devices.ts for the AI-academy side.
───────────────────────────────────────────────────── */

/** How many devices a student may have approved at once. */
export const MAX_APPROVED_DEVICES = 2

export type DeviceOutcome =
  | { ok: true;  device: IDevice }
  /** `created` is true only the first time a browser is recorded — the caller
   *  uses it to notify admins once, not on every blocked retry. `label` is the
   *  device's friendly name, for that notification. */
  | { ok: false; reason: 'pending' | 'limit'; created: boolean; label: string }
  | { ok: false; reason: 'revoked' }

/** A short label from the user agent — enough for an admin to tell two devices
 *  apart in the approval list, without a UA-parsing dependency. */
export function labelFromUserAgent(ua?: string): string {
  if (!ua) return 'Unknown device'
  const browser =
    /Edg\//.test(ua)            ? 'Edge'    :
    /OPR\/|Opera/.test(ua)      ? 'Opera'   :
    /Chrome\//.test(ua)         ? 'Chrome'  :
    /Firefox\//.test(ua)        ? 'Firefox' :
    /Safari\//.test(ua)         ? 'Safari'  : 'Browser'
  const os =
    /iPhone|iPad|iPod/.test(ua)   ? 'iOS'     :
    /Android/.test(ua)            ? 'Android' :
    /Mac OS X|Macintosh/.test(ua) ? 'macOS'   :
    /Windows/.test(ua)            ? 'Windows' :
    /Linux/.test(ua)              ? 'Linux'   : ''
  return os ? `${browser} on ${os}` : browser
}

/**
 * Resolves a browser against the two-device whitelist at sign-in, creating the
 * device row as a side effect:
 *   - known + approved  → signs in.
 *   - known + pending   → still waiting on an admin.
 *   - known + revoked   → refused.
 *   - new, 0 approved   → auto-approved as the main device, signs in.
 *   - new, 1 approved   → pending, refused until an admin approves.
 *   - new, ≥2 approved  → recorded as pending but reported as "limit", so an
 *                         admin sees the request yet must free a slot first.
 */
export async function resolveDeviceForLogin(
  userId: string,
  deviceId: string,
  info: { userAgent?: string; ip?: string },
): Promise<DeviceOutcome> {
  const now = new Date()

  const existing = await DeviceModel.findOne({ userId, deviceId })
  if (existing) {
    if (existing.status === 'revoked') return { ok: false, reason: 'revoked' }
    existing.lastSeenAt = now
    if (info.userAgent) existing.userAgent = info.userAgent.slice(0, 500)
    if (info.ip) existing.ip = info.ip
    await existing.save()
    if (existing.status === 'approved') return { ok: true, device: existing }
    // An already-recorded pending browser signing in again — not newly created.
    return { ok: false, reason: 'pending', created: false, label: existing.label ?? 'Unknown device' }
  }

  const approvedCount = await DeviceModel.countDocuments({ userId, status: 'approved' })
  const isFirst = approvedCount === 0

  try {
    const device = await DeviceModel.create({
      userId,
      deviceId,
      status:     isFirst ? 'approved' : 'pending',
      isMain:     isFirst,
      label:      labelFromUserAgent(info.userAgent),
      userAgent:  info.userAgent?.slice(0, 500),
      ip:         info.ip,
      approvedAt: isFirst ? now : undefined,
      lastSeenAt: now,
    })
    if (isFirst) return { ok: true, device }
  } catch (err) {
    // Lost a race with a concurrent request for the same browser — decide on
    // the row that won rather than double-inserting.
    if (typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000) {
      const row = await DeviceModel.findOne({ userId, deviceId })
      if (row?.status === 'approved') return { ok: true, device: row }
      if (row?.status === 'revoked') return { ok: false, reason: 'revoked' }
      return { ok: false, reason: 'pending', created: false, label: row?.label ?? 'Unknown device' }
    }
    throw err
  }

  // A brand-new device beyond the first: pending if a slot is open, otherwise a
  // hard limit (the row still exists for the admin to see). `created: true` —
  // this is the sign-in that first recorded it, so notify admins exactly once.
  const label = labelFromUserAgent(info.userAgent)
  return approvedCount >= MAX_APPROVED_DEVICES
    ? { ok: false, reason: 'limit', created: true, label }
    : { ok: false, reason: 'pending', created: true, label }
}

/** Read-only check used on refresh: the session stays alive only while its
 *  browser is still an approved device. A revoked (or never-approved) device
 *  fails here and the caller ends the session. */
export async function isDeviceApproved(userId: string, deviceId: string): Promise<boolean> {
  if (!deviceId) return false
  const device = await DeviceModel.findOneAndUpdate(
    { userId, deviceId, status: 'approved' },
    { $set: { lastSeenAt: new Date() } },
  )
  return device !== null
}

/* ── Admin approval side (Phase D) ─────────────────────────────────────── */

/** One device row flattened for the admin UI, with the student it belongs to. */
export interface DeviceAdminView {
  id:         string
  userId:     string
  name:       string | null
  email:      string
  phone:      string | null
  status:     DeviceStatus
  isMain:     boolean
  label:      string | null
  ip:         string | null
  createdAt:  string
  approvedAt: string | null
  lastSeenAt: string | null
}

function iso(v: Date | null | undefined): string | null {
  return v ? new Date(v).toISOString() : null
}

/**
 * Every device joined to its student, pending first (the ones needing action).
 * Org admins see only their own academy's students; super_admin sees all.
 */
export async function adminListDevices(opts: {
  status?: DeviceStatus
  organizationId?: string | null
  /* The owners a department's sub_admin may see (plan.md §10). Matched on the
     device's indexed userId BEFORE the join, so only their devices are ever
     joined — matching after the join read every device in the academy and
     was 5x slower at 5,000 devices. An empty list means none. */
  ownerIds?: Types.ObjectId[] | null
}): Promise<DeviceAdminView[]> {
  const orgMatch =
    opts.organizationId && Types.ObjectId.isValid(opts.organizationId)
      ? [{ $match: { 'user.organizationId': new Types.ObjectId(opts.organizationId) } }]
      : []
  const statusMatch = opts.status ? [{ $match: { status: opts.status } }] : []
  const ownerFirst = opts.ownerIds ? [{ $match: { userId: { $in: opts.ownerIds } } }] : []

  const rows = await DeviceModel.aggregate([
    ...ownerFirst,
    { $addFields: { _rank: { $indexOfArray: [['pending', 'approved', 'revoked'], '$status'] } } },
    { $sort: { _rank: 1, createdAt: -1 } },
    { $lookup: { from: 'users', localField: 'userId', foreignField: '_id', as: 'user' } },
    { $unwind: '$user' }, // inner join — drop rows whose user was deleted
    ...orgMatch,
    ...statusMatch,
    { $limit: 1000 },
  ])

  return rows.map((r) => ({
    id:         String(r._id),
    userId:     String(r.userId),
    name:       r.user?.name ?? null,
    email:      r.user?.email ?? '(unknown account)',
    phone:      r.user?.enrollmentApplication?.phone ?? r.user?.phone ?? null,
    /* Their CS and CS team in Tetra Commission. */
    tetraCs:    r.user?.tetraCs ?? null,
    status:     r.status,
    isMain:     Boolean(r.isMain),
    label:      r.label ?? null,
    ip:         r.ip ?? null,
    createdAt:  iso(r.createdAt) ?? new Date(0).toISOString(),
    approvedAt: iso(r.approvedAt),
    lastSeenAt: iso(r.lastSeenAt),
  }))
}

export type AdminApproveResult = { ok: true } | { ok: false; reason: 'not_found' | 'limit' }

/* An org admin may only act on their own academy's students; super_admin
 *  passes no orgId and skips this. Returns false if the device's user is in a
 *  different org, so the caller reports it as not-found rather than leaking that
 *  the id exists. */
async function deviceInOrg(device: IDevice, organizationId?: string | null): Promise<boolean> {
  if (!organizationId || !Types.ObjectId.isValid(organizationId)) return true
  const user = await UserModel.findById(device.userId).select('organizationId').lean<{ organizationId?: Types.ObjectId }>()
  return String(user?.organizationId ?? '') === String(organizationId)
}

/** Approves a device, never past the two-device cap — a third approval is
 *  refused until an admin revokes one. Idempotent on an already-approved row. */
export async function adminApproveDevice(
  id: string,
  approvedBy: string,
  organizationId?: string | null,
): Promise<AdminApproveResult> {
  if (!Types.ObjectId.isValid(id)) return { ok: false, reason: 'not_found' }
  const device = await DeviceModel.findById(id)
  if (!device || !(await deviceInOrg(device, organizationId))) return { ok: false, reason: 'not_found' }
  if (device.status === 'approved') return { ok: true }

  const approvedCount = await DeviceModel.countDocuments({ userId: device.userId, status: 'approved' })
  if (approvedCount >= MAX_APPROVED_DEVICES) return { ok: false, reason: 'limit' }

  device.status = 'approved'
  device.approvedAt = new Date()
  if (Types.ObjectId.isValid(approvedBy)) device.approvedBy = new Types.ObjectId(approvedBy)
  await device.save()
  return { ok: true }
}

/** Revokes a device — its session ends on the next refresh and the slot frees. */
export async function adminRevokeDevice(id: string, organizationId?: string | null): Promise<{ ok: boolean }> {
  if (!Types.ObjectId.isValid(id)) return { ok: false }
  const device = await DeviceModel.findById(id)
  if (!device || !(await deviceInOrg(device, organizationId))) return { ok: false }
  device.status = 'revoked'
  await device.save()
  return { ok: true }
}
