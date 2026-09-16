/**
 * provision-student.ts — grant a student ONE course by hand and email their
 * login link. The general-purpose version of provision-ai-academy-student.ts,
 * for any course (trading programmes, digital marketing, …).
 *
 * Creates a passwordless account if needed, enrols + approves them, records a
 * paid Order, puts them under the academy that owns the course, and emails a
 * one-click login link that opens the course. Idempotent per email+course.
 *
 * IMPORTANT: run this on the server whose CLIENT_URL is the real student app
 * (production), or the emailed link will be a localhost URL. SMTP must be set.
 *
 *   bun src/scripts/provision-student.ts <email> "<name>" <phone> <course-slug>
 *
 * Example:
 *   bun src/scripts/provision-student.ts shasnifaizal@gmail.com "Shasni Faisal" 8156959065 market-break-out-trading-program
 *
 * Tip: list course slugs with
 *   bun -e "import('@/config/database.ts').then(async d=>{await d.connectDatabase();const {CourseModel}=await import('@/models/schema.ts');(await CourseModel.find({},'slug title').lean()).forEach(c=>console.log(c.slug,'—',c.title));process.exit(0)})"
 */
import '@/config/timezone.ts'
import 'dotenv/config'
import { connectDatabase, disconnectDatabase } from '@/config/database.ts'
import { OrderService } from '@/services/order.service.ts'
import { AuthService } from '@/services/auth.service.ts'
import { logger } from '@/utils/logger.ts'

const [email, name, phone, courseSlug] = process.argv.slice(2)
if (!email || !courseSlug) {
  console.error('usage: bun src/scripts/provision-student.ts <email> "<name>" <phone> <course-slug>')
  process.exit(1)
}

async function main() {
  await connectDatabase()
  const orders = new OrderService()
  const auth = new AuthService()

  const result = await orders.provisionManualPurchase({
    email: email!,
    ...(name ? { name } : {}),
    ...(phone ? { phone } : {}),
    courseSlug: courseSlug!,
  })
  logger.info({ email, ...result }, 'course access provisioned')

  // Email the one-click login link — lands on the course. A fresh link is
  // minted every run, so this doubles as "resend the invite".
  const { link } = await auth.inviteToCourse(email!, {
    next: `/courses/${result.courseSlug}`,
    ...(name ? { name } : {}),
    courseName: result.courseTitle,
  })

  console.log(`\n✅ ${email}`)
  console.log(`   account:  ${result.created ? 'created' : 'existing'}`)
  console.log(`   enrolled: ${result.courseTitle} (approved${result.organizationSlug ? `, ${result.organizationSlug} org` : ''})`)
  console.log(`   login link (also emailed): ${link}\n`)

  await disconnectDatabase()
  process.exit(0)
}

main().catch((err) => {
  console.error('provision failed:', err)
  process.exit(1)
})
