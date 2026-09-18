/* ─────────────────────────────────────────────────────
   Handing a class entry across to CLT Connect
   ─────────────────────────────────────────────────────
   The browser is redirected to the meeting platform carrying a short opaque
   code. CLT exchanges that code with us over the existing HMAC channel and
   receives a freshly minted ticket. Nothing bearer-shaped ever appears in a
   URL, and nothing bearer-shaped is stored.

     issueHandoff()    called by the LMS when someone clicks Join
     exchangeHandoff() called by CLT, once, over S2S

   The authorisation decision is made in exchangeHandoff, not issueHandoff.
   That is deliberate: issuing merely records an intent, and re-checking at the
   moment of use means a class cancelled, a booking withdrawn or an account
   disabled in the intervening seconds is honoured rather than raced.
───────────────────────────────────────────────────── */
import { createHash, randomBytes } from 'node:crypto'
import { Types } from 'mongoose'
import { ClassHandoffModel, type ClassHandoffKind } from '@/models/schema.ts'
import { JoinError, mintHostTicket, mintStudentTicket, type JoinContext } from '@/services/liveClassJoin.service.ts'
import { meetingDisplayName } from '@/utils/meetingIdentity.ts'
import { logger } from '@/utils/logger.ts'

/* Long enough that guessing is hopeless, short enough to sit in a URL. */
const CODE_BYTES = 32

/* The window between clicking Join and CLT asking about it. Generous enough
   for a slow page load on a bad connection, far shorter than a class. */
export const HANDOFF_TTL_SEC = 120

const hash = (code: string) => createHash('sha256').update(code).digest('hex')

export interface IssuedHandoff {
  code:      string
  expiresIn: number
}

/** Record the intent to enter a class and return the one-time code. */
export async function issueHandoff(
  liveClassId: string,
  userId: string,
  kind: ClassHandoffKind,
  opts: { visible?: boolean } = {},
): Promise<IssuedHandoff> {
  if (!Types.ObjectId.isValid(liveClassId)) {
    throw new JoinError('INVALID_ID', 'Invalid class id', 400)
  }
  const code = randomBytes(CODE_BYTES).toString('base64url')
  await ClassHandoffModel.create({
    codeHash:    hash(code),
    liveClassId: new Types.ObjectId(liveClassId),
    userId:      new Types.ObjectId(userId),
    kind,
    ...(kind === 'host' ? { visible: !!opts.visible } : {}),
    expiresAt:   new Date(Date.now() + HANDOFF_TTL_SEC * 1000),
  })
  logger.info({ liveClassId, userId, kind }, 'class handoff issued')
  return { code, expiresIn: HANDOFF_TTL_SEC }
}

export class HandoffError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) { super(message) }
}

export interface ExchangedHandoff {
  ticket:    string
  expiresIn: number
  roomName:  string
  hidden:    boolean
}

/**
 * Burn a code and mint the ticket it stood for. Called by CLT only.
 *
 * The burn is a single atomic findOneAndUpdate on `usedAt`, so two
 * simultaneous exchanges of the same code cannot both win — the same property
 * the ticket's own `jti` gives us one layer further on.
 */
export async function exchangeHandoff(code: string): Promise<ExchangedHandoff> {
  if (!code || code.length < 16) {
    throw new HandoffError('INVALID_CODE', 'Malformed handoff code.', 400)
  }

  /* Claim it first, ask questions second. A code that loses this race is
     already spent by the time the other caller reads it. */
  const row = await ClassHandoffModel.findOneAndUpdate(
    { codeHash: hash(code), usedAt: { $exists: false } },
    { $set: { usedAt: new Date() } },
    { new: false },
  ).lean()

  if (!row) {
    /* Never distinguish "wrong" from "already used": both mean the holder has
       nothing, and telling them which would confirm a real code existed. */
    throw new HandoffError('CODE_NOT_VALID', 'This link has expired or was already used.', 409)
  }
  /* The TTL monitor is lazy, so an expired row can still be here. */
  if (row.expiresAt.getTime() < Date.now()) {
    throw new HandoffError('CODE_EXPIRED', 'This link has expired — open the class again.', 410)
  }

  const { UserModel } = await import('@/models/schema.ts')
  const user = await UserModel.findById(row.userId)
    .select('name email role avatarUrl organizationId enrollmentStatus isActive').lean() as {
      name?: string; email?: string; role?: string; avatarUrl?: string
      organizationId?: unknown; enrollmentStatus?: string; isActive?: boolean
    } | null
  if (!user) throw new HandoffError('USER_GONE', 'That account no longer exists.', 404)

  const ctx: JoinContext = {
    userId: String(row.userId),
    /* THE NAME ON THE TILE, and this is the ONLY path the Join buttons use.
       It used to read `user.name ?? 'Participant'` — its own rule, decided
       here, while the three ticket routes had already been moved onto
       meetingDisplayName. The helper was green in its own suite and dark in
       production, because nothing tested the path the UI actually takes. */
    name:   meetingDisplayName({ name: user.name, email: user.email }, 'Participant'),
    email:  user.email ?? '',
    role:   user.role ?? 'student',
    ...(user.avatarUrl ? { avatarUrl: user.avatarUrl } : {}),
    ...(user.organizationId ? { organizationId: String(user.organizationId) } : {}),
    ...(user.enrollmentStatus ? { enrollmentStatus: user.enrollmentStatus } : {}),
    ...(user.isActive !== undefined ? { isActive: user.isActive } : {}),
  }

  /* injectCategoryScope runs in Express, which is not in play here, so the
     programme scope is resolved from the same source it reads. */
  if (ctx.role === 'sub_admin') {
    const { UserModel: UM } = await import('@/models/schema.ts')
    const withProgram = await UM.findById(row.userId).select('program').lean() as { program?: string } | null
    const map: Record<string, string> = {
      ai: 'ai', digital_marketing: 'digital-marketing', forex: '4x-trading', jura: 'jura',
    }
    const scope = withProgram?.program ? map[withProgram.program] : undefined
    if (scope) ctx.categoryScope = scope
  }

  /* Authorisation happens HERE, against the state as it is now. */
  const minted = row.kind === 'host'
    ? await mintHostTicket(String(row.liveClassId), ctx, { visible: !!row.visible })
    : { ...(await mintStudentTicket(String(row.liveClassId), ctx)), hidden: false }

  logger.info({ liveClassId: String(row.liveClassId), userId: ctx.userId, kind: row.kind },
    'class handoff exchanged')

  return {
    ticket:    minted.ticket,
    expiresIn: minted.expiresIn,
    roomName:  minted.roomName,
    hidden:    minted.hidden,
  }
}
