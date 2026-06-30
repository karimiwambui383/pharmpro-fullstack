// ════════════════════════════════════════════════════════════
// apps/web/src/pages/purchases/PurchaseDetailPage.tsx
// ════════════════════════════════════════════════════════════
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Send, Package } from 'lucide-react'
import { usePurchase, useSendPurchase, useReceivePurchase } from '../../api/purchases.api'
import { Card, CardHeader }    from '../../components/ui/Card'
import { Button }              from '../../components/ui/Button'
import { Badge }               from '../../components/ui/Badge'
import { useState }            from 'react'
import { Input }               from '../../components/ui/Input'

export function PurchaseDetailPage() {
  const { id }   = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: po, isLoading } = usePurchase(id!)
  const send     = useSendPurchase()
  const receive  = useReceivePurchase()
  const [receiveData, setReceiveData] = useState<Record<string, { batchNo:string; expiryDate:string; sellingPrice:string }>>({})

  if (isLoading) return <div className="shimmer h-96 rounded-xl" />
  if (!po) return <p className="text-text3">Purchase order not found</p>

  async function handleReceive() {
    const items = po.items
      .filter((i: any) => !i.received && receiveData[i.id]?.batchNo)
      .map((i: any) => ({
        purchaseItemId: i.id,
        quantityReceived: i.quantity,
        batchNo: receiveData[i.id].batchNo,
        expiryDate: new Date(receiveData[i.id].expiryDate).toISOString(),
        sellingPrice: Number(receiveData[i.id].sellingPrice),
      }))
    if (!items.length) return alert('Fill in batch details for at least one item')
    await receive.mutateAsync({ id: po.id, data: { items } })
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4 page-enter">
      <button onClick={() => navigate('/purchases')} className="flex items-center gap-1.5 text-sm text-text3 hover:text-text2">
        <ArrowLeft size={14}/> Back to purchase orders
      </button>

      <Card>
        <div className="flex justify-between items-start mb-4">
          <div>
            <h2 className="text-lg font-extrabold">{po.poNumber}</h2>
            <p className="text-sm text-text3">{po.supplier.name}</p>
          </div>
          <div className="flex gap-2">
            <Badge variant={po.status==='RECEIVED'?'success':po.status==='SENT'?'info':'gray'}>{po.status}</Badge>
            {po.status === 'DRAFT' && (
              <Button size="sm" variant="primary" icon={<Send size={13}/>} loading={send.isPending}
                onClick={() => send.mutate(po.id)}>Send</Button>
            )}
          </div>
        </div>

        <div className="space-y-3">
          {po.items.map((item: any) => (
            <div key={item.id} className="p-3 border border-border rounded-lg">
              <div className="flex justify-between items-center mb-2">
                <p className="text-sm font-bold">{item.drug.genericName}</p>
                <Badge variant={item.received ? 'success' : 'gray'}>
                  {item.received ? 'Received' : `${item.quantity} units`}
                </Badge>
              </div>
              {!item.received && ['SENT','PARTIAL'].includes(po.status) && (
                <div className="grid grid-cols-3 gap-2 mt-2">
                  <Input placeholder="Batch no." value={receiveData[item.id]?.batchNo ?? ''}
                    onChange={e => setReceiveData(p => ({ ...p, [item.id]: { ...p[item.id], batchNo: e.target.value } }))} />
                  <Input type="date" value={receiveData[item.id]?.expiryDate ?? ''}
                    onChange={e => setReceiveData(p => ({ ...p, [item.id]: { ...p[item.id], expiryDate: e.target.value } }))} />
                  <Input type="number" placeholder="Sell price" value={receiveData[item.id]?.sellingPrice ?? ''}
                    onChange={e => setReceiveData(p => ({ ...p, [item.id]: { ...p[item.id], sellingPrice: e.target.value } }))} />
                </div>
              )}
            </div>
          ))}
        </div>

        {['SENT','PARTIAL'].includes(po.status) && (
          <Button variant="success" icon={<Package size={15}/>} className="w-full justify-center mt-4"
            loading={receive.isPending} onClick={handleReceive}>
            Receive Stock
          </Button>
        )}
      </Card>
    </div>
  )
}
export default PurchaseDetailPage