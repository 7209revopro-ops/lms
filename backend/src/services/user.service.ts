import { Types } from 'mongoose'
import { UserRepository, RefreshTokenRepository } from '@/repositories/user.repository.ts'
import { hashPassword } from '@/utils/hash.ts'
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

  async listByRole(role: UserRole | undefined, params: { page: number; perPage: number; search?: string; category?: string; status?: 'active' | 'inactive'; excludeStudents?: boolean; enrollmentStatus?: 'pending' | 'approved' | 'rejected' | 'cancelled'; organizationId?: string }) {
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
      sharedAcrossOrgs?: boolean; role?: UserRole; isActive?: boolean; isVerified?: boolean; name?: string; email?: string; category?: '4x-trading' | 'digital-marketing' | 'ai' | 'jura' | null; categories?: ('4x-trading' | 'digital-marketing' | 'ai' | 'jura')[]; avatarUrl?: string; headline?: string; bio?: string; program?: import('@/types/index.ts').ProgramType },
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
    if (dto.program    !== undefined) update.program    = dto.program || undefined
    /* Lending an instructor to the other academy. WHO may set this is gated in
       the route (admin / super_admin only); the schema validator refuses it on
       any non-instructor, so a bad payload fails loudly rather than widening a
       student list. */
    if (dto.sharedAcrossOrgs !== undefined) update.sharedAcrossOrgs = dto.sharedAcrossOrgs
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

    if (Object.keys(update).length === 0) {
      throw new UserError('NO_CHANGES', 'No fields to update', 400)
    }

    const updated = await this.repo.updateById(id, update)
    if (!updated) throw new UserError('USER_NOT_FOUND', 'User not found.', 404)

    /* On deactivation, force the user to log out everywhere. */
    if (dto.isActive === false) {
      await this.refreshRepo.revokeAllForUser(id, 'security')
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
    if (Object.keys(patch).length > 0) {
      await this.repo.updateById(user.id, patch)
      Object.assign(user, patch)
    }
    return user
  }
}
