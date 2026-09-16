import { OrderModel, type IOrder, type OrderGateway } from '@/models/schema.ts'

export class OrderRepository {

  /* `organizationId` is what makes the admin refund route's tenancy check real.
     That check treats an order with no organizationId as grandfathered and
     refundable by any academy's admin — a deliberate allowance for rows that
     predate the field. But nothing ever SET the field, so every order matched
     the grandfather clause and the guard passed for every order in every
     academy: a Dubai admin could issue a real gateway refund against a
     Bangalore order. Stamping it at creation is what closes that. */
  async create(data: {
    userId:                   string
    courseId:                 string
    organizationId?:          string
    gateway:                  OrderGateway
    amount:                   number
    currency:                 string
    couponId?:                string
    discountAmount?:          number
    razorpayOrderId?:         string
    stripeCheckoutSessionId?: string
    tabbyCheckoutId?:         string
    tabbyPaymentId?:          string
    abzerOrderId?:            string
    tamaraCheckoutId?:        string
    tamaraOrderId?:           string
  }): Promise<IOrder> {
    return OrderModel.create({
      ...data,
      status:         'pending',
      discountAmount: data.discountAmount ?? 0,
    })
  }

  async findById(id: string): Promise<IOrder | null> {
    return OrderModel.findById(id).exec()
  }

  async findBySessionId(sessionId: string): Promise<IOrder | null> {
    return OrderModel.findOne({ stripeCheckoutSessionId: sessionId }).exec()
  }

  async findByRazorpayOrderId(razorpayOrderId: string): Promise<IOrder | null> {
    return OrderModel.findOne({ razorpayOrderId }).exec()
  }

  async findByTabbyCheckoutId(tabbyCheckoutId: string): Promise<IOrder | null> {
    return OrderModel.findOne({ tabbyCheckoutId }).exec()
  }

  async findByTabbyPaymentId(tabbyPaymentId: string): Promise<IOrder | null> {
    if (!tabbyPaymentId) return null
    return OrderModel.findOne({ tabbyPaymentId }).exec()
  }

  async findByAbzerOrderId(abzerOrderId: string): Promise<IOrder | null> {
    return OrderModel.findOne({ abzerOrderId }).exec()
  }

  async findByTamaraOrderId(tamaraOrderId: string): Promise<IOrder | null> {
    return OrderModel.findOne({ tamaraOrderId }).exec()
  }

  /* ─── Fulfilment — conditional, exactly-once ─────────
     `status: { $ne: 'paid' }` lives in the FILTER so a gateway webhook racing
     the client return-URL verify (or a retried webhook) cannot fulfil twice.
     Each returns true only for the caller that actually flipped the order;
     the loser must skip enrolment / emails / coupon side effects. */

  /* Stripe fulfillment */
  async fulfill(id: string, paymentIntentId: string, invoiceUrl?: string): Promise<boolean> {
    const result = await OrderModel.updateOne(
      { _id: id, status: { $ne: 'paid' } },
      { $set: { status: 'paid', stripePaymentIntentId: paymentIntentId, ...(invoiceUrl && { stripeInvoiceUrl: invoiceUrl }) } },
    ).exec()
    return result.modifiedCount === 1
  }

  /* Razorpay fulfillment */
  async fulfillRazorpay(id: string, paymentId: string, signature: string): Promise<boolean> {
    const result = await OrderModel.updateOne(
      { _id: id, status: { $ne: 'paid' } },
      { $set: { status: 'paid', razorpayPaymentId: paymentId, razorpaySignature: signature } },
    ).exec()
    return result.modifiedCount === 1
  }

  /* Tabby fulfillment */
  /* Only a PENDING order may become paid. `$ne: 'paid'` also matched
     `refunded` and `cancelled`, so a replayed callback could resurrect an order
     whose money had already been sent back — reinstating the enrolment and
     leaving the books claiming revenue that no longer exists. */
  async fulfillTabby(id: string, paymentId: string): Promise<boolean> {
    const result = await OrderModel.updateOne(
      { _id: id, status: 'pending' },
      { $set: { status: 'paid', tabbyPaymentId: paymentId } },
    ).exec()
    return result.modifiedCount === 1
  }

  /* Abzer fulfillment */
  async fulfillAbzer(id: string, paymentId: string): Promise<boolean> {
    const result = await OrderModel.updateOne(
      { _id: id, status: { $ne: 'paid' } },
      { $set: { status: 'paid', abzerPaymentId: paymentId } },
    ).exec()
    return result.modifiedCount === 1
  }

  /* Tamara fulfillment */
  async fulfillTamara(id: string, tamaraOrderId: string): Promise<boolean> {
    const result = await OrderModel.updateOne(
      { _id: id, status: { $ne: 'paid' } },
      { $set: { status: 'paid', tamaraPaymentId: tamaraOrderId } },
    ).exec()
    return result.modifiedCount === 1
  }

  async markRefunded(id: string): Promise<IOrder | null> {
    return OrderModel.findByIdAndUpdate(
      id,
      { $set: { status: 'refunded', refundedAt: new Date() } },
      { new: true },
    ).exec()
  }

  /* Conditional for the same reason as the fulfil methods — true only for the
     caller that actually cancelled, so a reserved coupon slot is released once. */
  async markCancelled(id: string): Promise<boolean> {
    const result = await OrderModel.updateOne(
      { _id: id, status: 'pending' },
      { $set: { status: 'cancelled', cancelledAt: new Date() } },
    ).exec()
    return result.modifiedCount === 1
  }

  async listForUser(userId: string): Promise<IOrder[]> {
    return OrderModel
      .find({ userId })
      .populate('courseId', 'title slug thumbnailUrl')
      .sort({ createdAt: -1 })
      .exec()
  }

  /* The scope both the list and the breakdown read, so a row counted in one
     is always openable in the other. */
  private async scopeFilter(
    status?: string, organizationId?: string, gateway?: string,
  ): Promise<Record<string, unknown>> {
    const filter: Record<string, unknown> = status && status !== 'all' ? { status } : {}
    if (gateway && gateway !== 'all') filter['gateway'] = gateway
    if (organizationId) {
      const { Types } = await import('mongoose')
      if (Types.ObjectId.isValid(organizationId)) filter['organizationId'] = new Types.ObjectId(organizationId)
    }
    return filter
  }

  /* One row per gateway that has EVER recorded an order, with what it took.

     The question this answers is "is Abzer recording anything at all" — which
     a paginated list sorted by date cannot answer, because a gateway with a
     handful of older orders simply never appears on page one. Deliberately
     ignores the status and gateway filters: a breakdown that moved when you
     clicked a tab could not be used to check for an absent gateway. */
  async gatewayBreakdown(organizationId?: string): Promise<{
    gateway: string; total: number; paid: number; pending: number
    refunded: number; cancelled: number; paidAmount: number; currency: string
  }[]> {
    const match: Record<string, unknown> = {}
    if (organizationId) {
      const { Types } = await import('mongoose')
      if (Types.ObjectId.isValid(organizationId)) match['organizationId'] = new Types.ObjectId(organizationId)
    }
    const rows = await OrderModel.aggregate([
      { $match: match },
      { $group: {
        _id:       '$gateway',
        total:     { $sum: 1 },
        paid:      { $sum: { $cond: [{ $eq: ['$status', 'paid'] },      1, 0] } },
        pending:   { $sum: { $cond: [{ $eq: ['$status', 'pending'] },   1, 0] } },
        refunded:  { $sum: { $cond: [{ $eq: ['$status', 'refunded'] },  1, 0] } },
        cancelled: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
        /* Only settled money is summed — a pending row is an intention. */
        paidAmount: { $sum: { $cond: [{ $eq: ['$status', 'paid'] }, '$amount', 0] } },
        currency:  { $first: '$currency' },
      } },
      { $sort: { total: -1 } },
    ]).exec()

    return rows.map((r: any) => ({
      gateway: String(r._id ?? 'unknown'),
      total: r.total, paid: r.paid, pending: r.pending,
      refunded: r.refunded, cancelled: r.cancelled,
      paidAmount: r.paidAmount ?? 0,
      currency: String(r.currency ?? ''),
    }))
  }

  async listAll(
    page = 1, perPage = 20, status?: string, organizationId?: string, gateway?: string,
  ): Promise<{ docs: IOrder[]; totalCount: number }> {
    const filter = await this.scopeFilter(status, organizationId, gateway)
    const [docs, totalCount] = await Promise.all([
      OrderModel
        .find(filter)
        .populate('userId',   'name email')
        .populate('courseId', 'title slug')
        .sort({ createdAt: -1 })
        .skip((page - 1) * perPage)
        .limit(perPage)
        .exec(),
      OrderModel.countDocuments(filter).exec(),
    ])
    return { docs, totalCount }
  }

  async revenueTimeseries(days: number, organizationId?: string): Promise<{ date: string; amount: number }[]> {
    const since = new Date()
    since.setDate(since.getDate() - days)

    const matchBase: Record<string, unknown> = { status: 'paid', createdAt: { $gte: since } }
    if (organizationId) {
      const { Types } = await import('mongoose')
      if (Types.ObjectId.isValid(organizationId)) matchBase['organizationId'] = new Types.ObjectId(organizationId)
    }
    const rows = await OrderModel.aggregate([
      { $match: matchBase },
      {
        $group: {
          _id:    { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          amount: { $sum: '$amount' },
        },
      },
      { $sort: { _id: 1 } },
    ])

    const byDate = new Map<string, number>(rows.map((r: any) => [r._id, r.amount]))
    const out: { date: string; amount: number }[] = []
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const key = d.toISOString().slice(0, 10)
      out.push({ date: key, amount: byDate.get(key) ?? 0 })
    }
    return out
  }

  async totalRevenue(): Promise<number> {
    const result = await OrderModel.aggregate([
      { $match: { status: 'paid' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ])
    return result[0]?.total ?? 0
  }
}
