// ════════════════════════════════════════════════════════════
// apps/web/src/pages/purchases/SuppliersPage.tsx
// ════════════════════════════════════════════════════════════
import { useNavigate }         from 'react-router-dom'
import { Plus, Truck, Phone }  from 'lucide-react'
import { useSuppliers }        from '../../api/purchases.api'
import { Card }                from '../../components/ui/Card'
import { Button }              from '../../components/ui/Button'
import { EmptyState }          from '../../components/ui/EmptyState'

export function SuppliersPage() {
  const { data: suppliers, isLoading } = useSuppliers()
  const navigate = useNavigate()

  return (
    <div className="space-y-4 page-enter">
      <div className="flex justify-between items-center">
        <h2 className="text-base font-bold text-text">Suppliers</h2>
        <Button variant="primary" icon={<Plus size={16}/>}>Add Supplier</Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {Array.from({length:3}).map((_,i)=><div key={i} className="shimmer h-32 rounded-xl"/>)}
        </div>
      ) : !suppliers?.length ? (
        <EmptyState icon={<Truck/>} title="No suppliers yet" />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {suppliers.map((s: any) => (
            <Card key={s.id}>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-blue-lt text-blue flex items-center justify-center">
                  <Truck size={18}/>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold truncate">{s.name}</p>
                  <p className="text-xs text-text3">{s.location ?? 'Location not set'}</p>
                </div>
              </div>
              <p className="text-xs text-text2 flex items-center gap-1.5 mb-1">
                <Phone size={11} className="text-text3"/> {s.phone ?? 'No phone'}
              </p>
              <p className="text-xs text-text3">{s._count?.purchases ?? 0} orders · {s.creditTerms ?? 'No terms set'}</p>
              <Button size="sm" variant="ghost" className="w-full mt-3 justify-center"
                onClick={() => navigate('/purchases')}>
                View orders
              </Button>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
export default SuppliersPage


