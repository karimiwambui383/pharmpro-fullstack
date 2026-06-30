// ════════════════════════════════════════════════════════════
// apps/web/src/pages/inventory/InventoryPage.tsx
// ════════════════════════════════════════════════════════════
import { useState }            from 'react'
import { Plus, Download, Package, AlertCircle, DollarSign, CalendarX } from 'lucide-react'
import { format }              from 'date-fns'
import { useInventory, useInventoryStats, useReceiveStock } from '../../api/inventory.api'
import { useDrugs }            from '../../api/drugs.api'
import { useSuppliers }        from '../../api/purchases.api'
import { useDebouncedValue }   from '../../hooks/useDebouncedValue'
import { Card }                from '../../components/ui/Card'
import { KpiCard }             from '../../components/ui/KpiCard'
import { Button }              from '../../components/ui/Button'
import { Badge }               from '../../components/ui/Badge'
import { Table }               from '../../components/ui/Table'
import { SearchInput }         from '../../components/ui/SearchInput'
import { Modal }               from '../../components/ui/Modal'
import { Input }               from '../../components/ui/Input'
import { Select }              from '../../components/ui/Select'

const STATUS_BADGE: Record<string, any> = {
  critical:'danger', low:'warning', expiring:'danger', normal:'info', good:'success',
}

export default function InventoryPage() {
  const [rawQ, setRawQ]   = useState('')
  const [status, setStatus] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const q = useDebouncedValue(rawQ, 300)

  const { data, isLoading } = useInventory({ q: q || undefined, status: status || undefined, limit: 50 })
  const { data: stats }     = useInventoryStats()

  return (
    <div className="space-y-4 page-enter">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Total SKUs" value={stats?.totalSKUs ?? 0} icon={<Package size={20}/>} color="blue" />
        <KpiCard label="Stock value" value={`KES ${((stats?.totalStockValue ?? 0)/1000).toFixed(0)}K`} icon={<DollarSign size={20}/>} color="green" />
        <KpiCard label="Low stock items" value={stats?.lowStock ?? 0} icon={<AlertCircle size={20}/>} color="red" />
        <KpiCard label="Expiring (30d)" value={stats?.expiring ?? 0} icon={<CalendarX size={20}/>} color="amber" />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <SearchInput value={rawQ} onChange={e => setRawQ(e.target.value)} placeholder="Search stock..." containerClass="flex-1 min-w-[200px]" />
        <select value={status} onChange={e => setStatus(e.target.value)}
          className="bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text outline-none focus:border-blue">
          <option value="">All status</option>
          <option value="critical">Critical</option><option value="low">Low</option>
          <option value="expiring">Expiring</option><option value="good">Good</option>
        </select>
        <Button variant="ghost" icon={<Download size={14}/>}>Export</Button>
        <Button variant="primary" icon={<Plus size={16}/>} onClick={() => setModalOpen(true)}>
          Receive Stock
        </Button>
      </div>

      <Card padding={false}>
        <Table
          loading={isLoading}
          rowKey={(r: any) => r.id}
          emptyMsg="No inventory items found"
          data={data?.data ?? []}
          columns={[
            { key:'drug', header:'Drug', render:(i:any)=>
                <div><p className="font-bold">{i.drug.genericName}</p><p className="text-xs text-text3">{i.drug.dosageForm}</p></div> },
            { key:'cat', header:'Category', render:(i:any)=> i.drug.drugClass ?? '–' },
            { key:'stock', header:'In stock', render:(i:any)=>
                <span className={i.stockStatus==='critical'?'text-red font-bold':''}>{i.quantityOnHand}</span> },
            { key:'reorder', header:'Reorder at', render:(i:any)=> i.reorderLevel },
            { key:'level', header:'Level', render:(i:any)=> {
                const pct = Math.min(100, Math.round((i.quantityOnHand/(i.reorderLevel*2))*100))
                const color = i.stockStatus==='critical'?'bg-red':i.stockStatus==='low'?'bg-amber':'bg-green'
                return (
                  <div className="flex items-center gap-2 w-28">
                    <div className="flex-1 h-1.5 bg-surface rounded-full overflow-hidden">
                      <div className={`h-full ${color}`} style={{width:`${pct}%`}} />
                    </div>
                    <span className="text-xs text-text3 w-8">{pct}%</span>
                  </div>
                )
              } },
            { key:'batch', header:'Batch', render:(i:any)=> <span className="text-xs text-text3">{i.batchNo}</span> },
            { key:'exp', header:'Expires', render:(i:any)=>
                <span className={i.daysUntilExpiry <= 30 ? 'text-amber font-semibold' : ''}>
                  {i.expiryDate ? format(new Date(i.expiryDate), 'MMM yyyy') : '–'}
                </span> },
            { key:'status', header:'Status', render:(i:any)=> <Badge variant={STATUS_BADGE[i.stockStatus]}>{i.stockStatus}</Badge> },
          ]}
        />
      </Card>

      <ReceiveStockModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  )
}

function ReceiveStockModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const receive = useReceiveStock()
  const { data: suppliers } = useSuppliers()
  const [drugQ, setDrugQ]   = useState('')
  const debouncedDrugQ      = useDebouncedValue(drugQ, 300)
  const { data: drugResults } = useDrugs({ q: debouncedDrugQ || undefined, limit: 6 })

  const [form, setForm] = useState({
    drugId:'', drugName:'', batchNo:'', expiryDate:'', quantity:'',
    unitCost:'', sellingPrice:'', supplierId:'', reorderLevel:'20',
  })

  function set<K extends keyof typeof form>(k: K, v: string) { setForm(p => ({ ...p, [k]: v })) }

  async function handleSubmit() {
    if (!form.drugId || !form.batchNo || !form.expiryDate || !form.quantity || !form.unitCost || !form.sellingPrice) {
      return alert('Fill in all required fields')
    }
    await receive.mutateAsync({
      drugId: form.drugId, batchNo: form.batchNo,
      expiryDate: new Date(form.expiryDate).toISOString(),
      quantity: Number(form.quantity), unitCost: Number(form.unitCost),
      sellingPrice: Number(form.sellingPrice),
      supplierId: form.supplierId || undefined,
      reorderLevel: Number(form.reorderLevel),
    })
    onClose()
    setForm({ drugId:'', drugName:'', batchNo:'', expiryDate:'', quantity:'',
      unitCost:'', sellingPrice:'', supplierId:'', reorderLevel:'20' })
  }

  return (
    <Modal open={open} onClose={onClose} title="Receive stock" icon={<Package size={16}/>}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={receive.isPending} onClick={handleSubmit}>Receive Stock</Button>
      </>}>
      <div className="mb-3">
        <Input label="Drug *" value={form.drugName || drugQ}
          onChange={e => { setDrugQ(e.target.value); set('drugName', ''); set('drugId','') }}
          placeholder="Search drug name..." />
        {drugQ && !form.drugId && (drugResults?.data ?? []).length > 0 && (
          <div className="mt-1 space-y-0.5 border border-border rounded-lg p-1">
            {drugResults!.data.map((d: any) => (
              <button key={d.id} onClick={() => { set('drugId', d.id); set('drugName', d.genericName); setDrugQ('') }}
                className="block w-full text-left text-sm px-2 py-1.5 rounded hover:bg-surface">
                {d.genericName} <span className="text-text3">({d.brandName})</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <Input label="Quantity *" type="number" value={form.quantity} onChange={e => set('quantity', e.target.value)} />
        <Input label="Unit cost (KES) *" type="number" value={form.unitCost} onChange={e => set('unitCost', e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <Input label="Selling price (KES) *" type="number" value={form.sellingPrice} onChange={e => set('sellingPrice', e.target.value)} />
        <Input label="Reorder level" type="number" value={form.reorderLevel} onChange={e => set('reorderLevel', e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <Input label="Batch number *" value={form.batchNo} onChange={e => set('batchNo', e.target.value)} placeholder="e.g. AMX-26-06" />
        <Input label="Expiry date *" type="date" value={form.expiryDate} onChange={e => set('expiryDate', e.target.value)} />
      </div>
      <Select label="Supplier" value={form.supplierId} onChange={e => set('supplierId', e.target.value)}
        placeholder="Select supplier"
        options={(suppliers ?? []).map((s:any) => ({ value: s.id, label: s.name }))} />
    </Modal>
  )
}


