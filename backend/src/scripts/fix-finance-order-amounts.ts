/**
 * fix-finance-order-amounts.ts — put the orders Delta Finance created into
 * minor units, like every other order.
 *
 * An order holds its amount in the currency's smallest unit (cents / fils):
 * the gateways write it that way, and every screen and revenue total divides
 * by 100. Finance sent the fee in whole units and the LMS stored it as it
 * came, so AED 5,200 was kept as 5200 and shown as AED 52.00, and counted a
 * hundredth in revenue. New finance orders are stored in minor units and
 * marked `externalRef.minorUnits`; this converts the ones written before.
 *
 * Only finance orders without the mark are touched, each one guarded on the
 * mark as it is written, so it can be run any number of times — before or
 * after the new code is deployed — and never multiplies an order twice.
 *
 * A dry run unless told otherwise: it lists what it would change.
 *
 *   bun src/scripts/fix-finance-order-amounts.ts            # dry run
 *   bun src/scripts/fix-finance-order-amounts.ts --write    # apply
 */
import '@/config/timezone.ts'
import 'dotenv/config'
import { connectDatabase, disconnectDatabase } from '@/config/database.ts'
import { OrderModel } from '@/models/schema.ts'

const write = process.argv.includes('--write')
const UNMARKED = { 'externalRef.source': 'finance', 'externalRef.minorUnits': { $ne: true } }

async function main() {
  await connectDatabase()

  const orders = await OrderModel.find(UNMARKED)
    .select('amount currency status externalRef createdAt')
    .sort({ createdAt: 1 })
    .lean()

  console.log(`\n${orders.length} finance order(s) still in whole units${write ? '' : ' — dry run, nothing written'}\n`)
  let changed = 0
  for (const o of orders) {
    const order = o as { _id: unknown; amount: number; currency: string; status: string; externalRef?: { id?: string }; createdAt?: Date }
    const to = Math.round(order.amount * 100)
    console.log(
      `  ${String(order._id)}  ${order.createdAt?.toISOString().slice(0, 10) ?? '—'}  invoice ${order.externalRef?.id ?? '—'}  ` +
      `${order.currency.toUpperCase()} ${order.amount} → stored ${to} (${order.currency.toUpperCase()} ${(to / 100).toFixed(2)})  ${order.status}`,
    )
    if (!write) continue
    // Guarded on the mark, so a second run — or two at once — cannot multiply it again.
    const res = await OrderModel.updateOne(
      { _id: order._id, ...UNMARKED },
      { $set: { amount: to, 'externalRef.minorUnits': true } },
    )
    changed += res.modifiedCount
  }

  if (write) console.log(`\n✅ ${changed} order(s) converted to minor units`)
  else if (orders.length) console.log('\nRun again with --write to apply.')
  await disconnectDatabase()
}

main().catch(async (err) => {
  console.error(err)
  await disconnectDatabase().catch(() => {})
  process.exit(1)
})
