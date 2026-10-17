import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  normalizeAssignment, normalizeSubmittable,
  type ApiSuccess, type AssignmentFile,
} from '@shared'
import { apiGet, http } from '../http'

/* Post-class assignments (/class-assignments — NOT the older lesson-level
   /assignments). Same flow as the website: upload each file through the
   server's /uploads/document (it checks the bytes and stores it on our
   storage), then submit the returned addresses. */

export const assignmentKeys = {
  all:         ['assignments'] as const,
  mine:        ['assignments', 'mine'] as const,
  submittable: ['assignments', 'submittable'] as const,
}

export function useSubmittableClasses() {
  return useQuery({
    queryKey: assignmentKeys.submittable,
    queryFn:  async () => (await apiGet<unknown[]>('/class-assignments/submittable')).map(normalizeSubmittable),
    staleTime: 60_000,
  })
}

export function useMyAssignments() {
  return useQuery({
    queryKey: assignmentKeys.mine,
    queryFn:  async () => (await apiGet<unknown[]>('/class-assignments/me')).map(normalizeAssignment),
    staleTime: 15_000,
  })
}

/** A file the student picked, before it is uploaded. */
export interface PickedFile { uri: string; name: string; mimeType: string; size?: number }

/* A phone upload of up to 10 MB on a slow connection needs far longer than
   the 15 s every other request gets. */
const UPLOAD_TIMEOUT_MS = 120_000

export async function uploadFile(f: PickedFile): Promise<AssignmentFile> {
  const form = new FormData()
  /* React Native's FormData takes a { uri, name, type } descriptor and
     streams the file from disk. */
  form.append('file', { uri: f.uri, name: f.name, type: f.mimeType } as unknown as Blob)
  const res = await http.post<ApiSuccess<{ url: string; size?: number }>>('/uploads/document', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: UPLOAD_TIMEOUT_MS,
  })
  return { url: res.data.data.url, name: f.name, mimeType: f.mimeType, sizeBytes: res.data.data.size ?? f.size ?? 0 }
}

function useInvalidate() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: assignmentKeys.all })
}

export function useSubmitAssignment() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: async (input: { liveClassId: string; title: string; note?: string; files: AssignmentFile[] }) =>
      normalizeAssignment((await http.post<ApiSuccess<unknown>>('/class-assignments', input)).data.data),
    onSuccess: invalidate,
  })
}

export function useResubmitAssignment() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: async ({ id, ...body }: { id: string; note?: string; files: AssignmentFile[] }) =>
      normalizeAssignment((await http.post<ApiSuccess<unknown>>(`/class-assignments/${id}/resubmit`, body)).data.data),
    onSuccess: invalidate,
  })
}
