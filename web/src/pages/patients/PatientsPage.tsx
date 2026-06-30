// ════════════════════════════════════════════════════════════
// apps/web/src/pages/patients/PatientsPage.tsx
// ════════════════════════════════════════════════════════════
import { useState }            from 'react'
import { useNavigate }         from 'react-router-dom'
import { UserPlus, Users, AlertTriangle } from 'lucide-react'
import { format }              from 'date-fns'
import { usePatients, usePatientStats, useCreatePatient } from '../../api/patients.api'
import { useDebouncedValue }   from '../../hooks/useDebouncedValue'
import { Card }                from '../../components/ui/Card'
import { KpiCard }             from '../../components/ui/KpiCard'
import { Button }              from '../../components/ui/Button'
import { Badge }               from '../../components/ui/Badge'
import { Table }               from '../../components/ui/Table'
import { Pagination }          from '../../components/ui/Pagination'
import { SearchInput }         from '../../components/ui/SearchInput'
import { Modal }               from '../../components/ui/Modal'
import { Input }               from '../../components/ui/Input'
import { Select }              from '../../components/ui/Select'

export default function PatientsPage() {
  const navigate          = useNavigate()
  const [rawQ, setRawQ]   = useState('')
  const [page, setPage]   = useState(1)
  const [modalOpen, setModalOpen] = useState(false)
  const q = useDebouncedValue(rawQ, 300)

  const { data, isLoading } = usePatients({ q: q || undefined, page, limit: 15 })
  const { data: stats }     = usePatientStats()

  return (
    <div className="space-y-4 page-enter">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Total patients" value={stats?.total ?? 0} icon={<Users size={20}/>} color="blue" />
        <KpiCard label="Active this month" value={stats?.activeThisMonth ?? 0} icon={<Users size={20}/>} color="green" />
        <KpiCard label="Chronic medication" value={stats?.chronic ?? 0} icon={<AlertTriangle size={20}/>} color="amber" />
        <KpiCard label="Due for refill" value={stats?.refillsDue ?? 0} icon={<AlertTriangle size={20}/>} color="purple" />
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <SearchInput
          value={rawQ} onChange={e => { setRawQ(e.target.value); setPage(1) }}
          placeholder="Search by name, phone, NHIF, ID..."
          containerClass="flex-1 max-w-md"
        />
        <Button variant="primary" icon={<UserPlus size={16}/>} onClick={() => setModalOpen(true)}>
          Register Patient
        </Button>
      </div>

      <Card padding={false}>
        <Table
          loading={isLoading}
          rowKey={(r: any) => r.id}
          emptyMsg="No patients found"
          onRowClick={(r: any) => navigate(`/patients/${r.id}`)}
          data={data?.data ?? []}
          columns={[
            {
              key:'name', header:'Name',
              render: (p: any) => (
                <div>
                  <p className="font-bold">{p.firstName} {p.lastName}</p>
                  {p.nickname && <p className="text-xs text-text3">"{p.nickname}"</p>}
                </div>
              ),
            },
            {
              key:'contact', header:'Contact',
              render: (p: any) => p.phone ?? <span className="text-text3 italic">no phone</span>,
            },
            {
              key:'age', header:'Age/Sex',
              render: (p: any) => p.dateOfBirth
                ? `${new Date().getFullYear() - new Date(p.dateOfBirth).getFullYear()} / ${p.gender ?? '–'}`
                : '–',
            },
            {
              key:'conditions', header:'Conditions',
              render: (p: any) => p.chronicConditions?.length
                ? <div className="flex gap-1 flex-wrap">
                    {p.chronicConditions.slice(0,2).map((c: string) => <Badge key={c} variant="warning">{c}</Badge>)}
                  </div>
                : '–',
            },
            {
              key:'allergies', header:'Allergies',
              render: (p: any) => p.allergies?.length
                ? <Badge variant="danger">{p.allergies.length} on file</Badge>
                : '–',
            },
            { key:'insurance', header:'Insurance', render: (p:any) => p.insurance ?? 'Self-pay' },
            {
              key:'action', header:'',
              render: (p: any) => (
                <Button size="xs" variant="ghost" onClick={(e) => { e.stopPropagation(); navigate(`/patients/${p.id}`) }}>
                  View
                </Button>
              ),
            },
          ]}
        />
        {data?.meta && (
          <div className="px-4">
            <Pagination page={data.meta.page} pages={data.meta.pages}
              total={data.meta.total} limit={data.meta.limit} onChange={setPage} />
          </div>
        )}
      </Card>

      <NewPatientModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  )
}

// ── New patient modal — Africa-first: only name required ──
function NewPatientModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useCreatePatient()
  const [form, setForm] = useState({
    firstName:'', lastName:'', nickname:'', phone:'', dateOfBirth:'',
    gender:'', nationalId:'', insurance:'Self-pay', allergies:'', conditions:'',
  })

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm(prev => ({ ...prev, [k]: v }))
  }

  async function handleSubmit() {
    if (!form.firstName.trim() || !form.lastName.trim()) {
      return alert('First and last name are required')
    }
    await create.mutateAsync({
      firstName: form.firstName, lastName: form.lastName,
      nickname: form.nickname || undefined,
      phone: form.phone || undefined,
      dateOfBirth: form.dateOfBirth ? new Date(form.dateOfBirth).toISOString() : undefined,
      gender: form.gender || undefined,
      nationalId: form.nationalId || undefined,
      insurance: form.insurance,
      chronicConditions: form.conditions ? form.conditions.split(',').map(s => s.trim()) : [],
    })
    onClose()
    setForm({ firstName:'', lastName:'', nickname:'', phone:'', dateOfBirth:'',
      gender:'', nationalId:'', insurance:'Self-pay', allergies:'', conditions:'' })
  }

  return (
    <Modal
      open={open} onClose={onClose} title="Register new patient" icon={<UserPlus size={16}/>}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={create.isPending} onClick={handleSubmit}>
            Register Patient
          </Button>
        </>
      }
    >
      <p className="text-xs text-text3 mb-4 bg-blue-lt rounded-lg p-2.5">
        Only first and last name are required. Phone, ID, and insurance are optional —
        many patients walk in without these documents.
      </p>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <Input label="First name *" value={form.firstName} onChange={e => set('firstName', e.target.value)} />
        <Input label="Last name *"  value={form.lastName}  onChange={e => set('lastName', e.target.value)} />
      </div>
      <Input label="Nickname (if known by one)" value={form.nickname}
        onChange={e => set('nickname', e.target.value)} className="mb-3" />
      <div className="grid grid-cols-2 gap-3 mb-3">
        <Input label="Phone (optional)" value={form.phone} onChange={e => set('phone', e.target.value)}
          placeholder="07XX XXX XXX" />
        <Input label="Date of birth (optional)" type="date" value={form.dateOfBirth}
          onChange={e => set('dateOfBirth', e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <Select label="Gender" value={form.gender} onChange={e => set('gender', e.target.value)}
          placeholder="Not specified"
          options={[{value:'M',label:'Male'},{value:'F',label:'Female'},{value:'Other',label:'Other'}]} />
        <Input label="National ID (optional)" value={form.nationalId}
          onChange={e => set('nationalId', e.target.value)} />
      </div>
      <Select label="Insurance" value={form.insurance} onChange={e => set('insurance', e.target.value)}
        options={[
          {value:'Self-pay',label:'Self-pay'},{value:'NHIF',label:'NHIF'},
          {value:'AAR',label:'AAR'},{value:'UAP',label:'UAP'},
        ]} className="mb-3" />
      <Input label="Chronic conditions (comma separated)" value={form.conditions}
        onChange={e => set('conditions', e.target.value)} placeholder="T2DM, Hypertension" />
    </Modal>
  )
}


