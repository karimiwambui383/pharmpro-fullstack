/ ════════════════════════════════════════════════════════════
// modules/purchases/purchases.controller.ts
// ════════════════════════════════════════════════════════════
import { Request, Response, NextFunction } from 'express'
import { purchasesService }                from './purchases.service'
import {
  createPurchaseSchema,
  updatePurchaseSchema,
  receiveItemsSchema,
  purchaseSearchSchema,
  createSupplierSchema,
}                                          from './purchases.schema'

export class PurchasesController {

  // Suppliers
  async createSupplier(req: Request, res: Response, next: NextFunction) {
    try {
      const input    = createSupplierSchema.parse(req.body)
      const supplier = await purchasesService.createSupplier(input, req.user!.sub)
      res.status(201).json({ success: true, data: supplier })
    } catch (e) { next(e) }
  }

  async listSuppliers(req: Request, res: Response, next: NextFunction) {
    try {
      const suppliers = await purchasesService.listSuppliers()
      res.json({ success: true, data: suppliers })
    } catch (e) { next(e) }
  }

  async getSupplier(req: Request, res: Response, next: NextFunction) {
    try {
      const supplier = await purchasesService.getSupplier(req.params.id)
      res.json({ success: true, data: supplier })
    } catch (e) { next(e) }
  }

  // Purchase orders
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const input    = createPurchaseSchema.parse(req.body)
      const purchase = await purchasesService.create(input, req.branchId!, req.user!.sub)
      res.status(201).json({ success: true, data: purchase })
    } catch (e) { next(e) }
  }

  async search(req: Request, res: Response, next: NextFunction) {
    try {
      const input  = purchaseSearchSchema.parse(req.query)
      const result = await purchasesService.search(input, req.branchId!)
      res.json({ success: true, ...result })
    } catch (e) { next(e) }
  }

  async findById(req: Request, res: Response, next: NextFunction) {
    try {
      const po = await purchasesService.findById(req.params.id, req.branchId!)
      res.json({ success: true, data: po })
    } catch (e) { next(e) }
  }

  async send(req: Request, res: Response, next: NextFunction) {
    try {
      const po = await purchasesService.send(req.params.id, req.branchId!, req.user!.sub)
      res.json({ success: true, data: po })
    } catch (e) { next(e) }
  }

  async receiveItems(req: Request, res: Response, next: NextFunction) {
    try {
      const input = receiveItemsSchema.parse(req.body)
      const po    = await purchasesService.receiveItems(
        req.params.id, input, req.branchId!, req.user!.sub,
      )
      res.json({ success: true, data: po })
    } catch (e) { next(e) }
  }

  async cancel(req: Request, res: Response, next: NextFunction) {
    try {
      const { reason } = req.body
      if (!reason) throw Object.assign(new Error('Reason required'), { status: 400 })
      const result = await purchasesService.cancel(
        req.params.id, reason, req.branchId!, req.user!.sub,
      )
      res.json({ success: true, data: result })
    } catch (e) { next(e) }
  }

  async getStats(req: Request, res: Response, next: NextFunction) {
    try {
      const stats = await purchasesService.getStats(req.branchId!)
      res.json({ success: true, data: stats })
    } catch (e) { next(e) }
  }
}

export const purchasesController = new PurchasesController()


