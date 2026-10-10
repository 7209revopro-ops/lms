import { Types } from 'mongoose'
import { UserRepository, RefreshTokenRepository } from '@/repositories/user.repository.ts'
import { hashPassword } from '@/utils/hash.ts'
import { logger } from '@/utils/logger.ts'
import type { UserRole } from '@/types/index.ts'
import type { IUser } from '@/models/schema.ts'

export class UserError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message)
    this.name = 'UserError'
  }
}

export class UserService {
  private readonly repo         = new UserRepository()
  private readonly refreshRepo  = new RefreshTokenRepository()

  async listByRole(role: UserRole | undefined, params: { page: number; perPage: number; search?: string; category?: string; status?: 'active' | 'inactive'; excludeStudents?: boolean; enrollmentStatus?: 'pending' | 'approved' | 'rejected' | 'cancelled'; noPhone?: boolean; organizationId?: string }) {
    return this.repo.listByRole(role, params)
  }

  /* Deleting a user from the admin panel used to remove the user row and
     nothing else, so their enrolments survived pointing at an account that no
     longer existed — and the course table, which counts enrolments, kept
     counting them. The cascade runs BEFORE the row goes: it reads the user's
     enrolments to know which course counters to decrement, and once the user
     is gone there is nothing left to read. */
  async adminDelete(id: string): Promise<void> {
    if (!Types.ObjectId.isValid(id)) throw new UserError('INVALID_ID', 'Invalid user id', 400)

    const existing = await this.repo.findById(id)
    if (!existing) throw new UserError('USER_NOT_FOUND', 'User not found.', 404)

    const { cascadeUserDeletion } = await import('@/services/userCascade.ts')
    await cascadeUserDeletion(id)

    const deleted = await this.repo.hardDelete(id)
    if (!deleted) throw new UserError('USER_NOT_FOUND', 'User not found.', 404)
    await this.refreshRepo.revokeAllForUser(id, 'security')
  }

  /* Admin-only updates: role change, deactivate/activate, force-verify.
     Deactivation also revokes all refresh tokens for that user. */
  async adminUpdate(
    id: string,
    dto: {
      sharedAcrossOrgs?: boolean; meetEmail?: string; role?: UserRole; isActive?: boolean; isVerified?: boolean; name?: string; email?: string; category?: '4x-trading' | 'digital-marketing' | 'ai' | 'jura' | null; categories?: ('4x-trading' | 'digital-marketing' | 'ai' | 'jura')[]; avatarUrl?: string; headline?: string; bio?: string; phone?: string; program?: import('@/types/index.ts').ProgramType },
  ): Promise<IUser> {
    if (!Types.ObjectId.isValid(id)) {
      throw new UserError('INVALID_ID', 'Invalid user id', 400)
    }
    const update: Partial<IUser> = {}
    if (dto.role       !== undefined) update.role       = dto.role
    if (dto.isActive   !== undefined) update.isActive   = dto.isActive
    if (dto.isVerified !== undefined) update.isVerified = dto.isVerified
    if (dto.name       !== undefined) update.name       = dto.name.trim()
    if (dto.avatarUrl  !== undefined) update.avatarUrl  = dto.avatarUrl || undefined
    if (dto.headline   !== undefined) update.headline   = dto.headline || undefined
    if (dto.bio        !== undefined) update.bio        = dto.bio || undefined
    if (dto.phone      !== undefined) update.phone      = dto.phone || undefined
    if (dto.program    !== undefined) update.program    = dto.program || undefined
    /* Lending an instructor to the other academy. WHO may set this is gated in
       the route (admin / super_admin only); the schema validator refuses it on
       any non-instructor, so a bad payload fails loudly rather than widening a
       student list. */
    if (dto.sharedAcrossOrgs !== undefined) update.sharedAcrossOrgs = dto.sharedAcrossOrgs

    /* ONLY AN INSTRUCTOR MAY BE LENT — enforced here because nothing else on
       this path enforces it.

       UserSchema carries a pre('validate') hook for exactly this rule, and its
       comment says a validator "is the one check that cannot be forgotten at a
       new call site". That is true of save(), and false of this one: the
       repository updates through findByIdAndUpdate, and a DOCUMENT hook does
       not run on a query. `runValidators: true` runs the PATH validators —
       enum, required, min — and no document middleware at all. Measured, not
       assumed: a lent instructor patched to role 'admin' came back
       `role=admin sharedAcrossOrgs=true`, and a plain student patched with
       `{ sharedAcrossOrgs: true }` came back shared.

       The create route refuses the same combination with INVALID_SHARED_ROLE
       and had no counterpart here, so the rule held until the first edit.

       THE ROLE AFTER THE PATCH is what matters, not the role in the request:
       both halves of the pair can arrive separately. Changing the role away
       from instructor without mentioning the flag is the common case, and it is
       REFUSED rather than silently cleared — clearing it would un-lend the
       instructor as a side effect of a role change, and the borrowing academy's
       classes are assigned to them. Those classes would then refuse every
       subsequent save with INSTRUCTOR_NOT_FOUND. Better to make the operator
       do it in the order they can see. */
    if (dto.role !== undefined || dto.sharedAcrossOrgs !== undefined) {
      const current = await this.repo.findById(id)
      if (!current) throw new UserError('USER_NOT_FOUND', 'User not found.', 404)
      const nextRole   = dto.role ?? current.role
      const nextShared = dto.sharedAcrossOrgs ?? current.sharedAcrossOrgs === true
      if (nextShared && nextRole !== 'instructor') {
        throw new UserError(
          'INVALID_SHARED_ROLE',
          dto.sharedAcrossOrgs === true
            ? 'Only instructors can be shared between organizations.'
            : 'This instructor is shared with both organizations. Turn that off before changing their role.',
          400,
        )
      }
    }
    if (dto.categories !== undefined) {
      /* Multi-select path: set categories directly, keep category in sync with first */
      update.categories = dto.categories as any
      update.category   = dto.categories[0] ?? (undefined as any)
    } else if (dto.category !== undefined) {
      update.category   = dto.category ?? undefined
      update.categories = dto.category ? [dto.category] as any : [] as any
    }
    if (dto.email      !== undefined) {
      /* Check for duplicate email, excluding the current user */
      const existing = await this.repo.findByEmail(dto.email)
      if (existing && String(existing._id) !== id) {
        throw new UserError('EMAIL_TAKEN', 'An account with this email already exists.', 409)
      }
      update.email = dto.email.toLowerCase().trim()
    }
    /* '' clears it back to "use the login email" — see IUser.meetEmail. */
    if (dto.meetEmail !== undefined) {
      update.meetEmail = dto.meetEmail ? dto.meetEmail.toLowerCase().trim() : null
    }

    if (Object.keys(update).length === 0) {
      throw new UserError('NO_CHANGES', 'No fields to update', 400)
    }

    const updated = await this.repo.updateById(id, update)
    if (!updated) throw new UserError('USER_NOT_FOUND', 'User not found.', 404)

    /* On deactivation, force the user to log out everywhere. */
    if (dto.isActive === false) {
      await this.refreshRepo.revokeAllForUser(id, 'security')
    }

    /* The address Meet knows this instructor by may have moved — typically
       their Gmail arriving after classes were already scheduled. Re-point the
       co-host on their upcoming classes; classes already right are skipped, so
       a form re-saved unchanged costs one query. Never fails the save. */
    if (updated.role === 'instructor' && (dto.meetEmail !== undefined || dto.email !== undefined)) {
      void import('@/services/liveClass.service.ts')
        .then(({ LiveClassService }) => new LiveClassService().resyncMeetCohostsFor(id))
        .then(n => { if (n) logger.info({ instructorId: id, classes: n }, 'meet co-host re-pointed after address change') })
        .catch(err => logger.warn({ err, instructorId: id }, 'meet co-host resync failed'))
    }
    return updated
  }

  /* Admin creates a new user (instructor / admin) directly. */
  async findById(id: string): Promise<IUser | null> {
    if (!Types.ObjectId.isValid(id)) return null
    return this.repo.findById(id)
  }

  async adminCreateUser(dto: {
    name:            string
    email:           string
    /* Google account for Meet, when not `email` — see IUser.meetEmail. */
    meetEmail?:      string
    password:        string
    role:            UserRole
    bio?:            string
    headline?:       string
    category?:       '4x-trading' | 'digital-marketing' | 'ai' | 'jura'
    categories?:     ('4x-trading' | 'digital-marketing' | 'ai' | 'jura')[]
    avatarUrl?:      string
    approvedBy?:     string
    organizationId?: string
    program?:        import('@/types/index.ts').ProgramType
    /* Contact number for a staff account (super_admin/admin/sub_admin) —
       also doubles as their WhatsApp number, e.g. for a new-support-ticket
       alert. Meaningless-but-harmless on a student account. */
    phone?:          string
    /* Lend this instructor to the other academy. Gated to admin/super_admin in
       the route; the schema validator refuses it on any non-instructor. */
    sharedAcrossOrgs?: boolean
  }): Promise<IUser> {
    const exists = await this.repo.emailExists(dto.email)
    if (exists) {
      throw new UserError('EMAIL_TAKEN', 'An account with this email already exists.', 409)
    }
    const passwordHash = await hashPassword(dto.password)
    /* Resolve category / categories: multi-select (categories) takes priority */
    const resolvedCategories = dto.categories && dto.categories.length > 0
      ? dto.categories
      : dto.category ? [dto.category] : []
    const resolvedCategory = resolvedCategories[0]
    const user = await this.repo.createUser({
      name:           dto.name.trim(),
      email:          dto.email,
      passwordHash,
      role:           dto.role,
      category:       resolvedCategory,
      categories:     resolvedCategories,
      ...(dto.organizationId && { organizationId: dto.organizationId }),
      ...(dto.program        && { program:         dto.program }),
    })
    /* Patch bio / headline / avatarUrl / enrollment approval if provided */
    const patch: Partial<IUser> = {}
    if (dto.bio)       patch.bio       = dto.bio
    if (dto.headline)  patch.headline  = dto.headline
    if (dto.avatarUrl) patch.avatarUrl = dto.avatarUrl
    if (dto.phone)     patch.phone     = dto.phone
    /* Only ever set on an instructor — the schema validator enforces the same
       rule, so a mistaken payload fails loudly rather than silently widening
       who can see a student. */
    if (dto.sharedAcrossOrgs && dto.role === 'instructor') {
      ;(patch as any).sharedAcrossOrgs = true
    }
    if (dto.role === 'student' && dto.approvedBy) {
      const { Types } = await import('mongoose')
      ;(patch as any).enrollmentStatus = 'approved'
      ;(patch as any).approvedBy       = new Types.ObjectId(dto.approvedBy)
      ;(patch as any).approvedAt       = new Date()
    }
    if (dto.meetEmail) patch.meetEmail = dto.meetEmail.toLowerCase().trim()
    if (Object.keys(patch).length > 0) {
      await this.repo.updateById(user.id, patch)
      Object.assign(user, patch)
    }
    return user
  }
}
