// ════════════════════════════════════════════════════════════
// modules/patients/patients.schema.ts
// Africa-first: only firstName + lastName are required.
// Everything else is optional — phone, email, ID, insurance.
// ════════════════════════════════════════════════════════════

import { z } from 'zod'

export const createPatientSchema = z.object({
  firstName:          z.string().min(1, 'First name required'),
  lastName:           z.string().min(1, 'Last name required'),
  nickname:           z.string().optional(),

  // Contact — all optional
  phone:              z.string().optional().nullable(),
  altPhone:           z.string().optional().nullable(),
  email:              z.string().email().optional().nullable(),

  // Demographics — all optional
  dateOfBirth:        z.string().datetime().optional().nullable(),
  gender:             z.enum(['M','F','Other','Prefer not to say']).optional().nullable(),
  bloodGroup:         z.enum(['A+','A-','B+','B-','O+','O-','AB+','AB-','Unknown'])
                        .optional().nullable(),

  // Identity docs — all optional
  nationalId:         z.string().optional().nullable(),
  nhifNo:             z.string().optional().nullable(),
  passportNo:         z.string().optional().nullable(),
  birthCertNo:        z.string().optional().nullable(),

  // Insurance — all optional
  insurance:          z.string().optional().nullable(),
  policyNo:           z.string().optional().nullable(),
  insuranceExpiry:    z.string().datetime().optional().nullable(),

  // Clinical flags
  pregnancyStatus:    z.enum(['NOT_PREGNANT','PREGNANT','BREASTFEEDING','UNKNOWN'])
                        .default('UNKNOWN'),
  isBreastfeeding:    z.boolean().default(false),
  chronicConditions:  z.array(z.string()).default([]),
  currentMedications: z.array(z.string()).default([]),
})

export const updatePatientSchema = createPatientSchema.partial()

export const createAllergySchema = z.object({
  allergen:    z.string().min(1, 'Allergen name required'),
  allergenType:z.enum(['DRUG','FOOD','ENVIRONMENTAL','OTHER']),
  severity:    z.enum(['MILD','MODERATE','SEVERE','LIFE_THREATENING','UNKNOWN']),
  reaction:    z.string().optional(),
  notes:       z.string().optional(),
})

export const patientSearchSchema = z.object({
  q:         z.string().optional(),        // name, phone, ID fuzzy search
  condition: z.string().optional(),
  insurance: z.string().optional(),
  refillDue: z.coerce.boolean().optional(),
  page:      z.coerce.number().default(1),
  limit:     z.coerce.number().min(1).max(100).default(20),
})

export type CreatePatientInput = z.infer<typeof createPatientSchema>
export type UpdatePatientInput = z.infer<typeof updatePatientSchema>
export type CreateAllergyInput = z.infer<typeof createAllergySchema>
export type PatientSearchInput = z.infer<typeof patientSearchSchema>


// ════════════════════════════════════════════════════════════
// modules/patients/patients.service.ts
// ════════════════════════════════════════════════════════════

import { prisma }   from '../../config/prisma'
import { logger }   from '../../lib/logger'
import type {
  CreatePatientInput,
  UpdatePatientInput,
  CreateAllergyInput,
  PatientSearchInput,
} from './patients.schema'

export class PatientsService {

  // ── Create patient ────────────────────────────────────
  async create(input: CreatePatientInput, branchId: string, createdById: string) {
    const patient = await prisma.patient.create({
      data: {
        branchId,
        firstName:         input.firstName,
        lastName:          input.lastName,
        nickname:          input.nickname,
        phone:             input.phone,
        altPhone:          input.altPhone,
        email:             input.email,
        dateOfBirth:       input.dateOfBirth ? new Date(input.dateOfBirth) : null,
        gender:            input.gender,
        bloodGroup:        input.bloodGroup,
        nationalId:        input.nationalId,
        nhifNo:            input.nhifNo,
        passportNo:        input.passportNo,
        birthCertNo:       input.birthCertNo,
        insurance:         input.insurance,
        policyNo:          input.policyNo,
        insuranceExpiry:   input.insuranceExpiry ? new Date(input.insuranceExpiry) : null,
        pregnancyStatus:   input.pregnancyStatus as any,
        isBreastfeeding:   input.isBreastfeeding,
        chronicConditions: input.chronicConditions,
        currentMedications:input.currentMedications,
      },
    })

    // Audit log
    await prisma.auditLog.create({
      data: {
        branchId,
        userId:     createdById,
        action:     'CREATE',
        entityType: 'Patient',
        entityId:   patient.id,
        newValue:   { firstName: patient.firstName, lastName: patient.lastName },
      },
    })

    logger.info({ branchId, patientId: patient.id }, 'Patient registered')
    return patient
  }

  // ── Search patients ───────────────────────────────────
  // Africa-first search: works with partial name, phone, NHIF,
  // national ID, or birth cert number.
  async search(input: PatientSearchInput, branchId: string) {
    const { q, condition, insurance, page, limit } = input
    const skip = (page - 1) * limit

    const where: any = {
      branchId,
      deletedAt: null,
      ...(condition && {
        chronicConditions: { has: condition },
      }),
      ...(insurance && { insurance }),
    }

    // Flexible search across multiple identifier fields
    if (q) {
      where.OR = [
        { firstName:  { contains: q, mode: 'insensitive' } },
        { lastName:   { contains: q, mode: 'insensitive' } },
        { nickname:   { contains: q, mode: 'insensitive' } },
        { phone:      { contains: q } },
        { altPhone:   { contains: q } },
        { nhifNo:     { contains: q, mode: 'insensitive' } },
        { nationalId: { contains: q, mode: 'insensitive' } },
        { passportNo: { contains: q, mode: 'insensitive' } },
        { birthCertNo:{ contains: q, mode: 'insensitive' } },
        // Allow "Mary Wanjiku" or "Wanjiku Mary" search
        {
          AND: [
            { firstName: { contains: q.split(' ')[0], mode: 'insensitive' } },
            { lastName:  { contains: q.split(' ').slice(1).join(' ') || q, mode: 'insensitive' } },
          ],
        },
      ]
    }

    const [patients, total] = await prisma.$transaction([
      prisma.patient.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        include: {
          allergies: {
            where:   { isActive: true },
            select:  { allergen: true, severity: true, allergenType: true },
          },
          _count: {
            select: { prescriptions: true, clinicalNotes: true },
          },
        },
      }),
      prisma.patient.count({ where }),
    ])

    return {
      data: patients,
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
    }
  }

  // ── Get single patient (full profile) ─────────────────
  async findById(patientId: string, branchId: string, requestedById: string) {
    const patient = await prisma.patient.findFirst({
      where: { id: patientId, branchId, deletedAt: null },
      include: {
        allergies:     { where: { isActive: true } },
        prescriptions: {
          where:   { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take:    10,
          include: { items: { include: { drug: true } } },
        },
        clinicalNotes: {
          orderBy: { createdAt: 'desc' },
          take:    20,
          include: { createdBy: { select: { firstName: true, lastName: true, role: true } } },
        },
        sales: {
          orderBy: { createdAt: 'desc' },
          take:    10,
          select:  { id: true, saleNo: true, total: true, createdAt: true, status: true },
        },
      },
    })

    if (!patient) throw Object.assign(new Error('Patient not found'), { status: 404 })

    // Log the view — healthcare privacy requirement
    await prisma.readAuditLog.create({
      data: {
        branchId,
        userId:     requestedById,
        patientId:  patient.id,
        recordType: 'full_profile',
      },
    })

    return patient
  }

  // ── Update patient ────────────────────────────────────
  async update(
    patientId: string,
    input: UpdatePatientInput,
    branchId: string,
    updatedById: string,
  ) {
    const existing = await prisma.patient.findFirst({
      where: { id: patientId, branchId, deletedAt: null },
    })
    if (!existing) throw Object.assign(new Error('Patient not found'), { status: 404 })

    const updated = await prisma.patient.update({
      where: { id: patientId },
      data: {
        ...input,
        dateOfBirth:     input.dateOfBirth     ? new Date(input.dateOfBirth)     : undefined,
        insuranceExpiry: input.insuranceExpiry ? new Date(input.insuranceExpiry) : undefined,
        pregnancyStatus: input.pregnancyStatus as any,
      },
    })

    await prisma.auditLog.create({
      data: {
        branchId,
        userId:     updatedById,
        action:     'UPDATE',
        entityType: 'Patient',
        entityId:   patientId,
        oldValue:   existing as any,
        newValue:   updated  as any,
      },
    })

    return updated
  }

  // ── Soft delete ───────────────────────────────────────
  async softDelete(patientId: string, branchId: string, deletedById: string) {
    const patient = await prisma.patient.findFirst({
      where: { id: patientId, branchId, deletedAt: null },
    })
    if (!patient) throw Object.assign(new Error('Patient not found'), { status: 404 })

    await prisma.patient.update({
      where: { id: patientId },
      data:  { deletedAt: new Date() },
    })

    await prisma.auditLog.create({
      data: {
        branchId,
        userId:     deletedById,
        action:     'DELETE',
        entityType: 'Patient',
        entityId:   patientId,
        oldValue:   { firstName: patient.firstName, lastName: patient.lastName },
      },
    })
  }

  // ── Add allergy ───────────────────────────────────────
  async addAllergy(
    patientId: string,
    input: CreateAllergyInput,
    branchId: string,
    addedById: string,
  ) {
    // Confirm patient belongs to branch
    const patient = await prisma.patient.findFirst({
      where: { id: patientId, branchId, deletedAt: null },
    })
    if (!patient) throw Object.assign(new Error('Patient not found'), { status: 404 })

    const allergy = await prisma.allergy.create({
      data: {
        patientId,
        allergen:     input.allergen,
        allergenType: input.allergenType as any,
        severity:     input.severity     as any,
        reaction:     input.reaction,
        notes:        input.notes,
        verifiedById: addedById,
        verifiedAt:   new Date(),
      },
    })

    await prisma.auditLog.create({
      data: {
        branchId,
        userId:     addedById,
        action:     'CREATE',
        entityType: 'Allergy',
        entityId:   allergy.id,
        newValue:   { patientId, allergen: input.allergen, severity: input.severity },
      },
    })

    logger.warn(
      { patientId, allergen: input.allergen, severity: input.severity },
      'Allergy recorded on patient',
    )

    return allergy
  }

  // ── Get allergies ─────────────────────────────────────
  async getAllergies(patientId: string, branchId: string) {
    const patient = await prisma.patient.findFirst({
      where: { id: patientId, branchId, deletedAt: null },
    })
    if (!patient) throw Object.assign(new Error('Patient not found'), { status: 404 })

    return prisma.allergy.findMany({
      where:   { patientId, isActive: true },
      orderBy: { severity: 'desc' },
    })
  }

  // ── Patients due for refill ───────────────────────────
  async getRefillsDue(branchId: string) {
    return prisma.patient.findMany({
      where: {
        branchId,
        deletedAt: null,
        chronicConditions: { isEmpty: false },
        prescriptions: {
          some: {
            status:    'DISPENSED',
            deletedAt: null,
            refills: {
              some: {
                nextEligibleAt: { lte: new Date() },
              },
            },
          },
        },
      },
      include: {
        prescriptions: {
          where: { status: 'DISPENSED', deletedAt: null },
          include: {
            items:   { include: { drug: true } },
            refills: { orderBy: { dispensedAt: 'desc' }, take: 1 },
          },
        },
      },
      take: 50,
    })
  }

  // ── Stats for dashboard ───────────────────────────────
  async getStats(branchId: string) {
    const [total, activeThisMonth, chronic, refillsDue] = await prisma.$transaction([
      prisma.patient.count({ where: { branchId, deletedAt: null } }),
      prisma.patient.count({
        where: {
          branchId,
          deletedAt: null,
          sales: { some: { createdAt: { gte: new Date(new Date().setDate(1)) } } },
        },
      }),
      prisma.patient.count({
        where: {
          branchId,
          deletedAt: null,
          chronicConditions: { isEmpty: false },
        },
      }),
      prisma.patient.count({
        where: {
          branchId,
          deletedAt: null,
          prescriptions: {
            some: {
              status:    'DISPENSED',
              deletedAt: null,
              refills:   { some: { nextEligibleAt: { lte: new Date() } } },
            },
          },
        },
      }),
    ])

    return { total, activeThisMonth, chronic, refillsDue }
  }
}

export const patientsService = new PatientsService()


// ════════════════════════════════════════════════════════════
// modules/patients/patients.controller.ts
// ════════════════════════════════════════════════════════════

import { Request, Response, NextFunction } from 'express'
import { patientsService }                 from './patients.service'
import {
  createPatientSchema,
  updatePatientSchema,
  createAllergySchema,
  patientSearchSchema,
}                                          from './patients.schema'

export class PatientsController {

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const input   = createPatientSchema.parse(req.body)
      const patient = await patientsService.create(input, req.branchId!, req.user!.sub)
      res.status(201).json({ success: true, data: patient })
    } catch (e) { next(e) }
  }

  async search(req: Request, res: Response, next: NextFunction) {
    try {
      const input  = patientSearchSchema.parse(req.query)
      const result = await patientsService.search(input, req.branchId!)
      res.json({ success: true, ...result })
    } catch (e) { next(e) }
  }

  async findById(req: Request, res: Response, next: NextFunction) {
    try {
      const patient = await patientsService.findById(
        req.params.id, req.branchId!, req.user!.sub,
      )
      res.json({ success: true, data: patient })
    } catch (e) { next(e) }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const input   = updatePatientSchema.parse(req.body)
      const patient = await patientsService.update(
        req.params.id, input, req.branchId!, req.user!.sub,
      )
      res.json({ success: true, data: patient })
    } catch (e) { next(e) }
  }

  async softDelete(req: Request, res: Response, next: NextFunction) {
    try {
      await patientsService.softDelete(req.params.id, req.branchId!, req.user!.sub)
      res.json({ success: true, message: 'Patient record archived' })
    } catch (e) { next(e) }
  }

  async addAllergy(req: Request, res: Response, next: NextFunction) {
    try {
      const input   = createAllergySchema.parse(req.body)
      const allergy = await patientsService.addAllergy(
        req.params.id, input, req.branchId!, req.user!.sub,
      )
      res.status(201).json({ success: true, data: allergy })
    } catch (e) { next(e) }
  }

  async getAllergies(req: Request, res: Response, next: NextFunction) {
    try {
      const allergies = await patientsService.getAllergies(req.params.id, req.branchId!)
      res.json({ success: true, data: allergies })
    } catch (e) { next(e) }
  }

  async getRefillsDue(req: Request, res: Response, next: NextFunction) {
    try {
      const patients = await patientsService.getRefillsDue(req.branchId!)
      res.json({ success: true, data: patients })
    } catch (e) { next(e) }
  }

  async getStats(req: Request, res: Response, next: NextFunction) {
    try {
      const stats = await patientsService.getStats(req.branchId!)
      res.json({ success: true, data: stats })
    } catch (e) { next(e) }
  }
}

export const patientsController = new PatientsController()


// ════════════════════════════════════════════════════════════
// modules/patients/patients.router.ts
// ════════════════════════════════════════════════════════════

import { Router }              from 'express'
import { patientsController }  from './patients.controller'
import { authenticate }        from '../../middleware/authenticate'
import { authorize }           from '../../middleware/authorize'

const router = Router()

// All patient routes require authentication
router.use(authenticate)

// Stats
router.get('/stats',        patientsController.getStats.bind(patientsController))
router.get('/refills-due',  patientsController.getRefillsDue.bind(patientsController))

// CRUD
router.get ('/',            patientsController.search.bind(patientsController))
router.post('/',
  authorize(['SUPER_ADMIN','PHARMACIST','TECHNICIAN']),
  patientsController.create.bind(patientsController),
)
router.get ('/:id',         patientsController.findById.bind(patientsController))
router.patch('/:id',
  authorize(['SUPER_ADMIN','PHARMACIST']),
  patientsController.update.bind(patientsController),
)
router.delete('/:id',
  authorize(['SUPER_ADMIN']),
  patientsController.softDelete.bind(patientsController),
)

// Allergies
router.get ('/:id/allergies',
  patientsController.getAllergies.bind(patientsController),
)
router.post('/:id/allergies',
  authorize(['SUPER_ADMIN','PHARMACIST']),
  patientsController.addAllergy.bind(patientsController),
)

export default router