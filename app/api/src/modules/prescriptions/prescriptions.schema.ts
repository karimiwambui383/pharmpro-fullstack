// ════════════════════════════════════════════════════════════
// modules/prescriptions/prescriptions.schema.ts
// ════════════════════════════════════════════════════════════
import { z } from 'zod'

export const prescriptionItemSchema = z.object({
  drugId:             z.string().uuid('Invalid drug ID'),
  dose:               z.string().min(1, 'Dose required'),
  route:              z.enum([
    'ORAL','IV','IM','SC','TOPICAL',
    'INHALATION','SUBLINGUAL','RECTAL',
    'OPHTHALMIC','OTIC','NASAL','OTHER',
  ]).default('ORAL'),
  frequency:          z.string().min(1, 'Frequency required'),
  duration:           z.number().int().positive().optional(),
  durationUnit:       z.enum(['DAYS','WEEKS','MONTHS','AS_NEEDED']).default('DAYS'),
  quantity:           z.number().int().positive('Quantity required'),
  specialInstructions:z.string().optional(),
})

export const createPrescriptionSchema = z.object({
  patientId:       z.string().uuid('Invalid patient ID'),
  doctorName:      z.string().min(1, 'Doctor name required'),
  doctorLicenseNo: z.string().optional(),
  doctorPhone:     z.string().optional(),
  doctorFacility:  z.string().optional(),
  diagnosis:       z.string().optional(),
  priority:        z.enum(['NORMAL','URGENT','EMERGENCY']).default('NORMAL'),
  insurance:       z.string().optional(),
  policyNo:        z.string().optional(),
  preAuthCode:     z.string().optional(),
  refillsAllowed:  z.number().int().min(0).max(11).default(0),
  reviewDate:      z.string().datetime().optional(),
  notes:           z.string().optional(),
  items:           z.array(prescriptionItemSchema).min(1, 'At least one drug required'),
})

export const updatePrescriptionSchema = createPrescriptionSchema
  .omit({ patientId: true, items: true })
  .partial()

export const dispenseSchema = z.object({
  // pharmacist must explicitly acknowledge each warning
  overriddenWarnings: z.array(z.object({
    type:    z.string(),
    reason:  z.string().min(1, 'Override reason required'),
  })).default([]),
  // partial dispense support
  items: z.array(z.object({
    prescriptionItemId: z.string().uuid(),
    inventoryId:        z.string().uuid(),
    quantityDispensed:  z.number().int().positive(),
  })).min(1),
  notes: z.string().optional(),
})

export const refillSchema = z.object({
  items: z.array(z.object({
    prescriptionItemId: z.string().uuid(),
    inventoryId:        z.string().uuid(),
    quantityDispensed:  z.number().int().positive(),
  })).min(1),
  notes: z.string().optional(),
})

export const rxSearchSchema = z.object({
  q:        z.string().optional(),
  status:   z.enum([
    'PENDING_VERIFICATION','VERIFIED','PROCESSING',
    'READY','DISPENSED','CANCELLED','ON_HOLD',
  ]).optional(),
  priority: z.enum(['NORMAL','URGENT','EMERGENCY']).optional(),
  patientId:z.string().uuid().optional(),
  date:     z.string().optional(),  // YYYY-MM-DD
  page:     z.coerce.number().default(1),
  limit:    z.coerce.number().min(1).max(100).default(20),
})

export type CreatePrescriptionInput = z.infer<typeof createPrescriptionSchema>
export type UpdatePrescriptionInput = z.infer<typeof updatePrescriptionSchema>
export type DispenseInput           = z.infer<typeof dispenseSchema>
export type RefillInput             = z.infer<typeof refillSchema>
export type RxSearchInput           = z.infer<typeof rxSearchSchema>