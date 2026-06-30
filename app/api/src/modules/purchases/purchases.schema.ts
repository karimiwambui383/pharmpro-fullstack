// ════════════════════════════════════════════════════════════
// modules/purchases/purchases.schema.ts
// ════════════════════════════════════════════════════════════
import { z } from 'zod'

export const purchaseItemSchema = z.object({
  drugId:     z.string().uuid('Invalid drug ID'),
  quantity:   z.number().int().positive('Quantity required'),
  unitCost:   z.number().positive('Unit cost required'),
  batchNo:    z.string().optional(),
  expiryDate: z.string().datetime().optional(),
})

export const createPurchaseSchema = z.object({
  supplierId:   z.string().uuid('Invalid supplier ID'),
  expectedDate: z.string().datetime().optional(),
  invoiceNo:    z.string().optional(),
  notes:        z.string().optional(),
  items:        z.array(purchaseItemSchema).min(1, 'At least one item required'),
})

export const updatePurchaseSchema = z.object({
  expectedDate: z.string().datetime().optional(),
  notes:        z.string().optional(),
  invoiceNo:    z.string().optional(),
})

export const receiveItemsSchema = z.object({
  items: z.array(z.object({
    purchaseItemId: z.string().uuid(),
    quantityReceived: z.number().int().positive(),
    batchNo:        z.string().min(1, 'Batch number required on receive'),
    expiryDate:     z.string().datetime('Valid expiry date required'),
    sellingPrice:   z.number().positive('Selling price required'),
  })).min(1, 'At least one item required'),
})

export const purchaseSearchSchema = z.object({
  supplierId: z.string().uuid().optional(),
  status:     z.enum(['DRAFT','SENT','PARTIAL','RECEIVED','CANCELLED']).optional(),
  from:       z.string().optional(),
  to:         z.string().optional(),
  page:       z.coerce.number().default(1),
  limit:      z.coerce.number().min(1).max(100).default(20),
})

export const createSupplierSchema = z.object({
  name:          z.string().min(1, 'Supplier name required'),
  contactPerson: z.string().optional(),
  phone:         z.string().optional(),
  altPhone:      z.string().optional(),
  email:         z.string().email().optional(),
  address:       z.string().optional(),
  location:      z.string().optional(),
  creditTerms:   z.string().optional(),
})

export type CreatePurchaseInput  = z.infer<typeof createPurchaseSchema>
export type UpdatePurchaseInput  = z.infer<typeof updatePurchaseSchema>
export type ReceiveItemsInput    = z.infer<typeof receiveItemsSchema>
export type PurchaseSearchInput  = z.infer<typeof purchaseSearchSchema>
export type CreateSupplierInput  = z.infer<typeof createSupplierSchema>
