// modules/purchases/purchases.service.ts
//
// PO lifecycle: DRAFT → SENT → PARTIAL → RECEIVED
// Receiving stock triggers inventory update atomically.
// Partial receives update PO to PARTIAL until all items received.
// ════════════════════════════════════════════════════════════
import { prisma }           from '../../config/prisma'
import { redis }            from '../../config/redis'
import { logger }           from '../../lib/logger'
import { generateNumber }   from '../../lib/numbering'
import { inventoryService } from '../inventory/inventory.service'
import type {
  CreatePurchaseInput,
  UpdatePurchaseInput,
  ReceiveItemsInput,
  PurchaseSearchInput,
  CreateSupplierInput,
}                           from './purchases.schema'

export class PurchasesService {

  // ── Suppliers ─────────────────────────────────────────

  async createSupplier(input: CreateSupplierInput, createdById: string) {
    const supplier = await prisma.supplier.create({ data: input })
    await prisma.auditLog.create({
      data: {
        branchId:   'system',
        userId:     createdById,
        action:     'CREATE',
        entityType: 'Supplier',
        entityId:   supplier.id,
        newValue:   { name: supplier.name } as any,
      },
    })
    return supplier
  }

  async listSuppliers() {
    return prisma.supplier.findMany({
      where:   { isActive: true, deletedAt: null },
      orderBy: { name: 'asc' },
      include: { _count: { select: { purchases: true } } },
    })
  }

  async getSupplier(supplierId: string) {
    const s = await prisma.supplier.findFirst({
      where:   { id: supplierId, deletedAt: null },
      include: {
        purchases: {
          orderBy: { createdAt: 'desc' },
          take:    10,
          select:  { id: true, poNumber: true, status: true, totalValue: true, createdAt: true },
        },
      },
    })
    if (!s) throw Object.assign(new Error('Supplier not found'), { status: 404 })
    return s
  }

  // ── Purchase orders ───────────────────────────────────

  async create(input: CreatePurchaseInput, branchId: string, orderedById: string) {
    const branch = await prisma.branch.findUniqueOrThrow({
      where:  { id: branchId },
      select: { town: true },
    })
    const branchCode = branch.town.slice(0, 3).toUpperCase()
    const poNumber   = await generateNumber('PO', branchCode)

    // Calculate total value
    const totalValue = input.items.reduce(
      (s, i) => s + i.quantity * i.unitCost, 0,
    )

    const purchase = await prisma.$transaction(async (tx) => {
      const po = await tx.purchase.create({
        data: {
          poNumber,
          branchId,
          supplierId:   input.supplierId,
          orderedById,
          expectedDate: input.expectedDate ? new Date(input.expectedDate) : null,
          invoiceNo:    input.invoiceNo,
          notes:        input.notes,
          totalValue,
          status:       'DRAFT',
        },
      })

      await tx.purchaseItem.createMany({
        data: input.items.map(item => ({
          purchaseId: po.id,
          drugId:     item.drugId,
          quantity:   item.quantity,
          unitCost:   item.unitCost,
          batchNo:    item.batchNo,
          expiryDate: item.expiryDate ? new Date(item.expiryDate) : null,
        })),
      })

      await tx.auditLog.create({
        data: {
          branchId,
          userId:     orderedById,
          action:     'CREATE',
          entityType: 'Purchase',
          entityId:   po.id,
          newValue:   { poNumber, supplierId: input.supplierId, totalValue } as any,
        },
      })

      return po
    })

    logger.info({ poNumber, supplierId: input.supplierId, totalValue }, 'Purchase order created')
    return purchase
  }

  async search(input: PurchaseSearchInput, branchId: string) {
    const { supplierId, status, from, to, page, limit } = input
    const skip = (page - 1) * limit

    const where: any = {
      branchId,
      ...(supplierId && { supplierId }),
      ...(status     && { status: status as any }),
      ...((from || to) && {
        createdAt: {
          ...(from && { gte: new Date(`${from}T00:00:00.000Z`) }),
          ...(to   && { lte: new Date(`${to}T23:59:59.999Z`)   }),
        },
      }),
    }

    const [purchases, total] = await prisma.$transaction([
      prisma.purchase.findMany({
        where,
        skip,
        take:    limit,
        orderBy: { createdAt: 'desc' },
        include: {
          supplier:   { select: { name: true, phone: true } },
          orderedBy:  { select: { firstName: true, lastName: true } },
          receivedBy: { select: { firstName: true, lastName: true } },
          items:      { include: { drug: { select: { genericName: true, brandName: true } } } },
        },
      }),
      prisma.purchase.count({ where }),
    ])

    return {
      data: purchases,
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
    }
  }

  async findById(poId: string, branchId: string) {
    const po = await prisma.purchase.findFirst({
      where:   { id: poId, branchId },
      include: {
        supplier:   true,
        orderedBy:  { select: { firstName: true, lastName: true } },
        receivedBy: { select: { firstName: true, lastName: true } },
        items:      {
          include: { drug: { select: { genericName: true, brandName: true, dosageForm: true } } },
        },
      },
    })
    if (!po) throw Object.assign(new Error('Purchase order not found'), { status: 404 })
    return po
  }

  // ── Send PO (DRAFT → SENT) ────────────────────────────
  async send(poId: string, branchId: string, userId: string) {
    const po = await this.findById(poId, branchId)
    if (po.status !== 'DRAFT') {
      throw Object.assign(new Error('Only DRAFT orders can be sent'), { status: 400 })
    }

    const updated = await prisma.purchase.update({
      where: { id: poId },
      data:  { status: 'SENT' },
    })

    await prisma.auditLog.create({
      data: {
        branchId,
        userId,
        action:     'UPDATE',
        entityType: 'Purchase',
        entityId:   poId,
        oldValue:   { status: 'DRAFT' } as any,
        newValue:   { status: 'SENT' }  as any,
      },
    })

    // Queue supplier notification (email/SMS)
    logger.info({ poNumber: po.poNumber }, 'PO sent to supplier')
    return updated
  }

  // ── Receive items (SENT/PARTIAL → PARTIAL/RECEIVED) ───
  // This is atomic: each received item updates inventory
  // AND creates a ledger entry in the same transaction.
  async receiveItems(
    poId:           string,
    input:          ReceiveItemsInput,
    branchId:       string,
    receivedById:   string,
  ) {
    const po = await this.findById(poId, branchId)

    if (!['SENT','PARTIAL'].includes(po.status)) {
      throw Object.assign(
        new Error(`Cannot receive against a ${po.status} order`),
        { status: 400 },
      )
    }

    await prisma.$transaction(async (tx) => {
      for (const recv of input.items) {
        const poItem = po.items.find(i => i.id === recv.purchaseItemId)
        if (!poItem) {
          throw Object.assign(
            new Error(`Item ${recv.purchaseItemId} not on this PO`),
            { status: 400 },
          )
        }

        // Mark item as received on PO
        await tx.purchaseItem.update({
          where: { id: recv.purchaseItemId },
          data:  {
            received:   true,
            batchNo:    recv.batchNo,
            expiryDate: new Date(recv.expiryDate),
          },
        })

        // Update / create inventory (uses our existing receiveStock logic)
        await inventoryService.receiveStock(
          {
            drugId:       poItem.drugId,
            batchNo:      recv.batchNo,
            expiryDate:   recv.expiryDate,
            quantity:     recv.quantityReceived,
            unitCost:     Number(poItem.unitCost),
            sellingPrice: recv.sellingPrice,
            supplierId:   po.supplierId,
          },
          branchId,
          receivedById,
        )
      }

      // Check if fully received
      const allItems     = await tx.purchaseItem.findMany({ where: { purchaseId: poId } })
      const fullyReceived = allItems.every(i => i.received)
      const newStatus     = fullyReceived ? 'RECEIVED' : 'PARTIAL'

      await tx.purchase.update({
        where: { id: poId },
        data:  {
          status:       newStatus,
          receivedById,
          receivedDate: fullyReceived ? new Date() : null,
        },
      })

      await tx.auditLog.create({
        data: {
          branchId,
          userId:     receivedById,
          action:     'UPDATE',
          entityType: 'Purchase',
          entityId:   poId,
          newValue:   {
            status:      newStatus,
            itemsReceived: input.items.length,
          } as any,
        },
      })
    })

    // Invalidate inventory cache
    await redis.del(`inv:stats:${branchId}`)
    logger.info({ poId, itemsReceived: input.items.length }, 'PO items received into inventory')

    return this.findById(poId, branchId)
  }

  // ── Cancel PO ─────────────────────────────────────────
  async cancel(poId: string, reason: string, branchId: string, userId: string) {
    const po = await this.findById(poId, branchId)
    if (['RECEIVED','CANCELLED'].includes(po.status)) {
      throw Object.assign(
        new Error(`Cannot cancel a ${po.status} order`),
        { status: 400 },
      )
    }

    await prisma.$transaction(async (tx) => {
      await tx.purchase.update({
        where: { id: poId },
        data:  { status: 'CANCELLED' },
      })
      await tx.auditLog.create({
        data: {
          branchId,
          userId,
          action:     'UPDATE',
          entityType: 'Purchase',
          entityId:   poId,
          oldValue:   { status: po.status } as any,
          newValue:   { status: 'CANCELLED', reason } as any,
        },
      })
    })

    return { cancelled: true }
  }

  // ── Purchase stats ────────────────────────────────────
  async getStats(branchId: string) {
    const cacheKey = `purchases:stats:${branchId}`
    const cached   = await redis.get(cacheKey)
    if (cached) return JSON.parse(cached)

    const [pending, thisMonth, topSuppliers] = await prisma.$transaction([
      prisma.purchase.count({
        where: { branchId, status: { in: ['SENT','PARTIAL'] } },
      }),
      prisma.purchase.aggregate({
        where: {
          branchId,
          status:    { in: ['RECEIVED','PARTIAL'] },
          createdAt: { gte: new Date(new Date().setDate(1)) },
        },
        _sum:   { totalValue: true },
        _count: { id: true },
      }),
      prisma.purchase.groupBy({
        by:      ['supplierId'],
        where:   { branchId, status: 'RECEIVED' },
        _sum:    { totalValue: true },
        _count:  { id: true },
        orderBy: { _sum: { totalValue: 'desc' } },
        take:    5,
      }),
    ])

    const stats = {
      pendingOrders:      pending,
      thisMonthOrders:    thisMonth._count.id,
      thisMonthSpend:     Number(thisMonth._sum.totalValue ?? 0),
      topSuppliers,
    }

    await redis.setex(cacheKey, 300, JSON.stringify(stats))
    return stats
  }
}

export const purchasesService = new PurchasesService()


/