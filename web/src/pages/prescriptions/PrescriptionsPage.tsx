// ════════════════════════════════════════════════════════════
// apps/web/src/pages/prescriptions/PrescriptionsPage.tsx
// ════════════════════════════════════════════════════════════
import { useState }            from 'react'
import { useNavigate }         from 'react-router-dom'
import { Plus, Pill }          from 'lucide-react'
import { format }              from 'date-fns'
import { usePrescriptions, useDispensePrescription, useVerifyPrescription } from '../../api/prescriptions.api'
import { Card }                from '../../components/ui/Card'
import { Button }              from '../../components/ui/Button'
import { Badge }               from '../../components/ui/Badge'
import { Table }               from '../../components/ui/Table'
import { Pagination }          from '../../components/ui/Pagination'
import { SearchInput }         from '../../components/ui/SearchInput'
import { useDebouncedValue }   from '../../hooks/useDebouncedValue'

const TABS = [
  { key:'',                     label:'All' },
  { key:'PENDING_VERIFICATION', label:'Pending' },
  { key:'VERIFIED',             label:'Verified' },
  { key:'PROCESSING',           label:'Processing' },
  { key:'READY',                label:'Ready' },
  { key:'DISPENSED',            label:'Dispensed' },
]

const STATUS_BADGE: Record<string, 'danger'|'info'|'warning'|'success'|'purple'|'gray'> = {
  PENDING_VERIFICATION:'gray', VERIFIED:'info', PROCESSING:'warning',
  READY:'success', DISPENSED:'purple', CANCELLED:'danger', ON_HOLD:'warning',
}

export default function PrescriptionsPage() {
  const navigate              = useNavigate()
  const [tab, setTab]         = useState('')
  const [rawQ, setRawQ]       = useState('')
  const [page, setPage]       = useState(1)
  const q                     = useDebouncedValue(rawQ, 300)

  const { data, isLoading } = usePrescriptions({
    status: tab || undefined, q: q || undefined, page, limit: 15,
  })

  const verify   = useVerifyPrescription()
  const dispense = useDispensePrescription()

  return (
    <div className="space-y-4 page-enter">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex gap-1 border-b border-border -mb-px">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => { setTab(t.key); setPage(1) }}
              className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-all
                ${tab === t.key
                  ? 'border-blue text-blue'
                  : 'border-transparent text-text3 hover:text-text2'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <Button
          variant="primary" icon={<Plus size={16}/>}
          onClick={() => navigate('/prescriptions/new')}
        >
          New Prescription
        </Button>
      </div>

      <div className="flex gap-2">
        <SearchInput
          value={rawQ} onChange={e => { setRawQ(e.target.value); setPage(1) }}
          placeholder="Search by Rx number, patient, doctor..."
          containerClass="flex-1 max-w-md"
        />
      </div>

      <Card padding={false}>
        <Table
          loading={isLoading}
          rowKey={(r: any) => r.id}
          emptyMsg="No prescriptions found"
          onRowClick={(r: any) => navigate(`/prescriptions/${r.id}`)}
          data={data?.data ?? []}
          columns={[
            {
              key:'rxNumber', header:'Rx No.',
              render: (r: any) => <span className="font-bold text-blue">#{r.rxNumber}</span>,
            },
            {
              key:'patient', header:'Patient',
              render: (r: any) => `${r.patient.firstName} ${r.patient.lastName}`,
            },
            {
              key:'items', header:'Drugs',
              render: (r: any) => (
                <span className="text-text2">
                  {r.items.map((i: any) => i.drug.genericName).join(', ')}
                </span>
              ),
            },
            { key:'doctorName', header:'Prescriber' },
            {
              key:'priority', header:'Priority',
              render: (r: any) => (
                <Badge variant={r.priority === 'EMERGENCY' || r.priority === 'URGENT' ? 'danger' : 'gray'}>
                  {r.priority}
                </Badge>
              ),
            },
            {
              key:'createdAt', header:'Date',
              render: (r: any) => format(new Date(r.createdAt), 'd MMM, HH:mm'),
            },
            {
              key:'status', header:'Status',
              render: (r: any) => <Badge variant={STATUS_BADGE[r.status] ?? 'gray'}>{r.status.replace('_',' ')}</Badge>,
            },
            {
              key:'action', header:'',
              render: (r: any) => (
                <div onClick={e => e.stopPropagation()}>
                  {r.status === 'PENDING_VERIFICATION' && (
                    <Button size="xs" variant="primary"
                      loading={verify.isPending}
                      onClick={() => verify.mutate(r.id)}>
                      Verify
                    </Button>
                  )}
                  {r.status === 'READY' && (
                    <Button size="xs" variant="success"
                      onClick={() => navigate(`/prescriptions/${r.id}`)}>
                      Dispense
                    </Button>
                  )}
                </div>
              ),
            },
          ]}
        />
        {data?.meta && (
          <div className="px-4">
            <Pagination
              page={data.meta.page} pages={data.meta.pages}
              total={data.meta.total} limit={data.meta.limit}
              onChange={setPage}
            />
          </div>
        )}
      </Card>
    </div>
  )
}




