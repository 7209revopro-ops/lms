import { Router, type Request, type Response, type NextFunction } from 'express'
import { Types } from 'mongoose'
import path from 'path'
import fs from 'fs'
import { authenticateAny } from '@/middleware/auth.middleware.ts'
import { sendSuccess } from '@/utils/response.ts'
import { UserModel } from '@/models/schema.ts'
import { mayAccessStudent } from '@/utils/departmentScope.ts'
import {
  isR2Configured,
  keyFromUrl,
  generatePresignedGetUrl,
  KYC_PREFIX,
} from '@/services/r2.service.ts'

/* ─────────────────────────────────────────────────────
   Authorised reads of identity documents  (H-11)
   ─────────────────────────────────────────────────────
   Passport and national-ID scans used to be served from permanent public URLs
   with `immutable` caching — anyone holding the link could read them forever,
   and nothing could revoke it. They now live under the `kyc/` prefix, which
   app.ts refuses to serve statically, and are reachable only through here.

   Who may read a document:
     • the person it belongs to
     • admin-portal staff, confined to their own academy
       (super_admin is unscoped, matching every other tenancy guard)

   The response is a signed link valid for five minutes, never the raw storage
   key — so a link that leaks into a log, a chat or a browser history stops
   working on its own.

   The profile photo is deliberately NOT gated: it doubles as `avatarUrl` and
   is rendered in ~47 places across both apps.
───────────────────────────────────────────────────── */

const router = Router()

const SIGNED_URL_TTL_SECONDS = 300

/** Field name in the URL → the property that stores it. */
const FIELDS = {
  passport: 'passportUrl',
  idDoc:    'idDocUrl',
} as const
type DocField = keyof typeof FIELDS

const STAFF_ROLES = new Set([
  'super_admin', 'admin', 'sub_admin', 'support',
])

/* GET /documents/:userId/:field  →  { url, expiresIn } */
router.get(
  '/:userId/:field',
  authenticateAny,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const targetId = String(req.params['userId'] ?? '')
      const field    = String(req.params['field'] ?? '') as DocField

      if (!(field in FIELDS)) {
        res.status(400).json({
          success: false,
          error: { code: 'INVALID_FIELD', message: 'Unknown document field.' },
        }); return
      }
      if (!Types.ObjectId.isValid(targetId)) {
        res.status(400).json({
          success: false,
          error: { code: 'INVALID_ID', message: 'Invalid user id.' },
        }); return
      }

      const caller  = req.user!
      const isOwner = caller.id === targetId
      const isStaff = STAFF_ROLES.has(caller.role)

      /* Neither the owner nor staff — refuse without confirming the id exists. */
      if (!isOwner && !isStaff) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Document not found.' },
        }); return
      }

      const target = await UserModel.findById(targetId)
        .select('organizationId enrollmentApplication enrollmentStatus category categories')
        .lean()
        .exec()

      if (!target) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Document not found.' },
        }); return
      }

      /* Tenancy — staff are confined to their own academy.

         The caller's academy is re-read from the database rather than taken
         from req.user. That was once load-bearing: authenticateAny did not
         populate organizationId, so trusting it left the field undefined, the
         comparison below fell through, and a neighbouring academy's admin
         could read the scans (N-07).

         P-06 closed that at the source — authenticateAny now resolves the
         account through loadAccountState on every request, so req.user
         .organizationId is itself a fresh database value and this read is no
         longer the only thing standing between the two academies. It is kept
         deliberately: one indexed lookup on a rarely-hit route, and the guard
         no longer depends on a middleware three files away continuing to
         behave. Reverting either layer alone leaves the other holding;
         `bun run test:kyc` pins the outcome rather than the mechanism.

         A missing caller record means the account was deleted while its token
         is still live, and is denied outright. */
      if (isStaff && !isOwner && caller.role !== 'super_admin') {
        const self = await UserModel.findById(caller.id).select('organizationId').lean().exec()
        if (!self) {
          res.status(404).json({
            success: false,
            error: { code: 'NOT_FOUND', message: 'Document not found.' },
          }); return
        }
        const callerOrg = (self as { organizationId?: unknown }).organizationId
        const targetOrg = (target as { organizationId?: unknown }).organizationId
        if (callerOrg && targetOrg && String(callerOrg) !== String(targetOrg)) {
          res.status(404).json({
            success: false,
            error: { code: 'NOT_FOUND', message: 'Document not found.' },
          }); return
        }
      }

      /* Department — a sub_admin reads the scans of their own department's
         students and applicants only (plan.md §10), with the same 404. */
      if (!isOwner && !(await mayAccessStudent(req, target as Parameters<typeof mayAccessStudent>[1]))) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Document not found.' },
        }); return
      }
      const app      = (target as { enrollmentApplication?: Record<string, string> }).enrollmentApplication
      const storedUrl = app?.[FIELDS[field]]
      if (!storedUrl) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Document not found.' },
        }); return
      }

      const key = keyFromUrl(storedUrl)
      if (!key) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Document not found.' },
        }); return
      }

      /* Legacy rows still point at a public `documents/` object. Hand the
         stored URL back so nothing breaks before the migration has run —
         `bun run migrate-kyc` relocates them under kyc/. */
      if (!key.startsWith(KYC_PREFIX)) {
        sendSuccess(res, { url: storedUrl, expiresIn: null, legacy: true })
        return
      }

      if (isR2Configured()) {
        const url = await generatePresignedGetUrl(key, SIGNED_URL_TTL_SECONDS)
        sendSuccess(res, { url, expiresIn: SIGNED_URL_TTL_SECONDS, legacy: false })
        return
      }

      /* Local-disk storage has nothing to sign against, so stream the bytes
         through this already-authorised request instead. */
      const abs = path.join(process.cwd(), 'uploads', key)
      const root = path.join(process.cwd(), 'uploads')
      if (!abs.startsWith(root + path.sep) || !fs.existsSync(abs)) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Document not found.' },
        }); return
      }
      res.setHeader('Cache-Control', 'private, no-store')
      res.sendFile(abs)
    } catch (err) { next(err) }
  },
)

export default router
