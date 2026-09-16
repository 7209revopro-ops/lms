import mongoose, { Schema, type Document, type Types } from 'mongoose'
import type { UserRole, CourseStatus, LessonType, EnrollmentStatus, QuestionType, AchievementKind, StudentEnrollmentStatus, ProgramCategory, OrgSlug, ProgramType } from '@/types/index.ts'

/* ─────────────────────────────────────────────────────
   Shared schema transform
   ─────────────────────────────────────────────────────
   Applied to every schema's toJSON / toObject:
   • Exposes id (string) instead of _id (ObjectId)
   • Removes __v (version key)
───────────────────────────────────────────────────── */
const baseTransform = (_doc: Document, ret: Record<string, unknown>) => {
  /* `_id` is not guaranteed. This transform runs on SUBDOCUMENTS too, and five
     of them are declared `{ _id: false }` — support-ticket messages among them.
     Serialising one threw "undefined is not an object (evaluating
     'ret._id.toString')", which surfaced as a 500 on an ordinary action:
     posting a reply to your own support ticket. A projection that excludes
     `_id` reaches here the same way.

     Guarding costs nothing and cannot change the output for a document that
     does have an id. */
  if (ret['_id'] != null) {
    ret['id'] = (ret['_id'] as Types.ObjectId).toString()
    delete ret['_id']
  }
  delete ret['__v']
  return ret
}

const baseSchemaOptions = {
  timestamps: true,
  toJSON:   { virtuals: true, transform: baseTransform },
  toObject: { virtuals: true, transform: baseTransform },
}

/* ─────────────────────────────────────────────────────
   ORGANIZATION
───────────────────────────────────────────────────── */
export interface IOrganization extends Document {
  id:             string
  name:           string
  slug:           OrgSlug
  currency:       'AED' | 'INR'
  paymentGateway: 'abzer' | 'razorpay'
  countryFilter:  string | null   // null = catch-all (Dubai); 'India' = Bangalore only
  createdAt:      Date
  updatedAt:      Date
}

const OrganizationSchema = new Schema<IOrganization>(
  {
    name:           { type: String, required: true, unique: true, trim: true },
    slug:           { type: String, required: true, unique: true, enum: ['dubai', 'bangalore'] },
    currency:       { type: String, required: true, enum: ['AED', 'INR'] },
    paymentGateway: { type: String, required: true, enum: ['abzer', 'razorpay'] },
    countryFilter:  { type: String, default: null },
  },
  baseSchemaOptions,
)

export const OrganizationModel = mongoose.model<IOrganization>('Organization', OrganizationSchema)

/* ─────────────────────────────────────────────────────
   USER
───────────────────────────────────────────────────── */
/* ── Enrollment application data (23-question form) ── */
export interface IEnrollmentApplication {
  phone?:             string
  emergencyContact?:  string
  gender?:            string
  dateOfBirth?:       string
  nationality?:       string
  homeCountry?:       string
  occupation?:        string
  idType?:            string
  idNumber?:          string
  emiratesId?:        string
  countryAttendance?: string
  villa?:             string
  city?:              string
  addressCountry?:    string
  passportUrl?:       string
  idDocUrl?:          string
  photoUrl?:          string
  experienceLevel?:   string
  preferredStartDate?: string
  hearAboutUs?:       string
  referralName?:      string
  programs?:          string[]
  paymentMethod?:     string
}

export interface IUser extends Document {
  id:            string
  name:          string
  email:         string
  /** Requested but not yet confirmed. See the schema note below. */
  pendingEmail?: string
  passwordHash?: string
  avatarUrl?:    string
  role:          UserRole
  isVerified:    boolean
  isActive:      boolean
  /* OAuth */
  provider?:     string
  providerId?:   string
  /* Profile */
  bio?:          string
  headline?:     string
  websiteUrl?:   string
  /* Account safety */
  failedLoginAttempts: number
  lockedUntil?:  Date
  /* Timestamp the last admin password-reset mail was issued — backs an atomic
     per-account throttle so concurrent forgot-password bursts can't flood a
     staff inbox. */
  lastResetMailAt?: Date
  /* Two-factor authentication (TOTP) */
  twoFactorEnabled: boolean
  twoFactorSecret?: string   // base32-encoded TOTP secret; select:false
  /* Per-day AI chat usage (L-09). `day` is the local calendar date in the
     app's timezone (Asia/Dubai), so the allowance resets at local midnight
     rather than at an arbitrary UTC hour. */
  aiUsage?: { day: string; count: number }
  /* Custom role (fine-grained permissions) */
  customRoleId?: Types.ObjectId
  /* Multi-org — which academy this user belongs to (omitted for super_admin) */
  organizationId?: Types.ObjectId
  /* sub_admin program scope */
  program?: ProgramType
  /* Student program categories (multi) */
  category?:     ProgramCategory     // legacy single
  categories:    ProgramCategory[]   // multi-category
  /* Signup type — express (fast) or full (complete form) */
  signupType?:         'express' | 'full'
  /* Student enrollment approval */
  enrollmentStatus?:   StudentEnrollmentStatus
  approvedBy?:         Types.ObjectId
  approvedByEmail?:    string
  approvedByName?:     string
  approvedByRole?:     string
  approvedAt?:         Date
  rejectedBy?:         Types.ObjectId
  rejectedByEmail?:    string
  rejectedByName?:     string
  rejectedAt?:         Date
  rejectionReason?:    string
  /* Tracks when an express user completes the full 4-step registration form */
  fullRegistrationSubmittedAt?: Date
  /* Enrollment application form data */
  enrollmentApplication?: IEnrollmentApplication
  /* Meta */
  lastLoginAt?:  Date
  createdAt:     Date
  updatedAt:     Date
}

const UserSchema = new Schema<IUser>(
  {
    name:         { type: String, required: true, trim: true, maxlength: 120 },
    email:        { type: String, required: true, unique: true, lowercase: true, trim: true },
    /* An email change the student has asked for but not yet confirmed.

       Deliberately NOT the `email` field with a flag beside it: until the new
       address is proven reachable it must not be able to sign in, receive
       anything, or collide with somebody else's account. Parking it here keeps
       the live identity untouched while the link is outstanding, so a typo
       costs nothing and a change abandoned halfway simply expires. No unique
       index — two students may both be part-way through claiming the same
       address, and only the one who confirms first gets it. */
    pendingEmail: { type: String, lowercase: true, trim: true },
    passwordHash: { type: String, select: false },   // excluded from queries by default
    avatarUrl:    { type: String },
    role:         { type: String, enum: ['student', 'instructor', 'admin', 'super_admin', 'sub_admin', 'support'], default: 'student' },
    isVerified:   { type: Boolean, default: false },
    isActive:     { type: Boolean, default: true },
    provider:     { type: String },
    providerId:   { type: String },
    bio:          { type: String },
    headline:     { type: String, maxlength: 255 },
    websiteUrl:   { type: String },
    failedLoginAttempts: { type: Number, default: 0 },
    lockedUntil:  { type: Date },
    lastResetMailAt: { type: Date },
    twoFactorEnabled: { type: Boolean, default: false },
    twoFactorSecret:  { type: String, select: false },
    aiUsage:          { day: { type: String }, count: { type: Number, default: 0 } },
    customRoleId:   { type: Schema.Types.ObjectId, ref: 'Role' },
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization' },
    program:        { type: String, enum: ['ai', 'digital_marketing', 'forex', 'jura'] },
    lastLoginAt:    { type: Date },
    category:         { type: String, enum: ['4x-trading', 'digital-marketing', 'ai', 'jura'] },
    categories:       [{ type: String, enum: ['4x-trading', 'digital-marketing', 'ai', 'jura'] }],
    signupType:       { type: String, enum: ['express', 'full'], default: 'full' },
    enrollmentStatus: { type: String, enum: ['pending', 'approved', 'rejected', 'cancelled'] },
    approvedBy:       { type: Schema.Types.ObjectId, ref: 'User' },
    approvedByEmail:  { type: String },
    approvedByName:   { type: String },
    approvedByRole:   { type: String },
    approvedAt:       { type: Date },
    rejectedBy:       { type: Schema.Types.ObjectId, ref: 'User' },
    rejectedByEmail:  { type: String },
    rejectedByName:   { type: String },
    rejectedAt:       { type: Date },
    rejectionReason:              { type: String },
    fullRegistrationSubmittedAt:  { type: Date },
    enrollmentApplication: {
      type: new Schema<IEnrollmentApplication>({
        phone:              { type: String },
        emergencyContact:   { type: String },
        gender:             { type: String },
        dateOfBirth:        { type: String },
        nationality:        { type: String },
        homeCountry:        { type: String },
        occupation:         { type: String },
        idType:             { type: String },
        idNumber:           { type: String },
        emiratesId:         { type: String },
        countryAttendance:  { type: String },
        villa:              { type: String },
        city:               { type: String },
        addressCountry:     { type: String },
        passportUrl:        { type: String },
        idDocUrl:           { type: String }, // ID document copy URL
        photoUrl:           { type: String },
        experienceLevel:    { type: String },
        preferredStartDate: { type: String },
        hearAboutUs:        { type: String },
        referralName:       { type: String },
        programs:           [{ type: String }],
        paymentMethod:      { type: String },
      }, { _id: false }),
      default: undefined,
    },
  },
  baseSchemaOptions,
)

UserSchema.index({ provider: 1, providerId: 1 })

export const UserModel = mongoose.model<IUser>('User', UserSchema)

/* ─────────────────────────────────────────────────────
   ROLE  (custom roles with fine-grained permission matrix)
───────────────────────────────────────────────────── */
export const PERMISSION_RESOURCES = [
  'users', 'courses', 'live-classes', 'bookings',
  'orders', 'categories', 'coupons', 'reviews', 'reports', 'roles', 'support',
] as const
export type PermissionResource = typeof PERMISSION_RESOURCES[number]

export interface IResourcePermission {
  resource:    string
  create:      boolean
  read:        boolean
  update:      boolean
  delete:      boolean
  list:        boolean
  list_basic:  boolean
  impersonate: boolean    // meaningful for 'users' resource only
}

export interface IRole extends Document {
  id:           string
  name:         string
  description?: string
  isSystem:     boolean   // system roles cannot be deleted
  permissions:  IResourcePermission[]
  createdAt:    Date
  updatedAt:    Date
}

const ResourcePermissionSchema = new Schema<IResourcePermission>(
  {
    resource:    { type: String, required: true },
    create:      { type: Boolean, default: false },
    read:        { type: Boolean, default: false },
    update:      { type: Boolean, default: false },
    delete:      { type: Boolean, default: false },
    list:        { type: Boolean, default: false },
    list_basic:  { type: Boolean, default: false },
    impersonate: { type: Boolean, default: false },
  },
  { _id: false },
)

const RoleSchema = new Schema<IRole>(
  {
    name:        { type: String, required: true, unique: true, trim: true, maxlength: 80 },
    description: { type: String, maxlength: 500 },
    isSystem:    { type: Boolean, default: false },
    permissions: { type: [ResourcePermissionSchema], default: [] },
  },
  baseSchemaOptions,
)

export const RoleModel = mongoose.model<IRole>('Role', RoleSchema)

/* ─────────────────────────────────────────────────────
   REFRESH TOKEN
───────────────────────────────────────────────────── */
export type RefreshTokenRevokeReason = 'rotation' | 'user' | 'logout' | 'security'

export interface IRefreshToken extends Document {
  id:             string
  userId:         Types.ObjectId
  tokenHash:      string
  isRevoked:      boolean
  /* Why this token was revoked. Critical for refresh-reuse detection:
     only 'rotation' triggers the kill-all-sessions response — the
     others are explicit user/security actions and must never cascade. */
  revokedReason?: RefreshTokenRevokeReason
  expiresAt:      Date
  /* Session metadata — populated on login, refreshed on each
     successful token rotation. Used by the Active Sessions UI. */
  userAgent?:     string
  ip?:            string
  lastUsedAt?:    Date
  createdAt:      Date
  updatedAt:      Date
}

const RefreshTokenSchema = new Schema<IRefreshToken>(
  {
    userId:        { type: Schema.Types.ObjectId, ref: 'User', required: true },
    tokenHash:     { type: String, required: true, unique: true },
    isRevoked:     { type: Boolean, default: false },
    revokedReason: { type: String, enum: ['rotation', 'user', 'logout', 'security'] },
    expiresAt:     { type: Date, required: true },
    userAgent:     { type: String, maxlength: 500 },
    ip:            { type: String, maxlength: 64 },
    lastUsedAt:    { type: Date },
  },
  baseSchemaOptions,
)

RefreshTokenSchema.index({ userId: 1 })
RefreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })  // TTL index — auto-deletes

export const RefreshTokenModel = mongoose.model<IRefreshToken>('RefreshToken', RefreshTokenSchema)

/* ── Device whitelist ──────────────────────────────────────────────────
   Students may sign in on two devices. The first browser is auto-approved as
   the main device; a second is a pending request an admin approves; a third is
   refused until a slot is freed. Identity is a random deviceId kept in a
   long-lived httpOnly cookie (lms_device), per browser rather than hardware.
   Enforced at every login and re-checked on refresh (see device.service.ts).
   The AI-academy side keeps its own equivalent — see academy-api. */
export type DeviceStatus = 'approved' | 'pending' | 'revoked'

export interface IDevice extends Document {
  id:          string
  userId:      Types.ObjectId
  deviceId:    string
  status:      DeviceStatus
  isMain:      boolean
  label?:      string
  userAgent?:  string
  ip?:         string
  approvedAt?: Date
  approvedBy?: Types.ObjectId
  lastSeenAt?: Date
  createdAt:   Date
  updatedAt:   Date
}

const DeviceSchema = new Schema<IDevice>(
  {
    userId:     { type: Schema.Types.ObjectId, ref: 'User', required: true },
    deviceId:   { type: String, required: true },
    status:     { type: String, enum: ['approved', 'pending', 'revoked'], required: true },
    isMain:     { type: Boolean, default: false },
    label:      { type: String, maxlength: 120 },
    userAgent:  { type: String, maxlength: 500 },
    ip:         { type: String, maxlength: 64 },
    approvedAt: { type: Date },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    lastSeenAt: { type: Date },
  },
  baseSchemaOptions,
)

// One row per browser per user — the whitelist upsert depends on it.
DeviceSchema.index({ userId: 1, deviceId: 1 }, { unique: true })
DeviceSchema.index({ userId: 1, status: 1 })
DeviceSchema.index({ status: 1, createdAt: -1 })   // admin pending-requests list

export const DeviceModel = mongoose.model<IDevice>('Device', DeviceSchema)

/* ─────────────────────────────────────────────────────
   AUTH TOKEN — used for password reset + email verify
───────────────────────────────────────────────────── */
export type AuthTokenPurpose =
  | 'reset-password' | 'verify-email' | 'otp-login' | 'login-link' | 'change-email'

export interface IAuthToken extends Document {
  id:        string
  userId:    Types.ObjectId
  tokenHash: string
  purpose:   AuthTokenPurpose
  expiresAt: Date
  usedAt?:   Date
  createdAt: Date
  updatedAt: Date
}

const AuthTokenSchema = new Schema<IAuthToken>(
  {
    userId:    { type: Schema.Types.ObjectId, ref: 'User', required: true },
    tokenHash: { type: String, required: true, unique: true },
    purpose:   { type: String, enum: ['reset-password', 'verify-email', 'otp-login', 'login-link', 'change-email'], required: true },
    expiresAt: { type: Date, required: true },
    usedAt:    { type: Date },
  },
  baseSchemaOptions,
)

AuthTokenSchema.index({ userId: 1, purpose: 1 })
AuthTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export const AuthTokenModel = mongoose.model<IAuthToken>('AuthToken', AuthTokenSchema)

/* ─────────────────────────────────────────────────────
   CATEGORY
───────────────────────────────────────────────────── */
export interface ICategory extends Document {
  id:          string
  name:        string
  slug:        string
  description?: string
  icon?:       string
  createdAt:   Date
  updatedAt:   Date
}

const CategorySchema = new Schema<ICategory>(
  {
    name:        { type: String, required: true, unique: true, trim: true, maxlength: 100 },
    slug:        { type: String, required: true, unique: true, lowercase: true },
    description: { type: String },
    icon:        { type: String },
  },
  baseSchemaOptions,
)

export const CategoryModel = mongoose.model<ICategory>('Category', CategorySchema)

/* ─────────────────────────────────────────────────────
   COURSE
───────────────────────────────────────────────────── */
export interface ICourse extends Document {
  id:             string
  title:          string
  slug:           string
  description?:   string
  thumbnailUrl?:  string
  previewUrl?:    string
  price:          number
  /* Per-currency overrides (B-01). `price` is the USD figure Stripe charges;
     these are what the AED and INR gateways charge when set. Both were read by
     order.service.ts and settable from the admin form long before they existed
     here — Mongoose runs strict, so every value an admin typed was silently
     dropped on save and every non-USD order fell back to a conversion rate.
     Absent still means "fall back", so existing courses are unaffected. */
  priceAED?:      number
  priceINR?:      number
  isFree:         boolean
  status:         CourseStatus
  level?:         string
  durationMins:   number
  language:       string
  tags?:          string[]
  program?:        string
  instructorId:    Types.ObjectId
  categoryId?:     Types.ObjectId
  organizationId?: Types.ObjectId
  /* Denormalized stats */
  enrolledCount:  number
  ratingAvg:      number
  ratingCount:    number
  createdAt:      Date
  updatedAt:      Date
}

const CourseSchema = new Schema<ICourse>(
  {
    title:         { type: String, required: true, trim: true, maxlength: 255 },
    slug:          { type: String, required: true, unique: true, lowercase: true },
    description:   { type: String },
    thumbnailUrl:  { type: String },
    previewUrl:    { type: String },
    price:         { type: Number, default: 0, min: 0 },
    priceAED:      { type: Number, min: 0 },
    priceINR:      { type: Number, min: 0 },
    isFree:        { type: Boolean, default: false },
    status:        { type: String, enum: ['draft', 'published', 'archived'], default: 'draft' },
    level:         { type: String, enum: ['beginner', 'intermediate', 'advanced'] },
    durationMins:  { type: Number, default: 0 },
    language:      { type: String, default: 'English' },
    tags:          [{ type: String }],
    program:       { type: String },
    instructorId:   { type: Schema.Types.ObjectId, ref: 'User', required: true },
    categoryId:     { type: Schema.Types.ObjectId, ref: 'Category' },
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization' },
    enrolledCount:  { type: Number, default: 0 },
    ratingAvg:     { type: Number, default: 0 },
    ratingCount:   { type: Number, default: 0 },
  },
  baseSchemaOptions,
)

CourseSchema.index({ instructorId: 1 })
CourseSchema.index({ categoryId: 1 })
CourseSchema.index({ status: 1 })
CourseSchema.index({ organizationId: 1 })
CourseSchema.index({ title: 'text', description: 'text', tags: 'text' })  // full-text search

export const CourseModel = mongoose.model<ICourse>('Course', CourseSchema)

/* ─────────────────────────────────────────────────────
   SECTION  (course chapter)
───────────────────────────────────────────────────── */
export interface ISection extends Document {
  id:           string
  courseId:     Types.ObjectId
  title:        string
  description?: string
  order:        number
  createdAt:    Date
  updatedAt:    Date
}

const SectionSchema = new Schema<ISection>(
  {
    courseId:    { type: Schema.Types.ObjectId, ref: 'Course', required: true },
    title:       { type: String, required: true, trim: true, maxlength: 255 },
    description: { type: String, default: '', maxlength: 1000 },
    order:       { type: Number, default: 0 },
  },
  baseSchemaOptions,
)

SectionSchema.index({ courseId: 1, order: 1 })

export const SectionModel = mongoose.model<ISection>('Section', SectionSchema)

/* ─────────────────────────────────────────────────────
   LESSON
───────────────────────────────────────────────────── */
export interface ILesson extends Document {
  id:           string
  sectionId:    Types.ObjectId
  courseId:     Types.ObjectId
  title:        string
  type:         LessonType
  contentUrl?:  string
  contentBody?: string
  /** Full plain-text transcript — stored as-is.
   *  Can be manually authored or AI-generated via POST /admin/lessons/:id/generate-transcript */
  transcript?:  string
  durationMins: number
  order:        number
  isFree:       boolean
  createdAt:    Date
  updatedAt:    Date
}

const LessonSchema = new Schema<ILesson>(
  {
    sectionId:   { type: Schema.Types.ObjectId, ref: 'Section', required: true },
    courseId:    { type: Schema.Types.ObjectId, ref: 'Course',  required: true },
    title:       { type: String, required: true, trim: true, maxlength: 255 },
    type:        { type: String, enum: ['video', 'article', 'quiz', 'assignment'], default: 'video' },
    contentUrl:  { type: String },
    contentBody: { type: String },
    transcript:  { type: String },
    durationMins: { type: Number, default: 0 },
    order:       { type: Number, default: 0 },
    isFree:      { type: Boolean, default: false },
  },
  baseSchemaOptions,
)

LessonSchema.index({ courseId: 1, order: 1 })
LessonSchema.index({ sectionId: 1 })

export const LessonModel = mongoose.model<ILesson>('Lesson', LessonSchema)

/* ─────────────────────────────────────────────────────
   ENROLLMENT
───────────────────────────────────────────────────── */
/* ─────────────────────────────────────────────────────
   How a student came to be enrolled.

   Recorded at creation because it cannot be reconstructed afterwards: an
   admin-granted enrolment and a bulk-imported one are byte-identical rows, so
   until this field existed the two were indistinguishable for ever. Only
   `purchase` is independently verifiable after the fact, from the paid Order.

     purchase  paid through a gateway — Stripe/Razorpay/Tabby/Abzer/Tamara,
               including the AI-academy server-to-server provisioning, which
               writes its own paid Order
     free      the student enrolled themselves on a course with no price
     admin     granted from the admin panel by a person
     script    written by a maintenance or bulk-import script
     unknown   pre-dates this field and could not be inferred — see
               scripts/backfill-enrollment-source.ts
───────────────────────────────────────────────────── */
export const ENROLLMENT_SOURCES = ['purchase', 'free', 'admin', 'script', 'unknown'] as const
export type EnrollmentSource = typeof ENROLLMENT_SOURCES[number]

export interface IEnrollment extends Document {
  id:              string
  userId:          Types.ObjectId
  courseId:        Types.ObjectId
  status:          EnrollmentStatus
  source:          EnrollmentSource
  progressPercent: number
  lastLessonId?:   Types.ObjectId
  enrolledAt:      Date
  completedAt?:    Date
  certificateId?:  string   // generated cert UUID
  blockedLessons:  Types.ObjectId[]  // lessons blocked by admin/instructor
  organizationId?: Types.ObjectId
  createdAt:       Date
  updatedAt:       Date
}

const EnrollmentSchema = new Schema<IEnrollment>(
  {
    userId:          { type: Schema.Types.ObjectId, ref: 'User',   required: true },
    courseId:        { type: Schema.Types.ObjectId, ref: 'Course', required: true },
    status:          { type: String, enum: ['active', 'completed', 'dropped'], default: 'active' },
    /* Defaults to 'unknown' rather than 'admin': a row that arrives without a
       source is one whose writer forgot to say, and guessing would launder
       that silence into a claim the UI then presents as fact. */
    source:          { type: String, enum: ENROLLMENT_SOURCES, default: 'unknown', index: true },
    progressPercent: { type: Number, default: 0, min: 0, max: 100 },
    lastLessonId:    { type: Schema.Types.ObjectId, ref: 'Lesson' },
    enrolledAt:      { type: Date, default: Date.now },
    completedAt:     { type: Date },
    certificateId:   { type: String },
    blockedLessons:  [{ type: Schema.Types.ObjectId, ref: 'Lesson' }],
    organizationId:  { type: Schema.Types.ObjectId, ref: 'Organization' },
  },
  baseSchemaOptions,
)

EnrollmentSchema.index({ userId: 1, courseId: 1 }, { unique: true })  // one enrollment per user/course
EnrollmentSchema.index({ userId: 1 })
EnrollmentSchema.index({ courseId: 1 })

export const EnrollmentModel = mongoose.model<IEnrollment>('Enrollment', EnrollmentSchema)

/* ─────────────────────────────────────────────────────
   LESSON PROGRESS
───────────────────────────────────────────────────── */
export interface ILessonProgress extends Document {
  id:             string
  userId:         Types.ObjectId
  lessonId:       Types.ObjectId
  courseId:       Types.ObjectId
  isCompleted:    boolean
  watchTimeSecs:  number
  completedAt?:   Date
  createdAt:      Date
  updatedAt:      Date
}

const LessonProgressSchema = new Schema<ILessonProgress>(
  {
    userId:        { type: Schema.Types.ObjectId, ref: 'User',   required: true },
    lessonId:      { type: Schema.Types.ObjectId, ref: 'Lesson', required: true },
    courseId:      { type: Schema.Types.ObjectId, ref: 'Course', required: true },
    isCompleted:   { type: Boolean, default: false },
    watchTimeSecs: { type: Number, default: 0 },
    completedAt:   { type: Date },
  },
  baseSchemaOptions,
)

LessonProgressSchema.index({ userId: 1, lessonId: 1 }, { unique: true })
LessonProgressSchema.index({ userId: 1, courseId: 1 })

export const LessonProgressModel = mongoose.model<ILessonProgress>('LessonProgress', LessonProgressSchema)

/* ─────────────────────────────────────────────────────
   REVIEW
───────────────────────────────────────────────────── */
export interface IReview extends Document {
  id:                 string
  userId:             Types.ObjectId
  courseId:           Types.ObjectId
  rating:             number
  comment?:           string
  /* 6.2 — instructor reply */
  instructorReply?:   string
  instructorReplyAt?: Date
  instructorId?:      Types.ObjectId   // who replied
  /* 6.3 — helpfulness signals */
  helpfulVotes:       number
  reportCount:        number
  isReported:         boolean
  createdAt:          Date
  updatedAt:          Date
}

const ReviewSchema = new Schema<IReview>(
  {
    userId:            { type: Schema.Types.ObjectId, ref: 'User',   required: true },
    courseId:          { type: Schema.Types.ObjectId, ref: 'Course', required: true },
    rating:            { type: Number, required: true, min: 1, max: 5 },
    comment:           { type: String, maxlength: 5000 },
    instructorReply:   { type: String, maxlength: 5000 },
    instructorReplyAt: { type: Date },
    instructorId:      { type: Schema.Types.ObjectId, ref: 'User' },
    helpfulVotes:      { type: Number, default: 0, min: 0 },
    reportCount:       { type: Number, default: 0, min: 0 },
    isReported:        { type: Boolean, default: false },
  },
  baseSchemaOptions,
)

ReviewSchema.index({ userId: 1, courseId: 1 }, { unique: true })  // one review per user/course
ReviewSchema.index({ courseId: 1 })
ReviewSchema.index({ isReported: 1 })

export const ReviewModel = mongoose.model<IReview>('Review', ReviewSchema)

/* ─────────────────────────────────────────────────────
   NOTIFICATION — in-app activity feed for the bell icon
───────────────────────────────────────────────────── */
export type NotificationKind =
  | 'enrollment'
  | 'lesson-complete'
  | 'course-complete'
  | 'review-posted'
  | 'live-class-scheduled'
  | 'achievement'
  | 'booking-confirmed'
  | 'booking-cancelled'
  | 'class-reminder'
  | 'system'

export interface INotification extends Document {
  id:        string
  userId:    Types.ObjectId
  kind:      NotificationKind
  title:     string
  body?:     string
  link?:     string     // in-app path, e.g. /courses/foo
  readAt?:   Date
  createdAt: Date
  updatedAt: Date
}

const NotificationSchema = new Schema<INotification>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    kind:   { type: String, enum: ['enrollment','lesson-complete','course-complete','review-posted','live-class-scheduled','achievement','booking-confirmed','booking-cancelled','class-reminder','system'], required: true },
    title:  { type: String, required: true, maxlength: 255 },
    body:   { type: String, maxlength: 1000 },
    link:   { type: String, maxlength: 1024 },
    readAt: { type: Date },
  },
  baseSchemaOptions,
)
NotificationSchema.index({ userId: 1, createdAt: -1 })
NotificationSchema.index({ userId: 1, readAt: 1 })

export const NotificationModel = mongoose.model<INotification>('Notification', NotificationSchema)

/* ─────────────────────────────────────────────────────
   FAVORITE — user saves a course for later
───────────────────────────────────────────────────── */
export interface IFavorite extends Document {
  id:        string
  userId:    Types.ObjectId
  courseId:  Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

const FavoriteSchema = new Schema<IFavorite>(
  {
    userId:   { type: Schema.Types.ObjectId, ref: 'User',   required: true },
    courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true },
  },
  baseSchemaOptions,
)
FavoriteSchema.index({ userId: 1, courseId: 1 }, { unique: true })
FavoriteSchema.index({ userId: 1, createdAt: -1 })

export const FavoriteModel = mongoose.model<IFavorite>('Favorite', FavoriteSchema)

/* ─────────────────────────────────────────────────────
   LIVE CLASS — scheduled real-time sessions
   ─────────────────────────────────────────────────────
   `meetingUrl` is an external link (Zoom / Meet / Jitsi).
   Status is derived from now() vs scheduledStart + duration
   for read paths; `cancelled` is the one stored override.
───────────────────────────────────────────────────── */
export type LiveClassStatus = 'scheduled' | 'live' | 'ended' | 'cancelled'
export type LiveClassType   = 'external' | 'internal'

export type LiveClassProvider = 'mux' | 'livekit'

export interface ILiveClass extends Document {
  id:             string
  courseId:       Types.ObjectId
  instructorId:   Types.ObjectId
  title:          string
  description?:   string
  scheduledStart: Date
  durationMins:   number

  /* Type discriminator */
  type:           LiveClassType    // 'external' | 'internal'

  /* External-only */
  meetingUrl?:    string           // required when type=external
  googleMeetCode?: string          // e.g. "abc-def-ghij"

  /* Which engine backs an `internal` class.
     `type` says external-vs-in-app; `provider` says WHICH in-app engine, so
     LiveKit can be added without touching a single existing row. Everything
     already in the database is Mux, which is exactly what the default says. */
  provider?:         LiveClassProvider   // 'mux' | 'livekit'

  /* Internal + provider='livekit' — the CLT Connect side of the link.
     roomName is derived from the class id, never chosen by a caller. */
  cltRoomName?:      string       // "lms-<liveClassId>"
  cltCourseId?:      number       // CLT courses.id, set when the room is provisioned
  cltMeetingId?:     number       // CLT meetings.id, set when a host starts it
  /* CLT recordings.id. Stored instead of a URL: the stream endpoint needs a
     CLT admin token an LMS admin does not have, and a presigned link would go
     stale sitting here. Exchanged for a short-lived URL on play. */
  cltRecordingId?:   number
  recordingDurationSecs?: number

  /* Internal-only (Mux) */
  muxLiveStreamId?:  string       // Mux live stream ID
  muxStreamKey?:     string       // RTMP stream key — select:false, never sent to clients
  muxPlaybackId?:    string       // HLS playback ID
  muxAssetId?:       string       // recording asset ID (set after stream ends)

  /* Status — replaces cancelled: boolean */
  status:         LiveClassStatus

  /* Post-stream */
  recordingUrl?:  string          // set when recording is ready
  mentorNotes?:   string          // mentor can add notes/summary after session
  viewerCount:    number          // updated by Mux Real-Time API
  startedAt?:     Date
  endedAt?:       Date

  /* Module (section) link — optional, associates session with a course section */
  sectionId?:        Types.ObjectId

  sessionCapacity:   number           // max bookings (default 30)
  bookedCount:       number           // denormalised, incremented on booking

  language:          string           // class language (English, Arabic, Hindi, Malayalam, Urdu)

  /* Offline class support */
  isOnline:          boolean          // false = physical classroom session
  location?:         string           // venue / address (offline only)
  room?:             string           // classroom / room number (offline only)

  /* Reschedule tracking */
  rescheduledReason?: string          // admin-provided reason when class is rescheduled

  /* Instructor reminder tracking */
  reminderInstructor15MinSent: boolean

  /* Multi-org */
  organizationId?: Types.ObjectId

  /* Weekly-repeat grouping — a pure tag shared by every class generated
     from the same "repeat weekly" action. Not a foreign-key relation;
     there is no separate series/template document. */
  seriesId?:      Types.ObjectId

  createdAt:      Date
  updatedAt:      Date
}

const LiveClassSchema = new Schema<ILiveClass>(
  {
    courseId:       { type: Schema.Types.ObjectId, ref: 'Course', required: true },
    instructorId:   { type: Schema.Types.ObjectId, ref: 'User',   required: true },
    title:          { type: String, required: true, trim: true, maxlength: 255 },
    description:    { type: String, maxlength: 2000 },
    scheduledStart: { type: Date,   required: true },
    durationMins:   { type: Number, required: true, min: 5, max: 600 },

    type:           { type: String, enum: ['external', 'internal'], default: 'external' },
    status:         { type: String, enum: ['scheduled', 'live', 'ended', 'cancelled'], default: 'scheduled' },

    meetingUrl:        { type: String, maxlength: 2048 },
    googleMeetCode:    { type: String, maxlength: 20 },
    /* Defaults to 'mux' so every existing row keeps its current behaviour
       without a migration — the whole point of adding a provider rather than
       repurposing `type`. */
    provider:          { type: String, enum: ['mux', 'livekit'], default: 'mux' },
    cltRoomName:       { type: String, maxlength: 64 },
    cltCourseId:       { type: Number },
    cltMeetingId:      { type: Number },
    cltRecordingId:    { type: Number },
    recordingDurationSecs: { type: Number },

    muxLiveStreamId:   { type: String },
    muxStreamKey:      { type: String, select: false },   // never returned in standard queries
    muxPlaybackId:     { type: String },
    muxAssetId:        { type: String },
    recordingUrl:      { type: String },
    mentorNotes:       { type: String, maxlength: 5000 },
    viewerCount:       { type: Number, default: 0 },
    startedAt:         { type: Date },
    endedAt:           { type: Date },
    // Module link
    sectionId:         { type: Schema.Types.ObjectId, ref: 'Section' },
    sessionCapacity:   { type: Number, default: 30, min: 1, max: 500 },
    bookedCount:       { type: Number, default: 0, min: 0 },
    language:          { type: String, default: 'English' },
    isOnline:          { type: Boolean, default: true },
    location:          { type: String, maxlength: 500 },
    room:              { type: String, maxlength: 100 },
    rescheduledReason:           { type: String, maxlength: 2000 },
    reminderInstructor15MinSent: { type: Boolean, default: false },
    organizationId:              { type: Schema.Types.ObjectId, ref: 'Organization' },
    seriesId:                    { type: Schema.Types.ObjectId },
  },
  baseSchemaOptions,
)

LiveClassSchema.index({ courseId: 1, scheduledStart: 1 })
LiveClassSchema.index({ scheduledStart: 1 })
LiveClassSchema.index({ muxLiveStreamId: 1 }, { sparse: true })
/* CLT webhooks and the join path both arrive holding only the room name. */
LiveClassSchema.index({ cltRoomName: 1 }, { sparse: true })
LiveClassSchema.index({ organizationId: 1 })
LiveClassSchema.index({ seriesId: 1 }, { sparse: true })

export const LiveClassModel = mongoose.model<ILiveClass>('LiveClass', LiveClassSchema)

/* ─────────────────────────────────────────────────────
   QUIZ — one per quiz-type lesson
   ─────────────────────────────────────────────────────
   Questions are embedded to avoid extra roundtrips.
   correctAnswer stores the 0-based index (as string)
   for mcq/true_false, or the expected text for short.
───────────────────────────────────────────────────── */
export interface IQuizQuestion {
  _id:          Types.ObjectId
  text:         string
  type:         QuestionType
  choices:      string[]   // mcq: 4 options, true_false: ['True','False'], short: []
  correctAnswer: string    // index string for mcq/tf, text for short
  points:       number
  explanation?: string
}

export interface IQuiz extends Document {
  id:          string
  lessonId:    Types.ObjectId
  courseId:    Types.ObjectId
  passPercent: number
  timeLimit?:  number  // minutes; undefined = no limit
  questions:   IQuizQuestion[]
  createdAt:   Date
  updatedAt:   Date
}

const QuizQuestionSchema = new Schema<IQuizQuestion>({
  text:          { type: String, required: true, maxlength: 2000 },
  type:          { type: String, enum: ['mcq', 'true_false', 'short'], required: true },
  choices:       [{ type: String, maxlength: 500 }],
  correctAnswer: { type: String, required: true },
  points:        { type: Number, default: 1, min: 1 },
  explanation:   { type: String, maxlength: 2000 },
}, { _id: true })

const QuizSchema = new Schema<IQuiz>(
  {
    lessonId:    { type: Schema.Types.ObjectId, ref: 'Lesson',  required: true, unique: true },
    courseId:    { type: Schema.Types.ObjectId, ref: 'Course',  required: true },
    passPercent: { type: Number, default: 70, min: 0, max: 100 },
    timeLimit:   { type: Number, min: 1 },
    questions:   [QuizQuestionSchema],
  },
  baseSchemaOptions,
)

QuizSchema.index({ courseId: 1 })

export const QuizModel = mongoose.model<IQuiz>('Quiz', QuizSchema)

/* ─────────────────────────────────────────────────────
   QUIZ ATTEMPT — one per submission
───────────────────────────────────────────────────── */
export interface IQuizAttemptAnswer {
  questionId: string
  answer:     string  // index string or text
}

export interface IQuizAttempt extends Document {
  id:            string
  userId:        Types.ObjectId
  quizId:        Types.ObjectId
  lessonId:      Types.ObjectId
  courseId:      Types.ObjectId
  answers:       IQuizAttemptAnswer[]
  score:         number   // raw points earned
  maxScore:      number   // total possible points
  scorePercent:  number
  passed:        boolean
  attemptNumber: number
  completedAt:   Date
  createdAt:     Date
  updatedAt:     Date
}

const QuizAttemptAnswerSchema = new Schema<IQuizAttemptAnswer>({
  questionId: { type: String, required: true },
  answer:     { type: String, required: true },
}, { _id: false })

const QuizAttemptSchema = new Schema<IQuizAttempt>(
  {
    userId:        { type: Schema.Types.ObjectId, ref: 'User',   required: true },
    quizId:        { type: Schema.Types.ObjectId, ref: 'Quiz',   required: true },
    lessonId:      { type: Schema.Types.ObjectId, ref: 'Lesson', required: true },
    courseId:      { type: Schema.Types.ObjectId, ref: 'Course', required: true },
    answers:       [QuizAttemptAnswerSchema],
    score:         { type: Number, required: true, min: 0 },
    maxScore:      { type: Number, required: true, min: 0 },
    scorePercent:  { type: Number, required: true, min: 0, max: 100 },
    passed:        { type: Boolean, required: true },
    attemptNumber: { type: Number, required: true, min: 1 },
    completedAt:   { type: Date, default: Date.now },
  },
  baseSchemaOptions,
)

QuizAttemptSchema.index({ userId: 1, quizId: 1 })
QuizAttemptSchema.index({ userId: 1, courseId: 1 })
QuizAttemptSchema.index({ quizId: 1 })

export const QuizAttemptModel = mongoose.model<IQuizAttempt>('QuizAttempt', QuizAttemptSchema)

/* ─────────────────────────────────────────────────────
   ASSIGNMENT — one per assignment-type lesson
───────────────────────────────────────────────────── */
export interface IAssignment extends Document {
  id:           string
  lessonId:     Types.ObjectId
  courseId:     Types.ObjectId
  title:        string
  instructions: string
  dueDate?:     Date
  maxScore:     number
  createdAt:    Date
  updatedAt:    Date
}

const AssignmentSchema = new Schema<IAssignment>(
  {
    lessonId:     { type: Schema.Types.ObjectId, ref: 'Lesson',  required: true, unique: true },
    courseId:     { type: Schema.Types.ObjectId, ref: 'Course',  required: true },
    title:        { type: String, required: true, maxlength: 255 },
    instructions: { type: String, required: true, maxlength: 20000 },
    dueDate:      { type: Date },
    maxScore:     { type: Number, default: 100, min: 1 },
  },
  baseSchemaOptions,
)

AssignmentSchema.index({ courseId: 1 })

export const AssignmentModel = mongoose.model<IAssignment>('Assignment', AssignmentSchema)

/* ─────────────────────────────────────────────────────
   ASSIGNMENT SUBMISSION
───────────────────────────────────────────────────── */
export type SubmissionStatus = 'submitted' | 'graded' | 'returned'

export interface IAssignmentSubmission extends Document {
  id:              string
  userId:          Types.ObjectId
  assignmentId:    Types.ObjectId
  courseId:        Types.ObjectId
  submissionUrl?:  string
  submissionText?: string
  grade?:          number
  feedback?:       string
  gradedAt?:       Date
  gradedBy?:       Types.ObjectId
  status:          SubmissionStatus
  createdAt:       Date
  updatedAt:       Date
}

const AssignmentSubmissionSchema = new Schema<IAssignmentSubmission>(
  {
    userId:         { type: Schema.Types.ObjectId, ref: 'User',       required: true },
    assignmentId:   { type: Schema.Types.ObjectId, ref: 'Assignment', required: true },
    courseId:       { type: Schema.Types.ObjectId, ref: 'Course',     required: true },
    submissionUrl:  { type: String, maxlength: 2048 },
    submissionText: { type: String, maxlength: 20000 },
    grade:          { type: Number, min: 0 },
    feedback:       { type: String, maxlength: 5000 },
    gradedAt:       { type: Date },
    gradedBy:       { type: Schema.Types.ObjectId, ref: 'User' },
    status:         { type: String, enum: ['submitted', 'graded', 'returned'], default: 'submitted' },
  },
  baseSchemaOptions,
)

AssignmentSubmissionSchema.index({ userId: 1, assignmentId: 1 }, { unique: true })
AssignmentSubmissionSchema.index({ assignmentId: 1 })
AssignmentSubmissionSchema.index({ userId: 1, courseId: 1 })

export const AssignmentSubmissionModel = mongoose.model<IAssignmentSubmission>('AssignmentSubmission', AssignmentSubmissionSchema)

/* ─────────────────────────────────────────────────────
   USER ACHIEVEMENT — awarded badge / milestone
───────────────────────────────────────────────────── */
export interface IUserAchievement extends Document {
  id:          string
  userId:      Types.ObjectId
  kind:        AchievementKind
  title:       string
  description: string
  icon:        string   // emoji
  metadata?:   Record<string, unknown>
  earnedAt:    Date
  createdAt:   Date
  updatedAt:   Date
}

const UserAchievementSchema = new Schema<IUserAchievement>(
  {
    userId:      { type: Schema.Types.ObjectId, ref: 'User', required: true },
    kind:        { type: String, enum: ['first_lesson','course_complete','quiz_ace','quiz_pass','streak_7','streak_30','streak_100','top_reviewer'], required: true },
    title:       { type: String, required: true, maxlength: 100 },
    description: { type: String, required: true, maxlength: 255 },
    icon:        { type: String, required: true, maxlength: 10 },
    metadata:    { type: Schema.Types.Mixed },
    earnedAt:    { type: Date, default: Date.now },
  },
  baseSchemaOptions,
)

/* One per kind per user — prevents duplicate awards */
UserAchievementSchema.index({ userId: 1, kind: 1 }, { unique: true })
UserAchievementSchema.index({ userId: 1, earnedAt: -1 })

export const UserAchievementModel = mongoose.model<IUserAchievement>('UserAchievement', UserAchievementSchema)

/* ─────────────────────────────────────────────────────
   USER STREAK — one document per user
───────────────────────────────────────────────────── */
export interface IUserStreak extends Document {
  id:              string
  userId:          Types.ObjectId
  currentStreak:   number   // consecutive days with activity
  longestStreak:   number
  lastActiveDate:  string   // 'YYYY-MM-DD' local date
  totalDaysActive: number
  weeklyGoal:      number   // target lessons per week
  weekProgress:    number   // lessons completed this ISO week
  weekStartDate:   string   // 'YYYY-MM-DD' of Monday that started weekProgress
  createdAt:       Date
  updatedAt:       Date
}

const UserStreakSchema = new Schema<IUserStreak>(
  {
    userId:          { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    currentStreak:   { type: Number, default: 0 },
    longestStreak:   { type: Number, default: 0 },
    lastActiveDate:  { type: String, default: '' },
    totalDaysActive: { type: Number, default: 0 },
    weeklyGoal:      { type: Number, default: 5, min: 1, max: 50 },
    weekProgress:    { type: Number, default: 0 },
    weekStartDate:   { type: String, default: '' },
  },
  baseSchemaOptions,
)

UserStreakSchema.index({ userId: 1 })

export const UserStreakModel = mongoose.model<IUserStreak>('UserStreak', UserStreakSchema)

/* ─────────────────────────────────────────────────────
   COUPON — discount codes for paid courses
   ─────────────────────────────────────────────────────
   discountType 'percent': discountValue is 1–100 (%)
   discountType 'fixed':   discountValue is MAJOR UNITS OF `currency` — the
     owning academy's currency, stamped at create time from Organization.
     It was previously documented as USD and applied as bare minor units to
     whatever the gateway happened to charge in, so "50" took 50 AED off an
     Abzer checkout and 50 INR off a Razorpay one — values ~22x apart, and
     neither the documented $50 (N-01). Redemption now requires the checkout
     currency to match; see CouponService.applyDiscount().
   appliesTo: [] means all published courses in the coupon's organization

   TENANCY — coupons are PER-ORGANIZATION. `organizationId` is required and
   `code` is unique *within* an organization, not globally, so Dubai and
   Bangalore can both run "SUMMER20" on their own catalogues at their own
   currency. There is deliberately no cross-org / "global" coupon: the two
   academies price in AED and INR respectively, and a fixed-amount discount
   carries no exchange rate, so one code spanning both cannot be made correct.
───────────────────────────────────────────────────── */
export type CouponDiscountType = 'percent' | 'fixed'

/** Currencies an academy prices in. Mirrors Organization.currency. */
export type CouponCurrency = 'AED' | 'INR'

export interface ICoupon extends Document {
  id:           string
  code:         string          // UPPERCASE, unique per organization
  discountType: CouponDiscountType
  discountValue: number
  /* The currency `discountValue` is denominated in, for discountType 'fixed'.
     Inherited from the owning organisation at create time and never editable —
     a coupon cannot change academy, so it cannot change currency either.
     Optional on the interface only for rows that predate the field; the boot
     backfill in index.ts stamps them. */
  currency?:    CouponCurrency
  maxUses:      number          // 0 = unlimited
  usedCount:    number
  expiresAt?:   Date
  isActive:        boolean
  appliesTo:       Types.ObjectId[]   // empty = all courses in the org
  organizationId:  Types.ObjectId     // required — the owning academy
  createdAt:       Date
  updatedAt:       Date
}

const CouponSchema = new Schema<ICoupon>(
  {
    code:          { type: String, required: true, uppercase: true, trim: true, maxlength: 50 },
    discountType:  { type: String, enum: ['percent', 'fixed'], required: true },
    discountValue: { type: Number, required: true, min: 0 },
    currency:      { type: String, enum: ['AED', 'INR'] },
    maxUses:        { type: Number, default: 0, min: 0 },
    usedCount:      { type: Number, default: 0, min: 0 },
    expiresAt:      { type: Date },
    isActive:       { type: Boolean, default: true },
    appliesTo:      [{ type: Schema.Types.ObjectId, ref: 'Course' }],
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
  },
  baseSchemaOptions,
)

/* Unique per (code, organization) — NOT globally. The legacy single-field
   unique index `code_1` is dropped at boot in index.ts; without that drop it
   would still reject a second academy reusing a code. */
CouponSchema.index({ code: 1, organizationId: 1 }, { unique: true })
CouponSchema.index({ isActive: 1 })
CouponSchema.index({ organizationId: 1 })

export const CouponModel = mongoose.model<ICoupon>('Coupon', CouponSchema)

/* ─────────────────────────────────────────────────────
   ORDER — Stripe payment record
   ─────────────────────────────────────────────────────
   amount / discountAmount are stored in CENTS.
   status: pending → paid (webhook) → refunded (admin)
           pending → cancelled (Tamara ORDER_EXPIRED/DECLINED webhook)
───────────────────────────────────────────────────── */
export type OrderStatus = 'pending' | 'paid' | 'refunded' | 'cancelled'

export type OrderGateway = 'stripe' | 'razorpay' | 'tabby' | 'abzer' | 'tamara'

export interface IOrder extends Document {
  id:              string
  userId:          Types.ObjectId
  courseId:        Types.ObjectId
  organizationId?: Types.ObjectId
  gateway:         OrderGateway
  stripeCheckoutSessionId?: string
  stripePaymentIntentId?:   string
  razorpayOrderId?:         string
  razorpayPaymentId?:       string
  razorpaySignature?:       string
  tabbyCheckoutId?:         string
  tabbyPaymentId?:          string
  abzerOrderId?:            string
  abzerPaymentId?:          string
  tamaraCheckoutId?:        string
  tamaraOrderId?:           string
  tamaraPaymentId?:         string
  amount:                   number    // charged amount in smallest unit (cents / fils)
  currency:                 string
  status:                   OrderStatus
  couponId?:                Types.ObjectId
  discountAmount:           number    // smallest-unit saving by coupon (0 if none)
  stripeInvoiceUrl?:        string
  refundedAt?:              Date
  cancelledAt?:             Date
  createdAt:                Date
  updatedAt:                Date
}

const OrderSchema = new Schema<IOrder>(
  {
    userId:                  { type: Schema.Types.ObjectId, ref: 'User',         required: true },
    courseId:                { type: Schema.Types.ObjectId, ref: 'Course',       required: true },
    organizationId:          { type: Schema.Types.ObjectId, ref: 'Organization' },
    gateway:                 { type: String, enum: ['stripe', 'razorpay', 'tabby', 'abzer', 'tamara'], required: true, default: 'stripe' },
    stripeCheckoutSessionId: { type: String },
    stripePaymentIntentId:   { type: String },
    razorpayOrderId:         { type: String },
    razorpayPaymentId:       { type: String },
    razorpaySignature:       { type: String },
    tabbyCheckoutId:         { type: String },
    tabbyPaymentId:          { type: String },
    abzerOrderId:            { type: String },
    abzerPaymentId:          { type: String },
    tamaraCheckoutId:        { type: String },
    tamaraOrderId:           { type: String },
    tamaraPaymentId:         { type: String },
    amount:                  { type: Number, required: true, min: 0 },
    currency:                { type: String, required: true, default: 'usd', maxlength: 3 },
    status:                  { type: String, enum: ['pending', 'paid', 'refunded', 'cancelled'], default: 'pending' },
    couponId:                { type: Schema.Types.ObjectId, ref: 'Coupon' },
    discountAmount:          { type: Number, default: 0, min: 0 },
    stripeInvoiceUrl:        { type: String, maxlength: 2048 },
    refundedAt:              { type: Date },
    cancelledAt:             { type: Date },
  },
  baseSchemaOptions,
)

OrderSchema.index({ userId: 1, createdAt: -1 })
OrderSchema.index({ courseId: 1 })
OrderSchema.index({ status: 1 })
OrderSchema.index(
  { stripeCheckoutSessionId: 1 },
  { unique: true, partialFilterExpression: { stripeCheckoutSessionId: { $type: 'string' } } },
)

export const OrderModel = mongoose.model<IOrder>('Order', OrderSchema)

/* ─────────────────────────────────────────────────────
   REVIEW VOTE — helpful / report signal on a review  (6.3)
───────────────────────────────────────────────────── */
export type ReviewVoteType = 'helpful' | 'report'

export interface IReviewVote extends Document {
  id:        string
  userId:    Types.ObjectId
  reviewId:  Types.ObjectId
  type:      ReviewVoteType
  createdAt: Date
  updatedAt: Date
}

const ReviewVoteSchema = new Schema<IReviewVote>(
  {
    userId:   { type: Schema.Types.ObjectId, ref: 'User',   required: true },
    reviewId: { type: Schema.Types.ObjectId, ref: 'Review', required: true },
    type:     { type: String, enum: ['helpful', 'report'], required: true },
  },
  baseSchemaOptions,
)

ReviewVoteSchema.index({ userId: 1, reviewId: 1, type: 1 }, { unique: true })
ReviewVoteSchema.index({ reviewId: 1 })

export const ReviewVoteModel = mongoose.model<IReviewVote>('ReviewVote', ReviewVoteSchema)

/* ─────────────────────────────────────────────────────
   DISCUSSION THREAD — per-lesson Q&A (6.1)
   ─────────────────────────────────────────────────────
   upvotedBy stored as user-id array for O(1) membership.
   commentCount is denormalised for cheap list queries.
───────────────────────────────────────────────────── */
export interface IDiscussionThread extends Document {
  id:           string
  lessonId:     Types.ObjectId
  courseId:     Types.ObjectId
  authorId:     Types.ObjectId
  title?:       string
  body:         string
  isPinned:     boolean
  isResolved:   boolean
  upvoteCount:  number
  upvotedBy:    Types.ObjectId[]
  commentCount: number
  createdAt:    Date
  updatedAt:    Date
}

const DiscussionThreadSchema = new Schema<IDiscussionThread>(
  {
    lessonId:     { type: Schema.Types.ObjectId, ref: 'Lesson', required: true },
    courseId:     { type: Schema.Types.ObjectId, ref: 'Course', required: true },
    authorId:     { type: Schema.Types.ObjectId, ref: 'User',   required: true },
    title:        { type: String, maxlength: 255 },
    body:         { type: String, required: true, maxlength: 10000 },
    isPinned:     { type: Boolean, default: false },
    isResolved:   { type: Boolean, default: false },
    upvoteCount:  { type: Number, default: 0, min: 0 },
    upvotedBy:    [{ type: Schema.Types.ObjectId, ref: 'User' }],
    commentCount: { type: Number, default: 0, min: 0 },
  },
  baseSchemaOptions,
)

DiscussionThreadSchema.index({ lessonId: 1, createdAt: -1 })
DiscussionThreadSchema.index({ courseId: 1 })
DiscussionThreadSchema.index({ authorId: 1 })

export const DiscussionThreadModel = mongoose.model<IDiscussionThread>('DiscussionThread', DiscussionThreadSchema)

/* ─────────────────────────────────────────────────────
   DISCUSSION COMMENT — reply to a thread (6.1)
   ─────────────────────────────────────────────────────
   parentId: null = top-level reply, set = nested reply.
   isInstructorAnswer: highlighted as the accepted answer.
───────────────────────────────────────────────────── */
export interface IDiscussionComment extends Document {
  id:                 string
  threadId:           Types.ObjectId
  authorId:           Types.ObjectId
  body:               string
  parentId?:          Types.ObjectId  // null = direct reply to thread
  upvoteCount:        number
  upvotedBy:          Types.ObjectId[]
  isInstructorAnswer: boolean
  createdAt:          Date
  updatedAt:          Date
}

const DiscussionCommentSchema = new Schema<IDiscussionComment>(
  {
    threadId:           { type: Schema.Types.ObjectId, ref: 'DiscussionThread', required: true },
    authorId:           { type: Schema.Types.ObjectId, ref: 'User',             required: true },
    body:               { type: String, required: true, maxlength: 10000 },
    parentId:           { type: Schema.Types.ObjectId, ref: 'DiscussionComment' },
    upvoteCount:        { type: Number, default: 0, min: 0 },
    upvotedBy:          [{ type: Schema.Types.ObjectId, ref: 'User' }],
    isInstructorAnswer: { type: Boolean, default: false },
  },
  baseSchemaOptions,
)

DiscussionCommentSchema.index({ threadId: 1, createdAt: 1 })
DiscussionCommentSchema.index({ parentId: 1 })
DiscussionCommentSchema.index({ authorId: 1 })

export const DiscussionCommentModel = mongoose.model<IDiscussionComment>('DiscussionComment', DiscussionCommentSchema)

/* ─────────────────────────────────────────────────────
   LESSON NOTE — private student notes per lesson (6.4)
───────────────────────────────────────────────────── */
export interface ILessonNote extends Document {
  id:        string
  userId:    Types.ObjectId
  lessonId:  Types.ObjectId
  courseId:  Types.ObjectId
  body:      string
  createdAt: Date
  updatedAt: Date
}

const LessonNoteSchema = new Schema<ILessonNote>(
  {
    userId:   { type: Schema.Types.ObjectId, ref: 'User',   required: true },
    lessonId: { type: Schema.Types.ObjectId, ref: 'Lesson', required: true },
    courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true },
    body:     { type: String, required: true, maxlength: 50000 },
  },
  baseSchemaOptions,
)

LessonNoteSchema.index({ userId: 1, lessonId: 1 }, { unique: true })
LessonNoteSchema.index({ userId: 1, courseId: 1 })

export const LessonNoteModel = mongoose.model<ILessonNote>('LessonNote', LessonNoteSchema)

/* ─────────────────────────────────────────────────────
   VIDEO BOOKMARK — timestamped bookmark in a lesson (6.5)
───────────────────────────────────────────────────── */
export interface IVideoBookmark extends Document {
  id:        string
  userId:    Types.ObjectId
  lessonId:  Types.ObjectId
  courseId:  Types.ObjectId
  timeSecs:  number    // position in the video (seconds)
  label?:    string
  createdAt: Date
  updatedAt: Date
}

const VideoBookmarkSchema = new Schema<IVideoBookmark>(
  {
    userId:   { type: Schema.Types.ObjectId, ref: 'User',   required: true },
    lessonId: { type: Schema.Types.ObjectId, ref: 'Lesson', required: true },
    courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true },
    timeSecs: { type: Number, required: true, min: 0 },
    label:    { type: String, maxlength: 200 },
  },
  baseSchemaOptions,
)

VideoBookmarkSchema.index({ userId: 1, lessonId: 1 })
VideoBookmarkSchema.index({ userId: 1, courseId: 1 })

export const VideoBookmarkModel = mongoose.model<IVideoBookmark>('VideoBookmark', VideoBookmarkSchema)

/* ─────────────────────────────────────────────────────
   LEARNING PATH — ordered collection of courses (6.6)
   ─────────────────────────────────────────────────────
   courses[] is embedded with ordering + prereq flag.
   enrolledCount is denormalised for catalogue display.
───────────────────────────────────────────────────── */
export type LearningPathStatus = 'draft' | 'published'

export interface ILearningPathCourse {
  courseId:        Types.ObjectId
  order:           number    // display order (1-based)
  isPrerequisite:  boolean   // must complete this before the next
}

export interface ILearningPath extends Document {
  id:             string
  title:          string
  slug:           string
  description?:   string
  thumbnailUrl?:  string
  instructorId:   Types.ObjectId
  categoryId?:    Types.ObjectId
  status:         LearningPathStatus
  courses:        ILearningPathCourse[]
  enrolledCount:  number
  /* Owning academy (P-22). Optional on the interface only for rows that
     predate the field — the boot backfill in index.ts stamps them, and the
     `{org} OR {null}` filter convention keeps any stragglers reachable. */
  organizationId?: Types.ObjectId
  createdAt:      Date
  updatedAt:      Date
}

const LearningPathCourseSchema = new Schema<ILearningPathCourse>(
  {
    courseId:       { type: Schema.Types.ObjectId, ref: 'Course', required: true },
    order:          { type: Number, required: true, min: 1 },
    isPrerequisite: { type: Boolean, default: false },
  },
  { _id: false },
)

const LearningPathSchema = new Schema<ILearningPath>(
  {
    title:         { type: String, required: true, trim: true, maxlength: 255 },
    slug:          { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 255 },
    description:   { type: String, maxlength: 5000 },
    thumbnailUrl:  { type: String, maxlength: 2048 },
    instructorId:  { type: Schema.Types.ObjectId, ref: 'User',     required: true },
    categoryId:    { type: Schema.Types.ObjectId, ref: 'Category' },
    status:        { type: String, enum: ['draft', 'published'], default: 'draft' },
    courses:       [LearningPathCourseSchema],
    enrolledCount: { type: Number, default: 0, min: 0 },
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization' },
  },
  baseSchemaOptions,
)

LearningPathSchema.index({ slug: 1 }, { unique: true })
LearningPathSchema.index({ status: 1 })
LearningPathSchema.index({ instructorId: 1 })
LearningPathSchema.index({ categoryId: 1 })
LearningPathSchema.index({ organizationId: 1 })

export const LearningPathModel = mongoose.model<ILearningPath>('LearningPath', LearningPathSchema)

/* ─────────────────────────────────────────────────────
   AUDIT LOG — admin action trail (8.11)
───────────────────────────────────────────────────── */
/* ─────────────────────────────────────────────────────
   IMPERSONATION SESSION  (M-04)
   ─────────────────────────────────────────────────────
   Impersonation used to be a bare JWT: no record of WHO was impersonating,
   and no way to stop it once issued. The token was the whole session, so
   "end impersonation" only meant the browser threw its copy away — anyone
   holding it kept full access to the target account until it expired.

   This record is the session. The token carries its id, every request
   re-checks it, and revoking the row ends the session immediately — for
   every holder of that token, not just the one who clicked the button.

   Rows are kept after they end, because the point of the actor trail is
   answering "who was in that account, and when" long after the fact.
───────────────────────────────────────────────────── */
export interface IImpersonationSession extends Document {
  id:             string
  actorId:        Types.ObjectId    // the staff member doing the impersonating
  actorEmail:     string            // denormalised — survives the actor being deleted
  targetId:       Types.ObjectId    // the account being impersonated
  targetEmail:    string
  organizationId?: Types.ObjectId
  expiresAt:      Date
  revokedAt?:     Date
  revokedBy?:     Types.ObjectId
  ip?:            string
  userAgent?:     string
  createdAt:      Date
  updatedAt:      Date
}

const ImpersonationSessionSchema = new Schema<IImpersonationSession>(
  {
    actorId:        { type: Schema.Types.ObjectId, ref: 'User', required: true },
    actorEmail:     { type: String, required: true },
    targetId:       { type: Schema.Types.ObjectId, ref: 'User', required: true },
    targetEmail:    { type: String, required: true },
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization' },
    expiresAt:      { type: Date, required: true },
    revokedAt:      { type: Date },
    revokedBy:      { type: Schema.Types.ObjectId, ref: 'User' },
    ip:             { type: String },
    userAgent:      { type: String },
  },
  baseSchemaOptions,
)

/* Looked up on EVERY request made with an impersonation token, so it must be
   an indexed point read. Deliberately no TTL index: an expired session is
   still evidence, and the expiry is enforced in code. */
ImpersonationSessionSchema.index({ actorId: 1, createdAt: -1 })
ImpersonationSessionSchema.index({ targetId: 1, createdAt: -1 })

export const ImpersonationSessionModel =
  mongoose.model<IImpersonationSession>('ImpersonationSession', ImpersonationSessionSchema)

/* ─────────────────────────────────────────────────────
   IMPERSONATION HANDOFF  (client-portal impersonation)
   ─────────────────────────────────────────────────────
   The admin and client portals are separate origins, and since M-21 the auth
   cookies are host-only — so the admin app cannot set the client's cookie and
   must not be given a way to. Instead it receives a one-time CODE and opens
   the client app with it; the client origin redeems the code for its own
   cookie.

   The row stores the code's HASH and the session id — never a token. The
   client token is minted at redemption, so nothing that grants access is ever
   at rest here, and a database read yields nothing usable.
───────────────────────────────────────────────────── */
export interface IImpersonationHandoff extends Document {
  id:        string
  codeHash:  string             // sha256 of the one-time code
  sessionId: Types.ObjectId     // -> ImpersonationSession
  expiresAt: Date
  usedAt?:   Date
  createdAt: Date
  updatedAt: Date
}

const ImpersonationHandoffSchema = new Schema<IImpersonationHandoff>(
  {
    codeHash:  { type: String, required: true, unique: true },
    sessionId: { type: Schema.Types.ObjectId, ref: 'ImpersonationSession', required: true },
    expiresAt: { type: Date, required: true },
    usedAt:    { type: Date },
  },
  baseSchemaOptions,
)

/* TTL sweeps spent codes. Mongo's monitor only runs about once a minute, so a
   row can outlive its expiry by a little — redemption therefore checks
   expiresAt itself rather than trusting the row's absence. */
ImpersonationHandoffSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export const ImpersonationHandoffModel =
  mongoose.model<IImpersonationHandoff>('ImpersonationHandoff', ImpersonationHandoffSchema)

/* ─────────────────────────────────────────────────────
   ClassHandoff — one-time code for entering a class on CLT
   ─────────────────────────────────────────────────────
   The redirect flow needs to carry an identity across an origin boundary, and
   a signed ticket is a bearer credential: in a URL it lands in history, the
   Referer header, proxy logs and any shared screen. So the URL carries a
   meaningless code instead, and CLT exchanges it server-to-server.

   TWO deliberate choices about what is stored:

   1. The code is stored HASHED, like ImpersonationHandoff. A database read
      yields nothing that can be redeemed.

   2. The TICKET IS NOT STORED AT ALL. Only the intent is — who, which class,
      as host or student, visible or hidden — and the ticket is minted when CLT
      exchanges the code. That keeps a bearer credential out of the database
      entirely, re-runs the authorisation check at the moment of use rather
      than trusting one made a minute earlier, and starts the ticket's 90-second
      life when it is actually needed instead of burning it on a page load.
───────────────────────────────────────────────────── */
export type ClassHandoffKind = 'host' | 'student'

export interface IClassHandoff extends Document {
  id:          string
  codeHash:    string             // sha256 of the one-time code
  liveClassId: Types.ObjectId
  userId:      Types.ObjectId
  kind:        ClassHandoffKind
  visible?:    boolean            // host only; admins choose per entry
  expiresAt:   Date
  usedAt?:     Date
  createdAt:   Date
  updatedAt:   Date
}

const ClassHandoffSchema = new Schema<IClassHandoff>(
  {
    codeHash:    { type: String, required: true, unique: true },
    liveClassId: { type: Schema.Types.ObjectId, ref: 'LiveClass', required: true },
    userId:      { type: Schema.Types.ObjectId, ref: 'User', required: true },
    kind:        { type: String, enum: ['host', 'student'], required: true },
    visible:     { type: Boolean },
    expiresAt:   { type: Date, required: true },
    usedAt:      { type: Date },
  },
  baseSchemaOptions,
)

/* TTL sweeps spent codes. Mongo's monitor runs about once a minute, so a row
   can outlive its expiry briefly — redemption therefore checks expiresAt
   itself rather than trusting the row's absence. */
ClassHandoffSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export const ClassHandoffModel =
  mongoose.model<IClassHandoff>('ClassHandoff', ClassHandoffSchema)

export type AuditAction =
  | 'course.create'   | 'course.update'   | 'course.delete'
  | 'course.publish'  | 'course.archive'
  | 'user.create'     | 'user.ban'        | 'user.unban'      | 'user.roleChange'
  | 'user.delete'     | 'user.impersonate' | 'user.reset2fa'
  | 'user.impersonate.revoke'
  | 'user.impersonate.client'
  | 'recording.view'
  | 'review.delete'
  | 'coupon.create'   | 'coupon.delete'
  | 'order.refund'
  | 'category.create' | 'category.update' | 'category.delete'
  | 'bulk.publish'    | 'bulk.archive'    | 'bulk.delete'
  | 'course.import'   | 'course.export'
  | 'liveclass.create' | 'liveclass.update' | 'liveclass.delete' | 'liveclass.repeat'
  /* Operator switches. `settings.device-limit` disables a security control
     for every academy at once, so it is audited like an impersonation. */
  | 'settings.device-limit'

export interface IAuditLog extends Document {
  id:         string
  actorId:    Types.ObjectId
  actorEmail: string
  actorRole:  string
  action:     AuditAction
  entity:     string             // e.g. "Course", "User"
  entityId?:  string
  meta?:      Record<string, unknown>   // extra context (e.g. old/new values)
  ip?:        string
  userAgent?: string
  /* Which academy the acting staff member belonged to (H-12). Optional: rows
     written before the field existed have none, and stay visible to everyone —
     `bun run migrate-audit-org` backfills them from the actor's record. */
  organizationId?: Types.ObjectId
  createdAt:  Date
}

const AuditLogSchema = new Schema<IAuditLog>(
  {
    actorId:    { type: Schema.Types.ObjectId, ref: 'User', required: true },
    actorEmail: { type: String, required: true },
    actorRole:  { type: String, required: true },
    action:     { type: String, required: true },
    entity:     { type: String, required: true },
    entityId:   { type: String },
    meta:       { type: Schema.Types.Mixed },
    ip:         { type: String },
    userAgent:  { type: String },
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization' },
  },
  { timestamps: { createdAt: true, updatedAt: false }, toJSON: { virtuals: true }, toObject: { virtuals: true } },
)

AuditLogSchema.index({ actorId: 1 })
AuditLogSchema.index({ organizationId: 1, createdAt: -1 })
AuditLogSchema.index({ action: 1 })
AuditLogSchema.index({ createdAt: -1 })
AuditLogSchema.index({ entity: 1, entityId: 1 })

export const AuditLogModel = mongoose.model<IAuditLog>('AuditLog', AuditLogSchema)

/* ─────────────────────────────────────────────────────
   EMAIL OUTBOX
   ─────────────────────────────────────────────────────
   Every outbound email is written here BEFORE it is attempted, and only marked
   sent once a transport accepts it. That ordering is the whole point: sends
   used to be fire-and-forget, so a transient SMTP failure — or the daily
   sending cap — silently destroyed the message. A password reset that Gmail
   refused at 2,001 emails was simply gone.

   Rows stay `pending` until delivered, so when the cap resets or the network
   recovers the drain job replays them. Nothing is lost, it is only late.

   `failed` is reserved for permanent rejections (no such mailbox) and for
   giving up after MAX_ATTEMPTS — both worth a human looking at.
───────────────────────────────────────────────────── */
export type EmailOutboxStatus = 'pending' | 'sent' | 'failed'

export interface IEmailOutbox extends Document {
  id:            string
  to:            string
  subject:       string
  html:          string
  text?:         string
  status:        EmailOutboxStatus
  attempts:      number
  nextAttemptAt: Date
  lastError?:    string
  sentVia?:      string        // which mailbox accepted it
  sentAt?:       Date
  createdAt:     Date
  updatedAt:     Date
}

const EmailOutboxSchema = new Schema<IEmailOutbox>(
  {
    to:            { type: String, required: true, trim: true },
    subject:       { type: String, required: true },
    html:          { type: String, required: true },
    text:          { type: String },
    status:        { type: String, enum: ['pending', 'sent', 'failed'], default: 'pending', index: true },
    attempts:      { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: () => new Date() },
    lastError:     { type: String, maxlength: 500 },
    sentVia:       { type: String },
    sentAt:        { type: Date },
  },
  baseSchemaOptions,
)

/* The drain query: oldest due work first. */
EmailOutboxSchema.index({ status: 1, nextAttemptAt: 1 })

/* Delivered mail is kept 30 days as a send log, then swept. Pending and failed
   rows are NEVER auto-removed — losing them is the failure this exists to
   prevent — so the TTL is on sentAt, which only a delivered row carries. */
EmailOutboxSchema.index({ sentAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 })

export const EmailOutboxModel =
  mongoose.model<IEmailOutbox>('EmailOutbox', EmailOutboxSchema)


/* ─────────────────────────────────────────────────────
   NOTIFICATION DIGEST QUEUE — Standard-tier events awaiting their daily mail
   ─────────────────────────────────────────────────────
   Phase 2 of the Class-Update Notification spec. Standard-tier events are
   queued per student as they happen and flushed once a day into a single
   "here's what changed in your classes today" email.

   Critical-tier events (cancellation, reschedule, mentor change) never come
   here — they bypass the queue entirely and send immediately, which is the
   whole point of having tiers.

   Deliberately NOT reusing EmailOutbox: that queue holds rendered messages
   waiting on a transport that failed, and its drain sends each row as its own
   email. These rows are the opposite — they are events waiting to be COMBINED
   into one message that does not exist yet. Putting them in the same
   collection would mean the outbox drain mails each one separately, which is
   precisely the behaviour this replaces.
───────────────────────────────────────────────────── */
export interface IDigestQueue extends Document {
  userId:      Types.ObjectId
  kind:        string
  title:       string
  body:        string
  link?:       string
  queuedAt:    Date
  sentAt?:     Date
  createdAt:   Date
  updatedAt:   Date
}

const DigestQueueSchema = new Schema<IDigestQueue>(
  {
    userId:   { type: Schema.Types.ObjectId, ref: 'User', required: true },
    /* What happened, for grouping and for anyone reading the queue later. */
    kind:     { type: String, required: true, maxlength: 60 },
    title:    { type: String, required: true, maxlength: 200 },
    body:     { type: String, required: true, maxlength: 500 },
    link:     { type: String, maxlength: 500 },
    queuedAt: { type: Date, default: () => new Date() },
    /* Null until the digest carrying this row is sent. The flush claims rows
       by stamping it, so a second run cannot re-send what the first took. */
    sentAt:   { type: Date, default: null },
  },
  baseSchemaOptions,
)

/* The flush's only query: everything still pending, oldest first, per student. */
DigestQueueSchema.index({ userId: 1, sentAt: 1, queuedAt: 1 })

/* Sent rows are a 30-day record of what each digest contained; pending rows
   are never swept, for the same reason the outbox never sweeps its own. */
DigestQueueSchema.index({ sentAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 })

export const DigestQueueModel =
  mongoose.model<IDigestQueue>('DigestQueue', DigestQueueSchema)


/* ────────────────────────────────────────────────────
   CRITICAL MAIL — parked, merged, then sent (Phase 4)

   Critical-tier email no longer leaves from the request that caused it. Each
   recipient's mail waits here for a short buffer so that back-to-back
   corrections to the same session collapse into one, per §7 of the
   Class-Update Notification spec.

   Separate from DigestQueue on purpose. A digest row is a line in a message
   that does not exist yet; a row here IS a message, addressed and ready, that
   is deliberately not sent yet. They have different lifecycles: a digest row
   waits for a clock, this one waits for the admin to stop typing.

   Three terminal states, and the difference matters when reading the table:
     · sentAt set, foldedToDigest false — mailed
     · sentAt set, foldedToDigest true  — over the student's daily cap, so it
       went into the digest instead. Closed out, but never mailed.
     · supersededAt set                 — overtaken before it was sent. The
       only producer today is a cancellation, which makes every other pending
       fact about that session moot.

   `claimedAt` is not a fourth state: it is the lock a flush takes on a row
   before sending it, so two overlapping flushes cannot both deliver it.
─────────────────────────────────────────────────── */
export interface ICriticalMail extends Document {
  liveClassId:        Types.ObjectId
  userId:             Types.ObjectId
  email:              string
  name:               string
  kind:               'cancelled' | 'rescheduled' | 'instructor'
  title:              string
  scheduledStart?:    Date
  oldStart?:          Date
  newStart?:          Date
  oldInstructorName?: string
  newInstructorName?: string
  queuedAt:           Date
  dueAt:              Date
  sentAt?:            Date | null
  foldedToDigest?:    boolean
  supersededAt?:      Date | null
  claimedAt?:         Date | null
  createdAt:          Date
  updatedAt:          Date
}

const CriticalMailSchema = new Schema<ICriticalMail>(
  {
    liveClassId: { type: Schema.Types.ObjectId, ref: 'LiveClass', required: true },
    userId:      { type: Schema.Types.ObjectId, ref: 'User',      required: true },
    /* The address and name are COPIED rather than joined at send time: the
       mail is about what the student booked, and re-reading the user at flush
       time would only matter if they changed their address inside the buffer,
       which the account-change flow handles on its own. */
    email:  { type: String, required: true, maxlength: 320 },
    name:   { type: String, default: '',    maxlength: 200 },
    kind:   { type: String, required: true, enum: ['cancelled', 'rescheduled', 'instructor'] },
    title:  { type: String, required: true, maxlength: 255 },
    /* The class's own start time, so the flush can tell when waiting out the
       buffer would deliver the mail after the class it is about. */
    scheduledStart:    { type: Date },
    oldStart:          { type: Date },
    newStart:          { type: Date },
    oldInstructorName: { type: String, maxlength: 200 },
    newInstructorName: { type: String, maxlength: 200 },
    queuedAt:          { type: Date, default: () => new Date() },
    /* Set once, from the FIRST edit, and never pushed back by a merge — a
       rolling window would let a stream of corrections delay a cancellation
       indefinitely. */
    dueAt:             { type: Date, required: true },
    sentAt:            { type: Date,    default: null },
    foldedToDigest:    { type: Boolean, default: false },
    supersededAt:      { type: Date,    default: null },
    /* Set by whichever flush takes this row, BEFORE it sends. Two flushes can
       overlap — the urgent path runs inside the admin's request on whatever
       instance served it, while the cron tick runs on instance 0 — and an
       in-process guard does not span processes. Without the claim both read
       the same pending rows and both send: a cancellation delivered twice.
       Cleared again if the send throws, so the next tick retries. */
    claimedAt:         { type: Date,    default: null },
  },
  baseSchemaOptions,
)

/* The flush's query: what is pending and ready. */
CriticalMailSchema.index({ sentAt: 1, supersededAt: 1, dueAt: 1 })

/* The merge lookup: is there already a pending row for this session, this
   student, this kind of change? */
CriticalMailSchema.index({ liveClassId: 1, userId: 1, kind: 1, sentAt: 1 })

/* The daily-cap count. */
CriticalMailSchema.index({ userId: 1, sentAt: 1 })

/* Sent rows are a 30-day record of what was mailed and what was capped;
   pending rows are never swept. */
CriticalMailSchema.index({ sentAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 })

export const CriticalMailModel =
  mongoose.model<ICriticalMail>('CriticalMail', CriticalMailSchema)


/* ────────────────────────────────────────────────────
   SYSTEM SETTINGS — one row per switch, read through settings.service.ts

   Deliberately key/value rather than a column per feature. These are operator
   switches, not domain data: they are read constantly, written rarely, and the
   next one should not need a migration.

   `updatedBy` and `updatedAt` are the whole audit story for a switch that can
   disable a security control — whoever turns the device limit off should be
   answerable for it.
─────────────────────────────────────────────────── */
export interface ISystemSetting extends Document {
  key:        string
  value:      unknown
  updatedBy?: Types.ObjectId
  createdAt:  Date
  updatedAt:  Date
}

const SystemSettingSchema = new Schema<ISystemSetting>(
  {
    key:       { type: String, required: true, unique: true, maxlength: 100 },
    /* Mixed so a switch can grow from a boolean into an object without a
       migration. Readers are responsible for validating what they get. */
    value:     { type: Schema.Types.Mixed, required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  baseSchemaOptions,
)

export const SystemSettingModel =
  mongoose.model<ISystemSetting>('SystemSetting', SystemSettingSchema)


/* ─────────────────────────────────────────────────────
   MENTOR AVAILABILITY — weekly recurring time slots
───────────────────────────────────────────────────── */
export interface IAvailabilitySlot {
  dayOfWeek:  number   // 0 = Sunday … 6 = Saturday
  startTime:  string   // "HH:MM" 24-hour
  endTime:    string   // "HH:MM" 24-hour
}

export interface IMentorAvailability extends Document {
  id:       string
  mentorId: Types.ObjectId
  slots:    IAvailabilitySlot[]
  createdAt: Date
  updatedAt: Date
}

const AvailabilitySlotSchema = new Schema<IAvailabilitySlot>(
  {
    dayOfWeek: { type: Number, required: true, min: 0, max: 6 },
    startTime: { type: String, required: true, match: /^\d{2}:\d{2}$/ },
    endTime:   { type: String, required: true, match: /^\d{2}:\d{2}$/ },
  },
  { _id: false },
)

const MentorAvailabilitySchema = new Schema<IMentorAvailability>(
  {
    mentorId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    slots:    { type: [AvailabilitySlotSchema], default: [] },
  },
  baseSchemaOptions,
)

export const MentorAvailabilityModel = mongoose.model<IMentorAvailability>(
  'MentorAvailability',
  MentorAvailabilitySchema,
)

/* ─────────────────────────────────────────────────────
   CLASS BOOKING — student books a specific session slot
───────────────────────────────────────────────────── */
export type BookingStatus = 'booked' | 'attended' | 'missed' | 'cancelled'

export interface IClassBooking extends Document {
  id:          string
  userId:      Types.ObjectId
  liveClassId: Types.ObjectId
  status:      BookingStatus
  bookedAt:    Date
  cancelledAt?: Date

  /* Attendance, reported by the meeting platform after the fact.
     Deliberately separate from `status`: a booking stays 'booked' whether or
     not the student turned up, and collapsing the two would destroy the
     difference between "cancelled in advance" and "no-showed". */
  attendedAt?:      Date
  attendanceSource?: 'livekit'
  // Reminder flags
  reminderDayBeforeSent:  boolean
  reminderDayOfSent:      boolean
  reminderPreSessionSent: boolean   // 30-min reminder (no link)
  reminder5MinSent:       boolean   // 5-min reminder (with link)
  reminderAtTimeSent:     boolean   // at-time reminder (with link)
  createdAt:   Date
  updatedAt:   Date
}

const ClassBookingSchema = new Schema<IClassBooking>(
  {
    userId:      { type: Schema.Types.ObjectId, ref: 'User',      required: true },
    liveClassId: { type: Schema.Types.ObjectId, ref: 'LiveClass', required: true },
    status:      { type: String, enum: ['booked', 'attended', 'missed', 'cancelled'], default: 'booked' },
    bookedAt:    { type: Date, default: Date.now },
    attendedAt:       { type: Date },
    attendanceSource: { type: String, enum: ['livekit'] },
    cancelledAt: { type: Date },
    reminderDayBeforeSent:  { type: Boolean, default: false },
    reminderDayOfSent:      { type: Boolean, default: false },
    reminderPreSessionSent: { type: Boolean, default: false },
    reminder5MinSent:       { type: Boolean, default: false },
    reminderAtTimeSent:     { type: Boolean, default: false },
  },
  baseSchemaOptions,
)

// Prevent duplicate bookings; allow re-booking after cancel via the application layer
ClassBookingSchema.index({ userId: 1, liveClassId: 1 }, { unique: true })
ClassBookingSchema.index({ liveClassId: 1 })
ClassBookingSchema.index({ userId: 1, status: 1 })

export const ClassBookingModel = mongoose.model<IClassBooking>('ClassBooking', ClassBookingSchema)

/* ─────────────────────────────────────────────────────
   SESSION HOMEWORK — assigned post-class tasks
───────────────────────────────────────────────────── */
export interface ISessionHomework extends Document {
  id:          string
  liveClassId: Types.ObjectId
  assignedBy:  Types.ObjectId
  title:       string
  description: string
  dueDate?:    Date
  createdAt:   Date
  updatedAt:   Date
}

const SessionHomeworkSchema = new Schema<ISessionHomework>(
  {
    liveClassId: { type: Schema.Types.ObjectId, ref: 'LiveClass', required: true },
    assignedBy:  { type: Schema.Types.ObjectId, ref: 'User',      required: true },
    title:       { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, default: '',   maxlength: 5000 },
    dueDate:     { type: Date },
  },
  baseSchemaOptions,
)

SessionHomeworkSchema.index({ liveClassId: 1 })
SessionHomeworkSchema.index({ assignedBy: 1 })

export const SessionHomeworkModel = mongoose.model<ISessionHomework>('SessionHomework', SessionHomeworkSchema)

/* ─────────────────────────────────────────────────────
   HOMEWORK SUBMISSION — student submits work
───────────────────────────────────────────────────── */
export type HomeworkSubmissionStatus = 'submitted' | 'graded' | 'returned'

export interface IHomeworkSubmission extends Document {
  id:              string
  homeworkId:      Types.ObjectId
  userId:          Types.ObjectId
  submissionText?: string
  submissionUrl?:  string
  grade?:          number
  feedback?:       string
  gradedAt?:       Date
  gradedBy?:       Types.ObjectId
  status:          HomeworkSubmissionStatus
  createdAt:       Date
  updatedAt:       Date
}

const HomeworkSubmissionSchema = new Schema<IHomeworkSubmission>(
  {
    homeworkId:      { type: Schema.Types.ObjectId, ref: 'SessionHomework', required: true },
    userId:          { type: Schema.Types.ObjectId, ref: 'User',            required: true },
    submissionText:  { type: String, maxlength: 10000 },
    submissionUrl:   { type: String, maxlength: 500 },
    grade:           { type: Number, min: 0, max: 100 },
    feedback:        { type: String, maxlength: 2000 },
    gradedAt:        { type: Date },
    gradedBy:        { type: Schema.Types.ObjectId, ref: 'User' },
    status:          { type: String, enum: ['submitted', 'graded', 'returned'], default: 'submitted' },
  },
  baseSchemaOptions,
)

HomeworkSubmissionSchema.index({ homeworkId: 1 })
HomeworkSubmissionSchema.index({ userId: 1 })
HomeworkSubmissionSchema.index({ homeworkId: 1, userId: 1 }, { unique: true })

export const HomeworkSubmissionModel = mongoose.model<IHomeworkSubmission>('HomeworkSubmission', HomeworkSubmissionSchema)

/* ── Class Feedback ─────────────────────────────────────────── */
export interface IClassFeedback extends Document {
  id: string
  liveClassId: Types.ObjectId
  userId:      Types.ObjectId
  rating:      number   // 1–5
  comment?:    string
  createdAt:   Date
  updatedAt:   Date
}

const ClassFeedbackSchema = new Schema<IClassFeedback>(
  {
    liveClassId: { type: Schema.Types.ObjectId, ref: 'LiveClass', required: true, index: true },
    userId:      { type: Schema.Types.ObjectId, ref: 'User',      required: true },
    rating:      { type: Number, min: 1, max: 5, required: true },
    comment:     { type: String, maxlength: 1000 },
  },
  { timestamps: true },
)
ClassFeedbackSchema.index({ liveClassId: 1, userId: 1 }, { unique: true })
ClassFeedbackSchema.virtual('id').get(function() { return this._id.toString() })
ClassFeedbackSchema.set('toJSON', { virtuals: true })

export const ClassFeedbackModel = mongoose.model<IClassFeedback>('ClassFeedback', ClassFeedbackSchema)

/* ─── Support Tickets ──────────────────────────────────────────────────── */

export type SupportTicketStatus = 'open' | 'pending' | 'resolved' | 'closed'
export type SupportCategory     = 'technical' | 'billing' | 'course' | 'account' | 'other'

export interface ISupportMessage {
  /* Absent on SYSTEM messages (e.g. the automatic welcome reply) — both UIs
     fall back to a "Support Team" label, and the performance metrics count
     only sender-bearing admin messages as real first responses. */
  senderId?:  Types.ObjectId
  senderRole: 'student' | 'admin'
  body:       string
  createdAt:  Date
}

export interface ISupportTicket extends Document {
  id:             string
  userId:         Types.ObjectId
  subject:        string
  category:       SupportCategory
  program?:       string
  status:         SupportTicketStatus
  messages:       ISupportMessage[]
  lastMessageAt:  Date
  lastSenderRole: 'student' | 'admin'
  userUnread:      boolean
  adminUnread:     boolean
  organizationId?: Types.ObjectId
  createdAt:       Date
  updatedAt:       Date
}

const SupportMessageSchema = new Schema<ISupportMessage>(
  {
    /* Optional so SYSTEM messages (auto welcome reply) can omit it — its
       absence is what marks a message as automated. Human paths always set it. */
    senderId:   { type: Schema.Types.ObjectId, ref: 'User', required: false },
    senderRole: { type: String, enum: ['student', 'admin'], required: true },
    body:       { type: String, required: true, maxlength: 5000 },
    createdAt:  { type: Date, default: () => new Date() },
  },
  { _id: true },
)

const SupportTicketSchema = new Schema<ISupportTicket>(
  {
    userId:         { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    subject:        { type: String, required: true, trim: true, maxlength: 200 },
    category:       { type: String, enum: ['technical', 'billing', 'course', 'account', 'other'], default: 'other' },
    program:        { type: String },
    status:         { type: String, enum: ['open', 'pending', 'resolved', 'closed'], default: 'open', index: true },
    messages:       [SupportMessageSchema],
    lastMessageAt:  { type: Date, default: () => new Date(), index: true },
    lastSenderRole: { type: String, enum: ['student', 'admin'], default: 'student' },
    userUnread:     { type: Boolean, default: false },
    adminUnread:    { type: Boolean, default: true },
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization' },
  },
  baseSchemaOptions,
)

SupportTicketSchema.index({ organizationId: 1 })

export const SupportTicketModel = mongoose.model<ISupportTicket>('SupportTicket', SupportTicketSchema)

/* ─────────────────────────────────────────────────────
   CLASS ASSIGNMENT  (student → instructor, after a live class)
   ─────────────────────────────────────────────────────
   Distinct from Assignment/AssignmentSubmission above, which is the
   instructor-authored, lesson-attached, 0-100 graded kind. This one is
   student-INITIATED and attached to a live SESSION: you attend a class, you
   send your work to the instructor, they approve it or send it back with a
   reason and you try again.

   The session carries the course, the module and the instructor, so the
   student picks ONE thing rather than three — and cannot assemble a
   combination that never existed. Those fields are still denormalised onto
   the row because a session can later be re-parented (P-16) and a submission
   must keep the context it was made in.
───────────────────────────────────────────────────── */
export type ClassAssignmentStatus = 'pending' | 'approved' | 'rejected'

export interface IClassAssignmentFile {
  url:      string      // own-storage reference, validated by documentRef
  name:     string
  mimeType: string
  sizeBytes: number
}

export interface IClassAssignmentReview {
  status:     'approved' | 'rejected'
  reason?:    string           // required by the route when rejecting
  reviewerId: Types.ObjectId
  attempt:    number           // which submission attempt this judged
  reviewedAt: Date
}

export interface IClassAssignment extends Document {
  id:             string
  studentId:      Types.ObjectId
  liveClassId:    Types.ObjectId
  courseId:       Types.ObjectId
  sectionId?:     Types.ObjectId          // the module, when the session has one
  instructorId:   Types.ObjectId
  organizationId?: Types.ObjectId
  title:          string
  note?:          string
  files:          IClassAssignmentFile[]
  status:         ClassAssignmentStatus
  attempt:        number                  // 1 on first send, +1 per resubmission
  reviews:        IClassAssignmentReview[]
  lastReason?:    string                  // the reason on the most recent rejection
  submittedAt:    Date
  reviewedAt?:    Date
  createdAt:      Date
  updatedAt:      Date
}

const ClassAssignmentFileSchema = new Schema<IClassAssignmentFile>(
  {
    url:       { type: String, required: true, maxlength: 2048 },
    name:      { type: String, required: true, maxlength: 255 },
    mimeType:  { type: String, required: true, maxlength: 100 },
    sizeBytes: { type: Number, required: true, min: 0 },
  },
  { _id: false },
)

const ClassAssignmentReviewSchema = new Schema<IClassAssignmentReview>(
  {
    status:     { type: String, enum: ['approved', 'rejected'], required: true },
    reason:     { type: String, maxlength: 2000 },
    reviewerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    attempt:    { type: Number, required: true, min: 1 },
    reviewedAt: { type: Date, default: () => new Date() },
  },
  { _id: false },
)

const ClassAssignmentSchema = new Schema<IClassAssignment>(
  {
    studentId:      { type: Schema.Types.ObjectId, ref: 'User',      required: true, index: true },
    liveClassId:    { type: Schema.Types.ObjectId, ref: 'LiveClass', required: true, index: true },
    courseId:       { type: Schema.Types.ObjectId, ref: 'Course',    required: true, index: true },
    sectionId:      { type: Schema.Types.ObjectId, ref: 'Section' },
    instructorId:   { type: Schema.Types.ObjectId, ref: 'User',      required: true, index: true },
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', index: true },
    title:          { type: String, required: true, trim: true, maxlength: 200 },
    note:           { type: String, maxlength: 5000 },
    files:          { type: [ClassAssignmentFileSchema], default: [] },
    status:         { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
    attempt:        { type: Number, default: 1, min: 1 },
    reviews:        { type: [ClassAssignmentReviewSchema], default: [] },
    lastReason:     { type: String, maxlength: 2000 },
    submittedAt:    { type: Date, default: () => new Date(), index: true },
    reviewedAt:     { type: Date },
  },
  baseSchemaOptions,
)

/* The instructor's queue: their sessions, newest pending first. */
ClassAssignmentSchema.index({ instructorId: 1, status: 1, submittedAt: -1 })
/* The student's own list. */
ClassAssignmentSchema.index({ studentId: 1, submittedAt: -1 })
/* One submission per student per session — revisions bump `attempt` on the
   same row rather than adding another. The service checks this before writing;
   the index is what makes it true under two simultaneous requests. */
ClassAssignmentSchema.index({ studentId: 1, liveClassId: 1 }, { unique: true })

export const ClassAssignmentModel =
  mongoose.model<IClassAssignment>('ClassAssignment', ClassAssignmentSchema)
