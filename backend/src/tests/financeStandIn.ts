/* ─────────────────────────────────────────────────────────────
   A finance that knows every student, for suites that approve or create
   students while testing something else.

   Approving a student — or creating one already approved — now asks finance
   first, and is refused when finance cannot be asked
   (services/financeCustomerCheck.service.ts). Without a finance to ask, every
   such approval in those suites would be refused. financecheck.suite.ts is
   where the rule itself is tested, against a finance that says no.

     await import('./financeStandIn.ts')   // before the first approval
───────────────────────────────────────────────────────────── */
import { createServer } from 'node:http'

const SECRET = process.env['FINANCE_S2S_SECRET'] || 'finance-stand-in-secret-0123456789'

const server = createServer((req, res) => {
  let raw = ''
  req.on('data', c => { raw += c })
  req.on('end', () => {
    res.setHeader('content-type', 'application/json')
    if (req.method !== 'POST' || req.url !== '/api/v1/lms/customer-check' || req.headers['x-lms-secret'] !== SECRET) {
      res.statusCode = 401
      res.end(JSON.stringify({ error: { code: 'UNAUTHENTICATED' } }))
      return
    }
    res.end(JSON.stringify({ data: { exists: true, organizations: ['Delta HQ'] } }))
  })
})
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
server.unref()   // never what keeps a finished suite running

process.env['FINANCE_API_URL'] = `http://127.0.0.1:${(server.address() as { port: number }).port}`
process.env['FINANCE_S2S_SECRET'] = SECRET
