// ════════════════════════════════════════════════════════════
// modules/drugs/drugs.schema.ts
// ════════════════════════════════════════════════════════════

import { z } from 'zod'

export const createDrugSchema = z.object({
  brandName:          z.string().min(1, 'Brand name required'),
  genericName:        z.string().min(1, 'Generic name required'),
  drugClass:          z.string().optional(),
  dosageForm:         z.string().optional(),
  standardDose:       z.string().optional(),
  pregnancyCategory:  z.enum(['A','B','C','D','X']).optional(),
  contraindications:  z.string().optional(),
  storage:            z.string().optional(),
  manufacturer:       z.string().optional(),
  controlledCategory: z.enum([
    'OTC','PRESCRIPTION_ONLY','RESTRICTED',
    'SCHEDULE_I','SCHEDULE_II','SCHEDULE_III',
  ]).default('OTC'),
})

export const updateDrugSchema = createDrugSchema.partial()

export const drugSearchSchema = z.object({
  q:       z.string().optional(),
  class:   z.string().optional(),
  form:    z.string().optional(),
  controlled: z.coerce.boolean().optional(),
  page:    z.coerce.number().default(1),
  limit:   z.coerce.number().min(1).max(100).default(20),
})

export const interactionCheckSchema = z.object({
  drugAId: z.string().uuid('Invalid drug A ID'),
  drugBId: z.string().uuid('Invalid drug B ID'),
})

export const addInteractionSchema = z.object({
  drugAId:     z.string().uuid(),
  drugBId:     z.string().uuid(),
  severity:    z.enum(['MINOR','MODERATE','MAJOR','CONTRAINDICATED']),
  description: z.string().min(1),
  mechanism:   z.string().optional(),
  source:      z.string().optional(),
})

export type CreateDrugInput        = z.infer<typeof createDrugSchema>
export type UpdateDrugInput        = z.infer<typeof updateDrugSchema>
export type DrugSearchInput        = z.infer<typeof drugSearchSchema>
export type InteractionCheckInput  = z.infer<typeof interactionCheckSchema>
export type AddInteractionInput    = z.infer<typeof addInteractionSchema>


// ════════════════════════════════════════════════════════════
// modules/drugs/drugs.service.ts
// ════════════════════════════════════════════════════════════

import { prisma }  from '../../config/prisma'
import { logger }  from '../../lib/logger'
import type {
  CreateDrugInput,
  UpdateDrugInput,
  DrugSearchInput,
  AddInteractionInput,
} from './drugs.schema'

export class DrugsService {

  // ── Create drug ───────────────────────────────────────
  async create(input: CreateDrugInput, createdById: string) {
    const drug = await prisma.drug.create({
      data: {
        ...input,
        controlledCategory: input.controlledCategory as any,
        pregnancyCategory:  input.pregnancyCategory,
      },
    })

    await prisma.auditLog.create({
      data: {
        branchId:   'system', // drugs are global, not branch-scoped
        userId:     createdById,
        action:     'CREATE',
        entityType: 'Drug',
        entityId:   drug.id,
        newValue:   { brandName: drug.brandName, genericName: drug.genericName },
      },
    })

    logger.info({ drugId: drug.id, genericName: drug.genericName }, 'Drug added to database')
    return drug
  }

  // ── Search drugs ──────────────────────────────────────
  async search(input: DrugSearchInput) {
    const { q, page, limit } = input
    const skip = (page - 1) * limit

    const where: any = {
      isActive:  true,
      deletedAt: null,
      ...(input.class && { drugClass: { contains: input.class, mode: 'insensitive' } }),
      ...(input.form  && { dosageForm:{ contains: input.form,  mode: 'insensitive' } }),
      ...(input.controlled !== undefined && {
        controlledCategory: input.controlled
          ? { in: ['SCHEDULE_I','SCHEDULE_II','SCHEDULE_III'] }
          : { in: ['OTC','PRESCRIPTION_ONLY','RESTRICTED'] },
      }),
    }

    if (q) {
      where.OR = [
        { brandName:   { contains: q, mode: 'insensitive' } },
        { genericName: { contains: q, mode: 'insensitive' } },
        { drugClass:   { contains: q, mode: 'insensitive' } },
      ]
    }

    const [drugs, total] = await prisma.$transaction([
      prisma.drug.findMany({
        where,
        skip,
        take: limit,
        orderBy: { genericName: 'asc' },
        include: {
          _count: {
            select: { inventory: true, prescriptionItems: true },
          },
        },
      }),
      prisma.drug.count({ where }),
    ])

    return {
      data: drugs,
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
    }
  }

  // ── Get single drug with full detail ──────────────────
  async findById(drugId: string) {
    const drug = await prisma.drug.findFirst({
      where:   { id: drugId, deletedAt: null },
      include: {
        interactionsAsA: {
          where:   { isActive: true },
          include: { drugB: { select: { genericName: true, brandName: true } } },
        },
        interactionsAsB: {
          where:   { isActive: true },
          include: { drugA: { select: { genericName: true, brandName: true } } },
        },
        medicationBatches: {
          where:   { isRecalled: false },
          orderBy: { expiryDate: 'asc' },
        },
      },
    })
    if (!drug) throw Object.assign(new Error('Drug not found'), { status: 404 })

    // Merge interactions from both sides of the relation
    const interactions = [
      ...drug.interactionsAsA.map(ix => ({
        withDrug:    ix.drugB.genericName,
        severity:    ix.severity,
        description: ix.description,
        mechanism:   ix.mechanism,
        source:      ix.source,
      })),
      ...drug.interactionsAsB.map(ix => ({
        withDrug:    ix.drugA.genericName,
        severity:    ix.severity,
        description: ix.description,
        mechanism:   ix.mechanism,
        source:      ix.source,
      })),
    ]

    return { ...drug, interactions }
  }

  // ── Update drug ───────────────────────────────────────
  async update(drugId: string, input: UpdateDrugInput, updatedById: string) {
    const existing = await prisma.drug.findFirst({ where: { id: drugId, deletedAt: null } })
    if (!existing) throw Object.assign(new Error('Drug not found'), { status: 404 })

    const updated = await prisma.drug.update({
      where: { id: drugId },
      data:  {
        ...input,
        controlledCategory: input.controlledCategory as any,
      },
    })

    await prisma.auditLog.create({
      data: {
        branchId:   'system',
        userId:     updatedById,
        action:     'UPDATE',
        entityType: 'Drug',
        entityId:   drugId,
        oldValue:   existing as any,
        newValue:   updated  as any,
      },
    })

    return updated
  }

  // ── Soft delete drug ──────────────────────────────────
  async softDelete(drugId: string, deletedById: string) {
    const drug = await prisma.drug.findFirst({ where: { id: drugId, deletedAt: null } })
    if (!drug) throw Object.assign(new Error('Drug not found'), { status: 404 })

    return prisma.drug.update({
      where: { id: drugId },
      data:  { deletedAt: new Date(), isActive: false },
    })
  }

  // ── Check interaction between two specific drugs ──────
  async checkInteraction(drugAId: string, drugBId: string) {
    const interaction = await prisma.drugInteraction.findFirst({
      where: {
        isActive: true,
        OR: [
          { drugAId, drugBId },
          { drugAId: drugBId, drugBId: drugAId },
        ],
      },
      include: {
        drugA: { select: { genericName: true } },
        drugB: { select: { genericName: true } },
      },
    })

    if (!interaction) {
      return { found: false, message: 'No known interaction found in database. Always verify with current clinical references.' }
    }

    return {
      found:       true,
      severity:    interaction.severity,
      description: interaction.description,
      mechanism:   interaction.mechanism,
      source:      interaction.source,
      drugA:       interaction.drugA.genericName,
      drugB:       interaction.drugB.genericName,
    }
  }

  // ── Add interaction ───────────────────────────────────
  async addInteraction(input: AddInteractionInput, createdById: string) {
    const existing = await prisma.drugInteraction.findFirst({
      where: {
        OR: [
          { drugAId: input.drugAId, drugBId: input.drugBId },
          { drugAId: input.drugBId, drugBId: input.drugAId },
        ],
      },
    })
    if (existing) throw Object.assign(new Error('Interaction already recorded'), { status: 409 })

    const ix = await prisma.drugInteraction.create({
      data: {
        drugAId:     input.drugAId,
        drugBId:     input.drugBId,
        severity:    input.severity as any,
        description: input.description,
        mechanism:   input.mechanism,
        source:      input.source,
      },
    })

    await prisma.auditLog.create({
      data: {
        branchId:   'system',
        userId:     createdById,
        action:     'CREATE',
        entityType: 'DrugInteraction',
        entityId:   ix.id,
        newValue:   input as any,
      },
    })

    return ix
  }

  // ── Batch recall ──────────────────────────────────────
  // Mark a batch as recalled and return all affected patients
  async recallBatch(batchId: string, reason: string, recalledById: string) {
    const batch = await prisma.medicationBatch.findUnique({ where: { id: batchId } })
    if (!batch) throw Object.assign(new Error('Batch not found'), { status: 404 })

    await prisma.medicationBatch.update({
      where: { id: batchId },
      data:  { isRecalled: true, recallReason: reason, recalledAt: new Date() },
    })

    // Find all patients who received this batch
    const affectedItems = await prisma.prescriptionItem.findMany({
      where:   { batchId },
      include: { prescription: { include: { patient: true } } },
      distinct: ['prescriptionId'],
    })

    const affectedPatients = affectedItems.map(i => ({
      patientId:  i.prescription.patient.id,
      name:       `${i.prescription.patient.firstName} ${i.prescription.patient.lastName}`,
      phone:      i.prescription.patient.phone,
      rxNumber:   i.prescription.rxNumber,
    }))

    await prisma.auditLog.create({
      data: {
        branchId:   'system',
        userId:     recalledById,
        action:     'UPDATE',
        entityType: 'MedicationBatch',
        entityId:   batchId,
        newValue:   { isRecalled: true, reason, affectedCount: affectedPatients.length } as any,
      },
    })

    logger.warn(
      { batchId, reason, affectedCount: affectedPatients.length },
      '⚠️  Batch recalled',
    )

    return { batch: { ...batch, isRecalled: true, recallReason: reason }, affectedPatients }
  }
}

export const drugsService = new DrugsService()


// ════════════════════════════════════════════════════════════
// modules/drugs/drugs.controller.ts
// ════════════════════════════════════════════════════════════

import { Request, Response, NextFunction } from 'express'
import { drugsService }                    from './drugs.service'
import {
  createDrugSchema,
  updateDrugSchema,
  drugSearchSchema,
  interactionCheckSchema,
  addInteractionSchema,
}                                          from './drugs.schema'

export class DrugsController {

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const input = createDrugSchema.parse(req.body)
      const drug  = await drugsService.create(input, req.user!.sub)
      res.status(201).json({ success: true, data: drug })
    } catch (e) { next(e) }
  }

  async search(req: Request, res: Response, next: NextFunction) {
    try {
      const input  = drugSearchSchema.parse(req.query)
      const result = await drugsService.search(input)
      res.json({ success: true, ...result })
    } catch (e) { next(e) }
  }

  async findById(req: Request, res: Response, next: NextFunction) {
    try {
      const drug = await drugsService.findById(req.params.id)
      res.json({ success: true, data: drug })
    } catch (e) { next(e) }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const input = updateDrugSchema.parse(req.body)
      const drug  = await drugsService.update(req.params.id, input, req.user!.sub)
      res.json({ success: true, data: drug })
    } catch (e) { next(e) }
  }

  async softDelete(req: Request, res: Response, next: NextFunction) {
    try {
      await drugsService.softDelete(req.params.id, req.user!.sub)
      res.json({ success: true, message: 'Drug deactivated' })
    } catch (e) { next(e) }
  }

  async checkInteraction(req: Request, res: Response, next: NextFunction) {
    try {
      const { drugAId, drugBId } = interactionCheckSchema.parse(req.query)
      const result = await drugsService.checkInteraction(drugAId, drugBId)
      res.json({ success: true, data: result })
    } catch (e) { next(e) }
  }

  async addInteraction(req: Request, res: Response, next: NextFunction) {
    try {
      const input = addInteractionSchema.parse(req.body)
      const ix    = await drugsService.addInteraction(input, req.user!.sub)
      res.status(201).json({ success: true, data: ix })
    } catch (e) { next(e) }
  }

  async recallBatch(req: Request, res: Response, next: NextFunction) {
    try {
      const { reason } = req.body
      if (!reason) throw Object.assign(new Error('Recall reason required'), { status: 400 })
      const result = await drugsService.recallBatch(req.params.batchId, reason, req.user!.sub)
      res.json({ success: true, data: result })
    } catch (e) { next(e) }
  }
}

export const drugsController = new DrugsController()


// ════════════════════════════════════════════════════════════
// modules/drugs/drugs.router.ts
// ════════════════════════════════════════════════════════════

import { Router }         from 'express'
import { drugsController} from './drugs.controller'
import { authenticate }   from '../../middleware/authenticate'
import { authorize }      from '../../middleware/authorize'

const router = Router()
router.use(authenticate)

// Drug CRUD
router.get ('/',     drugsController.search.bind(drugsController))
router.post('/',
  authorize(['SUPER_ADMIN','PHARMACIST']),
  drugsController.create.bind(drugsController),
)
router.get ('/:id',  drugsController.findById.bind(drugsController))
router.patch('/:id',
  authorize(['SUPER_ADMIN','PHARMACIST']),
  drugsController.update.bind(drugsController),
)
router.delete('/:id',
  authorize(['SUPER_ADMIN']),
  drugsController.softDelete.bind(drugsController),
)

// Interactions
router.get ('/interactions/check',
  drugsController.checkInteraction.bind(drugsController),
)
router.post('/interactions',
  authorize(['SUPER_ADMIN','PHARMACIST']),
  drugsController.addInteraction.bind(drugsController),
)

// Batch recall (SUPER_ADMIN only)
router.post('/batches/:batchId/recall',
  authorize(['SUPER_ADMIN']),
  drugsController.recallBatch.bind(drugsController),
)

export default router