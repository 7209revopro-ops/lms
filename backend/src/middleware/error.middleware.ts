import type { Request, Response, NextFunction } from 'express'
import { ZodError } from 'zod'
import { logger } from '@/utils/logger.ts'
import { sendError } from '@/utils/response.ts'
import { AuthError } from '@/services/auth.service.ts'
import { CourseError } from '@/services/course.service.ts'
import { EnrollmentError } from '@/services/enrollment.service.ts'
import { ReviewError } from '@/services/review.service.ts'
import { CategoryError } from '@/services/category.service.ts'
import { LiveClassError } from '@/services/liveClass.service.ts'
import { NotificationError } from '@/services/notification.service.ts'
import { FavoriteError } from '@/services/favorite.service.ts'
import { OutlineError } from '@/services/section.service.ts'
import { UserError } from '@/services/user.service.ts'
import { QuizError } from '@/services/quiz.service.ts'
import { AssignmentError } from '@/services/assignment.service.ts'
import { ClassAssignmentError } from '@/services/classAssignment.service.ts'
import { CertificateError } from '@/services/certificate.service.ts'
import { OrderError } from '@/services/order.service.ts'
import { CouponError } from '@/services/coupon.service.ts'
import { DiscussionError } from '@/services/discussion.service.ts'
import { NoteError } from '@/services/note.service.ts'
import { BookmarkError } from '@/services/bookmark.service.ts'
import { LearningPathError } from '@/services/learningpath.service.ts'
import { AIError } from '@/services/ai.service.ts'
import { SupportError } from '@/services/support.service.ts'
import { TotpError } from '@/services/totp.service.ts'
import { TranscriptError } from '@/services/transcript.service.ts'
import { PortalError } from '@/services/portal.service.ts'

/* ─────────────────────────────────────────────────────
   Global error handler
   ─────────────────────────────────────────────────────
   Must be registered LAST (after all routes) with 4 args.
   Catches all errors thrown/passed to next(err).
───────────────────────────────────────────────────── */
export function errorMiddleware(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  /* ── A value that cannot be an id is a BAD REQUEST, not a server fault ──
     Mongoose throws a CastError when a non-ObjectId reaches findById or a
     query on an ObjectId path. It is not one of the domain error classes
     below, so it fell all the way through to the generic handler: a mistyped
     URL answered 500 "An unexpected error occurred" and logged a stack trace.

     B-06 fixed this in BaseRepository, which covers every repository — but a
     dozen services call the Mongoose models directly (quiz, assignment,
     certificate, auth), and those bypassed it entirely. Handling the error
     class itself is the only place that covers all of them, including the
     next one somebody writes.

     404 rather than 400: the caller asked for a thing that cannot exist, and
     answering "not found" avoids distinguishing a malformed id from a real
     one that is simply absent.

     There are TWO error shapes, and catching only the first is why the initial
     version of this branch changed nothing for quizzes and assignments:

       • CastError  — Mongoose casting a bad value for a query path.
       • BSONError  — the driver rejecting `new Types.ObjectId(bad)`, which is
                      what services do when they build the id themselves.
                      Message: "input must be a 24 character hex string…".
                      Older driver versions call it BSONTypeError.

     The second was found by catching a real one and printing its constructor,
     rather than by assuming which class Mongoose throws. */
  const errName = err && typeof err === 'object' ? (err as { name?: string }).name : undefined
  if (errName === 'CastError' || errName === 'BSONError' || errName === 'BSONTypeError') {
    const path = (err as { path?: string }).path ?? 'id'
    logger.debug({ err, path, url: req.originalUrl }, 'Malformed identifier rejected')
    sendError(res, 'NOT_FOUND', `No record matches that ${path}.`, 404)
    return
  }

  /* ── Domain errors (auth, business logic) ──────── */
  if (err instanceof PortalError) {
    sendError(res, err.code, err.message, err.statusCode)
    return
  }
  if (err instanceof AuthError) {
    sendError(res, err.code, err.message, err.statusCode)
    return
  }
  if (err instanceof CourseError) {
    sendError(res, err.code, err.message, err.statusCode)
    return
  }
  if (err instanceof EnrollmentError) {
    sendError(res, err.code, err.message, err.statusCode)
    return
  }
  if (err instanceof ReviewError) {
    sendError(res, err.code, err.message, err.statusCode)
    return
  }
  if (err instanceof CategoryError) {
    sendError(res, err.code, err.message, err.statusCode)
    return
  }
  if (err instanceof LiveClassError) {
    sendError(res, err.code, err.message, err.statusCode)
    return
  }
  if (err instanceof NotificationError) {
    sendError(res, err.code, err.message, err.statusCode)
    return
  }
  if (err instanceof SupportError) {
    sendError(res, err.code, err.message, err.statusCode)
    return
  }
  if (err instanceof FavoriteError) {
    sendError(res, err.code, err.message, err.statusCode)
    return
  }
  if (err instanceof OutlineError) {
    sendError(res, err.code, err.message, err.statusCode)
    return
  }
  if (err instanceof UserError) {
    sendError(res, err.code, err.message, err.statusCode)
    return
  }
  if (err instanceof QuizError) {
    sendError(res, err.code, err.message, err.statusCode)
    return
  }
  if (err instanceof AssignmentError) {
    sendError(res, err.code, err.message, err.statusCode)
    return
  }
  if (err instanceof ClassAssignmentError) {
    sendError(res, err.code, err.message, err.statusCode)
    return
  }
  if (err instanceof CertificateError) {
    sendError(res, err.code, err.message, err.statusCode)
    return
  }
  if (err instanceof OrderError) {
    sendError(res, err.code, err.message, err.statusCode)
    return
  }
  if (err instanceof DiscussionError) {
    sendError(res, err.code, err.message, err.statusCode)
    return
  }
  if (err instanceof NoteError) {
    sendError(res, err.code, err.message, err.statusCode)
    return
  }
  if (err instanceof BookmarkError) {
    sendError(res, err.code, err.message, err.statusCode)
    return
  }
  if (err instanceof LearningPathError) {
    sendError(res, err.code, err.message, err.statusCode)
    return
  }
  if (err instanceof CouponError) {
    sendError(res, err.code, err.message, err.statusCode)
    return
  }
  if (err instanceof AIError) {
    sendError(res, err.code, err.message, err.statusCode)
    return
  }
  if (err instanceof TotpError) {
    sendError(res, err.code, err.message, err.statusCode)
    return
  }
  if (err instanceof TranscriptError) {
    sendError(res, err.code, err.message, err.statusCode)
    return
  }

  /* ── Zod validation errors (from service layer) ── */
  if (err instanceof ZodError) {
    sendError(res, 'VALIDATION_ERROR', 'Validation failed', 422, err.issues)
    return
  }

  /* ── CORS errors ───────────────────────────────── */
  if (err instanceof Error && err.message.startsWith('CORS:')) {
    sendError(res, 'CORS_ERROR', err.message, 403)
    return
  }

  /* ── Malformed or oversized request bodies ─────────
     body-parser rejects these before any route sees them, and it already
     decides the right status: 400 for JSON it cannot parse, 413 for a body
     over the limit. Without this they fell through to the catch-all and were
     reported as 500 — a client sending "{bad" was recorded as a server fault,
     which is both wrong and the kind of thing that pages someone at 3am for
     no reason. */
  {
    const e = err as { type?: string; status?: number; statusCode?: number }
    const status = e.status ?? e.statusCode
    if (typeof e.type === 'string' && e.type.startsWith('entity.')
        && typeof status === 'number' && status >= 400 && status < 500) {
      sendError(
        res,
        e.type === 'entity.too.large' ? 'PAYLOAD_TOO_LARGE' : 'INVALID_JSON',
        e.type === 'entity.too.large'
          ? 'Request body is too large.'
          : 'Request body is not valid JSON.',
        status,
      )
      return
    }
  }

  /* ── Unknown errors ────────────────────────────── */
  logger.error(
    {
      err,
      method: req.method,
      url:    req.url,
      ip:     req.ip,
    },
    'Unhandled error',
  )

  const isDev = process.env.NODE_ENV === 'development'
  sendError(
    res,
    'INTERNAL_ERROR',
    isDev && err instanceof Error ? err.message : 'An unexpected error occurred',
    500,
    isDev && err instanceof Error ? err.stack : undefined,
  )
}

/* ─── 404 handler ───────────────────────────────────
   Register before errorMiddleware to catch unknown routes
───────────────────────────────────────────────────── */
export function notFoundMiddleware(req: Request, res: Response): void {
  sendError(res, 'NOT_FOUND', `Route ${req.method} ${req.path} not found`, 404)
}
