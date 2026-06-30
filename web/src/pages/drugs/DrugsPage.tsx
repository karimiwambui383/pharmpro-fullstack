// ════════════════════════════════════════════════════════════
// apps/web/src/pages/drugs/DrugsPage.tsx
// ════════════════════════════════════════════════════════════
import { useState }            from 'react'
import { Plus, AlertTriangle, Search } from 'lucide-react'
import { useDrugs, useCheckInteraction } from '../../api/drugs.api'
import { useDebouncedValue }   from '../../hooks/useDebouncedValue'
import { Card, CardHeader }    from '../../components/ui/Card'
import { Button }              from '../../components/ui/Button'
import { Badge }               from '../../components/ui/Badge'
import { SearchInput }         from '../../components/ui/SearchInput'
import { Input }               from '../../components/ui/Input'
import { EmptyState }          from '../../components/ui/EmptyState'

export default function DrugsPage() {
  const [rawQ, setRawQ] = useState('')
  const q = useDebouncedValue(rawQ, 300)
  const { data, isLoading } = useDrugs({ q: q || undefined, limit: 30 })

  const [drugA, setDrugA] = useState('')
  const [drugB, setDrugB] = useState('')
  const [checkAId, setCheckAId] = useState<string>()
  const [checkBId, setCheckBId] = useState<string>()
  const { data: interaction } = useCheckInteraction(checkAId, checkBId)
  const { data: aMatches } = useDrugs({ q: drugA || undefined, limit: 5 })
  const { data: bMatches } = useDrugs({ q: drugB || undefined, limit: 5 })

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4 page-enter">
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <SearchInput value={rawQ} onChange={e => setRawQ(e.target.value)}
            placeholder="Search drug name, class..." containerClass="flex-1 max-w-md" />
          <Button variant="primary" icon={<Plus size={16}/>}>Add Drug</Button>
        </div>

        {isLoading ? (
          <div className="space-y-2">{Array.from({length:5}).map((_,i)=><div key={i} className="shimmer h-24 rounded-lg"/>)}</div>
        ) : (data?.data ?? []).length === 0 ? (
          <EmptyState icon={<Search/>} title="No drugs found" />
        ) : (
          <div className="space-y-2.5">
            {data!.data.map((d: any) => (
              <Card key={d.id}>
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-sm font-bold">{d.genericName}</p>
                    <p className="text-xs text-text3">{d.brandName}</p>
                  </div>
                  <Badge variant="info">{d.drugClass ?? 'Unclassified'}</Badge>
                </div>
                <div className="flex gap-1.5 flex-wrap mt-2.5">
                  <Badge variant={d.controlledCategory==='OTC'?'success':'warning'}>
                    {d.controlledCategory.replace('_',' ')}
                  </Badge>
                  {d.pregnancyCategory && <Badge variant="gray">Pregnancy: {d.pregnancyCategory}</Badge>}
                </div>
                {d.standardDose && <p className="text-xs text-text3 mt-2">{d.standardDose}</p>}
              </Card>
            ))}
          </div>
        )}
      </div>

      <Card>
        <CardHeader title="Interaction checker" icon={<AlertTriangle size={16}/>} />
        <div className="space-y-2.5">
          <div>
            <Input label="Drug A" value={drugA} onChange={e => { setDrugA(e.target.value); setCheckAId(undefined) }} placeholder="e.g. Warfarin" />
            {drugA && !checkAId && (aMatches?.data ?? []).length > 0 && (
              <div className="mt-1 space-y-0.5">
                {aMatches!.data.slice(0,3).map((d:any) => (
                  <button key={d.id} onClick={() => { setDrugA(d.genericName); setCheckAId(d.id) }}
                    className="block w-full text-left text-xs px-2 py-1.5 rounded hover:bg-surface">
                    {d.genericName}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <Input label="Drug B" value={drugB} onChange={e => { setDrugB(e.target.value); setCheckBId(undefined) }} placeholder="e.g. Atorvastatin" />
            {drugB && !checkBId && (bMatches?.data ?? []).length > 0 && (
              <div className="mt-1 space-y-0.5">
                {bMatches!.data.slice(0,3).map((d:any) => (
                  <button key={d.id} onClick={() => { setDrugB(d.genericName); setCheckBId(d.id) }}
                    className="block w-full text-left text-xs px-2 py-1.5 rounded hover:bg-surface">
                    {d.genericName}
                  </button>
                ))}
              </div>
            )}
          </div>

          {interaction && (
            <div className={`p-3 rounded-lg text-sm ${
              interaction.found
                ? interaction.severity === 'CONTRAINDICATED' || interaction.severity === 'MAJOR'
                  ? 'bg-red-lt text-red' : 'bg-amber-lt text-amber'
                : 'bg-green-lt text-green'
            }`}>
              {interaction.found ? (
                <>
                  <p className="font-bold mb-1">{interaction.severity}</p>
                  <p className="text-xs">{interaction.description}</p>
                </>
              ) : (
                <p>{interaction.message}</p>
              )}
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}