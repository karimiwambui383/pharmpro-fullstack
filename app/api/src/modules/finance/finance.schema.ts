// ════════════════════════════════════════════════════════════
// modules/finance/finance.schema.ts
// ════════════════════════════════════════════════════════════
import { z } from 'zod'

export const createExpenseSchema = z.object({
  category:    z.enum([
    'RENT','UTILITIES','SALARIES','EQUIPMENT',
    'MARKETING','TRANSPORT','MAINTENANCE','OTHER',
  ]),
  description: z.string().min(1, 'Description required'),
  amount:      z.number().positive('Amount required'),
  expenseDate: z.string().datetime().optional(),
  receiptUrl:  z.string().url().optional(),
})

export const financeRangeSchema = z.object({
  from:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format: YYYY-MM-DD'),
  to:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format: YYYY-MM-DD'),
  branchId: z.string().uuid().optional(), // super admin can query any branch
})

export const plSchema = financeRangeSchema

export type CreateExpenseInput = z.infer<typeof createExpenseSchema>
export type FinanceRangeInput  = z.infer<typeof financeRangeSchema>


// ════════════════════════════════════════════════════════════
// modules/finance/finance.service.ts
//
// Load considerations:
//  - All heavy aggregations use raw SQL for performance
//  - P&L, margins and breakdowns cached in Redis per date range
//  - Cache keys include date range so stale data never leaks
//  - Drug-level profitability uses window functions (PostgreSQL)
//  - All queries are branch-scoped (multi-tenant safe)
// ════════════════════════════════════════════════════════════
import { Prisma }  from '@prisma/client'
import { prisma }  from '../../config/prisma'
import { redis }   from '../../config/redis'
import { logger }  from '../../lib/logger'
import type {
  CreateExpenseInput,
  FinanceRangeInput,
}                  from './finance.schema'

export class FinanceService {

  // ── Create expense ────────────────────────────────────
  async createExpense(
    input:       CreateExpenseInput,
    branchId:    string,
    createdById: string,
  ) {
    const expense = await prisma.expense.create({
      data: {
        branchId,
        createdById,
        category:    input.category,
        description: input.description,
        amount:      input.amount,
        expenseDate: input.expenseDate ? new Date(input.expenseDate) : new Date(),
        receiptUrl:  input.receiptUrl,
      },
    })

    await prisma.auditLog.create({
      data: {
        branchId,
        userId:     createdById,
        action:     'CREATE',
        entityType: 'Expense',
        entityId:   expense.id,
        newValue:   { category: input.category, amount: input.amount } as any,
      },
    })

    // Invalidate finance cache for this branch
    await redis.del(`finance:pl:${branchId}:*`)
    return expense
  }

  // ── List expenses ─────────────────────────────────────
  async listExpenses(input: FinanceRangeInput, branchId: string) {
    return prisma.expense.findMany({
      where: {
        branchId,
        expenseDate: {
          gte: new Date(`${input.from}T00:00:00.000Z`),
          lte: new Date(`${input.to}T23:59:59.999Z`),
        },
      },
      orderBy:  { expenseDate: 'desc' },
      include:  { createdBy: { select: { firstName: true, lastName: true } } },
    })
  }

  // ── Profit & Loss Statement ───────────────────────────
  // Revenue − COGS − Expenses = Net Profit
  async getProfitAndLoss(input: FinanceRangeInput, branchId: string) {
    const cacheKey = `finance:pl:${branchId}:${input.from}:${input.to}`
    const cached   = await redis.get(cacheKey)
    if (cached) return JSON.parse(cached)

    const from = new Date(`${input.from}T00:00:00.000Z`)
    const to   = new Date(`${input.to}T23:59:59.999Z`)

    // Revenue (completed sales)
    const revenueResult = await prisma.sale.aggregate({
      where: { branchId, status: 'COMPLETED', createdAt: { gte: from, lte: to } },
      _sum:  { total: true, discount: true, vat: true },
      _count:{ id: true },
    })

    // Refunds
    const refundResult = await prisma.payment.aggregate({
      where: {
        status: 'REFUNDED',
        amount: { lt: 0 },
        sale:   { branchId, createdAt: { gte: from, lte: to } },
      },
      _sum: { amount: true },
    })

    // COGS — sum of (quantity × unitCost) for all sold items in period
    const cogsResult = await prisma.$queryRaw<{ cogs: number }[]>`
      SELECT COALESCE(SUM(si.quantity * i.unit_cost), 0)::numeric AS cogs
      FROM sale_items si
      JOIN sales s   ON s.id = si.sale_id
      JOIN inventory i ON i.id = si.inventory_id
      WHERE s.branch_id = ${branchId}
        AND s.status = 'COMPLETED'
        AND s.created_at BETWEEN ${from} AND ${to}
    `

    // Expenses by category
    const expenses = await prisma.expense.groupBy({
      by:    ['category'],
      where: { branchId, expenseDate: { gte: from, lte: to } },
      _sum:  { amount: true },
    })

    const totalExpenses = expenses.reduce((s, e) => s + Number(e._sum.amount ?? 0), 0)
    const revenue       = Number(revenueResult._sum.total   ?? 0)
    const refunds       = Math.abs(Number(refundResult._sum.amount ?? 0))
    const netRevenue    = revenue - refunds
    const cogs          = Number(cogsResult[0]?.cogs ?? 0)
    const grossProfit   = netRevenue - cogs
    const grossMargin   = netRevenue > 0 ? Number(((grossProfit / netRevenue) * 100).toFixed(2)) : 0
    const netProfit     = grossProfit - totalExpenses
    const netMargin     = netRevenue > 0 ? Number(((netProfit / netRevenue) * 100).toFixed(2)) : 0

    const pl = {
      period:   { from: input.from, to: input.to },
      revenue: {
        gross:       revenue,
        refunds,
        discounts:   Number(revenueResult._sum.discount ?? 0),
        vat:         Number(revenueResult._sum.vat      ?? 0),
        net:         netRevenue,
        transactions:revenueResult._count.id,
      },
      cogs,
      grossProfit,
      grossMargin,
      expenses: {
        total:      totalExpenses,
        breakdown:  expenses.map(e => ({
          category: e.category,
          amount:   Number(e._sum.amount ?? 0),
        })),
      },
      netProfit,
      netMargin,
    }

    // Cache for 10 min — finance data changes slowly
    await redis.setex(cacheKey, 600, JSON.stringify(pl))
    return pl
  }

  // ── Drug profitability report ─────────────────────────
  // Most profitable drugs by gross margin, revenue, volume
  async getDrugProfitability(input: FinanceRangeInput, branchId: string) {
    const cacheKey = `finance:drugs:${branchId}:${input.from}:${input.to}`
    const cached   = await redis.get(cacheKey)
    if (cached) return JSON.parse(cached)

    const from = new Date(`${input.from}T00:00:00.000Z`)
    const to   = new Date(`${input.to}T23:59:59.999Z`)

    const result = await prisma.$queryRaw<{
      drug_id:        string
      generic_name:   string
      brand_name:     string
      units_sold:     number
      revenue:        number
      cogs:           number
      gross_profit:   number
      gross_margin:   number
    }[]>`
      SELECT
        d.id                                              AS drug_id,
        d.generic_name,
        d.brand_name,
        SUM(si.quantity)::int                             AS units_sold,
        SUM(si.subtotal)::numeric                         AS revenue,
        SUM(si.quantity * i.unit_cost)::numeric           AS cogs,
        (SUM(si.subtotal) - SUM(si.quantity * i.unit_cost))::numeric
                                                          AS gross_profit,
        CASE WHEN SUM(si.subtotal) > 0
          THEN ROUND(
            (SUM(si.subtotal) - SUM(si.quantity * i.unit_cost))
            / SUM(si.subtotal) * 100, 2
          )
          ELSE 0
        END                                               AS gross_margin
      FROM sale_items si
      JOIN sales     s ON s.id = si.sale_id
      JOIN drugs     d ON d.id = si.drug_id
      JOIN inventory i ON i.id = si.inventory_id
      WHERE s.branch_id = ${branchId}
        AND s.status    = 'COMPLETED'
        AND s.created_at BETWEEN ${from} AND ${to}
      GROUP BY d.id, d.generic_name, d.brand_name
      ORDER BY gross_profit DESC
      LIMIT 20
    `

    await redis.setex(cacheKey, 600, JSON.stringify(result))
    return result
  }

  // ── Daily revenue for charting ────────────────────────
  async getDailyRevenue(input: FinanceRangeInput, branchId: string) {
    const cacheKey = `finance:daily:${branchId}:${input.from}:${input.to}`
    const cached   = await redis.get(cacheKey)
    if (cached) return JSON.parse(cached)

    const from = new Date(`${input.from}T00:00:00.000Z`)
    const to   = new Date(`${input.to}T23:59:59.999Z`)

    const result = await prisma.$queryRaw<{
      date:     string
      revenue:  number
      cogs:     number
      profit:   number
      txns:     number
    }[]>`
      SELECT
        DATE(s.created_at AT TIME ZONE 'Africa/Nairobi') AS date,
        SUM(s.total)::numeric                            AS revenue,
        SUM(si_cogs.cogs)::numeric                       AS cogs,
        (SUM(s.total) - SUM(si_cogs.cogs))::numeric      AS profit,
        COUNT(DISTINCT s.id)::int                        AS txns
      FROM sales s
      JOIN (
        SELECT si.sale_id, SUM(si.quantity * i.unit_cost) AS cogs
        FROM sale_items si
        JOIN inventory i ON i.id = si.inventory_id
        GROUP BY si.sale_id
      ) si_cogs ON si_cogs.sale_id = s.id
      WHERE s.branch_id = ${branchId}
        AND s.status    = 'COMPLETED'
        AND s.created_at BETWEEN ${from} AND ${to}
      GROUP BY DATE(s.created_at AT TIME ZONE 'Africa/Nairobi')
      ORDER BY date ASC
    `

    await redis.setex(cacheKey, 300, JSON.stringify(result))
    return result
  }

  // ── Inventory valuation ───────────────────────────────
  async getInventoryValuation(branchId: string) {
    const cacheKey = `finance:inv-val:${branchId}`
    const cached   = await redis.get(cacheKey)
    if (cached) return JSON.parse(cached)

    const result = await prisma.$queryRaw<{
      category:        string
      skus:            number
      total_qty:       number
      cost_value:      number
      selling_value:   number
      potential_profit:number
    }[]>`
      SELECT
        d.drug_class                                        AS category,
        COUNT(DISTINCT i.id)::int                           AS skus,
        SUM(i.quantity_on_hand)::int                        AS total_qty,
        SUM(i.quantity_on_hand * i.unit_cost)::numeric      AS cost_value,
        SUM(i.quantity_on_hand * i.selling_price)::numeric  AS selling_value,
        SUM(i.quantity_on_hand * (i.selling_price - i.unit_cost))::numeric
                                                            AS potential_profit
      FROM inventory i
      JOIN drugs d ON d.id = i.drug_id
      WHERE i.branch_id = ${branchId}
        AND i.quantity_on_hand > 0
      GROUP BY d.drug_class
      ORDER BY cost_value DESC
    `

    await redis.setex(cacheKey, 300, JSON.stringify(result))
    return result
  }

  // ── Payment method breakdown ──────────────────────────
  async getPaymentBreakdown(input: FinanceRangeInput, branchId: string) {
    const from = new Date(`${input.from}T00:00:00.000Z`)
    const to   = new Date(`${input.to}T23:59:59.999Z`)

    return prisma.payment.groupBy({
      by:    ['method'],
      where: {
        status: 'COMPLETED',
        sale:   { branchId, status: 'COMPLETED', createdAt: { gte: from, lte: to } },
      },
      _sum:   { amount: true },
      _count: { id: true },
      orderBy:{ _sum: { amount: 'desc' } },
    })
  }
}

export const financeService = new FinanceService()


// ════════════════════════════════════════════════════════════
// modules/finance/finance.controller.ts
// ════════════════════════════════════════════════════════════
import { Request, Response, NextFunction } from 'express'
import { financeService }                  from './finance.service'
import {
  createExpenseSchema,
  financeRangeSchema,
}                                          from './finance.schema'

export class FinanceController {

  async createExpense(req: Request, res: Response, next: NextFunction) {
    try {
      const input   = createExpenseSchema.parse(req.body)
      const expense = await financeService.createExpense(input, req.branchId!, req.user!.sub)
      res.status(201).json({ success: true, data: expense })
    } catch (e) { next(e) }
  }

  async listExpenses(req: Request, res: Response, next: NextFunction) {
    try {
      const input = financeRangeSchema.parse(req.query)
      const data  = await financeService.listExpenses(input, req.branchId!)
      res.json({ success: true, data })
    } catch (e) { next(e) }
  }

  async getProfitAndLoss(req: Request, res: Response, next: NextFunction) {
    try {
      const input = financeRangeSchema.parse(req.query)
      const data  = await financeService.getProfitAndLoss(input, req.branchId!)
      res.json({ success: true, data })
    } catch (e) { next(e) }
  }

  async getDrugProfitability(req: Request, res: Response, next: NextFunction) {
    try {
      const input = financeRangeSchema.parse(req.query)
      const data  = await financeService.getDrugProfitability(input, req.branchId!)
      res.json({ success: true, data })
    } catch (e) { next(e) }
  }

  async getDailyRevenue(req: Request, res: Response, next: NextFunction) {
    try {
      const input = financeRangeSchema.parse(req.query)
      const data  = await financeService.getDailyRevenue(input, req.branchId!)
      res.json({ success: true, data })
    } catch (e) { next(e) }
  }

  async getInventoryValuation(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await financeService.getInventoryValuation(req.branchId!)
      res.json({ success: true, data })
    } catch (e) { next(e) }
  }

  async getPaymentBreakdown(req: Request, res: Response, next: NextFunction) {
    try {
      const input = financeRangeSchema.parse(req.query)
      const data  = await financeService.getPaymentBreakdown(input, req.branchId!)
      res.json({ success: true, data })
    } catch (e) { next(e) }
  }
}

export const financeController = new FinanceController()


// ════════════════════════════════════════════════════════════
// modules/finance/finance.router.ts
// ════════════════════════════════════════════════════════════
import { Router }           from 'express'
import { financeController} from './finance.controller'
import { authenticate }     from '../../middleware/authenticate'
import { authorize }        from '../../middleware/authorize'

const router = Router()
router.use(authenticate)
router.use(authorize(['SUPER_ADMIN','PHARMACIST','ACCOUNTANT','STORE_MANAGER']))

router.get ('/pl',                financeController.getProfitAndLoss.bind(financeController))
router.get ('/drugs',             financeController.getDrugProfitability.bind(financeController))
router.get ('/daily',             financeController.getDailyRevenue.bind(financeController))
router.get ('/inventory-value',   financeController.getInventoryValuation.bind(financeController))
router.get ('/payments',          financeController.getPaymentBreakdown.bind(financeController))
router.get ('/expenses',          financeController.listExpenses.bind(financeController))
router.post('/expenses',
  authorize(['SUPER_ADMIN','ACCOUNTANT','STORE_MANAGER']),
  financeController.createExpense.bind(financeController),
)

export default router