'use client'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/axios'

export interface AdminStats {
  totalCourses:     number
  publishedCourses: number
  draftCourses:     number
  totalStudents:    number
  totalInstructors: number
  totalEnrollments: number
  totalReviews:     number
  /** null for a department's sub_admin — revenue is admin-only. */
  revenueEstimate:  number | null
}

export function useAdminStats() {
  return useQuery({
    queryKey: ['admin', 'stats'],
    queryFn: async () => {
      const res = await api.get<{ success: true; data: AdminStats }>('/admin/stats')
      return res.data.data
    },
    staleTime: 30_000,
  })
}

/* ─── Analytics extensions ─────────────────────── */
export interface EnrollmentsTimeseriesPoint { date: string; count: number }
export interface TopCourse {
  id: string
  title: string
  slug: string
  enrolledCount: number
  ratingAvg: number
  thumbnailUrl?: string
}
export interface CompletionStats {
  totalEnrollments: number
  completed:        number
  active:           number
  dropped:          number
  completionRate:   number
}

export function useEnrollmentsTimeseries(days = 30) {
  return useQuery({
    queryKey: ['admin', 'analytics', 'enrollments', days],
    queryFn: async () => {
      const res = await api.get<{ success: true; data: EnrollmentsTimeseriesPoint[] }>(
        '/admin/analytics/enrollments', { params: { days } },
      )
      return res.data.data
    },
    staleTime: 60_000,
  })
}

export function useTopCourses(limit = 5) {
  return useQuery({
    queryKey: ['admin', 'analytics', 'top-courses', limit],
    queryFn: async () => {
      const res = await api.get<{ success: true; data: TopCourse[] }>(
        '/admin/analytics/top-courses', { params: { limit } },
      )
      return res.data.data
    },
    staleTime: 60_000,
  })
}

export function useCompletionStats() {
  return useQuery({
    queryKey: ['admin', 'analytics', 'completion'],
    queryFn: async () => {
      const res = await api.get<{ success: true; data: CompletionStats }>(
        '/admin/analytics/completion',
      )
      return res.data.data
    },
    staleTime: 60_000,
  })
}

/* ─── Revenue analytics ──────────────────────────── */
export interface RevenueTimeseriesPoint { date: string; amount: number }  // cents

export function useRevenueTimeseries(days = 30) {
  return useQuery({
    queryKey: ['admin', 'analytics', 'revenue', days],
    queryFn: async () => {
      const res = await api.get<{ success: true; data: RevenueTimeseriesPoint[] }>(
        '/admin/analytics/revenue', { params: { days } },
      )
      return res.data.data
    },
    staleTime: 60_000,
  })
}

/* ─── Admin orders ───────────────────────────────── */
export interface AdminOrder {
  id:                      string
  userId:                  string | { id: string; name: string; email: string }
  courseId:                string | { id: string; title: string; slug: string }
  amount:                  number   // cents
  currency:                string
  status:                  'pending' | 'paid' | 'refunded' | 'cancelled'
  gateway:                 'stripe' | 'razorpay' | 'abzer' | 'tamara' | 'tabby'
  discountAmount:          number
  stripePaymentIntentId?:  string
  stripeInvoiceUrl?:       string
  refundedAt?:             string
  createdAt:               string
}

export function useAdminOrders(page = 1, status = 'all', gateway = 'all') {
  return useQuery({
    queryKey: ['admin', 'orders', page, status, gateway],
    queryFn: async () => {
      const res = await api.get<{ success: true; data: AdminOrder[]; meta: any }>(
        '/admin/orders', { params: { page, per_page: 20, status, gateway } },
      )
      return { orders: res.data.data, meta: res.data.meta }
    },
    staleTime: 30_000,
  })
}

export interface GatewayBreakdownRow {
  gateway:    string
  total:      number
  paid:       number
  pending:    number
  refunded:   number
  cancelled:  number
  paidAmount: number
  currency:   string
}

/* Which gateways have EVER recorded an order.

   A paginated list sorted by date cannot answer "is Abzer recording anything"
   — a gateway with a few older orders simply never reaches page one, and its
   absence from the screen reads as its absence from the system. This counts
   the whole collection, and deliberately ignores the status and gateway tabs
   so the answer does not move when you click one. */
export function useGatewayBreakdown() {
  return useQuery({
    queryKey: ['admin', 'orders', 'by-gateway'],
    queryFn: async () => {
      const res = await api.get<{ success: true; data: GatewayBreakdownRow[] }>('/admin/orders/by-gateway')
      return res.data.data
    },
    staleTime: 30_000,
  })
}

/* ─── Admin coupons ──────────────────────────────── */
export interface AdminCoupon {
  id:            string
  code:          string
  discountType:  'percent' | 'fixed'
  discountValue: number
  /* For discountType 'fixed', the currency discountValue is denominated in —
     the owning academy's, stamped by the backend at create time (N-01). */
  currency?:     'AED' | 'INR'
  maxUses:       number
  usedCount:     number
  expiresAt?:    string | null
  isActive:      boolean
  appliesTo:     string[]
  createdAt:     string
}

export function useAdminCoupons(page = 1) {
  return useQuery({
    queryKey: ['admin', 'coupons', page],
    queryFn: async () => {
      const res = await api.get<{ success: true; data: AdminCoupon[]; meta: any }>(
        '/admin/coupons', { params: { page, per_page: 20 } },
      )
      return { coupons: res.data.data, meta: res.data.meta }
    },
    staleTime: 30_000,
  })
}

/* ─── Admin learning paths (6.6) ─────────────────── */
export interface AdminLearningPathCourse {
  courseId:       string | { id: string; title: string; slug: string; thumbnailUrl?: string }
  order:          number
  isPrerequisite: boolean
}

export interface AdminLearningPath {
  id:             string
  title:          string
  slug:           string
  description?:   string
  thumbnailUrl?:  string
  instructorId:   string | { id: string; name: string }
  status:         'draft' | 'published'
  courses:        AdminLearningPathCourse[]
  enrolledCount:  number
  createdAt:      string
}

export function useAdminLearningPaths(page = 1) {
  return useQuery({
    queryKey: ['admin', 'learning-paths', page],
    queryFn: async () => {
      /* Backend returns { success, data: { paths: [...], meta: {...} } } */
      const res = await api.get<{ success: true; data: { paths: AdminLearningPath[]; meta: any } }>(
        '/learning-paths/admin/list', { params: { page, per_page: 20 } },
      )
      return { paths: res.data.data.paths, meta: res.data.data.meta }
    },
    staleTime: 30_000,
  })
}

export function useCreateLearningPath() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Partial<AdminLearningPath> & { title: string }) =>
      api.post('/learning-paths', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'learning-paths'] }),
  })
}

export function useUpdateLearningPath() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...data }: Partial<AdminLearningPath> & { id: string }) =>
      api.patch(`/learning-paths/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'learning-paths'] }),
  })
}

export function useDeleteLearningPath() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.delete(`/learning-paths/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'learning-paths'] }),
  })
}
