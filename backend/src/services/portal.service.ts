import crypto from 'node:crypto'
import mongoose from 'mongoose'
import { UserModel, RoleModel, OrganizationModel } from '@/models/schema.ts'
import { hashPassword } from '@/utils/hash.ts'

/**
 * Answering the Root portal's questions about this server's people.
 *
 * The portal decides who may open what across the estate. It could sign
 * somebody in here and nothing more: the role it recorded was whatever an
 * administrator typed into a box, nothing checked it against this server, and
 * the two could drift apart indefinitely.
 *
 * Two things about this application shape what follows.
 *
 * A person's role here is the enum on their account — student, instructor,
 * admin and so on. There is also a Role collection, but that is a permission
 * *narrowing* applied through customRoleId on top of the base role, and
 * leaving it unset means unrestricted within that role rather than no access.
 * Offering both through one field would make "set their role" mean two
 * different things depending on which was picked, so only the base roles are
 * offered. Custom roles stay where they are managed, in this application.
 *
 * And this server holds more than one organization — Dubai and Bangalore —
 * so every question about a person is asked about one of them.
 */

/**
 * Refusals from here, shaped the way this application shapes them.
 *
 * A plain Error with a statusCode property looks right and is not: the error
 * middleware matches on class, so everything fell through to INTERNAL_ERROR
 * and "belongs to a different organization" was reported as a server fault.
 */
export class PortalError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message)
    this.name = 'PortalError'
  }
}

const httpError = (message: string, statusCode: number) => {
  const code =
    statusCode === 404 ? 'NOT_FOUND' :
    statusCode === 409 ? 'CONFLICT' :
    statusCode === 403 ? 'FORBIDDEN' : 'VALIDATION_ERROR'
  return new PortalError(code, message, statusCode)
}

/**
 * The roles somebody can be given here, described rather than enumerated.
 *
 * These are not rows in a table: they are the values the account's `role`
 * field may take, and what each one means lives in this application's code.
 * The portal shows the description beside the name so that choosing one is a
 * decision about what somebody will be able to do.
 */
const BASE_ROLES: { key: string; description: string }[] = [
  { key: 'student',     description: 'Takes courses. Cannot open the admin portal.' },
  { key: 'instructor',  description: 'Teaches and manages their own courses.' },
  { key: 'support',     description: 'Helps learners; no course authoring.' },
  { key: 'sub_admin',   description: 'Administers within the limits of an assigned custom role.' },
  { key: 'admin',       description: 'Administers this organization.' },
  { key: 'super_admin', description: 'Everything, everywhere. Bypasses every permission check.' },
]

/** Which organization, insisted upon rather than assumed. */
async function resolveOrg(remoteOrgId?: string) {
  if (!remoteOrgId) {
    throw httpError(
      'This server holds more than one organization, so the portal must say which — set LMS_REMOTE_ORG_ID on its side.',
      400,
    )
  }
  if (!mongoose.isValidObjectId(remoteOrgId)) {
    throw httpError(`"${remoteOrgId}" is not a valid organization id`, 400)
  }
  const org = await OrganizationModel.findById(remoteOrgId).select('name slug')
  if (!org) throw httpError('No such organization on this server', 404)
  return org
}

export interface PortalRole {
  key: string
  name: string
  description: string
  permissions: string[]
  isSystem: boolean
}

/**
 * The roles this server offers.
 *
 * Not scoped to an organization, because they are not: the enum is the same
 * everywhere on this server. Asking for an organization here would add a way
 * to fail for no gain.
 */
export function listRolesForPortal(): { organization: string; roles: PortalRole[] } {
  return {
    organization: 'Delta LMS',
    roles: BASE_ROLES.map((r) => ({
      key: r.key,
      // Underscores are how the value is stored, not how anybody says it.
      name: r.key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      description: r.description,
      permissions: [],
      isSystem: true,
    })),
  }
}

export interface PortalUserState {
  exists: boolean
  inOrganization: boolean
  name: string
  email: string
  status: string
  membershipStatus: string | null
  roleKey: string | null
  roleName: string | null
  permissions: string[]
  lastLoginAt: string | null
}

/**
 * What an account actually holds here, right now.
 *
 * "Does not exist" is an answer rather than an error: the portal asks this
 * about everybody it knows, and most will have no account here.
 *
 * Somebody may exist on this server and belong to the other organization.
 * That is reported rather than hidden — it is the more interesting finding,
 * and calling it "no account" would invite creating a second one.
 */
export async function describeUserForPortal(input: {
  email: string
  remoteOrgId?: string
}): Promise<PortalUserState> {
  const org = await resolveOrg(input.remoteOrgId)
  const email = input.email.toLowerCase().trim()
  if (!email) throw httpError('email is required', 400)

  const blank: PortalUserState = {
    exists: false, inOrganization: false, name: '', email, status: '',
    membershipStatus: null, roleKey: null, roleName: null, permissions: [], lastLoginAt: null,
  }

  const user = await UserModel.findOne({ email }).lean()
  if (!user) return blank

  const here = String(user.organizationId ?? '') === String(org._id)
  const status = user.isActive === false ? 'inactive' : 'active'

  /* A custom role is a narrowing on top of the base role. It is not settable
     from here, but it is worth reporting: somebody reading the portal should
     see that this account is restricted beyond what its role name implies. */
  let permissions: string[] = []
  if (here && user.customRoleId) {
    const custom = await RoleModel.findById(user.customRoleId).select('name').lean()
    if (custom) permissions = [`limited by the custom role "${custom.name}"`]
  }

  return {
    exists: true,
    inOrganization: here,
    name: user.name ?? '',
    email: user.email,
    status,
    membershipStatus: here ? status : null,
    roleKey: here ? user.role ?? null : null,
    roleName: here ? (user.role ?? '').replace(/_/g, ' ') : null,
    permissions,
    lastLoginAt: user.lastLoginAt ? new Date(user.lastLoginAt).toISOString() : null,
  }
}

/** The role, matched the way a person would write it. */
function findRole(name: string): string {
  const wanted = name.trim().toLowerCase().replace(/[\s-]+/g, '_')
  const hit = BASE_ROLES.find((r) => r.key === wanted)
  if (hit) return hit.key
  throw httpError(
    `No role "${name.trim()}" here. Available: ${BASE_ROLES.map((r) => r.key).join(', ')}.`,
    400,
  )
}

/**
 * Change what somebody is here, because the portal said so.
 *
 * Only within the organization named, and creates nothing: provisioning is
 * its own call, and an edit that created accounts as a side effect would turn
 * a typo in an email address into a second person.
 */
export async function setUserRoleFromPortal(input: {
  email: string
  role?: string
  status?: string
  remoteOrgId?: string
}): Promise<{ detail: string; roleKey: string; membershipStatus: string }> {
  const org = await resolveOrg(input.remoteOrgId)
  const email = input.email.toLowerCase().trim()
  if (!email) throw httpError('email is required', 400)
  if (!input.role && !input.status) {
    throw httpError('Nothing to change: give a role, a status, or both', 400)
  }

  const user = await UserModel.findOne({ email })
  if (!user) throw httpError(`${email} has no account on this server — create one first`, 404)
  if (String(user.organizationId ?? '') !== String(org._id)) {
    throw httpError(`${email} belongs to a different organization on this server`, 409)
  }

  const changes: string[] = []

  if (input.role) {
    const role = findRole(input.role)
    if (user.role !== role) {
      /* Only an instructor may be lent to the other academy, and the schema
         enforces it on save — so moving somebody off instructor has to let go
         of that first, or the change is refused with a message about a flag
         nobody set from here. */
      if (user.sharedAcrossOrgs && role !== 'instructor') user.sharedAcrossOrgs = false
      user.role = role as typeof user.role
      changes.push(`role to ${role}`)
    }
  }

  if (input.status) {
    const status = input.status.trim().toLowerCase()
    if (status !== 'active' && status !== 'inactive') {
      throw httpError(`"${status}" is not a status here`, 400)
    }
    const wanted = status === 'active'
    if (user.isActive !== wanted) {
      user.isActive = wanted
      changes.push(`status to ${status}`)
    }
  }

  if (changes.length) await user.save()

  return {
    detail: changes.length
      ? `Changed ${email}'s ${changes.join(' and ')} in ${org.name}`
      : `${email} already held that in ${org.name}`,
    roleKey: user.role ?? '',
    membershipStatus: user.isActive === false ? 'inactive' : 'active',
  }
}

/**
 * Create an account here, because a root admin asked.
 *
 * Signing in from the portal deliberately refuses an unknown person: this
 * server believes what the portal vouches for, so an account appearing
 * because a token arrived would turn a spoofed portal into an instant
 * account. That refusal stands; this is the other half, decided on purpose.
 *
 * The password is random and nobody is told it, including whoever asked for
 * the account — they arrive through the portal and never type one here.
 */
export async function provisionFromPortal(input: {
  email: string
  name: string
  role: string
  remoteOrgId?: string
}): Promise<{ created: boolean; userId: string; detail: string }> {
  const org = await resolveOrg(input.remoteOrgId)
  const email = input.email.toLowerCase().trim()
  if (!email) throw httpError('email is required', 400)

  const role = findRole(input.role)

  const existing = await UserModel.findOne({ email })
  if (existing) {
    if (String(existing.organizationId ?? '') === String(org._id)) {
      // Idempotent: the portal retries, and an administrator clicking twice
      // should not be an error they have to interpret.
      return {
        created: false,
        userId: String(existing._id),
        detail: `${email} already has an account in ${org.name}`,
      }
    }
    throw httpError(`${email} already exists on this server, in a different organization`, 409)
  }

  const user = await UserModel.create({
    organizationId: org._id,
    name: input.name?.trim() || email.split('@')[0],
    email,
    passwordHash: await hashPassword(crypto.randomBytes(24).toString('hex')),
    role,
    isActive: true,
    /* Verified on purpose: they were vouched for by the portal, and leaving
       them unverified would send them looking for a confirmation email that
       the portal's whole point is to avoid. */
    isVerified: true,
  })

  return {
    created: true,
    userId: String(user._id),
    detail: `Created ${email} in ${org.name} as ${role}`,
  }
}
