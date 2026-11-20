'use client'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/axios'

export interface DiscussionAuthor {
  id:        string
  name:      string
  avatarUrl?: string
  role:      string
  /** A sub admin who also teaches — shown as a mentor. */
  alsoTeaches?: boolean
}

export interface DiscussionThread {
  id:           string
  lessonId:     string
  courseId:     string
  authorId:     DiscussionAuthor | string
  title?:       string
  body:         string
  isPinned:     boolean
  isResolved:   boolean
  upvoteCount:  number
  commentCount: number
  createdAt:    string
}

export interface DiscussionComment {
  id:                 string
  threadId:           string
  authorId:           DiscussionAuthor | string
  body:               string
  parentId?:          string
  upvoteCount:        number
  isInstructorAnswer: boolean
  createdAt:          string
}

export const discussionKeys = {
  threads:  (lessonId: string) => ['discussion', 'threads', lessonId] as const,
  comments: (threadId: string) => ['discussion', 'comments', threadId] as const,
}

export function useThreads(lessonId: string | undefined) {
  return useQuery({
    queryKey: discussionKeys.threads(lessonId ?? ''),
    queryFn: async () => {
      const res = await api.get<{ success: true; data: { threads: DiscussionThread[] } }>(
        `/lessons/${lessonId}/threads`,
        { params: { per_page: 50 } },
      )
      return res.data.data.threads
    },
    enabled: !!lessonId,
    staleTime: 20_000,
  })
}

export function useCreateThread(lessonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { title?: string; body: string }) =>
      api.post(`/lessons/${lessonId}/threads`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: discussionKeys.threads(lessonId ?? '') }),
  })
}

export function useUpvoteThread(lessonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (threadId: string) => api.post(`/threads/${threadId}/upvote`),
    onSuccess: () => qc.invalidateQueries({ queryKey: discussionKeys.threads(lessonId ?? '') }),
  })
}

export function useResolveThread(lessonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ threadId, isResolved }: { threadId: string; isResolved: boolean }) =>
      api.patch(`/threads/${threadId}/resolve`, { isResolved }),
    onSuccess: () => qc.invalidateQueries({ queryKey: discussionKeys.threads(lessonId ?? '') }),
  })
}

export function useDeleteThread(lessonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (threadId: string) => api.delete(`/threads/${threadId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: discussionKeys.threads(lessonId ?? '') }),
  })
}

export function useComments(threadId: string | undefined) {
  return useQuery({
    queryKey: discussionKeys.comments(threadId ?? ''),
    queryFn: async () => {
      const res = await api.get<{ success: true; data: { comments: DiscussionComment[] } }>(
        `/threads/${threadId}/comments`,
      )
      return res.data.data.comments
    },
    enabled: !!threadId,
    staleTime: 15_000,
  })
}

export function useCreateComment(threadId: string | undefined, lessonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { body: string; parentId?: string }) =>
      api.post(`/threads/${threadId}/comments`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: discussionKeys.comments(threadId ?? '') })
      qc.invalidateQueries({ queryKey: discussionKeys.threads(lessonId ?? '') })
    },
  })
}

export function useUpvoteComment(threadId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (commentId: string) => api.post(`/comments/${commentId}/upvote`),
    onSuccess: () => qc.invalidateQueries({ queryKey: discussionKeys.comments(threadId ?? '') }),
  })
}

export function useDeleteComment(threadId: string | undefined, lessonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (commentId: string) => api.delete(`/comments/${commentId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: discussionKeys.comments(threadId ?? '') })
      qc.invalidateQueries({ queryKey: discussionKeys.threads(lessonId ?? '') })
    },
  })
}
