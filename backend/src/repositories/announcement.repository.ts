import { Types } from 'mongoose'
import { AnnouncementModel, type IAnnouncement } from '@/models/schema.ts'

export class AnnouncementRepository {

  async findById(id: string): Promise<IAnnouncement | null> {
    if (!Types.ObjectId.isValid(id)) return null
    return AnnouncementModel.findById(id).exec()
  }

  /* Admin list. `organizationId` omitted is the super_admin case — every
     row, every academy, including the unscoped "All Academies" ones. Passed,
     it is the org-admin case: exactly that academy's own rows. An org admin
     does NOT see another academy's rows, and does not see the unscoped ones
     either — those were a super_admin's call, not something an org admin
     manages or can accidentally edit by having it appear in their list. */
  async listAll(page = 1, perPage = 50, organizationId?: string): Promise<{ docs: IAnnouncement[]; totalCount: number }> {
    const filter: Record<string, unknown> = {}
    if (organizationId && Types.ObjectId.isValid(organizationId)) {
      filter['organizationId'] = new Types.ObjectId(organizationId)
    }
    const [docs, totalCount] = await Promise.all([
      AnnouncementModel.find(filter).sort({ startDate: -1 }).skip((page - 1) * perPage).limit(perPage).exec(),
      AnnouncementModel.countDocuments(filter).exec(),
    ])
    return { docs, totalCount }
  }

  async create(data: {
    title:           string
    description:     string
    mediaUrl?:       string
    startDate:       Date
    endDate:         Date
    organizationId?: string | null   // null/undefined = every academy
    createdBy:       string
  }): Promise<IAnnouncement> {
    return AnnouncementModel.create({
      title:          data.title,
      description:    data.description,
      mediaUrl:       data.mediaUrl,
      startDate:       data.startDate,
      endDate:         data.endDate,
      organizationId: data.organizationId && Types.ObjectId.isValid(data.organizationId)
        ? new Types.ObjectId(data.organizationId)
        : undefined,
      createdBy:      new Types.ObjectId(data.createdBy),
    })
  }

  /* Address a row by id AND owning organisation, exactly like Coupon's
     scopeFilter — an org admin's write can never reach another academy's
     announcement, or the unscoped ones, by id-guessing. `organizationId`
     omitted is the super_admin case: fully unscoped, can touch any row. */
  private scopeFilter(id: string, organizationId?: string): Record<string, unknown> {
    const filter: Record<string, unknown> = { _id: new Types.ObjectId(id) }
    if (organizationId && Types.ObjectId.isValid(organizationId)) {
      filter['organizationId'] = new Types.ObjectId(organizationId)
    }
    return filter
  }

  async update(
    id: string,
    patch: Partial<Pick<IAnnouncement, 'title' | 'description' | 'mediaUrl' | 'startDate' | 'endDate' | 'isActive'>>
      & { organizationId?: string | null },
    organizationId?: string,
  ): Promise<IAnnouncement | null> {
    if (!Types.ObjectId.isValid(id)) return null
    const set: Record<string, unknown> = { ...patch }
    if ('organizationId' in patch) {
      set['organizationId'] = patch.organizationId && Types.ObjectId.isValid(patch.organizationId)
        ? new Types.ObjectId(patch.organizationId)
        : null
    }
    return AnnouncementModel.findOneAndUpdate(
      this.scopeFilter(id, organizationId),
      { $set: set },
      { new: true },
    ).exec()
  }

  async deleteById(id: string, organizationId?: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(id)) return false
    const result = await AnnouncementModel.deleteOne(this.scopeFilter(id, organizationId)).exec()
    return (result.deletedCount ?? 0) > 0
  }

  /* The student-facing query. isActive, inside its date window, and served —
     this academy by name, or unscoped (every academy). A caller with no
     academy on record (rule 3b) sees only the unscoped rows, never another
     academy's private ones — same shape as servedClassFilter's includeUnowned
     arm, just without the guest-cohort second door this collection has no
     concept of. */
  async listActiveFor(organizationId: string | null, now: Date): Promise<IAnnouncement[]> {
    const orArms: Record<string, unknown>[] = [
      { organizationId: { $exists: false } },
      { organizationId: null },
    ]
    if (organizationId && Types.ObjectId.isValid(organizationId)) {
      orArms.push({ organizationId: new Types.ObjectId(organizationId) })
    }
    /* .lean() drops Document's Mongo-internal members (its `_id.db`, etc.)
       that IAnnouncement inherits by extending Document, so the plain object
       it returns does not structurally satisfy IAnnouncement even though
       every field the caller actually reads is present. Cast rather than
       widen the return type — every call site here reads it as data, never
       calls a Document method on it. */
    return AnnouncementModel.find({
      isActive:  true,
      startDate: { $lte: now },
      endDate:   { $gte: now },
      $or: orArms,
    }).sort({ startDate: -1 }).lean().exec() as unknown as Promise<IAnnouncement[]>
  }
}
