// ════════════════════════════════════════════════════════════
// apps/web/src/pages/sales/SalesPage.tsx
// ════════════════════════════════════════════════════════════
import { useState }            from 'react'
import { useNavigate }         from 'react-router-dom'
import { Download, Receipt as ReceiptIcon } from 'lucide-react'
import { format }              from 'date-fns'
import { useSales, useSalesStats } from '../../api/sales.api'
import { useDebouncedValue }   from '../../hooks/useDebouncedValue'
import { Card }                from '../../components/ui/Card'
import { KpiCard }             from '../../components/ui/KpiCard'
import { Button }              from '../../components/ui/Button'
import { Badge }               from '../../components/ui/Badge'
import { Table }               from '../../components/ui/Table'
import { Pagination }          from '../../components/ui/Pagination'
import { SearchInput }         from '../../components/ui/SearchInput'
import { DollarSign, Receipt, ArrowLeftRight, RotateCcw } from 'lucide-react'

const PAY_BADGE: Record<string, any> = {
  CASH:'success', MPESA:'info', CARD:'warning', INSURANCE:'purple', NHIF:'purple', CREDIT:'gray',
}

export default function SalesPage() {
  const navigate         = useNavigate()
  const [rawQ, setRawQ]  = useState('')
  const [method, setMethod] = useState('')
  const [date, setDate]  = useState('')
  const [page, setPage]  = useState(1)
  const q = useDebouncedValue(rawQ, 300)

  const { data, isLoading } = useSales({
    q: q || undefined, method: method || undefined,
    dateFrom: date || undefined, dateTo: date || undefined,
    page, limit: 15,
  })
  const { data: stats } = useSalesStats()

  return (
    <div className="space-y-4 page-enter">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Today's sales" value={`KES ${(stats?.today?.revenue ?? 0).toLocaleString('en-KE')}`}
          icon={<DollarSign size={20}/>} color="green" />
        <KpiCard label="Transactions" value={stats?.today?.count ?? 0}
          icon={<Receipt size={20}/>} color="blue" />
        <KpiCard label="Avg order value" value={`KES ${(stats?.today?.avgOrder ?? 0).toLocaleString('en-KE')}`}
          icon={<ArrowLeftRight size={20}/>} color="purple" />
        <KpiCard label="Refunds" value={stats?.today?.refunds ?? 0}
          icon={<RotateCcw size={20}/>} color="red" />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <SearchInput value={rawQ} onChange={e => { setRawQ(e.target.value); setPage(1) }}
          placeholder="Search ID, patient, cashier..." containerClass="flex-1 min-w-[200px]" />
        <input type="date" value={date} onChange={e => { setDate(e.target.value); setPage(1) }}
          className="bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text outline-none focus:border-blue" />
        <select value={method} onChange={e => { setMethod(e.target.value); setPage(1) }}
          className="bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text outline-none focus:border-blue">
          <option value="">All payments</option>
          <option value="CASH">Cash</option><option value="MPESA">M-Pesa</option>
          <option value="CARD">Card</option><option value="INSURANCE">Insurance</option>
        </select>
        <Button variant="ghost" icon={<Download size={14}/>}>Export</Button>
      </div>

      <Card padding={false}>
        <Table
          loading={isLoading}
          rowKey={(r: any) => r.id}
          emptyMsg="No sales found"
          onRowClick={(r: any) => navigate(`/sales/${r.id}`)}
          data={data?.data ?? []}
          columns={[
            { key:'saleNo', header:'Sale ID', render:(s:any)=><span className="font-bold text-blue">#{s.saleNo}</span> },
            { key:'patient', header:'Patient', render:(s:any)=> s.patient ? `${s.patient.firstName} ${s.patient.lastName}` : 'Walk-in' },
            { key:'items', header:'Items', render:(s:any)=> s.items?.length ?? 0 },
            { key:'payment', header:'Payment', render:(s:any)=>
                <div className="flex gap-1 flex-wrap">
                  {s.payments?.map((p:any)=> <Badge key={p.id} variant={PAY_BADGE[p.method]}>{p.method}</Badge>)}
                </div> },
            { key:'total', header:'Amount', render:(s:any)=> <span className="font-bold">KES {Number(s.total).toLocaleString('en-KE')}</span> },
            { key:'cashier', header:'Cashier', render:(s:any)=> `${s.cashier.firstName} ${s.cashier.lastName}` },
            { key:'createdAt', header:'Time', render:(s:any)=> format(new Date(s.createdAt), 'HH:mm') },
            { key:'status', header:'Status', render:(s:any)=>
                <Badge variant={s.status==='COMPLETED'?'success':s.status==='REFUNDED'?'danger':'gray'}>{s.status}</Badge> },
            { key:'action', header:'', render:(s:any)=>
                <Button size="xs" variant="ghost" icon={<ReceiptIcon size={13}/>}
                  onClick={(e)=>{e.stopPropagation(); navigate(`/sales/${s.id}`)}}>
                  Receipt
                </Button> },
          ]}
        />
        {data?.meta && (
          <div className="px-4">
            <Pagination page={data.meta.page} pages={data.meta.pages}
              total={data.meta.total} limit={data.meta.limit} onChange={setPage} />
          </div>
        )}
      </Card>
    </div>
  )
}


