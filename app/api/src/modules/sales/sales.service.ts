// ════════════════════════════════════════════════════════════
// modules/sales/sales.service.ts
//
// Load considerations:
//  - Full sale in ONE serializable transaction
//    (inventory lock + sale + items + payments + audit)
//  - Sale number from Redis INCR (atomic, no DB seq lock)
//  - M-Pesa token cached in Redis — zero auth overhead per sale
//  - Payment split: a single sale can have cash + M-Pesa + NHIF
//  - Refund reverses inventory in same transaction pattern
//  - Daily revenue cached in Redis, invalidated on every sale
//  - Receipt PDF queued to BullMQ — never blocks the HTTP response
//  - All queries scoped to branchId (multi-tenant enforced)
// ════════════════════════════════════════════════════════════

import { Prisma }             from '@prisma/client'
import { prisma }             from '../../config/prisma'
import { redis }              from '../../config/redis'
import { logger }             from '../../lib/logger'
import { generateNumber }     from '../../lib/numbering'
import { inventoryService }   from '../inventory/inventory.service'
import {
  initiateStkPush,
  parseStkCallback,
  queryStkStatus,
}                             from '../../lib/mpesa'
import { notificationQueue, reportQueue } from '../../jobs/queues'
import type {
  CreateSaleInput,
  MpesaStkInput,
  RefundInput,
  SalesSearchInput,
}                             from './sales.schema'

// ── Receipt template (plain text → queued as PDF) ─────────
function buildReceiptText(params: {
  saleNo:       string
  branchName:   string
  licenseNo:    string
  items:        { name: string; qty: number; unitPrice: number }[]
  subtotal:     number
  discount:     number
  vat:          number
  total:        number
  payments:     { method: string; amount: number; reference?: string }[]
  cashierName:  string
  date:         Date
  footer:       string
}): string {
  const line   = '─'.repeat(40)
  const money  = (n: number) => `KES ${n.toLocaleString('en-KE', { minimumFractionDigits: 2 })}`

  const itemLines = params.items.map(
    i => `${i.name.padEnd(24)}${String(i.qty).padStart(3)} × ${money(i.unitPrice)}`,
  ).join('\n')

  const paymentLines = params.payments.map(
    p => `${p.method.padEnd(12)}${money(p.amount)}${p.reference ? `  [${p.reference}]` : ''}`,
  ).join('\n')

  return `
${params.branchName}
License: ${params.licenseNo}
${line}
RECEIPT: ${params.saleNo}
Date: ${params.date.toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' })}
Cashier: ${params.cashierName}
${line}
${itemLines}
${line}
Subtotal:   ${money(params.subtotal)}
Discount:   -${money(params.discount)}
VAT (16%):  ${money(params.vat)}
${line}
TOTAL:      ${money(params.total)}
${line}
PAYMENT
${paymentLines}
${line}
${params.footer}
`.trim()
}

export class SalesService {

  // ── Create sale (full POS transaction) ────────────────
  async create(input: CreateSaleInput, branchId: string, cashierId: string) {

    // 1. Validate payment totals cover the sale
    const branch = await prisma.branch.findUniqueOrThrow({
      where:  { id: branchId },
      select: { name: true, licenseNo: true, town: true },
    })

    // 2. Fetch inventory items and calculate totals
    const inventoryItems = await prisma.inventory.findMany({
      where: {
        id:       { in: input.items.map(i => i.inventoryId) },
        branchId,
      },
      include: {
        drug: { select: { genericName: true, brandName: true, controlledCategory: true } },
      },
    })

    if (inventoryItems.length !== input.items.length) {
      throw Object.assign(
        new Error('One or more inventory items not found in this branch'),
        { status: 404 },
      )
    }

    // Build line totals
    const lineItems = input.items.map(item => {
      const inv = inventoryItems.find(i => i.id === item.inventoryId)!
      return {
        ...item,
        drug:      inv.drug,
        batchId:   inv.batchNo ? `batch-${inv.batchNo}-${inv.drugId}` : null,
        subtotal:  Number((item.unitPrice * item.quantity).toFixed(2)),
      }
    })

    const subtotalRaw  = lineItems.reduce((s, i) => s + i.subtotal, 0)
    const discountAmt  = Number((subtotalRaw * input.discount / 100).toFixed(2))
    const net          = subtotalRaw - discountAmt
    const vatAmt       = Number((net * 0.16).toFixed(2))
    const total        = Number((net + vatAmt).toFixed(2))

    // 3. Validate payment covers total (allow rounding tolerance of 1 KES)
    const paymentTotal = input.payments.reduce((s, p) => s + p.amount, 0)
    if (paymentTotal < total - 1) {
      throw Object.assign(
        new Error(
          `Payment total (KES ${paymentTotal}) does not cover sale total (KES ${total})`,
        ),
        { status: 400 },
      )
    }

    // 4. Generate sale number atomically
    const branchCode = branch.town.slice(0, 3).toUpperCase()
    const saleNo     = await generateNumber('SALE', branchCode)

    // 5. Execute full sale in ONE serializable transaction
    const sale = await prisma.$transaction(async (tx) => {

      // Create sale header
      const sale = await tx.sale.create({
        data: {
          saleNo,
          branchId,
          cashierId,
          patientId:    input.patientId ?? null,
          subtotal:     subtotalRaw,
          discount:     discountAmt,
          vat:          vatAmt,
          total,
          status:       'COMPLETED',
        },
      })

      // Create sale items + deduct inventory (SELECT FOR UPDATE per item)
      for (const item of lineItems) {
        // Lock + deduct inventory
        await inventoryService.deductStock(
          tx,
          item.inventoryId,
          item.quantity,
          sale.id,
          cashierId,
          branchId,
        )

        await tx.saleItem.create({
          data: {
            saleId:      sale.id,
            drugId:      item.drugId,
            inventoryId: item.inventoryId,
            batchId:     item.batchId,
            quantity:    item.quantity,
            unitPrice:   item.unitPrice,
            subtotal:    item.subtotal,
          },
        })
      }

      // Record payments (split payment supported)
      for (const payment of input.payments) {
        await tx.payment.create({
          data: {
            saleId:     sale.id,
            method:     payment.method as any,
            amount:     payment.amount,
            reference:  payment.reference,
            mpesaPhone: payment.mpesaPhone,
            status:     payment.method === 'MPESA' ? 'PENDING' : 'COMPLETED',
          },
        })
      }

      // Audit log
      await tx.auditLog.create({
        data: {
          branchId,
          userId:     cashierId,
          action:     'CREATE',
          entityType: 'Sale',
          entityId:   sale.id,
          newValue:   {
            saleNo,
            total,
            itemCount:  lineItems.length,
            paymentMethods: input.payments.map(p => p.method),
          } as any,
        },
      })

      return sale
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout:        10_000, // 10s max — POS must be fast
    })

    // 6. Update Redis daily revenue (non-blocking)
    this.incrementDailyRevenue(branchId, total).catch(e =>
      logger.error({ e }, 'Failed to update daily revenue cache'),
    )

    // 7. Emit real-time sale event to branch dashboard
    await redis.publish(
      `branch:${branchId}:events`,
      JSON.stringify({
        event:  'sale:completed',
        saleNo,
        total,
        cashierId,
        itemCount: lineItems.length,
      }),
    )

    // 8. Queue receipt PDF generation (non-blocking)
    const cashier = await prisma.user.findUnique({
      where:  { id: cashierId },
      select: { firstName: true, lastName: true },
    })
    const receiptText = buildReceiptText({
      saleNo,
      branchName:  branch.name,
      licenseNo:   branch.licenseNo ?? 'N/A',
      items:       lineItems.map(i => ({
        name:      i.drug.genericName,
        qty:       i.quantity,
        unitPrice: i.unitPrice,
      })),
      subtotal:    subtotalRaw,
      discount:    discountAmt,
      vat:         vatAmt,
      total,
      payments:    input.payments.map(p => ({
        method:    p.method,
        amount:    p.amount,
        reference: p.reference,
      })),
      cashierName: cashier ? `${cashier.firstName} ${cashier.lastName}` : 'Staff',
      date:        new Date(),
      footer:      'Thank you! Stay healthy.',
    })

    await reportQueue.add('sale-receipt-pdf', {
      saleId: sale.id,
      receiptText,
      branchId,
    }, { attempts: 3 })

    // 9. SMS receipt to patient if they have a phone
    if (input.patientId) {
      await notificationQueue.add('sale-sms-receipt', {
        saleId:    sale.id,
        saleNo,
        total,
        patientId: input.patientId,
        branchId,
      }, { attempts: 3, backoff: { type: 'exponential', delay: 3000 } })
    }

    logger.info({ saleNo, total, branchId, cashierId }, 'Sale completed')

    return {
      sale,
      receiptText,
      saleNo,
      total,
    }
  }

  // ── Initiate M-Pesa STK Push ──────────────────────────
  async initiateMpesa(input: MpesaStkInput, branchId: string) {
    const result = await initiateStkPush({
      phone:       input.phone,
      amount:      input.amount,
      accountRef:  input.saleRef ?? 'PharmPro',
      description: 'Pharmacy payment',
      saleId:      input.saleRef,
    })

    return result
  }

  // ── M-Pesa callback handler (called by Safaricom) ─────
  // MUST be idempotent — Safaricom may retry callbacks
  async handleMpesaCallback(body: any, branchId: string) {
    const result = parseStkCallback(body)

    logger.info({ result }, 'M-Pesa callback received')

    if (result.resultCode !== 0) {
      // Payment failed — update payment status
      logger.warn({ resultDesc: result.resultDesc }, 'M-Pesa payment failed')

      // Find pending payment by checkout request
      const pending = await redis.get(`mpesa:stk:${result.checkoutRequestId}`)
      if (pending) {
        const { saleId } = JSON.parse(pending)
        if (saleId) {
          await prisma.payment.updateMany({
            where: { saleId, method: 'MPESA', status: 'PENDING' },
            data:  { status: 'FAILED', failReason: result.resultDesc },
          })
        }
        await redis.del(`mpesa:stk:${result.checkoutRequestId}`)
      }

      return { received: true, paid: false }
    }

    // Payment successful
    const pending = await redis.get(`mpesa:stk:${result.checkoutRequestId}`)

    if (pending) {
      const { saleId } = JSON.parse(pending)

      if (saleId) {
        // Idempotency check — don't update if already completed
        const existing = await prisma.payment.findFirst({
          where: { saleId, method: 'MPESA', status: 'COMPLETED' },
        })

        if (!existing) {
          await prisma.payment.updateMany({
            where: { saleId, method: 'MPESA', status: 'PENDING' },
            data:  {
              status:    'COMPLETED',
              reference: result.mpesaReceiptNo,
            },
          })

          // Emit confirmation to branch POS
          await redis.publish(
            `branch:${branchId}:events`,
            JSON.stringify({
              event:          'mpesa:confirmed',
              saleId,
              receiptNo:      result.mpesaReceiptNo,
              amount:         result.amount,
              phone:          result.phone,
            }),
          )
        }
      }

      await redis.del(`mpesa:stk:${result.checkoutRequestId}`)
    }

    return { received: true, paid: true, receiptNo: result.mpesaReceiptNo }
  }

  // ── Query M-Pesa STK status (polling) ─────────────────
  async queryMpesaStatus(checkoutRequestId: string) {
    return queryStkStatus(checkoutRequestId)
  }

  // ── Refund / void sale ────────────────────────────────
  async refund(input: RefundInput, branchId: string, refundedById: string) {
    const sale = await prisma.sale.findFirst({
      where:   { id: input.saleId, branchId, deletedAt: null },
      include: { items: { include: { drug: true } }, payments: true },
    })
    if (!sale) throw Object.assign(new Error('Sale not found'), { status: 404 })
    if (sale.status === 'REFUNDED') {
      throw Object.assign(new Error('Sale already refunded'), { status: 400 })
    }

    let refundTotal = 0

    await prisma.$transaction(async (tx) => {
      for (const refundItem of input.items) {
        const saleItem = sale.items.find(i => i.id === refundItem.saleItemId)
        if (!saleItem) {
          throw Object.assign(new Error(`Sale item ${refundItem.saleItemId} not found`), { status: 404 })
        }
        if (refundItem.quantity > saleItem.quantity) {
          throw Object.assign(
            new Error(`Refund quantity exceeds sold quantity for ${saleItem.drug.genericName}`),
            { status: 400 },
          )
        }

        const lineRefund = Number(saleItem.unitPrice) * refundItem.quantity
        refundTotal += lineRefund

        // Return stock to inventory
        await tx.inventory.update({
          where: { id: saleItem.inventoryId },
          data:  { quantityOnHand: { increment: refundItem.quantity } },
        })

        // Ledger entry — positive = stock back in
        await tx.inventoryTransaction.create({
          data: {
            branchId,
            drugId:      saleItem.drugId,
            inventoryId: saleItem.inventoryId,
            type:        'RETURN',
            quantity:    refundItem.quantity,
            referenceId: sale.id,
            reason:      `Refund — ${input.reason}`,
            createdById: refundedById,
          },
        })
      }

      // Mark sale as refunded
      await tx.sale.update({
        where: { id: sale.id },
        data:  { status: 'REFUNDED' },
      })

      // Record refund payment (negative amount for accounting)
      await tx.payment.create({
        data: {
          saleId:    sale.id,
          method:    sale.payments[0]?.method ?? 'CASH',
          amount:    -refundTotal,
          reference: `REFUND-${input.reason}`,
          status:    'REFUNDED',
        },
      })

      await tx.auditLog.create({
        data: {
          branchId,
          userId:     refundedById,
          action:     'UPDATE',
          entityType: 'Sale',
          entityId:   sale.id,
          oldValue:   { status: 'COMPLETED' } as any,
          newValue:   { status: 'REFUNDED', reason: input.reason, refundTotal } as any,
        },
      })
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

    // Subtract from daily revenue cache
    await this.incrementDailyRevenue(branchId, -refundTotal)

    await redis.publish(
      `branch:${branchId}:events`,
      JSON.stringify({ event: 'sale:refunded', saleId: sale.id, refundTotal }),
    )

    logger.info({ saleId: sale.id, refundTotal, reason: input.reason }, 'Sale refunded')
    return { refundTotal }
  }

  // ── Search sales ──────────────────────────────────────
  async search(input: SalesSearchInput, branchId: string) {
    const { q, method, status, patientId, cashierId, dateFrom, dateTo, page, limit } = input
    const skip = (page - 1) * limit

    const where: Prisma.SaleWhereInput = {
      branchId,
      deletedAt: null,
      ...(status    && { status:    status    as any }),
      ...(patientId && { patientId }),
      ...(cashierId && { cashierId }),
      ...(dateFrom || dateTo) && {
        createdAt: {
          ...(dateFrom && { gte: new Date(`${dateFrom}T00:00:00.000Z`) }),
          ...(dateTo   && { lte: new Date(`${dateTo}T23:59:59.999Z`)   }),
        },
      },
      ...(method && { payments: { some: { method: method as any } } }),
      ...(q && {
        OR: [
          { saleNo: { contains: q, mode: 'insensitive' } },
          { patient: {
              OR: [
                { firstName: { contains: q, mode: 'insensitive' } },
                { lastName:  { contains: q, mode: 'insensitive' } },
              ],
          }},
        ],
      }),
    }

    const [sales, total] = await prisma.$transaction([
      prisma.sale.findMany({
        where,
        skip,
        take:    limit,
        orderBy: { createdAt: 'desc' },
        include: {
          patient:  { select: { firstName: true, lastName: true, phone: true } },
          cashier:  { select: { firstName: true, lastName: true } },
          items:    { include: { drug: { select: { genericName: true } } } },
          payments: true,
        },
      }),
      prisma.sale.count({ where }),
    ])

    return {
      data: sales,
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
    }
  }

  // ── Get single sale ───────────────────────────────────
  async findById(saleId: string, branchId: string) {
    const sale = await prisma.sale.findFirst({
      where:   { id: saleId, branchId },
      include: {
        patient:  { select: { firstName: true, lastName: true, phone: true, nhifNo: true } },
        cashier:  { select: { firstName: true, lastName: true } },
        items:    {
          include: {
            drug:      { select: { genericName: true, brandName: true } },
            inventory: { select: { batchNo: true, expiryDate: true } },
          },
        },
        payments: true,
      },
    })
    if (!sale) throw Object.assign(new Error('Sale not found'), { status: 404 })
    return sale
  }

  // ── Dashboard stats (Redis cached) ────────────────────
  async getDashboardStats(branchId: string) {
    const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
    const cacheKey = `sales:stats:${branchId}:${today}`
    const cached   = await redis.get(cacheKey)
    if (cached) return JSON.parse(cached)

    const startOfDay = new Date(`${today}T00:00:00.000Z`)
    const endOfDay   = new Date(`${today}T23:59:59.999Z`)

    const [
      todayCount,
      todayRevenue,
      todayRefunds,
      paymentBreakdown,
      topDrugs,
    ] = await prisma.$transaction([
      // Total sales today
      prisma.sale.count({
        where: { branchId, status: 'COMPLETED', createdAt: { gte: startOfDay, lte: endOfDay } },
      }),
      // Total revenue today
      prisma.sale.aggregate({
        where: { branchId, status: 'COMPLETED', createdAt: { gte: startOfDay, lte: endOfDay } },
        _sum:  { total: true },
      }),
      // Refunds today
      prisma.sale.count({
        where: { branchId, status: 'REFUNDED', createdAt: { gte: startOfDay, lte: endOfDay } },
      }),
      // Payment method breakdown
      prisma.payment.groupBy({
        by:    ['method'],
        where: {
          sale: { branchId, status: 'COMPLETED', createdAt: { gte: startOfDay, lte: endOfDay } },
          status: 'COMPLETED',
        },
        _sum:   { amount: true },
        _count: { id: true },
      }),
      // Top 5 drugs today
      prisma.saleItem.groupBy({
        by:      ['drugId'],
        where:   { sale: { branchId, createdAt: { gte: startOfDay, lte: endOfDay } } },
        _sum:    { quantity: true, subtotal: true },
        orderBy: { _sum: { subtotal: 'desc' } },
        take:    5,
      }),
    ])

    const stats = {
      today: {
        count:     todayCount,
        revenue:   Number(todayRevenue._sum.total ?? 0),
        refunds:   todayRefunds,
        avgOrder:  todayCount > 0
          ? Number((Number(todayRevenue._sum.total ?? 0) / todayCount).toFixed(2))
          : 0,
      },
      paymentBreakdown: paymentBreakdown.map(p => ({
        method: p.method,
        total:  Number(p._sum.amount ?? 0),
        count:  p._count.id,
      })),
      topDrugs,
    }

    await redis.setex(cacheKey, 120, JSON.stringify(stats)) // cache 2 min
    return stats
  }

  // ── 7-day / 30-day revenue trend ─────────────────────
  async getRevenueTrend(branchId: string, days: 7 | 30 = 7) {
    const cacheKey = `sales:trend:${branchId}:${days}`
    const cached   = await redis.get(cacheKey)
    if (cached) return JSON.parse(cached)

    const result = await prisma.$queryRaw<{ date: string; revenue: number; count: number }[]>`
      SELECT
        DATE(created_at AT TIME ZONE 'Africa/Nairobi') AS date,
        COALESCE(SUM(total), 0)::numeric               AS revenue,
        COUNT(*)::int                                  AS count
      FROM sales
      WHERE
        branch_id  = ${branchId}
        AND status = 'COMPLETED'
        AND created_at >= NOW() - INTERVAL '${Prisma.raw(String(days))} days'
      GROUP BY DATE(created_at AT TIME ZONE 'Africa/Nairobi')
      ORDER BY date ASC
    `

    await redis.setex(cacheKey, 300, JSON.stringify(result)) // cache 5 min
    return result
  }

  // ── Private: update daily revenue counter in Redis ────
  private async incrementDailyRevenue(branchId: string, amount: number) {
    const today = new Date().toISOString().slice(0, 10)
    const key   = `revenue:daily:${branchId}:${today}`
    // INCRBYFLOAT supports decimal amounts
    await redis.incrbyfloat(key, amount)
    await redis.expireat(key, Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60) // 90 days
  }
}

export const salesService = new SalesService()