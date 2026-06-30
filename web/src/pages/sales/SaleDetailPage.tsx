// ════════════════════════════════════════════════════════════
// apps/web/src/pages/sales/SaleDetailPage.tsx
// ════════════════════════════════════════════════════════════
import { useParams, useNavigate } from 'react-router-dom'
import { format }              from 'date-fns'
import { ArrowLeft, Printer, RotateCcw } from 'lucide-react'
import { useSale, useRefundSale } from '../../api/sales.api'
import { Card, CardHeader }    from '../../components/ui/Card'
import { Button }              from '../../components/ui/Button'
import { Badge }               from '../../components/ui/Badge'
import { useState }            from 'react'

export default function SaleDetailPage() {
  const { id }   = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: sale, isLoading } = useSale(id!)
  const refund   = useRefundSale()
  const [refundItems, setRefundItems] = useState<Record<string, number>>({})
  const [showRefund, setShowRefund]   = useState(false)

  if (isLoading) return <div className="shimmer h-96 rounded-xl" />
  if (!sale) return <p className="text-text3">Sale not found</p>

  async function handleRefund() {
    const items = Object.entries(refundItems)
      .filter(([, q]) => q > 0)
      .map(([saleItemId, quantity]) => ({ saleItemId, quantity }))
    if (!items.length) return alert('Select at least one item to refund')
    const reason = window.prompt('Refund reason:')
    if (!reason) return
    await refund.mutateAsync({ saleId: sale.id, reason, items })
    setShowRefund(false)
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4 page-enter">
      <button onClick={() => navigate('/sales')}
        className="flex items-center gap-1.5 text-sm text-text3 hover:text-text2">
        <ArrowLeft size={14} /> Back to sales
      </button>

      <Card>
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-lg font-extrabold">#{sale.saleNo}</h2>
            <p className="text-sm text-text3 mt-0.5">
              {format(new Date(sale.createdAt), 'd MMM yyyy, HH:mm')} ·
              {' '}{sale.cashier.firstName} {sale.cashier.lastName}
            </p>
          </div>
          <Badge variant={sale.status==='COMPLETED'?'success':'danger'}>{sale.status}</Badge>
        </div>

        <div className="divide-y divide-border">
          {sale.items.map((item: any) => (
            <div key={item.id} className="flex items-center justify-between py-2.5">
              <div className="flex items-center gap-2">
                {sale.status === 'COMPLETED' && (
                  <input type="checkbox"
                    onChange={e => setRefundItems(prev => ({
                      ...prev, [item.id]: e.target.checked ? item.quantity : 0,
                    }))}
                  />
                )}
                <div>
                  <p className="text-sm font-semibold">{item.drug.genericName}</p>
                  <p className="text-xs text-text3">batch {item.inventory?.batchNo}</p>
                </div>
              </div>
              <p className="text-sm">
                {item.quantity} × KES {Number(item.unitPrice).toLocaleString('en-KE')}
                {' = '}
                <span className="font-bold">KES {Number(item.subtotal).toLocaleString('en-KE')}</span>
              </p>
            </div>
          ))}
        </div>

        <div className="mt-4 pt-4 border-t border-border space-y-1.5">
          <div className="flex justify-between text-sm text-text2">
            <span>Subtotal</span><span>KES {Number(sale.subtotal).toLocaleString('en-KE')}</span>
          </div>
          <div className="flex justify-between text-sm text-text2">
            <span>Discount</span><span className="text-green">−KES {Number(sale.discount).toLocaleString('en-KE')}</span>
          </div>
          <div className="flex justify-between text-sm text-text2">
            <span>VAT 16%</span><span>KES {Number(sale.vat).toLocaleString('en-KE')}</span>
          </div>
          <div className="flex justify-between text-base font-extrabold pt-2 border-t border-border">
            <span>Total</span><span className="text-blue">KES {Number(sale.total).toLocaleString('en-KE')}</span>
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          {sale.payments.map((p: any) => (
            <Badge key={p.id} variant="info">{p.method}: KES {Number(p.amount).toLocaleString('en-KE')}</Badge>
          ))}
        </div>

        <div className="flex gap-2 mt-5">
          <Button variant="ghost" icon={<Printer size={14}/>} onClick={() => window.print()}>Print</Button>
          {sale.status === 'COMPLETED' && (
            showRefund ? (
              <Button variant="danger" icon={<RotateCcw size={14}/>} loading={refund.isPending} onClick={handleRefund}>
                Confirm Refund
              </Button>
            ) : (
              <Button variant="danger" icon={<RotateCcw size={14}/>} onClick={() => setShowRefund(true)}>
                Refund Items
              </Button>
            )
          )}
        </div>
      </Card>
    </div>
  )
}


