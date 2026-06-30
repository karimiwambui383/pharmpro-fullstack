// ════════════════════════════════════════════════════════════
// modules/prescriptions/prescriptions.controller.ts
// ════════════════════════════════════════════════════════════

import { Request, Response, NextFunction }  from 'express'
import { prescriptionsService }             from './prescriptions.service'
import {
  createPrescriptionSchema,
  updatePrescriptionSchema,
  dispenseSchema,
  refillSchema,
  rxSearchSchema,
}                                           from './prescriptions.schema'

export class PrescriptionsController {

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const input  = createPrescriptionSchema.parse(req.body)
      const result = await prescriptionsService.create(input, req.branchId!, req.user!.sub)
      res.status(201).json({ success: true, data: result })
    } catch (e) { next(e) }
  }

  async search(req: Request, res: Response, next: NextFunction) {
    try {
      const input  = rxSearchSchema.parse(req.query)
      const result = await prescriptionsService.search(input, req.branchId!)
      res.json({ success: true, ...result })
    } catch (e) { next(e) }
  }

  async findById(req: Request, res: Response, next: NextFunction) {
    try {
      const rx = await prescriptionsService.findById(req.params.id, req.branchId!)
      res.json({ success: true, data: rx })
    } catch (e) { next(e) }
  }

  async verify(req: Request, res: Response, next: NextFunction) {
    try {
      const rx = await prescriptionsService.verify(
        req.params.id, req.branchId!, req.user!.sub,
      )
      res.json({ success: true, data: rx })
    } catch (e) { next(e) }
  }

  async dispense(req: Request, res: Response, next: NextFunction) {
    try {
      const input  = dispenseSchema.parse(req.body)
      const result = await prescriptionsService.dispense(
        req.params.id, input, req.branchId!, req.user!.sub,
      )
      res.json({ success: true, data: result })
    } catch (e) { next(e) }
  }

  async refill(req: Request, res: Response, next: NextFunction) {
    try {
      const input  = refillSchema.parse(req.body)
      const result = await prescriptionsService.refill(
        req.params.id, input, req.branchId!, req.user!.sub,
      )
      res.json({ success: true, data: result })
    } catch (e) { next(e) }
  }

  async cancel(req: Request, res: Response, next: NextFunction) {
    try {
      const { reason } = req.body
      if (!reason) throw Object.assign(new Error('Cancellation reason required'), { status: 400 })
      await prescriptionsService.cancel(
        req.params.id, reason, req.branchId!, req.user!.sub,
      )
      res.json({ success: true, message: 'Prescription cancelled' })
    } catch (e) { next(e) }
  }

  async updateStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const { status } = req.body
      if (!status) throw Object.assign(new Error('Status required'), { status: 400 })
      const rx = await prescriptionsService.updateStatus(
        req.params.id, status, req.branchId!, req.user!.sub,
      )
      res.json({ success: true, data: rx })
    } catch (e) { next(e) }
  }

  async preCheck(req: Request, res: Response, next: NextFunction) {
    try {
      const { patientId, drugIds } = req.body
      if (!patientId || !Array.isArray(drugIds) || !drugIds.length) {
        throw Object.assign(new Error('patientId and drugIds[] required'), { status: 400 })
      }
      const result = await prescriptionsService.preCheck(
        patientId, drugIds, req.branchId!,
      )
      res.json({ success: true, data: result })
    } catch (e) { next(e) }
  }

  async getQueueStats(req: Request, res: Response, next: NextFunction) {
    try {
      const stats = await prescriptionsService.getQueueStats(req.branchId!)
      res.json({ success: true, data: stats })
    } catch (e) { next(e) }
  }
}

export const prescriptionsController = new PrescriptionsController()


// ════════════════════════════════════════════════════════════
// modules/prescriptions/prescriptions.router.ts
// ════════════════════════════════════════════════════════════

import { Router }                   from 'express'
import { prescriptionsController }  from './prescriptions.controller'
import { authenticate }             from '../../middleware/authenticate'
import { authorize }                from '../../middleware/authorize'

const router = Router()
router.use(authenticate)

// Stats + utility
router.get  ('/queue-stats',      prescriptionsController.getQueueStats.bind(prescriptionsController))
router.post ('/pre-check',        prescriptionsController.preCheck.bind(prescriptionsController))

// CRUD
router.get  ('/',                 prescriptionsController.search.bind(prescriptionsController))
router.post ('/',
  authorize(['SUPER_ADMIN','PHARMACIST','TECHNICIAN']),
  prescriptionsController.create.bind(prescriptionsController),
)
router.get  ('/:id',              prescriptionsController.findById.bind(prescriptionsController))

// Lifecycle transitions
router.patch('/:id/verify',
  authorize(['SUPER_ADMIN','PHARMACIST']),
  prescriptionsController.verify.bind(prescriptionsController),
)
router.patch('/:id/status',
  authorize(['SUPER_ADMIN','PHARMACIST','TECHNICIAN']),
  prescriptionsController.updateStatus.bind(prescriptionsController),
)
router.post ('/:id/dispense',
  authorize(['SUPER_ADMIN','PHARMACIST']),
  prescriptionsController.dispense.bind(prescriptionsController),
)
router.post ('/:id/refill',
  authorize(['SUPER_ADMIN','PHARMACIST']),
  prescriptionsController.refill.bind(prescriptionsController),
)
router.patch('/:id/cancel',
  authorize(['SUPER_ADMIN','PHARMACIST']),
  prescriptionsController.cancel.bind(prescriptionsController),
)

export default router


// ════════════════════════════════════════════════════════════
// jobs/queues.ts
// Central queue definitions — one place for all BullMQ queues.
// Workers defined in separate files (jobs/*.worker.ts)
// ════════════════════════════════════════════════════════════

import { Queue } from 'bullmq'
import { redis } from '../config/redis'

const connection = redis

// Default job options — all jobs retry 3x with exponential backoff
const defaultJobOptions = {
  attempts:         3,
  backoff:          { type: 'exponential' as const, delay: 5000 },
  removeOnComplete: { count: 100 },   // keep last 100 completed
  removeOnFail:     { count: 500 },   // keep last 500 failed for debugging
}

// ── Prescription events ───────────────────────────────────
export const rxQueue = new Queue('prescriptions', {
  connection,
  defaultJobOptions,
})

// ── Notification queue (SMS + Email) ─────────────────────
export const notificationQueue = new Queue('notifications', {
  connection,
  defaultJobOptions,
})

// ── Report generation queue ───────────────────────────────
export const reportQueue = new Queue('reports', {
  connection,
  defaultJobOptions,
})

// ── Backup queue ──────────────────────────────────────────
export const backupQueue = new Queue('backups', {
  connection,
  defaultJobOptions,
})

// ── Scheduled jobs (cron-like) ────────────────────────────
export const scheduledQueue = new Queue('scheduled', {
  connection,
  defaultJobOptions,
})


// ════════════════════════════════════════════════════════════
// jobs/prescriptions.worker.ts
// Handles all prescription-related async work
// ════════════════════════════════════════════════════════════

import { Worker, Job } from 'bullmq'
import { redis }       from '../config/redis'
import { prisma }      from '../config/prisma'
import { logger }      from '../lib/logger'
import { smsService }  from '../lib/sms'  // Africa's Talking wrapper

export function startPrescriptionsWorker() {
  const worker = new Worker(
    'prescriptions',
    async (job: Job) => {
      logger.info({ jobName: job.name, jobId: job.id }, 'Processing prescription job')

      switch (job.name) {

        case 'rx-created-sms': {
          const { patientId, rxNumber, priority } = job.data
          const patient = await prisma.patient.findUnique({
            where:  { id: patientId },
            select: { phone: true, firstName: true },
          })
          if (!patient?.phone) {
            logger.info({ patientId }, 'Patient has no phone — skipping SMS')
            return
          }
          await smsService.send({
            to:      patient.phone,
            message: priority === 'EMERGENCY'
              ? `PharmPro: URGENT - Your prescription ${rxNumber} is being processed immediately. Please wait.`
              : `PharmPro: Your prescription ${rxNumber} has been received. We will notify you when it is ready for collection.`,
          })
          break
        }

        case 'dispense-sms': {
          const { patientId, rxNumber } = job.data
          const patient = await prisma.patient.findUnique({
            where:  { id: patientId },
            select: { phone: true, firstName: true },
          })
          if (!patient?.phone) return
          await smsService.send({
            to:      patient.phone,
            message: `PharmPro: ${patient.firstName}, your prescription ${rxNumber} is ready for collection. Please bring this SMS. Thank you!`,
          })
          break
        }

        case 'dispense-receipt': {
          // In a full build, generate PDF receipt and store to S3
          // For now, just log
          logger.info({ prescriptionId: job.data.prescriptionId }, 'Receipt generation queued')
          break
        }

        default:
          logger.warn({ jobName: job.name }, 'Unknown prescription job type')
      }
    },
    {
      connection: redis,
      concurrency: 10,       // process 10 SMS jobs simultaneously
      limiter: {
        max:      50,         // max 50 jobs
        duration: 1000,       // per second (Africa's Talking rate limit)
      },
    },
  )

  worker.on('completed', job => logger.info({ jobId: job.id, name: job.name }, 'Job completed'))
  worker.on('failed',    (job, err) => logger.error({ jobId: job?.id, err }, 'Job failed'))

  return worker
}


// ════════════════════════════════════════════════════════════
// jobs/scheduled.worker.ts
// Cron jobs: expiry alerts, low stock check, daily backup
// ════════════════════════════════════════════════════════════

import { Worker, Job }      from 'bullmq'
import { QueueScheduler }   from 'bullmq'
import { scheduledQueue }   from './queues'
import { redis }            from '../config/redis'
import { prisma }           from '../config/prisma'
import { logger }           from '../lib/logger'

// Register cron jobs on startup
export async function registerCronJobs() {
  // ── Expiry check — daily at 07:00 EAT ─────────────────
  await scheduledQueue.add(
    'expiry-check',
    {},
    {
      repeat:    { cron: '0 4 * * *' },   // 07:00 EAT = 04:00 UTC
      jobId:     'expiry-check-daily',
      removeOnComplete: true,
    },
  )

  // ── Low stock check — every 6 hours ───────────────────
  await scheduledQueue.add(
    'low-stock-check',
    {},
    {
      repeat:    { every: 6 * 60 * 60 * 1000 },
      jobId:     'low-stock-check',
      removeOnComplete: true,
    },
  )

  // ── Daily backup — 01:00 EAT ──────────────────────────
  await scheduledQueue.add(
    'daily-backup',
    {},
    {
      repeat:    { cron: '0 22 * * *' },  // 01:00 EAT = 22:00 UTC prev day
      jobId:     'daily-backup',
      removeOnComplete: true,
    },
  )

  logger.info('✅ Cron jobs registered')
}

export function startScheduledWorker() {
  const worker = new Worker(
    'scheduled',
    async (job: Job) => {
      switch (job.name) {

        case 'expiry-check': {
          const in30 = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
          const expiring = await prisma.inventory.findMany({
            where: {
              expiryDate:     { lte: in30, gte: new Date() },
              quantityOnHand: { gt: 0 },
            },
            include: {
              drug:   { select: { genericName: true } },
              branch: { select: { id: true, name: true } },
            },
          })

          for (const item of expiring) {
            const days = Math.ceil(
              (item.expiryDate!.getTime() - Date.now()) / 86_400_000,
            )
            logger.warn(
              { drugName: item.drug.genericName, days, branch: item.branch.name },
              'Expiry alert',
            )
            // TODO: publish to Redis → Socket.io broadcasts to branch
            await redis.publish(
              `branch:${item.branchId}:events`,
              JSON.stringify({
                event:    'inventory:expiry-alert',
                drugName: item.drug.genericName,
                daysLeft: days,
                qty:      item.quantityOnHand,
                batchNo:  item.batchNo,
              }),
            )
          }
          logger.info({ count: expiring.length }, 'Expiry check complete')
          break
        }

        case 'low-stock-check': {
          const lowStock = await prisma.inventory.findMany({
            where: {
              quantityOnHand: { gt: 0 },
              // can't use field reference directly in Prisma — use raw
            },
          })
          // Filter in JS (or use raw SQL for large datasets)
          const below = lowStock.filter(i => i.quantityOnHand <= i.reorderLevel)

          for (const item of below) {
            await redis.publish(
              `branch:${item.branchId}:events`,
              JSON.stringify({
                event:    'inventory:low-stock',
                drugId:   item.drugId,
                qty:      item.quantityOnHand,
                reorder:  item.reorderLevel,
              }),
            )
          }
          logger.info({ count: below.length }, 'Low stock check complete')
          break
        }

        case 'daily-backup': {
          // In production: pg_dump → gzip → upload to S3
          logger.info('Daily backup job started')
          // Implementation in jobs/backup.worker.ts
          break
        }
      }
    },
    { connection: redis, concurrency: 1 },
  )

  worker.on('failed', (job, err) =>
    logger.error({ jobId: job?.id, name: job?.name, err }, 'Scheduled job failed'),
  )

  return worker
}


// ════════════════════════════════════════════════════════════
// realtime/socket.ts
// Socket.io — real-time updates to all branch clients.
// Architecture:
//   DB write → Redis pub/sub publish → Socket.io subscribes
//   → emits to all clients in that branch's room
// This decouples the HTTP layer from the WebSocket layer.
// ════════════════════════════════════════════════════════════

import { Server }       from 'socket.io'
import { createClient } from 'redis'
import { env }          from '../config/env'
import { logger }       from '../lib/logger'
import { verifyAccessToken } from '../lib/tokens'

// Separate Redis subscriber connection (can't reuse the main client)
const subscriber = createClient({ url: env.REDIS_URL })

export function initSocket(httpServer: any) {
  const io = new Server(httpServer, {
    cors: { origin: env.CLIENT_URL, credentials: true },
    // Adaptive timeout for Kenya's variable connectivity
    pingTimeout:  60000,
    pingInterval: 25000,
    transports:   ['websocket', 'polling'], // polling fallback for weak connections
  })

  // ── Auth middleware for Socket.io ────────────────────
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token
    if (!token) return next(new Error('Authentication required'))
    try {
      const payload     = verifyAccessToken(token)
      socket.data.user  = payload
      next()
    } catch {
      next(new Error('Invalid token'))
    }
  })

  // ── Connection handler ────────────────────────────────
  io.on('connection', (socket) => {
    const { sub: userId, branchId, role } = socket.data.user

    // Join branch-specific room — all events scoped to branch
    socket.join(`branch:${branchId}`)
    logger.info({ userId, branchId, role }, 'Socket connected')

    socket.on('disconnect', (reason) => {
      logger.info({ userId, reason }, 'Socket disconnected')
    })
  })

  // ── Redis → Socket bridge ─────────────────────────────
  // Subscribe to all branch event channels.
  // Services publish to Redis; Socket.io broadcasts to clients.
  subscriber.connect().then(async () => {
    await subscriber.pSubscribe('branch:*:events', (message, channel) => {
      try {
        const data     = JSON.parse(message)
        const branchId = channel.split(':')[1]
        // Broadcast to all clients in this branch's room
        io.to(`branch:${branchId}`).emit(data.event, data)
      } catch (e) {
        logger.error({ e, channel }, 'Socket bridge parse error')
      }
    })
    logger.info('✅ Socket.io Redis bridge active')
  })

  return io
}


// ════════════════════════════════════════════════════════════
// lib/sms.ts — Africa's Talking SMS wrapper
// ════════════════════════════════════════════════════════════

import AfricasTalking from 'africastalking'
import { env }        from '../config/env'
import { logger }     from './logger'

const AT = AfricasTalking({
  apiKey:   env.AT_API_KEY ?? 'sandbox-key',
  username: env.AT_USERNAME,
})

const sms = AT.SMS

export const smsService = {
  async send({ to, message }: { to: string; message: string }) {
    if (!env.AT_API_KEY) {
      logger.info({ to, message }, '[SMS DRY RUN] Would send SMS')
      return
    }

    try {
      // Normalize Kenyan numbers: 07XX → +2547XX
      const normalized = to.startsWith('0')
        ? `+254${to.slice(1)}`
        : to.startsWith('254')
        ? `+${to}`
        : to

      const result = await sms.send({
        to:      [normalized],
        message,
        from:    env.AT_SENDER_ID,
      })

      logger.info({ to: normalized, status: result.SMSMessageData?.Recipients?.[0]?.status }, 'SMS sent')
      return result
    } catch (err) {
      logger.error({ err, to }, 'SMS failed')
      throw err // BullMQ will retry
    }
  },
}


// ════════════════════════════════════════════════════════════
// Updated server.ts — wire in workers + socket + cron
// ════════════════════════════════════════════════════════════

import http                    from 'http'
import app                     from './app'
import { env }                 from './config/env'
import { prisma }              from './config/prisma'
import { redis }               from './config/redis'
import { logger }              from './lib/logger'
import { initSocket }          from './realtime/socket'
import { startPrescriptionsWorker } from './jobs/prescriptions.worker'
import { startScheduledWorker, registerCronJobs } from './jobs/scheduled.worker'

const server = http.createServer(app)

// Attach Socket.io to the HTTP server
const io = initSocket(server)

async function start() {
  try {
    await prisma.$connect()
    logger.info('✅ PostgreSQL connected')

    // Start BullMQ workers
    startPrescriptionsWorker()
    startScheduledWorker()
    await registerCronJobs()
    logger.info('✅ BullMQ workers started')

    server.listen(env.PORT, () => {
      logger.info(`✅ PharmPro API :${env.PORT} [${env.NODE_ENV}]`)
    })
  } catch (e) {
    logger.fatal(e, '❌ Server start failed')
    process.exit(1)
  }
}

async function shutdown(sig: string) {
  logger.info(`${sig} — graceful shutdown`)
  server.close(async () => {
    await prisma.$disconnect()
    redis.disconnect()
    process.exit(0)
  })
  setTimeout(() => process.exit(1), 15_000)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT',  () => shutdown('SIGINT'))

start()