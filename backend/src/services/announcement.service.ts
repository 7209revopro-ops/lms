import { Types } from 'mongoose'
import { AnnouncementRepository } from '@/repositories/announcement.repository.ts'
import type { IAnnouncement } from '@/models/schema.ts'

export class AnnouncementError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message)
    this.name = 'AnnouncementError'
  }
}

export class AnnouncementService {
  private readonly repo = new AnnouncementRepository()

  /* WHO MAY SET organizationId, AND TO WHAT, IS RESOLVED IN THE ROUTE —
     same split as live-class cross-academy sharing: a schema/service cannot
     see the caller's role, only the route guard can. This method receives
     the ALREADY-RESOLVED value: a real academy id, or null/undefined meaning
     "every academy" — a choice only a super_admin's request can produce. */
  async create(data: {
    title:           string
    description:     string
    mediaUrl?:       string
    startDate:       string   // ISO
    endDate:         string   // ISO
    organizationId?: string | null
    createdBy:       string
  }): Promise<IAnnouncement> {
    const start = new Date(data.startDate)
    const end   = new Date(data.endDate)
    if (end <= start) {
      throw new AnnouncementError('INVALID_DATE_RANGE', 'End date must be after start date', 400)
    }
    if (data.organizationId && !Types.ObjectId.isValid(data.organizationId)) {
      throw new AnnouncementError('INVALID_ORGANIZATION', 'That is not a valid academy id', 400)
    }
    if (data.organizationId) {
      const { OrganizationModel } = await import('@/models/schema.ts')
      if (!(await OrganizationModel.exists({ _id: data.organizationId }))) {
        throw new AnnouncementError('ORGANIZATION_NOT_FOUND', 'That academy does not exist', 404)
      }
    }

    return this.repo.create({
      title:           data.title,
      description:     data.description,
      mediaUrl:        data.mediaUrl,
      startDate:       start,
      endDate:         end,
      organizationId:  data.organizationId,
      createdBy:       data.createdBy,
    })
  }

  async list(page = 1, perPage = 50, organizationId?: string) {
    return this.repo.listAll(page, perPage, organizationId)
  }

  /* `organizationId` scopes the write — present, "only if this row is mine";
     omitted, the unscoped super_admin case. A row outside the caller's scope
     reports NOT_FOUND rather than FORBIDDEN, so the endpoint never confirms
     an id exists outside what the caller may touch (same as Coupon). */
  async update(
    id: string,
    patch: {
      title?:           string
      description?:     string
      mediaUrl?:        string
      startDate?:       string
      endDate?:         string
      isActive?:        boolean
      organizationId?:  string | null
    },
    organizationId?: string,
  ): Promise<IAnnouncement> {
    const existing = await this.repo.findById(id)
    if (!existing || (organizationId && String(existing.organizationId ?? '') !== organizationId)) {
      throw new AnnouncementError('ANNOUNCEMENT_NOT_FOUND', 'Announcement not found', 404)
    }

    const nextStart = patch.startDate ? new Date(patch.startDate) : existing.startDate
    const nextEnd   = patch.endDate   ? new Date(patch.endDate)   : existing.endDate
    if (nextEnd <= nextStart) {
      throw new AnnouncementError('INVALID_DATE_RANGE', 'End date must be after start date', 400)
    }
    if (patch.organizationId && !Types.ObjectId.isValid(patch.organizationId)) {
      throw new AnnouncementError('INVALID_ORGANIZATION', 'That is not a valid academy id', 400)
    }

    const set: Record<string, unknown> = { ...patch }
    if (patch.startDate) set['startDate'] = nextStart
    if (patch.endDate)   set['endDate']   = nextEnd

    const updated = await this.repo.update(id, set as never, organizationId)
    if (!updated) throw new AnnouncementError('ANNOUNCEMENT_NOT_FOUND', 'Announcement not found', 404)
    return updated
  }

  async remove(id: string, organizationId?: string): Promise<void> {
    const deleted = await this.repo.deleteById(id, organizationId)
    if (!deleted) throw new AnnouncementError('ANNOUNCEMENT_NOT_FOUND', 'Announcement not found', 404)
  }

  /** Student-facing: every announcement live right now for this caller's
      academy, plus every unscoped ("all academies") one. */
  async listActiveFor(organizationId: string | null): Promise<IAnnouncement[]> {
    return this.repo.listActiveFor(organizationId, new Date())
  }
}
