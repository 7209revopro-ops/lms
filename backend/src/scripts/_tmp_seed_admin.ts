export {}
const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const { UserModel, OrganizationModel } = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')
await mongoose.connect(process.env.DATABASE_URL ?? process.env.MONGODB_URI!)
const org = await OrganizationModel.findOne({ slug: 'dubai' }).lean() as any
await UserModel.deleteOne({ email: 'qa.admin@live.local' })
await UserModel.deleteMany({ email: /@qa\.local$/ })
await UserModel.create({
  name: 'QA Admin', email: 'qa.admin@live.local',
  passwordHash: await hashPassword('QaAdmin#2026'),
  role: 'admin', isActive: true, isVerified: true, organizationId: org._id,
})
console.log('RESEEDED')
await mongoose.disconnect()
