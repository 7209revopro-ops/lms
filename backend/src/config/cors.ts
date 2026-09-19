import type { CorsOptions } from 'cors'
import { env } from './env.ts'

/* Exported because the asset proxy needs the same list for CSP
   `frame-ancestors`: the set of front-ends allowed to EMBED a document is the
   same set allowed to call the API, and keeping two lists is how one of them
   silently goes stale. */
export const allowedOrigins = [
  env.CLIENT_URL,
  env.ADMIN_URL,
  'http://localhost:3002',
  'http://localhost:3003',
]

export const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    /* Allow requests with no origin (mobile apps, curl, Postman) */
    if (!origin) return callback(null, true)

    if (allowedOrigins.includes(origin)) {
      callback(null, true)
    } else {
      callback(new Error(`CORS: origin '${origin}' not allowed`))
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Refresh-Token'],
  exposedHeaders: ['X-New-Access-Token'],
}
