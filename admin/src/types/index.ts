export type CourseStatus = 'draft' | 'published' | 'archived'
export type CourseLevel  = 'beginner' | 'intermediate' | 'advanced'

export interface Course {
  /** The academy that owns this course. The cross-academy form needs it: the
      server resolves a class's host academy as the caller's, falling back to
      the course's, so without this the form cannot tell which academy to leave
      OUT of the guest list. */
  organizationId?: string
  id:            string
  title:         string
  slug:          string
  description?:  string
  thumbnailUrl?: string
  previewUrl?:   string
  price:         number
  priceAED?:     number
  priceINR?:     number
  isFree:        boolean
  status:        CourseStatus
  level?:        CourseLevel
  durationMins:  number
  language:      string
  tags?:         string[]
  instructorId:  string
  categoryId?:   string
  enrolledCount: number
  ratingAvg:     number
  ratingCount:   number
  lessonCount?:  number
  createdAt:     string
  updatedAt:     string
  program?:    '4x-trading' | 'digital-marketing' | 'ai' | 'jura'
  /* populated */
  instructor?: { id: string; name: string; avatarUrl?: string }
  category?:   { id: string; name: string }
}

export interface CourseFormValues {
  title:        string
  slug:         string
  description:  string
  thumbnailUrl: string
  previewUrl:   string
  price:        number
  priceAED?:    number
  priceINR?:    number
  isFree:       boolean
  status:       CourseStatus
  level:        CourseLevel | ''
  language:     string
  tags:         string
  categoryId:   string
  program:      '4x-trading' | 'digital-marketing' | 'ai' | 'jura' | ''
  /** Which academy owns the course. Super admins choose; others inherit. */
  organizationId?: string
}

export interface Category { id: string; name: string; slug: string }

export interface PaginationMeta {
  total_count: number
  page:        number
  per_page:    number
  total_pages: number
  has_next:    boolean
  has_prev:    boolean
}

export interface ApiSuccess<T> { success: true; data: T; message?: string; meta?: PaginationMeta }
export interface ApiError      { success: false; error: { code: string; message: string } }
export type ApiResponse<T>     = ApiSuccess<T> | ApiError
