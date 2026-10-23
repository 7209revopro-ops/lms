/**
 * seedDefaultRoles — called once at startup.
 * Creates the three built-in system roles if they don't already exist.
 * Never overwrites an existing role (safe to call on every boot).
 */
import { RoleModel, PERMISSION_RESOURCES, type IResourcePermission } from '@/models/schema.ts'
import { logger } from '@/utils/logger.ts'

/* ── Permission helpers ─────────────────────────────────── */

function all(resources = PERMISSION_RESOURCES): IResourcePermission[] {
  return resources.map(r => ({
    resource: r as string,
    create:      true,
    read:        true,
    update:      true,
    delete:      true,
    list:        true,
    list_basic:  true,
    impersonate: r === 'users',
  }))
}

function build(
  map: Partial<Record<typeof PERMISSION_RESOURCES[number], Partial<Omit<IResourcePermission, 'resource'>>>>,
): IResourcePermission[] {
  return PERMISSION_RESOURCES.map(r => {
    const p = map[r] ?? {}
    return {
      resource:    r as string,
      create:      p.create      ?? false,
      read:        p.read        ?? false,
      update:      p.update      ?? false,
      delete:      p.delete      ?? false,
      list:        p.list        ?? false,
      list_basic:  p.list_basic  ?? false,
      impersonate: r === 'users' ? (p.impersonate ?? false) : false,
    }
  })
}

/* ── System role definitions ────────────────────────────── */

const DEFAULT_ROLES = [
  {
    name:        'Super Admin',
    description: 'Unrestricted access to every resource and action',
    isSystem:    true,
    permissions: all(),
  },
  {
    name:        'Academic Admin',
    description: 'Manages courses, live classes, bookings, and learner content',
    isSystem:    true,
    permissions: build({
      users:          { read: true, list: true, list_basic: true },
      courses:        { create: true, read: true, update: true, delete: true, list: true, list_basic: true },
      'live-classes': { create: true, read: true, update: true, delete: true, list: true, list_basic: true },
      bookings:       { read: true, update: true, delete: true, list: true, list_basic: true },
      orders:         { read: true, list: true, list_basic: true },
      categories:     { create: true, read: true, update: true, delete: true, list: true, list_basic: true },
      coupons:        { create: true, read: true, update: true, delete: true, list: true, list_basic: true },
      reviews:        { read: true, update: true, delete: true, list: true, list_basic: true },
      reports:        { read: true, list: true },
      roles:          { read: true, list: true, list_basic: true },
      support:        { read: true, update: true, list: true, list_basic: true },
      /* The pages added 2026-10-17 — what an academy admin can reach today. */
      'enrollment-requests':   { create: true, read: true, update: true, delete: true, list: true, list_basic: true },
      devices:                 { read: true, update: true, list: true, list_basic: true },
      programs:                { create: true, read: true, update: true, delete: true, list: true, list_basic: true },
      'mentor-calendar':       { create: true, read: true, update: true, delete: true, list: true, list_basic: true },
      'class-verification':    { create: true, read: true, update: true, list: true, list_basic: true },
      'instructor-attendance': { read: true, list: true, list_basic: true },
      'instructor-reviews':    { read: true, list: true, list_basic: true },
      recordings:              { create: true, read: true, list: true, list_basic: true },
      assignments:             { read: true, update: true, list: true, list_basic: true },
      exams:                   { create: true, read: true, update: true, delete: true, list: true, list_basic: true },
      'send-message':          { create: true, read: true, list: true, list_basic: true },
      'audit-logs':            { read: true, list: true },
      settings:                { read: true, update: true, list: true },
    }),
  },
  {
    name:        'Instructor',
    description: 'Can create and manage their own courses and live sessions',
    isSystem:    true,
    permissions: build({
      users:          { list_basic: true },
      courses:        { create: true, read: true, update: true, list: true, list_basic: true },
      'live-classes': { create: true, read: true, update: true, list: true, list_basic: true },
      bookings:       { read: true, list: true },
      categories:     { read: true, list: true, list_basic: true },
      reviews:        { read: true, list: true },
      programs:              { create: true, read: true, update: true, list: true, list_basic: true },
      'mentor-calendar':     { create: true, read: true, update: true, list: true, list_basic: true },
      'class-verification':  { create: true, read: true, update: true, list: true, list_basic: true },
      assignments:           { read: true, update: true, list: true, list_basic: true },
      exams:                 { create: true, read: true, update: true, delete: true, list: true, list_basic: true },
      settings:              { read: true, update: true, list: true },
    }),
  },
]

/* ── Exported function ──────────────────────────────────── */

export async function seedDefaultRoles(): Promise<void> {
  for (const def of DEFAULT_ROLES) {
    const exists = await RoleModel.findOne({ name: def.name })
    if (!exists) {
      await RoleModel.create(def)
      logger.info(`[roles] Created system role: "${def.name}"`)
      continue
    }
    /* A resource added since the role was made (the pages of 2026-10-17): its default row is added. A row already
       there is never changed — an admin may have edited it. */
    const have = new Set(((exists as { permissions?: Array<{ resource: string }> }).permissions ?? []).map(p => p.resource))
    const missing = def.permissions.filter(p => !have.has(p.resource))
    if (missing.length) {
      await RoleModel.updateOne({ _id: exists._id }, { $push: { permissions: { $each: missing } } })
      logger.info(`[roles] "${def.name}": added ${missing.map(m => m.resource).join(', ')}`)
    }
  }
  /* Custom roles get the new resources too — all off, so nothing is widened; an admin ticks what they want. */
  const custom = await RoleModel.find({ isSystem: { $ne: true } }).select('permissions').lean()
  for (const r of custom as Array<{ _id: unknown; permissions?: Array<{ resource: string }> }>) {
    const have = new Set((r.permissions ?? []).map(p => p.resource))
    const missing = build({}).filter(p => !have.has(p.resource))
    if (missing.length) await RoleModel.updateOne({ _id: r._id }, { $push: { permissions: { $each: missing } } })
  }
}
