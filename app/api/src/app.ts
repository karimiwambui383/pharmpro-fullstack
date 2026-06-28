// src/app.ts — updated after Steps 2-4

import express          from 'express'
import cors             from 'cors'
import helmet           from 'helmet'
import cookieParser     from 'cookie-parser'
import { env }          from './config/env'
import { apiLimiter }   from './middleware/rateLimiter'
import { branchGuard }  from './middleware/branchGuard'
import { errorHandler } from './middleware/errorHandler'
import { authenticate } from './middleware/authenticate'

// ── Routers ──────────────────────────────────────────────
import authRouter       from './modules/auth/auth.router'
import patientsRouter   from './modules/patients/patients.router'
import drugsRouter      from './modules/drugs/drugs.router'
import inventoryRouter  from './modules/inventory/inventory.router'
// Step 5: import prescriptionsRouter from './modules/prescriptions/prescriptions.router'
// Step 6: import salesRouter         from './modules/sales/sales.router'
// Step 7: import purchasesRouter     from './modules/purchases/purchases.router'
// Step 7: import financeRouter       from './modules/finance/finance.router'
// Step 7: import reportsRouter       from './modules/reports/reports.router'
// Step 7: import insuranceRouter     from './modules/insurance/insurance.router'
// Step 7: import auditRouter         from './modules/audit/audit.router'

const app = express()

app.set('trust proxy', 1)

// ── Security headers ─────────────────────────────────────
app.use(helmet())
app.use(cors({ origin: env.CLIENT_URL, credentials: true }))

// ── Body parsing ─────────────────────────────────────────
app.use(express.json({ limit: '10mb' }))
app.use(cookieParser())

// ── Rate limiting (Redis-backed) ─────────────────────────
app.use(apiLimiter)

// ── Auth middleware — sets req.user where token present ──
// Does NOT block — unauthenticated requests still pass through.
// Individual routers call authenticate as needed.
app.use(authenticate)

// ── Branch isolation — stamps req.branchId from JWT ──────
app.use(branchGuard)

// ── Health check ─────────────────────────────────────────
app.get('/health', (_req, res) => res.json({
  status:    'ok',
  service:   'pharmpro-api',
  version:   '1.0.0',
  timestamp: new Date().toISOString(),
}))

// ── API routes ────────────────────────────────────────────
app.use('/api/auth',       authRouter)
app.use('/api/patients',   patientsRouter)
app.use('/api/drugs',      drugsRouter)
app.use('/api/inventory',  inventoryRouter)
// app.use('/api/prescriptions', prescriptionsRouter)  ← Step 5
// app.use('/api/sales',         salesRouter)          ← Step 6
// app.use('/api/purchases',     purchasesRouter)      ← Step 7
// app.use('/api/finance',       financeRouter)        ← Step 7
// app.use('/api/reports',       reportsRouter)        ← Step 7
// app.use('/api/insurance',     insuranceRouter)      ← Step 7
// app.use('/api/audit',         auditRouter)          ← Step 7

// ── 404 ──────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ success: false, message: 'Route not found' }))

// ── Global error handler (must be last) ─────────────────
app.use(errorHandler)

export default app