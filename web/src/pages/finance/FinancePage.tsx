// ════════════════════════════════════════════════════════════
// apps/web/src/pages/finance/FinancePage.tsx
// ════════════════════════════════════════════════════════════
import { useState }            from 'react'
import { format, subDays }     from 'date-fns'
import {
  TrendingUp, TrendingDown, Percent, Clock, DollarSign,
}                              from 'lucide-react'
import {
  BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Legend,
}                              from 'recharts'
import {
  useProfitAndLoss, useDrugProfitability,
  useDailyRevenue, usePaymentBreakdown,
}                              from '../../api/finance.api'
import { Card, CardHeader }    from '../../components/ui/Card'
import { KpiCard }             from '../../components/ui/KpiCard'
import { Table }               from '../../components/ui/Table'
import { Badge }               from '../../components/ui/Badge'

const COLORS = ['#3b82f6','#22c55e','#a855f7','#f59e0b','#14b8a6','#ef4444']

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="glass-card px-3 py-2 text-xs">
      <p className="text-text3 mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} style={{ color: p.color }} className="font-bold">
          {p.name}: KES {Number(p.value).toLocaleString('en-KE')}
        </p>
      ))}
    </div>
  )
}

export default function FinancePage() {
  // Default range: last 30 days
  const [from] = useState(format(subDays(new Date(), 30), 'yyyy-MM-dd'))
  const [to]   = useState(format(new Date(), 'yyyy-MM-dd'))

  const { data: pl,        isLoading: plLoading }    = useProfitAndLoss(from, to)
  const { data: drugProfit }                          = useDrugProfitability(from, to)
  const { data: daily }                                = useDailyRevenue(from, to)
  const { data: payments }                             = usePaymentBreakdown(from, to)

  const chartData = (daily ?? []).map((d: any) => ({
    date:    format(new Date(d.date), 'd MMM'),
    revenue: Number(d.revenue),
    cogs:    Number(d.cogs),
    profit:  Number(d.profit),
  }))

  const pieData = (payments ?? []).map((p: any) => ({
    name:  p.method,
    value: Number(p._sum.amount ?? 0),
  }))

  return (
    <div className="space-y-4 page-enter">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label="Net revenue (30d)"
          value={`KES ${((pl?.revenue?.net ?? 0)/1000).toFixed(0)}K`}
          change="↑ 18%" trend="up"
          icon={<TrendingUp size={20}/>} color="green" loading={plLoading}
        />
        <KpiCard
          label="Cost of goods"
          value={`KES ${((pl?.cogs ?? 0)/1000).toFixed(0)}K`}
          icon={<TrendingDown size={20}/>} color="red" loading={plLoading}
        />
        <KpiCard
          label="Gross margin"
          value={`${pl?.grossMargin ?? 0}%`}
          change={pl?.grossMargin > 35 ? 'Healthy' : undefined} trend="up"
          icon={<Percent size={20}/>} color="blue" loading={plLoading}
        />
        <KpiCard
          label="Net profit (30d)"
          value={`KES ${((pl?.netProfit ?? 0)/1000).toFixed(0)}K`}
          icon={<DollarSign size={20}/>} color="purple" loading={plLoading}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-3">
          <Card>
            <CardHeader title="Revenue vs COGS — 30 days" icon={<TrendingUp size={16}/>} />
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={chartData}>
                <CartesianGrid stroke="rgba(255,255,255,.04)" strokeDasharray="4 4" />
                <XAxis dataKey="date" tick={{ fill:'#4a5878', fontSize:10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill:'#4a5878', fontSize:11 }} axisLine={false} tickLine={false}
                  tickFormatter={v => `${(v/1000).toFixed(0)}K`} />
                <Tooltip content={<ChartTooltip />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="revenue" name="Revenue" fill="#3b82f6" radius={[3,3,0,0]} />
                <Bar dataKey="cogs"    name="COGS"    fill="#ef4444" radius={[3,3,0,0]} fillOpacity={0.6} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </div>

        <div className="lg:col-span-2">
          <Card>
            <CardHeader title="Payment breakdown" icon={<DollarSign size={16}/>} />
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%"
                  innerRadius={50} outerRadius={75} paddingAngle={2}>
                  {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip content={<ChartTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex flex-wrap gap-2 justify-center mt-2">
              {pieData.map((p: any, i: number) => (
                <span key={p.name} className="text-xs text-text2 flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ background: COLORS[i % COLORS.length] }} />
                  {p.name}
                </span>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <Card padding={false}>
        <div className="p-5 pb-0">
          <CardHeader title="Most profitable drugs" icon={<TrendingUp size={16}/>} />
        </div>
        <Table
          rowKey={(r: any) => r.drug_id}
          emptyMsg="No sales data for this period"
          data={drugProfit ?? []}
          columns={[
            { key:'generic_name', header:'Drug', render:(d:any)=> <span className="font-bold">{d.generic_name}</span> },
            { key:'units_sold',   header:'Units sold' },
            { key:'revenue',      header:'Revenue', render:(d:any)=> `KES ${Number(d.revenue).toLocaleString('en-KE')}` },
            { key:'cogs',         header:'COGS',    render:(d:any)=> `KES ${Number(d.cogs).toLocaleString('en-KE')}` },
            { key:'gross_profit', header:'Profit',  render:(d:any)=> <span className="font-bold text-green">KES {Number(d.gross_profit).toLocaleString('en-KE')}</span> },
            { key:'gross_margin', header:'Margin',  render:(d:any)=> <Badge variant={d.gross_margin > 30 ? 'success' : 'warning'}>{d.gross_margin}%</Badge> },
          ]}
        />
      </Card>

      <Card>
        <CardHeader title="Expense breakdown" icon={<Clock size={16}/>} />
        <div className="space-y-2">
          {(pl?.expenses?.breakdown ?? []).map((e: any) => (
            <div key={e.category} className="flex items-center justify-between p-2.5 bg-surface rounded-lg">
              <span className="text-sm font-semibold capitalize">{e.category.toLowerCase()}</span>
              <span className="text-sm font-bold">KES {e.amount.toLocaleString('en-KE')}</span>
            </div>
          ))}
          {(!pl?.expenses?.breakdown || pl.expenses.breakdown.length === 0) && (
            <p className="text-sm text-text3 text-center py-4">No expenses recorded this period</p>
          )}
        </div>
      </Card>
    </div>
  )
}


