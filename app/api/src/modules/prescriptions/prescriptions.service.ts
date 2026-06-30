// ════════════════════════════════════════════════════════════
// modules/prescriptions/prescriptions.service.ts
//
// Load considerations baked in:
// - Safety checks run in parallel (Promise.all)
// - Dispense runs in a serializable DB transaction
// - Inventory uses SELECT FOR UPDATE (no overselling)
// - Rx number generation uses Redis INCR (atomic, no DB round-trip)
// - Read queries paginated with indexed columns only
// - Queue status updates emit Socket.io events (non-blocking)
// - Heavy operations (PDF, SMS) delegated to BullMQ workers
// - All writes include audit log in same transaction
// ════════════════════════════════════════════════════════════

import { Prisma }          from '@prisma/client'
import { prisma }          from '../../config/prisma'
import { redis }           from '../../config/redis'
import { logger }          from '../../lib/logger'
import { generateNumber }  from '../../lib/numbering'
import { runSafetyChecks } from '../../lib/safety/safetyEngine'
import { inventoryService }from '../inventory/inventory.service'
import { rxQueue }         from '../../jobs/queues'
import type {
  CreatePrescriptionInput,
  UpdatePrescriptionInput,
  DispenseInput,
  RefillInput,
  RxSearchInput,
} from './prescriptions.schema'

// Branch code lookup — cached in Redis
async function getBranchCode(branchId: string): Promise<string> {
  const cacheKey = `branch:code:${branchId}`
  const cached   = await redis.get(cacheKey)
  if (cached) return cached

  const branch = await prisma.branch.findUniqueOrThrow({
    where:  { id: branchId },
    select: { town: true },
  })
  const code = branch.town.slice(0, 3).toUpperCase() // "Eldoret" → "ELD"
  await redis.setex(cacheKey, 86400, code)
  return code
}

export class PrescriptionsService {

  // ── Create prescription ───────────────────────────────
  // Runs safety checks BEFORE persisting anything.
  // Warnings are stored on the prescription record.
  async create(
    input:       CreatePrescriptionInput,
    branchId:    string,
    createdById: string,
  ) {
    // 1. Confirm patient belongs to this branch
    const patient = await prisma.patient.findFirst({
      where:  { id: input.patientId, branchId, deletedAt: null },
      select: {
        id: true, firstName: true, lastName: true,
        currentMedications: true, pregnancyStatus: true,
        isBreastfeeding: true,
      },
    })
    if (!patient) throw Object.assign(new Error('Patient not found'), { status: 404 })

    // 2. Run all safety checks in parallel
    const drugIds = input.items.map(i => i.drugId)
    const safetyResult = await runSafetyChecks({
      patientId:          patient.id,
      drugIds,
      currentMedications: patient.currentMedications,
    })

    // 3. Generate unique Rx number via Redis atomic increment
    const branchCode = await getBranchCode(branchId)
    const rxNumber   = await generateNumber('RX', branchCode)

    // 4. Persist prescription + items in a transaction
    const prescription = await prisma.$transaction(async (tx) => {
      const rx = await tx.prescription.create({
        data: {
          rxNumber,
          branchId,
          patientId:       input.patientId,
          doctorName:      input.doctorName,
          doctorLicenseNo: input.doctorLicenseNo,
          doctorPhone:     input.doctorPhone,
          doctorFacility:  input.doctorFacility,
          diagnosis:       input.diagnosis,
          priority:        input.priority as any,
          insurance:       input.insurance,
          policyNo:        input.policyNo,
          preAuthCode:     input.preAuthCode,
          refillsAllowed:  input.refillsAllowed,
          reviewDate:      input.reviewDate ? new Date(input.reviewDate) : null,
          notes:           input.notes,
          // Store warnings snapshot — what was shown at creation time
          interactionWarnings: safetyResult.warnings as unknown as Prisma.JsonArray,
          // URGENT/EMERGENCY → skip directly to VERIFIED
          status: input.priority === 'EMERGENCY' ? 'VERIFIED' : 'PENDING_VERIFICATION',
        },
        include: { patient: { select: { firstName: true, lastName: true } } },
      })

      // Create prescription items
      await tx.prescriptionItem.createMany({
        data: input.items.map(item => ({
          prescriptionId:      rx.id,
          drugId:              item.drugId,
          dose:                item.dose,
          route:               item.route as any,
          frequency:           item.frequency,
          duration:            item.duration,
          durationUnit:        item.durationUnit as any,
          quantity:            item.quantity,
          specialInstructions: item.specialInstructions,
          // Record if warnings were shown at creation
          interactionWarningsShown: safetyResult.warnings.some(
            w => w.type === 'INTERACTION' && (w.meta?.drugId as string) === item.drugId,
          ),
          allergyWarningShown: safetyResult.warnings.some(
            w => w.type === 'ALLERGY' && (w.meta?.drugId as string) === item.drugId,
          ),
        })),
      })

      // Audit log inside same transaction
      await tx.auditLog.create({
        data: {
          branchId,
          userId:     createdById,
          action:     'CREATE',
          entityType: 'Prescription',
          entityId:   rx.id,
          newValue:   {
            rxNumber,
            patientId: input.patientId,
            priority:  input.priority,
            drugCount: input.items.length,
            warnings:  safetyResult.warnings.length,
          } as any,
        },
      })

      return rx
    })

    // 5. Increment pending queue badge (non-blocking)
    await redis.incr(`rx:queue:${branchId}`)

    // 6. Enqueue SMS notification to patient if they have a phone (BullMQ)
    await rxQueue.add('rx-created-sms', {
      prescriptionId: prescription.id,
      patientId:      input.patientId,
      branchId,
      rxNumber,
      priority:       input.priority,
    }, {
      attempts: 3,
      backoff:  { type: 'exponential', delay: 5000 },
    })

    logger.info(
      { rxNumber, patientId: input.patientId, warnings: safetyResult.warnings.length },
      'Prescription created',
    )

    return { prescription, safetyResult }
  }

  // ── Verify prescription ───────────────────────────────
  async verify(rxId: string, branchId: string, verifiedById: string) {
    const rx = await this.findAndValidate(rxId, branchId)

    if (!['PENDING_VERIFICATION','ON_HOLD'].includes(rx.status)) {
      throw Object.assign(
        new Error(`Cannot verify prescription with status ${rx.status}`),
        { status: 400 },
      )
    }

    const updated = await prisma.$transaction(async (tx) => {
      const upd = await tx.prescription.update({
        where: { id: rxId },
        data:  {
          status:       'VERIFIED',
          verifiedById,
          verifiedAt:   new Date(),
        },
      })

      await tx.auditLog.create({
        data: {
          branchId,
          userId:     verifiedById,
          action:     'UPDATE',
          entityType: 'Prescription',
          entityId:   rxId,
          oldValue:   { status: rx.status } as any,
          newValue:   { status: 'VERIFIED', verifiedById } as any,
        },
      })

      return upd
    })

    // Emit real-time update to all branch clients
    await this.emitQueueUpdate(branchId)
    return updated
  }

  // ── Dispense prescription ─────────────────────────────
  // This is the most critical operation in the system.
  // It:
  //   1. Re-runs safety checks (not skipped because time may have passed)
  //   2. Validates override acknowledgments for all warnings
  //   3. Deducts inventory inside a serializable transaction
  //   4. Logs controlled substances separately
  //   5. Updates prescription status atomically
  //   6. Emits real-time update
  //   7. Enqueues receipt + SMS to BullMQ
  async dispense(
    rxId:       string,
    input:      DispenseInput,
    branchId:   string,
    dispensedById: string,
  ) {
    const rx = await prisma.prescription.findFirst({
      where:   { id: rxId, branchId, deletedAt: null },
      include: {
        patient: {
          select: {
            id: true, firstName: true, lastName: true,
            phone: true, currentMedications: true,
          },
        },
        items: {
          include: { drug: true },
        },
      },
    })

    if (!rx) throw Object.assign(new Error('Prescription not found'), { status: 404 })
    if (!['VERIFIED','PROCESSING'].includes(rx.status)) {
      throw Object.assign(
        new Error(`Cannot dispense prescription with status ${rx.status}`),
        { status: 400 },
      )
    }

    // ── Safety re-check ──────────────────────────────────
    const drugIds = rx.items.map(i => i.drugId)
    const safety  = await runSafetyChecks({
      patientId:          rx.patient.id,
      drugIds,
      currentMedications: rx.patient.currentMedications,
    })

    // ── Validate override acknowledgments ────────────────
    const warningsRequiringOverride = safety.warnings.filter(w => w.requiresOverride)
    for (const warning of warningsRequiringOverride) {
      const ack = input.overriddenWarnings.find(o => o.type === warning.type)
      if (!ack) {
        throw Object.assign(
          new Error(
            `Warning requires acknowledgment: ${warning.title}. Provide override reason.`,
          ),
          { status: 422 },
        )
      }
    }

    // ── Dispense in a serializable transaction ────────────
    const result = await prisma.$transaction(async (tx) => {

      // Deduct inventory for each item (SELECT FOR UPDATE inside)
      for (const dispItem of input.items) {
        const rxItem = rx.items.find(i => i.id === dispItem.prescriptionItemId)
        if (!rxItem) {
          throw Object.assign(
            new Error(`Item ${dispItem.prescriptionItemId} not on this prescription`),
            { status: 400 },
          )
        }
        if (dispItem.quantityDispensed > rxItem.quantity - rxItem.dispensedQty) {
          throw Object.assign(
            new Error(
              `Quantity ${dispItem.quantityDispensed} exceeds remaining `
              + `${rxItem.quantity - rxItem.dispensedQty} for ${rxItem.drug.genericName}`,
            ),
            { status: 400 },
          )
        }

        // Lock + deduct inventory
        await inventoryService.deductStock(
          tx,
          dispItem.inventoryId,
          dispItem.quantityDispensed,
          rxId,
          dispensedById,
          branchId,
        )

        // Update dispensed quantity on item
        await tx.prescriptionItem.update({
          where: { id: dispItem.prescriptionItemId },
          data:  {
            dispensedQty: { increment: dispItem.quantityDispensed },
            batchId:      `batch-${
              (await tx.inventory.findUnique({
                where:  { id: dispItem.inventoryId },
                select: { batchNo: true, drugId: true },
              }))!.batchNo
            }-${rxItem.drugId}`,
          },
        })
      }

      // Check if fully dispensed
      const updatedItems = await tx.prescriptionItem.findMany({
        where: { prescriptionId: rxId },
      })
      const fullyDispensed = updatedItems.every(i => i.dispensedQty >= i.quantity)

      // Update prescription status
      const updatedRx = await tx.prescription.update({
        where: { id: rxId },
        data:  {
          status:        fullyDispensed ? 'DISPENSED' : 'PROCESSING',
          dispensedById,
          dispensedAt:   fullyDispensed ? new Date() : null,
        },
        include: {
          items:   { include: { drug: true } },
          patient: { select: { firstName: true, lastName: true, phone: true } },
        },
      })

      // Record override acknowledgments in audit
      await tx.auditLog.create({
        data: {
          branchId,
          userId:     dispensedById,
          action:     'DISPENSE',
          entityType: 'Prescription',
          entityId:   rxId,
          newValue:   {
            status:       updatedRx.status,
            dispensedAt:  updatedRx.dispensedAt,
            overrides:    input.overriddenWarnings,
            safetyWarnings: safety.warnings.length,
            itemsDispensed: input.items.length,
          } as any,
        },
      })

      // Log controlled substances separately
      for (const rxItem of rx.items) {
        if (['SCHEDULE_I','SCHEDULE_II','SCHEDULE_III']
          .includes(rxItem.drug.controlledCategory)) {
          const inv = await tx.inventory.findUnique({
            where:  { id: input.items.find(i => i.prescriptionItemId === rxItem.id)?.inventoryId ?? '' },
            select: { batchNo: true },
          })

          if (inv) {
            await tx.controlledSubstanceLog.create({
              data: {
                branchId,
                dispensedById,
                prescriptionId:    rxId,
                drugId:            rxItem.drugId,
                batchNo:           inv.batchNo ?? 'UNKNOWN',
                quantity:          input.items.find(i =>
                  i.prescriptionItemId === rxItem.id)?.quantityDispensed ?? 0,
                patientName:
                  `${rx.patient.firstName} ${rx.patient.lastName}`,
                prescriberName:    rx.doctorName,
                prescriberLicense: rx.doctorLicenseNo ?? undefined,
              },
            })
          }
        }
      }

      return updatedRx
    }, {
      // Serializable isolation — prevents phantom reads under concurrent load
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    })

    // ── Decrement queue counter ──────────────────────────
    await redis.decr(`rx:queue:${branchId}`)

    // ── Emit real-time update ────────────────────────────
    await this.emitQueueUpdate(branchId)

    // ── Enqueue receipt + SMS (non-blocking) ─────────────
    await rxQueue.addBulk([
      {
        name: 'dispense-receipt',
        data: { prescriptionId: rxId, branchId, dispensedById },
        opts: { attempts: 3 },
      },
      {
        name: 'dispense-sms',
        data: {
          prescriptionId: rxId,
          patientId:      rx.patient.id,
          branchId,
          rxNumber:       rx.rxNumber,
        },
        opts: { attempts: 3, backoff: { type: 'exponential', delay: 3000 } },
      },
    ])

    logger.info(
      { rxId, rxNumber: rx.rxNumber, dispensedById, warnings: safety.warnings.length },
      'Prescription dispensed',
    )

    return { prescription: result, safetyResult: safety }
  }

  // ── Refill prescription ───────────────────────────────
  async refill(rxId: string, input: RefillInput, branchId: string, dispensedById: string) {
    const rx = await prisma.prescription.findFirst({
      where:   { id: rxId, branchId, deletedAt: null },
      include: { items: true, patient: { select: { id: true, currentMedications: true } } },
    })

    if (!rx) throw Object.assign(new Error('Prescription not found'), { status: 404 })
    if (rx.status !== 'DISPENSED') {
      throw Object.assign(new Error('Only dispensed prescriptions can be refilled'), { status: 400 })
    }
    if (rx.refillsUsed >= rx.refillsAllowed) {
      throw Object.assign(
        new Error(`No refills remaining (${rx.refillsAllowed} allowed, ${rx.refillsUsed} used)`),
        { status: 400 },
      )
    }

    // Check if patient is eligible (not too early)
    const lastRefill = await prisma.prescriptionRefill.findFirst({
      where:   { prescriptionId: rxId },
      orderBy: { dispensedAt: 'desc' },
    })
    if (lastRefill?.nextEligibleAt && lastRefill.nextEligibleAt > new Date()) {
      throw Object.assign(
        new Error(
          `Refill not yet due. Eligible from ${lastRefill.nextEligibleAt.toDateString()}`,
        ),
        { status: 400 },
      )
    }

    // Safety re-check on refill too
    const safety = await runSafetyChecks({
      patientId:          rx.patient.id,
      drugIds:            rx.items.map(i => i.drugId),
      currentMedications: rx.patient.currentMedications,
    })

    const refillNumber = rx.refillsUsed + 1

    await prisma.$transaction(async (tx) => {
      // Deduct inventory for each item
      for (const refillItem of input.items) {
        const rxItem = rx.items.find(i => i.id === refillItem.prescriptionItemId)
        if (!rxItem) continue

        await inventoryService.deductStock(
          tx,
          refillItem.inventoryId,
          refillItem.quantityDispensed,
          rxId,
          dispensedById,
          branchId,
        )
      }

      // Create refill record
      const totalQty = input.items.reduce((s, i) => s + i.quantityDispensed, 0)
      await tx.prescriptionRefill.create({
        data: {
          prescriptionId:    rxId,
          refillNumber,
          quantityDispensed: totalQty,
          dispensedById,
          dispensedAt:       new Date(),
          // Next eligible = 25 days (assume monthly refill, early pickup window)
          nextEligibleAt:    new Date(Date.now() + 25 * 24 * 60 * 60 * 1000),
          notes:             input.notes,
        },
      })

      // Update refillsUsed
      await tx.prescription.update({
        where: { id: rxId },
        data:  { refillsUsed: { increment: 1 } },
      })

      await tx.auditLog.create({
        data: {
          branchId,
          userId:     dispensedById,
          action:     'UPDATE',
          entityType: 'PrescriptionRefill',
          entityId:   rxId,
          newValue:   { refillNumber, totalQty, dispensedById } as any,
        },
      })
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

    logger.info({ rxId, refillNumber }, 'Prescription refilled')
    return { refillNumber, refillsRemaining: rx.refillsAllowed - refillNumber, safety }
  }

  // ── Cancel prescription ───────────────────────────────
  async cancel(rxId: string, reason: string, branchId: string, cancelledById: string) {
    const rx = await this.findAndValidate(rxId, branchId)

    if (['DISPENSED','CANCELLED'].includes(rx.status)) {
      throw Object.assign(
        new Error(`Cannot cancel prescription with status ${rx.status}`),
        { status: 400 },
      )
    }

    await prisma.$transaction(async (tx) => {
      await tx.prescription.update({
        where: { id: rxId },
        data:  { status: 'CANCELLED' },
      })

      await tx.auditLog.create({
        data: {
          branchId,
          userId:     cancelledById,
          action:     'UPDATE',
          entityType: 'Prescription',
          entityId:   rxId,
          oldValue:   { status: rx.status } as any,
          newValue:   { status: 'CANCELLED', reason, cancelledById } as any,
        },
      })
    })

    await redis.decr(`rx:queue:${branchId}`)
    await this.emitQueueUpdate(branchId)
  }

  // ── Search / list prescriptions ───────────────────────
  async search(input: RxSearchInput, branchId: string) {
    const { q, status, priority, patientId, date, page, limit } = input
    const skip = (page - 1) * limit

    const where: Prisma.PrescriptionWhereInput = {
      branchId,
      deletedAt: null,
      ...(status    && { status:   status   as any }),
      ...(priority  && { priority: priority as any }),
      ...(patientId && { patientId }),
      ...(date && {
        createdAt: {
          gte: new Date(`${date}T00:00:00.000Z`),
          lte: new Date(`${date}T23:59:59.999Z`),
        },
      }),
      ...(q && {
        OR: [
          { rxNumber: { contains: q, mode: 'insensitive' } },
          { patient:  { firstName: { contains: q, mode: 'insensitive' } } },
          { patient:  { lastName:  { contains: q, mode: 'insensitive' } } },
          { doctorName:{ contains: q, mode: 'insensitive' } },
        ],
      }),
    }

    const [prescriptions, total] = await prisma.$transaction([
      prisma.prescription.findMany({
        where,
        skip,
        take:    limit,
        orderBy: [
          // EMERGENCY first, then URGENT, then NORMAL, then by time
          { priority:  'desc' },
          { createdAt: 'desc' },
        ],
        include: {
          patient:     { select: { firstName: true, lastName: true, phone: true, nhifNo: true } },
          items:       { include: { drug: { select: { genericName: true, brandName: true } } } },
          verifiedBy:  { select: { firstName: true, lastName: true } },
          dispensedBy: { select: { firstName: true, lastName: true } },
        },
      }),
      prisma.prescription.count({ where }),
    ])

    return {
      data: prescriptions,
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
    }
  }

  // ── Get single prescription ───────────────────────────
  async findById(rxId: string, branchId: string) {
    const rx = await prisma.prescription.findFirst({
      where: { id: rxId, branchId, deletedAt: null },
      include: {
        patient: {
          include: {
            allergies: { where: { isActive: true } },
          },
        },
        items: {
          include: {
            drug:  true,
            batch: true,
          },
        },
        attachments: true,
        refills:     { orderBy: { dispensedAt: 'desc' } },
        verifiedBy:  { select: { firstName: true, lastName: true } },
        dispensedBy: { select: { firstName: true, lastName: true } },
      },
    })
    if (!rx) throw Object.assign(new Error('Prescription not found'), { status: 404 })
    return rx
  }

  // ── Get live queue stats for dashboard ────────────────
  // Uses Redis counter for instant response — no DB query
  async getQueueStats(branchId: string) {
    // Redis cache first
    const cacheKey = `rx:stats:${branchId}`
    const cached   = await redis.get(cacheKey)
    if (cached) return JSON.parse(cached)

    const [pending, processing, ready, urgent] = await prisma.$transaction([
      prisma.prescription.count({
        where: { branchId, status: 'PENDING_VERIFICATION', deletedAt: null },
      }),
      prisma.prescription.count({
        where: { branchId, status: 'PROCESSING', deletedAt: null },
      }),
      prisma.prescription.count({
        where: { branchId, status: 'READY', deletedAt: null },
      }),
      prisma.prescription.count({
        where: {
          branchId,
          deletedAt: null,
          priority:  { in: ['URGENT','EMERGENCY'] },
          status:    { notIn: ['DISPENSED','CANCELLED'] },
        },
      }),
    ])

    const stats = { pending, processing, ready, urgent, total: pending + processing + ready }
    await redis.setex(cacheKey, 30, JSON.stringify(stats)) // cache 30s only
    return stats
  }

  // ── Run safety check without creating prescription ────
  // Used by frontend to show warnings in real time as pharmacist
  // selects drugs, before they even submit the form.
  async preCheck(patientId: string, drugIds: string[], branchId: string) {
    const patient = await prisma.patient.findFirst({
      where:  { id: patientId, branchId, deletedAt: null },
      select: { currentMedications: true },
    })
    if (!patient) throw Object.assign(new Error('Patient not found'), { status: 404 })

    return runSafetyChecks({
      patientId,
      drugIds,
      currentMedications: patient.currentMedications,
    })
  }

  // ── Update status (VERIFIED → READY etc.) ─────────────
  async updateStatus(
    rxId:      string,
    status:    string,
    branchId:  string,
    userId:    string,
  ) {
    const rx = await this.findAndValidate(rxId, branchId)

    const allowed: Record<string, string[]> = {
      PENDING_VERIFICATION: ['VERIFIED','CANCELLED','ON_HOLD'],
      VERIFIED:             ['PROCESSING','READY','CANCELLED','ON_HOLD'],
      PROCESSING:           ['READY','CANCELLED','ON_HOLD'],
      READY:                ['DISPENSED','CANCELLED'],
      ON_HOLD:              ['VERIFIED','CANCELLED'],
    }

    if (!allowed[rx.status]?.includes(status)) {
      throw Object.assign(
        new Error(`Invalid status transition: ${rx.status} → ${status}`),
        { status: 400 },
      )
    }

    const updated = await prisma.$transaction(async (tx) => {
      const upd = await tx.prescription.update({
        where: { id: rxId },
        data:  { status: status as any },
      })

      await tx.auditLog.create({
        data: {
          branchId,
          userId,
          action:     'UPDATE',
          entityType: 'Prescription',
          entityId:   rxId,
          oldValue:   { status: rx.status } as any,
          newValue:   { status } as any,
        },
      })

      return upd
    })

    await this.emitQueueUpdate(branchId)
    return updated
  }

  // ── Private helpers ───────────────────────────────────

  private async findAndValidate(rxId: string, branchId: string) {
    const rx = await prisma.prescription.findFirst({
      where: { id: rxId, branchId, deletedAt: null },
    })
    if (!rx) throw Object.assign(new Error('Prescription not found'), { status: 404 })
    return rx
  }

  // Publish queue update to Redis pub/sub → Socket.io picks it up
  private async emitQueueUpdate(branchId: string) {
    await redis.publish(
      `branch:${branchId}:events`,
      JSON.stringify({ event: 'queue:updated', branchId, timestamp: Date.now() }),
    )
    // Invalidate stats cache
    await redis.del(`rx:stats:${branchId}`)
  }
}

export const prescriptionsService = new PrescriptionsService()