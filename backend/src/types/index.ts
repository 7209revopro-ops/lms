import type { Request } from 'express'

/* ─────────────────────────────────────────────────────
   Express augmentation — req.user populated by auth middleware
───────────────────────────────────────────────────── */
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser
    }
  }
}

export interface AuthUser {
  id:              string
  email:           string
  role:            UserRole
  categoryScope?:  ProgramCategory
  organizationId?: string    // ObjectId as string — set by authenticateAdmin; undefined for super_admin with no org header
  program?:        ProgramType  // sub_admin only
  /* Present ONLY when this request is being made through an impersonation
     token (M-04). `id`/`email`/`role` remain the impersonated user — that is
     what authorisation must judge — while these record who is really behind
     the request, so the audit trail names the operator rather than the
     account they borrowed. */
  impersonatorId?:    string
  impersonatorEmail?: string
  impersonationId?:   string   // the ImpersonationSession being used
  impersonationMode?: 'read' | 'write'   // that session's mode — 'write' lets the client portal change things (audited)
  /* A custom role assigned to this account (P-10). Only NARROWS what the base
     role already permits — see requirePermission(). Undefined for almost
     everyone, which is why resolving the matrix costs nothing in practice. */
  customRoleId?:      string
}

/* ─────────────────────────────────────────────────────
   Domain enums
───────────────────────────────────────────────────── */
export type UserRole =
  | 'student'
  | 'instructor'
  | 'admin'
  | 'super_admin'
  | 'sub_admin'   // programme-scoped admin; the programme lives in `program`
  | 'support'

export type OrgSlug    = 'dubai' | 'bangalore'
export type ProgramType = 'ai' | 'digital_marketing' | 'forex' | 'jura'

export type EnrollmentStatus = 'active' | 'completed' | 'dropped'

export type StudentEnrollmentStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'

export type ProgramCategory = '4x-trading' | 'digital-marketing' | 'ai' | 'jura'

export type CourseStatus = 'draft' | 'published' | 'archived'

export type LessonType = 'video' | 'article' | 'quiz' | 'assignment'

export type QuestionType = 'mcq' | 'true_false' | 'short'

export type AchievementKind =
  | 'first_lesson'
  | 'course_complete'
  | 'quiz_ace'
  | 'quiz_pass'
  | 'streak_7'
  | 'streak_30'
  | 'streak_100'
  | 'top_reviewer'

/* ─────────────────────────────────────────────────────
   API Response shape
───────────────────────────────────────────────────── */
export interface ApiSuccessResponse<T = unknown> {
  success: true
  data: T
  message?: string
  meta?: PaginationMeta
}

export interface ApiErrorResponse {
  success: false
  error: {
    code: string
    message: string
    details?: unknown
  }
}

export type ApiResponse<T = unknown> = ApiSuccessResponse<T> | ApiErrorResponse

export interface PaginationMeta {
  total_count: number
  page: number
  per_page: number
  total_pages: number
  has_next: boolean
  has_prev: boolean
}

/* ─────────────────────────────────────────────────────
   Pagination query params
───────────────────────────────────────────────────── */
export interface PaginationParams {
  page: number
  per_page: number
  offset: number
}

/* ─────────────────────────────────────────────────────
   JWT payloads
───────────────────────────────────────────────────── */
export interface AccessTokenPayload {
  sub: string       // user id
  email: string
  role: UserRole
  type: 'access'
  /* Impersonation only (M-04). `act` follows RFC 8693's "actor" idea: the
     party genuinely making the request, as distinct from `sub`, the party it
     is made as. `isn` names the ImpersonationSession, which is re-checked on
     every request so revoking the row ends the session immediately. */
  act?: { sub: string; email: string }
  isn?: string
}

export interface RefreshTokenPayload {
  sub: string
  type: 'refresh'
}

/* ─────────────────────────────────────────────────────
   Auth DTOs
───────────────────────────────────────────────────── */
export interface RegisterDto {
  name:              string
  email:             string
  password:          string
  signupType?:       'express' | 'full'
  organizationSlug?: OrgSlug
  enrollmentApplication?: {
    phone?:              string
    emergencyContact?:   string
    gender?:             string
    dateOfBirth?:        string
    nationality?:        string
    homeCountry?:        string
    occupation?:         string
    idType?:             string
    idNumber?:           string
    emiratesId?:         string
    countryAttendance?:  string
    villa?:              string
    city?:               string
    addressCountry?:     string
    passportUrl?:        string
    idDocUrl?:           string
    photoUrl?:           string
    experienceLevel?:    string
    preferredStartDate?: string
    hearAboutUs?:        string
    referralName?:       string
    programs?:           string[]
    paymentMethod?:      string
  }
}

export interface LoginDto {
  email: string
  password: string
  /* Client login form's "Remember me for 30 days" checkbox. Absent/true keeps
     the full refresh-session length; false shortens it — see refreshTtl.ts.
     Only auth.service.ts#login reads this; every other issuance path ignores
     it and keeps the full-length session. */
  remember?: boolean
}

export interface TokenPair {
  access_token: string
  refresh_token: string
  expires_in: number
}
