import { Types } from 'mongoose'
import { BaseRepository } from './base.repository.ts'
import { UserModel, RefreshTokenModel, AuthTokenModel } from '@/models/schema.ts'
import { sharedInstructorFilter, andFilter } from '@/utils/tenancy.ts'
import type {
  IUser, IRefreshToken, IAuthToken, AuthTokenPurpose, RefreshTokenRevokeReason,
} from '@/models/schema.ts'

/** Upper bound on a free-text search term before it reaches $regex. */
const MAX_SEARCH_LEN = 100

/* ─────────────────────────────────────────────────────
   UserRepository
───────────────────────────────────────────────────── */
export class UserRepository extends BaseRepository<IUser> {
  constructor() {
    super(UserModel)
  }

  /* ── Find by email (includes passwordHash for auth) */
  async findByEmail(email: string): Promise<IUser | null> {
    /* passwordHash has select:false — must opt-in explicitly */
    return UserModel
      .findOne({ email: email.toLowerCase().trim() })
      .select('+passwordHash')
      .exec()
  }

  /* ── Find by OAuth provider ─────────────────────── */
  async findByProvider(provider: string, providerId: string): Promise<IUser | null> {
    return UserModel.findOne({ provider, providerId }).exec()
  }

  /* ── Create user (normalizes email) ─────────────── */
  async createUser(data: {
    name:                   string
    email:                  string
    passwordHash?:          string
    role?:                  IUser['role']
    provider?:              string
    providerId?:            string
    avatarUrl?:             string
    enrollmentStatus?:      IUser['enrollmentStatus']
    categories?:            IUser['categories']
    category?:              IUser['category']
    enrollmentApplication?: IUser['enrollmentApplication']
    signupType?:            IUser['signupType']
    organizationId?:        Types.ObjectId | string
    program?:               IUser['program']
  }): Promise<IUser> {
    return this.create({
      ...data,
      email:      data.email.toLowerCase().trim(),
      isVerified: false,
      isActive:   true,
    } as Partial<IUser>)
  }

  /* ── Stamp last login time + reset lockout counter ── */
  async touchLastLogin(id: string): Promise<void> {
    await UserModel.findByIdAndUpdate(id, {
      $set:   { lastLoginAt: new Date(), failedLoginAttempts: 0 },
      $unset: { lockedUntil: 1 },
    }).exec()
  }

  /* ── Login-lockout helpers ──────────────────────── */
  async incrementFailedLogin(id: string): Promise<{ attempts: number; lockedUntil?: Date }> {
    const MAX_ATTEMPTS  = 5
    const LOCK_DURATION = 15 * 60 * 1000  // 15 min

    const updated = await UserModel.findByIdAndUpdate(
      id,
      { $inc: { failedLoginAttempts: 1 } },
      { new: true },
    ).exec()
    if (!updated) return { attempts: 0 }

    if (updated.failedLoginAttempts >= MAX_ATTEMPTS && !updated.lockedUntil) {
      const lockedUntil = new Date(Date.now() + LOCK_DURATION)
      await UserModel.findByIdAndUpdate(id, { $set: { lockedUntil } }).exec()
      return { attempts: updated.failedLoginAttempts, lockedUntil }
    }
    return {
      attempts:    updated.failedLoginAttempts,
      lockedUntil: updated.lockedUntil,
    }
  }

  async setVerified(id: string): Promise<void> {
    await UserModel.findByIdAndUpdate(id, { $set: { isVerified: true } }).exec()
  }

  async updatePasswordHash(id: string, passwordHash: string): Promise<void> {
    await UserModel.findByIdAndUpdate(id, {
      $set:   { passwordHash, failedLoginAttempts: 0 },
      $unset: { lockedUntil: 1 },
    }).exec()
  }

  /* Atomically claim a password-reset-mail slot for this account. Returns true
     for the single caller that wins the window and false for everyone else, so
     concurrent forgot-password bursts send at most one mail per windowMs. The
     conditional findOneAndUpdate is atomic per document, so unlike a read-then-
     write throttle there is no TOCTOU gap between checking and stamping. */
  async claimResetMailSlot(id: string, windowMs: number): Promise<boolean> {
    const cutoff = new Date(Date.now() - windowMs)
    const won = await UserModel.findOneAndUpdate(
      {
        _id: id,
        $or: [{ lastResetMailAt: { $exists: false } }, { lastResetMailAt: { $lte: cutoff } }],
      },
      { $set: { lastResetMailAt: new Date() } },
      { new: false },
    ).lean().exec()
    return !!won
  }

  /* Release a slot claimed by claimResetMailSlot when the mail could not be
     dispatched, so a transient send failure doesn't lock the account out of
     retrying for the whole window. */
  async releaseResetMailSlot(id: string): Promise<void> {
    await UserModel.findByIdAndUpdate(id, { $unset: { lastResetMailAt: 1 } }).exec()
  }

  /* ── Check email exists ─────────────────────────── */
  async emailExists(email: string): Promise<boolean> {
    return this.exists({ email: email.toLowerCase().trim() })
  }

  /* ── Paginated list by role (admin / instructors / students) */
  async listByRole(
    role: IUser['role'] | undefined,
    params: {
      page:              number
      perPage:           number
      search?:           string
      category?:         string
      enrollmentStatus?: string
      status?:           'active' | 'inactive'
      excludeStudents?:  boolean
      organizationId?:   string
    },
  ): Promise<{ docs: IUser[]; totalCount: number }> {
    const filter: Record<string, unknown> = {}

    if (params.excludeStudents) {
      filter['role'] = { $ne: 'student' }
    } else if (role) {
      filter['role'] = role
    }

    if (role === 'student') {
      // Explicit enrollmentStatus overrides the default; default is 'approved' for student lists
      filter['enrollmentStatus'] = params.enrollmentStatus ?? 'approved'
    } else if (params.enrollmentStatus) {
      filter['enrollmentStatus'] = params.enrollmentStatus
    }

    if (params.status === 'active')   filter['isActive'] = true
    if (params.status === 'inactive') filter['isActive'] = false

    /* ── Who counts as "in this programme" ──────────────────────────────
       A student's programme lives on `categories`, and nothing about
       enrolling on a course writes it: a Digital Marketing student put on an
       AI course — by purchase, by an admin, by self-enrol or by script — stays
       DM, so the AI sub-admin's student table never showed them. They were
       visible on the AI course roster and nowhere else, which made the two
       views disagree about who the programme's students are.

       So the programme filter now matches EITHER way in: the student carries
       the category, or they are enrolled on a course that belongs to it. This
       is a read-side widening only — nothing here writes `categories`, and a
       student unenrolled from the course leaves the list with it.

       Guarded to student lists. Not for correctness -- an instructor list
       already carries `role: 'instructor'`, so student ids could never match
       it -- but so that listing instructors or admins does not pay for two
       collection reads whose results are guaranteed to be discarded. */
    const categoryOr: Record<string, unknown>[] | null = params.category
      ? [{ category: params.category }, { categories: params.category }]
      : null

    if (categoryOr && role === 'student') {
      const enrolled = await this.studentIdsOnProgramCourses(params.category!)
      if (enrolled.length) categoryOr.push({ _id: { $in: enrolled } })
    }

    const searchTerm = params.search
      ? params.search.slice(0, MAX_SEARCH_LEN).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      : null

    const searchOr = searchTerm
      ? [
          { name:  { $regex: searchTerm, $options: 'i' } },
          { email: { $regex: searchTerm, $options: 'i' } },
        ]
      : null

    if (categoryOr && searchOr) {
      filter['$and'] = [{ $or: categoryOr }, { $or: searchOr }]
    } else if (categoryOr) {
      filter['$or'] = categoryOr
    } else if (searchOr) {
      filter['$or'] = searchOr
    }

    if (params.organizationId && Types.ObjectId.isValid(params.organizationId)) {
      /* Instructors may be LENT to the other academy, so an instructor list is
         "owned by me OR shared". Every other role stays strictly scoped —
         widening a student list across academies is the leak N-07 was.

         Composed under $and, never assigned to $or: the search and category
         clauses above already own `filter.$or`, and assigning it again here
         would silently drop the caller's search terms. */
      if (role === 'instructor') {
        andFilter(filter, sharedInstructorFilter(params.organizationId))
      } else {
        filter['organizationId'] = new Types.ObjectId(params.organizationId)
      }
    }

    return this.paginate(filter, params.page, params.perPage, { createdAt: -1 })
  }

  /* The student ids reachable through a programme's COURSES rather than
     through their own category. Two small indexed reads — the programme's
     courses, then the distinct students enrolled on them — which is the same
     shape the scoped bookings and live-class queries already use. */
  private async studentIdsOnProgramCourses(program: string): Promise<Types.ObjectId[]> {
    if (!program) return []
    const { CourseModel, EnrollmentModel } = await import('@/models/schema.ts')
    const courses = await CourseModel.find({ program }, { _id: 1 }).lean()
    if (!courses.length) return []
    return EnrollmentModel.distinct('userId', {
      courseId: { $in: courses.map(c => c._id) },
    }) as unknown as Types.ObjectId[]
  }
}

/* ─────────────────────────────────────────────────────
   RefreshTokenRepository
   Token rotation — each refresh issues a new token,
   revokes the old one. Reuse detection included.
───────────────────────────────────────────────────── */
export class RefreshTokenRepository extends BaseRepository<IRefreshToken> {
  constructor() {
    super(RefreshTokenModel)
  }

  /* ── Persist a new hashed token ─────────────────── */
  async saveToken(data: {
    userId:    string
    tokenHash: string
    expiresAt: Date
    userAgent?: string
    ip?:        string
  }): Promise<IRefreshToken> {
    return this.create({
      userId:     data.userId,
      tokenHash:  data.tokenHash,
      isRevoked:  false,
      expiresAt:  data.expiresAt,
      userAgent:  data.userAgent,
      ip:         data.ip,
      lastUsedAt: new Date(),
    } as unknown as Partial<IRefreshToken>)
  }

  /* ── Find a valid (non-revoked, non-expired) token ─ */
  async findValid(tokenHash: string): Promise<IRefreshToken | null> {
    return RefreshTokenModel.findOne({
      tokenHash,
      isRevoked: false,
      expiresAt: { $gt: new Date() },
    }).exec()
  }

  /* ── Find by hash regardless of state (for refresh path) ─ */
  async findByHash(tokenHash: string): Promise<IRefreshToken | null> {
    return RefreshTokenModel.findOne({ tokenHash }).exec()
  }

  /* ── Stamp lastUsedAt on a refresh hit ───────────── */
  async touchLastUsed(tokenHash: string): Promise<void> {
    await RefreshTokenModel.updateOne(
      { tokenHash },
      { $set: { lastUsedAt: new Date() } },
    ).exec()
  }

  /* ── List a user's active sessions ───────────────── */
  async listActiveForUser(userId: string): Promise<IRefreshToken[]> {
    return RefreshTokenModel
      .find({
        userId,
        isRevoked: false,
        expiresAt: { $gt: new Date() },
      })
      .sort({ lastUsedAt: -1, createdAt: -1 })
      .exec()
  }

  /* ── Find a specific session owned by the user ───── */
  async findOwn(id: string, userId: string): Promise<IRefreshToken | null> {
    return RefreshTokenModel.findOne({ _id: id, userId, isRevoked: false }).exec()
  }

  /* ── Revoke by ObjectId ────────────────────────── */
  async revokeById(id: string, reason: RefreshTokenRevokeReason = 'user'): Promise<void> {
    await RefreshTokenModel.updateOne(
      { _id: id },
      { $set: { isRevoked: true, revokedReason: reason } },
    ).exec()
  }

  /* ── Revoke a single token by hash ────────────── */
  async revokeToken(tokenHash: string, reason: RefreshTokenRevokeReason = 'logout'): Promise<void> {
    await RefreshTokenModel.updateOne(
      { tokenHash },
      { $set: { isRevoked: true, revokedReason: reason } },
    ).exec()
  }

  /* ── Atomically claim a token for rotation ───────────
     Guards against concurrent refresh calls (e.g. two
     browser tabs racing on the same still-valid refresh
     token): only the request that actually flips
     isRevoked false → true "wins" and proceeds to issue
     new tokens. A losing concurrent request gets back
     null instead of tripping reuse detection. */
  async claimForRotation(tokenHash: string): Promise<IRefreshToken | null> {
    return RefreshTokenModel.findOneAndUpdate(
      { tokenHash, isRevoked: false },
      { $set: { isRevoked: true, revokedReason: 'rotation' } },
      { new: false },
    ).exec()
  }

  /* ── Revoke all tokens for a user ───────────────── */
  async revokeAllForUser(userId: string, reason: RefreshTokenRevokeReason = 'security'): Promise<void> {
    await RefreshTokenModel.updateMany(
      { userId, isRevoked: false },
      { $set: { isRevoked: true, revokedReason: reason } },
    ).exec()
  }

  /* ── Delete expired tokens (maintenance) ────────── */
  async deleteExpired(): Promise<number> {
    return this.deleteMany({ expiresAt: { $lt: new Date() } })
  }
}

/* ─────────────────────────────────────────────────────
   AuthTokenRepository — password-reset + email-verify
───────────────────────────────────────────────────── */
export class AuthTokenRepository extends BaseRepository<IAuthToken> {
  constructor() {
    super(AuthTokenModel)
  }

  async create_(data: {
    userId:    string
    tokenHash: string
    purpose:   AuthTokenPurpose
    expiresAt: Date
  }): Promise<IAuthToken> {
    return this.create({
      userId:    data.userId,
      tokenHash: data.tokenHash,
      purpose:   data.purpose,
      expiresAt: data.expiresAt,
    } as unknown as Partial<IAuthToken>)
  }

  /* Atomically claim the token: matches + not used + not expired,
     and marks `usedAt` so a second consumer cannot replay it. */
  async claim(tokenHash: string, purpose: AuthTokenPurpose): Promise<IAuthToken | null> {
    return AuthTokenModel.findOneAndUpdate(
      {
        tokenHash,
        purpose,
        expiresAt: { $gt: new Date() },
        usedAt:    { $exists: false },
      },
      { $set: { usedAt: new Date() } },
      { new: false },  // return the doc as it was BEFORE the update
    ).exec()
  }

  /* Invalidate any outstanding tokens of this purpose for a user
     before issuing a new one — keeps the "only one live link" UX. */
  async invalidateForUser(userId: string, purpose: AuthTokenPurpose): Promise<void> {
    await AuthTokenModel.updateMany(
      { userId, purpose, usedAt: { $exists: false } },
      { $set: { usedAt: new Date() } },
    ).exec()
  }
}
