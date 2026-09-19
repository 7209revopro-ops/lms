import type { ICourse, ISection, ILesson } from '@/models/schema.ts'
import { toAssetUrl } from '@/utils/assetUrl.ts'

/* ─────────────────────────────────────────────────────
   Course DTO — flattens populated instructor/category
   into separate top-level fields so the frontend doesn't
   need to know that instructorId / categoryId are
   sometimes ObjectIds and sometimes populated docs.
───────────────────────────────────────────────────── */

interface PopulatedUser { id: string; name: string; avatarUrl?: string; headline?: string; bio?: string }
interface PopulatedCategory { id: string; name: string; slug: string }

export interface CourseDTO {
  id:             string
  title:          string
  slug:           string
  description?:   string
  thumbnailUrl?:  string
  previewUrl?:    string
  price:          number
  priceAED?:      number
  priceINR?:      number
  isFree:         boolean
  status:         string
  level?:         string
  durationMins:   number
  language:       string
  tags?:          string[]
  instructorId:   string
  /* The academy that OWNS this course. Needed by the admin form for
     cross-academy classes: the server resolves a class's host academy as the
     caller's, falling back to the course's, so a form that cannot see this
     cannot tell which academy to leave OUT of the guest list — and offered the
     host's own academy as a guest, which the server then refuses with "a class
     cannot be a guest of its own academy" for reasons invisible from the form.

     Not sensitive: tenancy already means a caller only ever sees courses of an
     academy they belong to, so this names an academy they are already in. */
  organizationId?: string
  categoryId?:    string
  program?:       '4x-trading' | 'digital-marketing' | 'ai' | 'jura'
  enrolledCount:  number
  ratingAvg:      number
  ratingCount:    number
  lessonCount?:   number
  createdAt:      string | Date
  updatedAt:      string | Date
  instructor?:    PopulatedUser
  category?:      PopulatedCategory
}

export function toCourseDTO(course: ICourse, lessonCount?: number): CourseDTO {
  const json = course.toJSON() as Record<string, unknown> & {
    instructorId?: string | PopulatedUser
    categoryId?:   string | PopulatedCategory
  }

  const dto: CourseDTO = {
    id:            json['id']            as string,
    title:         json['title']         as string,
    slug:          json['slug']          as string,
    description:   json['description']   as string | undefined,
    thumbnailUrl:  toAssetUrl(json['thumbnailUrl'] as string | undefined),
    previewUrl:    json['previewUrl']    as string | undefined,
    price:         json['price']         as number,
    priceAED:      json['priceAED']      as number | undefined,
    priceINR:      json['priceINR']      as number | undefined,
    isFree:        json['isFree']        as boolean,
    status:        json['status']        as string,
    level:         json['level']         as string | undefined,
    durationMins:  json['durationMins']  as number,
    language:      json['language']      as string,
    tags:          json['tags']          as string[] | undefined,
    program:       json['program']       as '4x-trading' | 'digital-marketing' | 'ai' | 'jura' | undefined,
    enrolledCount: json['enrolledCount'] as number,
    ratingAvg:     json['ratingAvg']     as number,
    ratingCount:   json['ratingCount']   as number,
    createdAt:     json['createdAt']     as string | Date,
    updatedAt:     json['updatedAt']     as string | Date,
    instructorId:  '',
    organizationId: json['organizationId'] ? String(json['organizationId']) : undefined,
  }

  const inst = json.instructorId
  if (typeof inst === 'object' && inst !== null) {
    dto.instructor   = { ...inst, avatarUrl: toAssetUrl(inst.avatarUrl) }
    dto.instructorId = inst.id
  } else {
    dto.instructorId = String(inst ?? '')
  }

  const cat = json.categoryId
  if (typeof cat === 'object' && cat !== null) {
    dto.category   = cat
    dto.categoryId = cat.id
  } else if (cat) {
    dto.categoryId = String(cat)
  }

  if (lessonCount !== undefined) dto.lessonCount = lessonCount

  return dto
}

/* Section + lesson lightweight DTOs for the outline */
export interface SectionDTO {
  id:    string
  title: string
  order: number
}

export interface LessonDTO {
  id:           string
  sectionId:    string
  courseId:     string
  title:        string
  type:         string
  durationMins: number
  order:        number
  isFree:       boolean
  contentUrl?:  string   // non-video content (article/external) — safe to expose
  contentBody?: string   // rich-text body for article lessons — gated like contentUrl
  hasVideo?:    boolean  // true when a video exists; the real URL is fetched, signed, from GET /lessons/:id/play-url
}

export function toSectionDTO(s: ISection): SectionDTO {
  const j = s.toJSON() as Record<string, unknown>
  return {
    id:    j['id']    as string,
    title: j['title'] as string,
    order: j['order'] as number,
  }
}

export function toLessonDTO(l: ILesson, includeContentUrl = false): LessonDTO {
  const j = l.toJSON() as Record<string, unknown>
  const dto: LessonDTO = {
    id:           j['id']           as string,
    sectionId:    String(j['sectionId']),
    courseId:     String(j['courseId']),
    title:        j['title']        as string,
    type:         j['type']         as string,
    durationMins: j['durationMins'] as number,
    order:        j['order']        as number,
    isFree:       j['isFree']       as boolean,
  }
  if (includeContentUrl) {
    const url = j['contentUrl'] as string | undefined
    if ((j['type'] as string) === 'video') {
      /* SECURITY: never ship the raw (public R2) video URL to the client — a
         permanent public link defeats paid gating. Expose only a boolean; the
         player fetches a short-lived signed URL from GET /lessons/:id/play-url. */
      dto.hasVideo = !!url
    } else {
      dto.contentUrl = url   // articles / external links are not the R2 video leak
      /* The article's rich-text body is content too, so it rides the same
         enrollment gate as contentUrl — withheld from non-enrolled, non-free
         viewers, shipped to everyone entitled to read the lesson. Omitted
         entirely before this fix, so article bodies never reached the client. */
      const body = j['contentBody'] as string | undefined
      if (body) dto.contentBody = body
    }
  }
  return dto
}
