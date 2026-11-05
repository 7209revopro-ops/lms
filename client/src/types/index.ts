export type CourseStatus = 'draft' | 'published' | 'archived'
export type CourseLevel  = 'beginner' | 'intermediate' | 'advanced'

export interface Course {
  id:            string
  title:         string
  slug:          string
  description?:  string
  thumbnailUrl?: string
  previewUrl?:   string
  price:         number
  /* Resolved by the backend for paid courses: explicit override or USD × rate.
     These are the exact amounts the AED (Abzer) / INR (Razorpay) checkouts
     charge — display them, never recompute locally. */
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
  instructor?: { id: string; name: string; avatarUrl?: string }
  category?:   { id: string; name: string }
  program?:    '4x-trading' | 'digital-marketing' | 'ai' | 'jura' | 'cma'
}

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
