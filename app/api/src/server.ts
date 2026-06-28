---
# apps/api/src/server.ts — entrypoint (separate from app.ts so we can test app.ts without binding a port)
# This file:
# - starts the HTTP server
# - starts Socket.io
# - runs BullMQ workers
# - handles graceful shutdown

import http          from 'http'
import app           from './app'
import { env }       from './config/env'
import { prisma }    from './config/prisma'
import { redis }     from './config/redis'
import { logger }    from './lib/logger'
# import { initSocket }  from './realtime/socket'    # Step 8
# import { startWorkers } from './jobs'              # Step 9

const server = http.createServer(app)

# initSocket(server)   # Step 8 — Socket.io attached to same HTTP server
# startWorkers()       # Step 9 — BullMQ workers

async function start() {
  try {
    # Test DB connection
    await prisma.$connect()
    logger.info('✅ PostgreSQL connected')

    server.listen(env.PORT, () => {
      logger.info(`✅ PharmPro API running on port ${env.PORT} [${env.NODE_ENV}]`)
    })
  } catch (e) {
    logger.fatal(e, '❌ Failed to start server')
    process.exit(1)
  }
}

# ── Graceful shutdown ──────────────────────────────────────
async function shutdown(signal: string) {
  logger.info(`${signal} received — shutting down gracefully`)
  server.close(async () => {
    await prisma.$disconnect()
    redis.disconnect()
    logger.info('Server closed. Goodbye.')
    process.exit(0)
  })
  # Force close after 10s if hanging
  setTimeout(() => process.exit(1), 10_000)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT',  () => shutdown('SIGINT'))

start()