import { Router, type Request, type Response } from 'express'
import mongoose from 'mongoose'
import { apiRateLimit } from '@/middleware/rateLimit.middleware.ts'
import authRoutes          from './auth.routes.ts'
import courseRoutes        from './courses.routes.ts'
import categoryRoutes      from './categories.routes.ts'
import enrollmentRoutes    from './enrollments.routes.ts'
import lessonRoutes        from './lessons.routes.ts'
import reviewRoutes        from './reviews.routes.ts'
import adminRoutes         from './admin.routes.ts'
import liveClassRoutes     from './liveClasses.routes.ts'
import notificationRoutes  from './notifications.routes.ts'
import favoriteRoutes      from './favorites.routes.ts'
import achievementRoutes   from './achievements.routes.ts'
import quizRoutes          from './quizzes.routes.ts'
import examRoutes          from './exams.routes.ts'
import assignmentRoutes    from './assignments.routes.ts'
import certificateRoutes   from './certificates.routes.ts'
import streakRoutes        from './streaks.routes.ts'
import couponRoutes        from './coupons.routes.ts'
import checkoutRoutes      from './checkout.routes.ts'
import webhookRoutes       from './webhooks.routes.ts'
import integrationRoutes   from './integrations.routes.ts'
import orderRoutes         from './orders.routes.ts'
import discussionRoutes    from './discussion.routes.ts'
import notesRoutes         from './notes.routes.ts'
import bookmarksRoutes     from './bookmarks.routes.ts'
import learningPathRoutes  from './learningpaths.routes.ts'
import aiRoutes            from './ai.routes.ts'
import auditLogRoutes      from './auditlog.routes.ts'
import uploadRoutes        from './upload.routes.ts'
import bookingRoutes       from './bookings.routes.ts'
import feedbackRoutes      from './feedback.routes.ts'
import supportRoutes       from './support.routes.ts'
import instructorRoutes   from './instructors.routes.ts'
import documentRoutes    from './documents.routes.ts'
import classAssignmentRoutes from './classAssignments.routes.ts'
import portalRoutes        from './portal.routes.ts'

const router = Router()

/* ─── Global API rate limit ──────────────────────── */
router.use(apiRateLimit)

/* ─── Health check ───────────────────────────────── */
router.get('/health', (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      status:    'ok',
      timestamp: new Date().toISOString(),
    },
  })
})

/* ─── Readiness probe (8.15) ─────────────────────
   Returns 200 only when the DB connection is open.
   K8s / docker-compose healthcheck: GET /api/v1/ready
───────────────────────────────────────────────── */
router.get('/ready', async (_req: Request, res: Response) => {
  const dbState = mongoose.connection.readyState // 1 = connected
  if (dbState !== 1) {
    res.status(503).json({ success: false, error: { code: 'NOT_READY', message: 'Database not connected' } })
    return
  }
  try {
    await mongoose.connection.db!.admin().ping()
    res.json({ success: true, data: { status: 'ready', db: 'connected' } })
  } catch {
    res.status(503).json({ success: false, error: { code: 'NOT_READY', message: 'Database ping failed' } })
  }
})

/* ─── Domain routers ─────────────────────────────── */
router.use('/auth',        authRoutes)
/* Server-to-server, from the Root portal. A shared secret, not a session. */
router.use('/service',     portalRoutes)
router.use('/courses',     courseRoutes)
router.use('/categories',  categoryRoutes)
router.use('/enrollments', enrollmentRoutes)
router.use('/lessons',     lessonRoutes)
router.use('/reviews',     reviewRoutes)
router.use('/admin',         adminRoutes)
router.use('/live-classes',  liveClassRoutes)
router.use('/notifications', notificationRoutes)
router.use('/favorites',     favoriteRoutes)
router.use('/achievements',  achievementRoutes)
router.use('/quizzes',       quizRoutes)
router.use('/exams',         examRoutes)
router.use('/assignments',   assignmentRoutes)
router.use('/certificates',  certificateRoutes)
router.use('/streaks',       streakRoutes)
router.use('/coupons',         couponRoutes)
router.use('/checkout',        checkoutRoutes)
router.use('/webhooks',        webhookRoutes)
router.use('/integrations',    integrationRoutes)
router.use('/orders',          orderRoutes)
/* 6.1 Q&A — thread/comment routes are nested under /lessons & /threads */
router.use('/',                discussionRoutes)
/* 6.4 Notes */
router.use('/',                notesRoutes)
/* 6.5 Bookmarks */
router.use('/',                bookmarksRoutes)
/* 6.6 Learning paths */
router.use('/learning-paths',  learningPathRoutes)
/* 7.x AI features */
router.use('/ai',              aiRoutes)
/* 8.11 Audit log */
router.use('/audit-logs',      auditLogRoutes)
/* Media uploads (image / video) */
router.use('/uploads',         uploadRoutes)
/* Class bookings (Phase 3) */
router.use('/bookings',        bookingRoutes)
/* Class feedback */
router.use('/feedback',        feedbackRoutes)
/* Help / Contact-us support tickets */
router.use('/support',         supportRoutes)
/* Public instructor list (for client-side mentor filter) */
router.use('/instructors',     instructorRoutes)
/* Authorised reads of identity documents (H-11) */
router.use('/documents',       documentRoutes)
/* Post-class assignments: student submits, instructor approves or sends back.
   Mounted at /class-assignments, NOT /assignments — that prefix already
   belongs to the lesson-level assignment feature above. */
router.use('/class-assignments', classAssignmentRoutes)

export default router
