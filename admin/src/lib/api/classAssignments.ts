'use client'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/axios'
import type { TetraCs } from '@/lib/api/tetraCs'

/* ─────────────────────────────────────────────────────
   Post-class assignments — the reviewer's side.

   Prefix is /class-assignments. The older /assignments routes belong to the
   lesson-level assignment feature and are unrelated.

   Query keys are namespaced under 'admin' per the repo convention, so this
   cache can never collide with the student app's ['classAssignments', …].
───────────────────────────────────────────────────── */

export type ClassAssignmentStatus = 'pending' | 'approved' | 'rejected'

export interface AssignmentFile {
  url:       string
  name:      string
  mimeType:  string
  sizeBytes: number
}

export interface AssignmentReview {
  status:     ClassAssignmentStatus
  reason?:    string
  attempt:    number
  reviewedAt: string
}

interface Ref { id: string; title?: string; name?: string; email?: string; avatarUrl?: string; scheduledStart?: string; tetraCs?: TetraCs | null }

export interface ReviewAssignment {
  id:           string
  title:        string
  note?:        string
  files:        AssignmentFile[]
  status:       ClassAssignmentStatus
  attempt:      number
  lastReason?:  string
  submittedAt:  string
  reviewedAt?:  string
  reviews:      AssignmentReview[]
  studentId?:    Ref
  instructorId?: Ref
  liveClassId?:  Ref
  courseId?:     Ref
  sectionId?:    Ref
}

/* ── The review dashboard ──────────────────────────────
   Response time is a MEDIAN. A mean is destroyed by one abandoned submission:
   a single row left for three weeks makes an instructor who answers everything
   else within the hour read as negligent, and the figure stops supporting the
   comparison it exists for.

   `approvalRate` and `medianResponseHours` are null — not 0 — for an
   instructor who has judged nothing yet. 0% would say "approves nothing",
   which is a different and much worse claim than "has not started". */
export interface InstructorPerformance {
  id:        string
  name:      string
  email:     string
  avatarUrl?: string
  total:     number
  pending:   number
  approved:  number
  rejected:  number
  approvalRate:        number | null
  medianResponseHours: number | null
  oldestPendingHours:  number | null
}

export interface ReviewStats {
  totals: { total: number; pending: number; approved: number; rejected: number }
  responsiveness: {
    medianResponseHours: number | null
    oldestPendingHours:  number | null
    pendingOver48h:      number
  }
  instructors: InstructorPerformance[]
}

export const classAssignmentKeys = {
  all:    ['admin', 'classAssignments'] as const,
  queue:  (status: string, instructorId?: string) =>
    ['admin', 'classAssignments', 'queue', status, instructorId ?? 'any'] as const,
  stats:  (instructorId?: string) =>
    ['admin', 'classAssignments', 'stats', instructorId ?? 'any'] as const,
}

function withId(o: any) { return o ? { ...o, id: o.id ?? o._id } : o }
function normalize(a: any): ReviewAssignment {
  return {
    ...a,
    id:          a.id ?? a._id,
    files:       a.files ?? [],
    reviews:     a.reviews ?? [],
    studentId:    withId(a.studentId),
    instructorId: withId(a.instructorId),
    liveClassId:  withId(a.liveClassId),
    courseId:    withId(a.courseId),
    sectionId:   withId(a.sectionId),
  }
}

/* ── The review queue ────────────────────────────────
   Instructors get only their own sessions and staff only their own academy;
   that scoping is the API's job, not a query param this screen can widen. */
export function useReviewQueue(
  status: 'all' | ClassAssignmentStatus = 'pending',
  instructorId?: string,
) {
  return useQuery({
    queryKey: classAssignmentKeys.queue(status, instructorId),
    queryFn:  async () => {
      const res = await api.get<{ success: true; data: any[] }>('/class-assignments/review', {
        params: {
          ...(status === 'all' ? {} : { status }),
          ...(instructorId ? { instructorId } : {}),
        },
      })
      return res.data.data.map(normalize)
    },
    staleTime: 15_000,
  })
}

/* Totals, how long students are waiting, and the same figures per instructor.

   Deliberately a SEPARATE request from the queue rather than counting the rows
   this screen already has. The queue is capped at 200 and filtered by the
   status tab, so counting it would report "3 awaiting review" while meaning
   "3 on this page of this tab" — a number that changes when you click a tab
   and is wrong the moment the backlog is real. The API counts every row in
   the caller's reach, using the same scoping helper the queue does. */
export function useReviewStats(instructorId?: string) {
  return useQuery({
    queryKey: classAssignmentKeys.stats(instructorId),
    queryFn:  async () => {
      const res = await api.get<{ success: true; data: ReviewStats }>(
        '/class-assignments/review/stats',
        { params: instructorId ? { instructorId } : {} },
      )
      return res.data.data
    },
    staleTime: 15_000,
  })
}

/* ── Approve / send back ─────────────────────────────── */
export function useReviewAssignment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, decision, reason }: {
      id:       string
      decision: 'approved' | 'rejected'
      reason?:  string
    }) => {
      const res = await api.patch<{ success: true; data: any }>(
        `/class-assignments/${id}/review`, { decision, reason },
      )
      return normalize(res.data.data)
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: classAssignmentKeys.all }) },
  })
}
