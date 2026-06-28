// ─── src/config/env.ts ───────────────────────────────────────
// Validate every env var at startup with Zod.
// App crashes immediately with a clear message if anything is missing.

import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV:                z.enum(['development', 'test', 'production']).default('development'),
  PORT:                    z.coerce.number().default(4000),
  DATABASE_URL:            z.string().min(1),
  REDIS_URL:               z.string().min(1),
  JWT_ACCESS_SECRET:       z.string().min(32),
  JWT_REFRESH_SECRET:      z.string().min(32),
  JWT_ACCESS_EXPIRES_IN:   z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN:  z.string().default('7d'),
  API_URL:                 z.string().url(),
  CLIENT_URL:              z.string().url(),
  AWS_REGION:              z.string().default('af-south-1'),
  AWS_ACCESS_KEY_ID:       z.string().optional(),
  AWS_SECRET_ACCESS_KEY:   z.string().optional(),
  AWS_S3_BUCKET:           z.string().default('pharmpro-uploads'),
  AT_API_KEY:              z.string().optional(),
  AT_USERNAME:             z.string().default('sandbox'),
  AT_SENDER_ID:            z.string().default('PharmPro'),
  SMTP_HOST:               z.string().optional(),
  SMTP_PORT:               z.coerce.number().default(465),
  SMTP_USER:               z.string().optional(),
  SMTP_PASS:               z.string().optional(),
  EMAIL_FROM:              z.string().email().default('noreply@pharmacare.co.ke'),
  RATE_LIMIT_WINDOW_MS:    z.coerce.number().default(900_000),
  RATE_LIMIT_MAX:          z.coerce.number().default(100),
  LOGIN_RATE_LIMIT_MAX:    z.coerce.number().default(10),
  BCRYPT_ROUNDS:           z.coerce.number().default(12),
  SEED_ADMIN_EMAIL:        z.string().email().optional(),
  SEED_ADMIN_PASSWORD:     z.string().optional(),
  SEED_BRANCH_NAME:        z.string().optional(),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  console.error('❌ Invalid environment variables:')
  console.error(parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const env = parsed.data


// ─── src/config/prisma.ts ────────────────────────────────────
// Prisma singleton — one connection pool for the whole app.

import { PrismaClient } from '@prisma/client'
import { env } from './env'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: env.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['error'],
  })

if (env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma


// ─── src/config/redis.ts ─────────────────────────────────────
// Redis singleton used by: rate limiter, session cache, BullMQ

import { Redis } from 'ioredis'
import { env } from './env'

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null, // required by BullMQ
  enableReadyCheck: false,
})

redis.on('connect',  () => console.log('✅ Redis connected'))
redis.on('error',    (e) => console.error('❌ Redis error', e))