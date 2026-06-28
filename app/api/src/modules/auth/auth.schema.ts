// ════════════════════════════════════════════════════════════
// auth.schema.ts — Zod request validation
// ════════════════════════════════════════════════════════════

import { z } from 'zod'

export const loginSchema = z.object({
  email:    z.string().email({ message: 'Valid email required' }),
  password: z.string().min(1, { message: 'Password required' }),
})

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
})

export const registerSchema = z.object({
  firstName: z.string().min(1),
  lastName:  z.string().min(1),
  email:     z.string().email(),
  password:  z
    .string()
    .min(8, 'Min 8 characters')
    .regex(/[A-Z]/, 'Must contain uppercase')
    .regex(/[0-9]/, 'Must contain number'),
  role:      z.enum(['SUPER_ADMIN','PHARMACIST','TECHNICIAN','CASHIER','STORE_MANAGER','ACCOUNTANT']),
  branchId:  z.string().uuid(),
  phone:     z.string().optional(),
})

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword:     z
    .string()
    .min(8, 'Min 8 characters')
    .regex(/[A-Z]/, 'Must contain uppercase')
    .regex(/[0-9]/, 'Must contain number'),
})

export type LoginInput          = z.infer<typeof loginSchema>
export type RefreshInput        = z.infer<typeof refreshSchema>
export type RegisterInput       = z.infer<typeof registerSchema>
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>


// ════════════════════════════════════════════════════════════
// lib/tokens.ts — JWT + refresh token helpers
// ════════════════════════════════════════════════════════════

import jwt          from 'jsonwebtoken'
import bcrypt       from 'bcrypt'
import crypto       from 'crypto'
import { env }      from '../config/env'
import { prisma }   from '../config/prisma'
import { redis }    from '../config/redis'

export interface JwtPayload {
  sub:      string  // userId
  email:    string
  role:     string
  branchId: string
}

// ── Access token (short-lived, 15 min) ──
export function signAccessToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN,
    issuer:    'pharmpro-api',
    audience:  'pharmpro-client',
  })
}

export function verifyAccessToken(token: string): JwtPayload {
  return jwt.verify(token, env.JWT_ACCESS_SECRET, {
    issuer:   'pharmpro-api',
    audience: 'pharmpro-client',
  }) as JwtPayload
}

// ── Refresh token (long-lived, 7 days) ──
// We store a bcrypt hash in DB, never the raw token.
export async function createRefreshToken(
  userId: string,
  ip?: string,
  ua?: string,
): Promise<string> {
  const raw   = crypto.randomBytes(64).toString('hex')
  const hash  = await bcrypt.hash(raw, 10) // lower rounds — token is random entropy
  const exp   = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

  await prisma.refreshToken.create({
    data: { userId, tokenHash: hash, expiresAt: exp, ipAddress: ip, userAgent: ua },
  })

  return raw // return only to caller — never persisted as plaintext
}

// ── Rotate refresh token (invalidate old, issue new) ──
export async function rotateRefreshToken(
  rawToken: string,
  ip?: string,
  ua?: string,
): Promise<{ accessToken: string; refreshToken: string; user: JwtPayload } | null> {
  // Find all non-revoked tokens and check each (we can't query by hash directly)
  const candidates = await prisma.refreshToken.findMany({
    where: { revokedAt: null, expiresAt: { gt: new Date() } },
    include: { user: { include: { branch: true } } },
    orderBy: { createdAt: 'desc' },
    take: 500, // cap scan — in production index on userId+status
  })

  let matched: (typeof candidates)[0] | null = null
  for (const c of candidates) {
    if (await bcrypt.compare(rawToken, c.tokenHash)) { matched = c; break }
  }

  if (!matched) return null

  // Revoke the old token
  await prisma.refreshToken.update({
    where: { id: matched.id },
    data:  { revokedAt: new Date() },
  })

  const u = matched.user
  const payload: JwtPayload = {
    sub:      u.id,
    email:    u.email,
    role:     u.role,
    branchId: u.branchId,
  }

  const newRaw    = await createRefreshToken(u.id, ip, ua)
  const newAccess = signAccessToken(payload)

  return { accessToken: newAccess, refreshToken: newRaw, user: payload }
}

// ── Revoke all tokens for a user (logout all devices) ──
export async function revokeAllTokens(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data:  { revokedAt: new Date() },
  })
  // Also clear any cached session in Redis
  await redis.del(`session:${userId}`)
}

// ── Blacklist an access token for its remaining TTL ──
// Prevents use after logout until it naturally expires
export async function blacklistAccessToken(token: string, expiresAt: number): Promise<void> {
  const ttl = Math.max(0, expiresAt - Math.floor(Date.now() / 1000))
  if (ttl > 0) await redis.setex(`bl:${token}`, ttl, '1')
}

export async function isAccessTokenBlacklisted(token: string): Promise<boolean> {
  return (await redis.exists(`bl:${token}`)) === 1
}


// ════════════════════════════════════════════════════════════
// lib/numbering.ts — human-readable ID generation
// RX-2026-ELD-000001 / SALE-2026-ELD-00001 / PO-2026-ELD-001
// ════════════════════════════════════════════════════════════

import { prisma } from '../config/prisma'
import { redis }  from '../config/redis'

type EntityType = 'RX' | 'SALE' | 'PO' | 'EXP'

export async function generateNumber(
  type: EntityType,
  branchCode: string, // e.g. "ELD", "NBI", "KSM"
): Promise<string> {
  const year = new Date().getFullYear()
  const key  = `seq:${type}:${year}:${branchCode}`
  const seq  = await redis.incr(key)

  // Set 1-year expiry on first use so old keys clean themselves up
  if (seq === 1) await redis.expire(key, 60 * 60 * 24 * 400)

  const padMap: Record<EntityType, number> = { RX: 6, SALE: 5, PO: 4, EXP: 5 }
  const padded = String(seq).padStart(padMap[type], '0')

  return `${type}-${year}-${branchCode.toUpperCase()}-${padded}`
  // → "RX-2026-ELD-000001"
  // → "SALE-2026-ELD-00001"
  // → "PO-2026-ELD-0001"
}


// ════════════════════════════════════════════════════════════
// auth.service.ts — all business logic
// ════════════════════════════════════════════════════════════

import bcrypt              from 'bcrypt'
import { prisma }          from '../config/prisma'
import { env }             from '../config/env'
import {
  signAccessToken,
  createRefreshToken,
  rotateRefreshToken,
  revokeAllTokens,
  blacklistAccessToken,
  JwtPayload,
}                          from '../lib/tokens'
import { logger }          from '../lib/logger'
import type {
  LoginInput,
  RegisterInput,
  ChangePasswordInput,
}                          from './auth.schema'

export class AuthService {

  // ── Login ────────────────────────────────────────────────
  async login(input: LoginInput, ip?: string, ua?: string) {
    const user = await prisma.user.findUnique({
      where:   { email: input.email.toLowerCase() },
      include: { branch: true },
    })

    // Constant-time comparison even on miss to prevent timing attacks
    const dummyHash = '$2b$12$invalidhashfortimingnormalization000000000000000000000'
    const hash      = user?.passwordHash ?? dummyHash
    const valid     = await bcrypt.compare(input.password, hash)

    if (!user || !valid || !user.isActive || user.deletedAt) {
      logger.warn({ ip, email: input.email }, 'Failed login attempt')
      throw Object.assign(new Error('Invalid credentials'), { status: 401 })
    }

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data:  { lastLogin: new Date() },
    })

    const payload: JwtPayload = {
      sub:      user.id,
      email:    user.email,
      role:     user.role,
      branchId: user.branchId,
    }

    const accessToken  = signAccessToken(payload)
    const refreshToken = await createRefreshToken(user.id, ip, ua)

    logger.info({ userId: user.id, branchId: user.branchId }, 'User logged in')

    return {
      accessToken,
      refreshToken,
      user: {
        id:        user.id,
        firstName: user.firstName,
        lastName:  user.lastName,
        email:     user.email,
        role:      user.role,
        branchId:  user.branchId,
        branch:    { id: user.branch.id, name: user.branch.name },
      },
    }
  }

  // ── Refresh ──────────────────────────────────────────────
  async refresh(rawToken: string, ip?: string, ua?: string) {
    const result = await rotateRefreshToken(rawToken, ip, ua)
    if (!result) throw Object.assign(new Error('Invalid or expired refresh token'), { status: 401 })
    return result
  }

  // ── Logout ───────────────────────────────────────────────
  async logout(userId: string, accessToken: string, accessExp: number) {
    await revokeAllTokens(userId)
    await blacklistAccessToken(accessToken, accessExp)
    logger.info({ userId }, 'User logged out')
  }

  // ── Register (admin creates staff accounts) ──────────────
  async register(input: RegisterInput, createdById: string) {
    const exists = await prisma.user.findUnique({ where: { email: input.email.toLowerCase() } })
    if (exists) throw Object.assign(new Error('Email already in use'), { status: 409 })

    const passwordHash = await bcrypt.hash(input.password, env.BCRYPT_ROUNDS)

    const user = await prisma.user.create({
      data: {
        firstName:    input.firstName,
        lastName:     input.lastName,
        email:        input.email.toLowerCase(),
        passwordHash,
        role:         input.role,
        branchId:     input.branchId,
        phone:        input.phone,
      },
    })

    logger.info({ createdById, newUserId: user.id }, 'Staff account created')

    return {
      id:        user.id,
      firstName: user.firstName,
      lastName:  user.lastName,
      email:     user.email,
      role:      user.role,
      branchId:  user.branchId,
    }
  }

  // ── Change password ──────────────────────────────────────
  async changePassword(userId: string, input: ChangePasswordInput) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
    const valid = await bcrypt.compare(input.currentPassword, user.passwordHash)
    if (!valid) throw Object.assign(new Error('Current password incorrect'), { status: 400 })

    const newHash = await bcrypt.hash(input.newPassword, env.BCRYPT_ROUNDS)
    await prisma.user.update({ where: { id: userId }, data: { passwordHash: newHash } })

    // Revoke all existing refresh tokens — force re-login on all devices
    await revokeAllTokens(userId)

    logger.info({ userId }, 'Password changed — all sessions revoked')
  }

  // ── Get current user (me) ────────────────────────────────
  async getMe(userId: string) {
    return prisma.user.findUniqueOrThrow({
      where:  { id: userId },
      select: {
        id:        true,
        firstName: true,
        lastName:  true,
        email:     true,
        role:      true,
        phone:     true,
        lastLogin: true,
        branch:    { select: { id: true, name: true, county: true, town: true } },
      },
    })
  }
}

export const authService = new AuthService()


// ════════════════════════════════════════════════════════════
// auth.controller.ts — thin HTTP layer, no business logic
// ════════════════════════════════════════════════════════════

import { Request, Response, NextFunction } from 'express'
import { authService }                     from './auth.service'
import {
  loginSchema,
  refreshSchema,
  registerSchema,
  changePasswordSchema,
}                                          from './auth.schema'

export class AuthController {

  async login(req: Request, res: Response, next: NextFunction) {
    try {
      const input  = loginSchema.parse(req.body)
      const ip     = req.ip
      const ua     = req.headers['user-agent']
      const result = await authService.login(input, ip, ua)

      // Refresh token → HttpOnly cookie (not accessible via JS)
      res.cookie('refreshToken', result.refreshToken, {
        httpOnly: true,
        secure:   process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge:   7 * 24 * 60 * 60 * 1000, // 7 days
        path:     '/api/auth/refresh',
      })

      res.json({
        success:     true,
        accessToken: result.accessToken,
        user:        result.user,
      })
    } catch (e) { next(e) }
  }

  async refresh(req: Request, res: Response, next: NextFunction) {
    try {
      // Prefer cookie; fall back to body for mobile clients
      const raw = req.cookies?.refreshToken ?? refreshSchema.parse(req.body).refreshToken
      if (!raw) throw Object.assign(new Error('Refresh token required'), { status: 400 })

      const result = await authService.refresh(raw, req.ip, req.headers['user-agent'])

      // Rotate cookie
      res.cookie('refreshToken', result.refreshToken, {
        httpOnly: true,
        secure:   process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge:   7 * 24 * 60 * 60 * 1000,
        path:     '/api/auth/refresh',
      })

      res.json({ success: true, accessToken: result.accessToken })
    } catch (e) { next(e) }
  }

  async logout(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.sub
      const token  = req.headers.authorization?.split(' ')[1] ?? ''
      const exp    = (req.user as any).exp ?? 0
      await authService.logout(userId, token, exp)

      res.clearCookie('refreshToken', { path: '/api/auth/refresh' })
      res.json({ success: true, message: 'Logged out successfully' })
    } catch (e) { next(e) }
  }

  async register(req: Request, res: Response, next: NextFunction) {
    try {
      const input = registerSchema.parse(req.body)
      const user  = await authService.register(input, req.user!.sub)
      res.status(201).json({ success: true, data: user })
    } catch (e) { next(e) }
  }

  async changePassword(req: Request, res: Response, next: NextFunction) {
    try {
      const input = changePasswordSchema.parse(req.body)
      await authService.changePassword(req.user!.sub, input)
      res.json({ success: true, message: 'Password changed. Please log in again.' })
    } catch (e) { next(e) }
  }

  async me(req: Request, res: Response, next: NextFunction) {
    try {
      const user = await authService.getMe(req.user!.sub)
      res.json({ success: true, data: user })
    } catch (e) { next(e) }
  }
}

export const authController = new AuthController()


// ════════════════════════════════════════════════════════════
// auth.router.ts
// ════════════════════════════════════════════════════════════

import { Router }          from 'express'
import { authController }  from './auth.controller'
import { authenticate }    from '../middleware/authenticate'
import { authorize }       from '../middleware/authorize'
import { loginLimiter }    from '../middleware/rateLimiter'

const router = Router()

// Public
router.post('/login',   loginLimiter, authController.login.bind(authController))
router.post('/refresh',              authController.refresh.bind(authController))

// Authenticated
router.post('/logout',          authenticate, authController.logout.bind(authController))
router.get ('/me',              authenticate, authController.me.bind(authController))
router.post('/change-password', authenticate, authController.changePassword.bind(authController))

// Admin only — create staff accounts
router.post(
  '/register',
  authenticate,
  authorize(['SUPER_ADMIN', 'PHARMACIST']),
  authController.register.bind(authController),
)

export default router


// ════════════════════════════════════════════════════════════
// middleware/authenticate.ts
// ════════════════════════════════════════════════════════════

import { Request, Response, NextFunction } from 'express'
import { verifyAccessToken, isAccessTokenBlacklisted } from '../lib/tokens'

declare global {
  namespace Express {
    interface Request {
      user?: import('../lib/tokens').JwtPayload & { exp?: number }
    }
  }
}

export async function authenticate(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'No token provided' })
  }

  const token = authHeader.split(' ')[1]

  try {
    // Check blacklist first (logout scenario)
    if (await isAccessTokenBlacklisted(token)) {
      return res.status(401).json({ success: false, message: 'Token revoked' })
    }

    const payload = verifyAccessToken(token)
    req.user      = payload
    next()
  } catch {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' })
  }
}


// ════════════════════════════════════════════════════════════
// middleware/authorize.ts — RBAC role check
// ════════════════════════════════════════════════════════════

import { Request, Response, NextFunction } from 'express'
import { Role }                            from '@prisma/client'

export function authorize(roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Not authenticated' })
    }
    if (!roles.includes(req.user.role as Role)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Required: ${roles.join(' or ')}`,
      })
    }
    next()
  }
}


// ════════════════════════════════════════════════════════════
// middleware/branchGuard.ts
// Enforces multi-tenant isolation — every query is scoped to
// the authenticated user's branchId. Never trust the client.
// ════════════════════════════════════════════════════════════

import { Request, Response, NextFunction } from 'express'

export function branchGuard(req: Request, _res: Response, next: NextFunction) {
  // Stamp every request with the user's branchId from their JWT.
  // Service layer uses req.branchId, never req.body.branchId.
  if (req.user) {
    req.branchId = req.user.branchId
  }
  next()
}

// Extend Express Request
declare global {
  namespace Express {
    interface Request { branchId?: string }
  }
}


// ════════════════════════════════════════════════════════════
// middleware/rateLimiter.ts
// ════════════════════════════════════════════════════════════

import rateLimit       from 'express-rate-limit'
import RedisStore      from 'rate-limit-redis'
import { redis }       from '../config/redis'
import { env }         from '../config/env'

// General API limiter
export const apiLimiter = rateLimit({
  windowMs:         env.RATE_LIMIT_WINDOW_MS,
  max:              env.RATE_LIMIT_MAX,
  standardHeaders:  true,
  legacyHeaders:    false,
  store:            new RedisStore({ sendCommand: (...a: string[]) => redis.call(...a) }),
  message:          { success: false, message: 'Too many requests. Please slow down.' },
})

// Stricter limiter for login — prevent brute force
export const loginLimiter = rateLimit({
  windowMs:         15 * 60 * 1000,  // 15 min
  max:              env.LOGIN_RATE_LIMIT_MAX,
  standardHeaders:  true,
  legacyHeaders:    false,
  store:            new RedisStore({ sendCommand: (...a: string[]) => redis.call(...a) }),
  message:          { success: false, message: 'Too many login attempts. Try again in 15 minutes.' },
  skipSuccessfulRequests: true,
})


// ════════════════════════════════════════════════════════════
// middleware/errorHandler.ts — global error handler
// ════════════════════════════════════════════════════════════

import { Request, Response, NextFunction } from 'express'
import { ZodError }                        from 'zod'
import { Prisma }                          from '@prisma/client'
import { logger }                          from '../lib/logger'

export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  logger.error({ err, path: req.path, method: req.method }, 'Unhandled error')

  // Zod validation errors
  if (err instanceof ZodError) {
    return res.status(400).json({
      success: false,
      message: 'Validation error',
      errors:  err.flatten().fieldErrors,
    })
  }

  // Prisma known errors
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      return res.status(409).json({ success: false, message: 'Record already exists' })
    }
    if (err.code === 'P2025') {
      return res.status(404).json({ success: false, message: 'Record not found' })
    }
  }

  // HTTP errors with explicit status
  const status = err.status ?? err.statusCode ?? 500
  const message = status < 500 ? err.message : 'Internal server error'

  // Never leak stack traces in production
  return res.status(status).json({
    success: false,
    message,
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
  })
}


// ════════════════════════════════════════════════════════════
// lib/logger.ts — Pino structured logger
// ════════════════════════════════════════════════════════════

import pino from 'pino'
import { env } from '../config/env'

export const logger = pino({
  level:     env.NODE_ENV === 'production' ? 'info' : 'debug',
  transport: env.NODE_ENV !== 'production'
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
  base:     { service: 'pharmpro-api' },
  redact:   ['req.headers.authorization', 'body.password', 'body.passwordHash'],
})


// ════════════════════════════════════════════════════════════
// app.ts — Express bootstrap
// ════════════════════════════════════════════════════════════

import express          from 'express'
import cors             from 'cors'
import helmet           from 'helmet'
import cookieParser     from 'cookie-parser'
import { env }          from './config/env'
import { apiLimiter }   from './middleware/rateLimiter'
import { branchGuard }  from './middleware/branchGuard'
import { errorHandler } from './middleware/errorHandler'
import { authenticate } from './middleware/authenticate'
import authRouter       from './modules/auth/auth.router'
// future routers imported here as modules are built

const app = express()

app.set('trust proxy', 1) // respect X-Forwarded-For from nginx

app.use(helmet())
app.use(cors({
  origin:      env.CLIENT_URL,
  credentials: true,
}))
app.use(express.json({ limit: '10mb' }))
app.use(cookieParser())
app.use(apiLimiter)
app.use(authenticate) // sets req.user where token present — doesn't block
app.use(branchGuard)  // stamps req.branchId from JWT

// Health check — no auth required
app.get('/health', (_req, res) => res.json({
  status:    'ok',
  service:   'pharmpro-api',
  timestamp: new Date().toISOString(),
}))

// Routes
app.use('/api/auth', authRouter)
// app.use('/api/users',         usersRouter)
// app.use('/api/branches',      branchesRouter)
// app.use('/api/patients',      patientsRouter)
// app.use('/api/drugs',         drugsRouter)
// app.use('/api/inventory',     inventoryRouter)
// app.use('/api/prescriptions', prescriptionsRouter)
// app.use('/api/sales',         salesRouter)
// app.use('/api/purchases',     purchasesRouter)
// app.use('/api/finance',       financeRouter)
// app.use('/api/reports',       reportsRouter)
// app.use('/api/audit',         auditRouter)

// 404 handler
app.use((_req, res) => res.status(404).json({ success: false, message: 'Route not found' }))

// Global error handler — must be last
app.use(errorHandler)

export default app