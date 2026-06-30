// ════════════════════════════════════════════════════════════
// apps/web/src/pages/purchases/PurchasesPage.tsx
// ════════════════════════════════════════════════════════════
import { useState }            from 'react'
import { useNavigate }         from 'react-router-dom'
import { Plus, FileText }      from 'lucide-react'
import { format }              from 'date-fns'
import { usePurchases, usePurchaseStats } from '../../api/purchases.api'
import { Card }                from '../../components/ui/Card'
import { KpiCard }             from '../../components/ui/KpiCard'
import { Button }              from '../../components/ui/Button'
import { Badge }               from '../../components/ui/Badge'
import { Table }               from '../../components/ui/Table'

const STATUS_BADGE: Record<string, any> = {
  DRAFT:'gray', SENT:'info', PARTIAL:'warning', RECEIVED:'success', CANCELLED:'danger',
}

export function PurchasesPage() {
  const navigate = useNavigate()
  const [page, setPage] = useState(1)
  const { data, isLoading } = usePurchases({ page, limit: 15 })
  const { data: stats } = usePurchaseStats()

  return (
    <div className="space-y-4 page-enter">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <KpiCard label="Pending orders" value={stats?.pendingOrders ?? 0} icon={<FileText size={20}/>} color="amber" />
        <KpiCard label="This month orders" value={stats?.thisMonthOrders ?? 0} icon={<FileText size={20}/>} color="blue" />
        <KpiCard label="This month spend" value={`KES ${((stats?.thisMonthSpend ?? 0)/1000).toFixed(0)}K`} icon={<FileText size={20}/>} color="green" />
      </div>

      <div className="flex justify-end">
        <Button variant="primary" icon={<Plus size={16}/>}>New Purchase Order</Button>
      </div>

      <Card padding={false}>
        <Table
          loading={isLoading}
          rowKey={(r: any) => r.id}
          emptyMsg="No purchase orders found"
          onRowClick={(r: any) => navigate(`/purchases/${r.id}`)}
          data={data?.data ?? []}
          columns={[
            { key:'poNumber', header:'PO No.', render:(p:any)=><span className="font-bold text-blue">{p.poNumber}</span> },
            { key:'supplier', header:'Supplier', render:(p:any)=> p.supplier.name },
            { key:'lines', header:'Lines', render:(p:any)=> p.items?.length ?? 0 },
            { key:'value', header:'Value', render:(p:any)=> `KES ${Number(p.totalValue).toLocaleString('en-KE')}` },
            { key:'ordered', header:'Ordered', render:(p:any)=> format(new Date(p.createdAt), 'd MMM') },
            { key:'expected', header:'Expected', render:(p:any)=> p.expectedDate ? format(new Date(p.expectedDate), 'd MMM') : '–' },
            { key:'status', header:'Status', render:(p:any)=> <Badge variant={STATUS_BADGE[p.status]}>{p.status}</Badge> },
          ]}
        />
      </Card>
    </div>
  )
}
export default PurchasesPage


