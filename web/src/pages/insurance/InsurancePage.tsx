// ════════════════════════════════════════════════════════════
// apps/web/src/pages/insurance/InsurancePage.tsx
// ════════════════════════════════════════════════════════════
import { useState }            from 'react'
import { Plus, Shield, CheckCircle, Clock, XCircle } from 'lucide-react'
import {
  useClaims, useInsuranceStats, useCreateClaim, useResubmitClaim,
}                              from '../../api/insurance.api'
import { usePatients }         from '../../api/patients.api'
import { Card }                from '../../components/ui/Card'
import { KpiCard }             from '../../components/ui/KpiCard'
import { Button }              from '../../components/ui/Button'
import { Badge }               from '../../components/ui/Badge'
import { Table }               from '../../components/ui/Table'
import { Modal }               from '../../components/ui/Modal'
import { Input }               from '../../components/ui/Input'
import { Select }              from '../../components/ui/Select'

const STATUS_BADGE: Record<string, any> = {
  PENDING:'warning', APPROVED:'success', REJECTED:'danger',
  RESUBMITTED:'info', PAID:'success',
}

export default function InsurancePage() {
  const [modalOpen, setModalOpen] = useState(false)
  const { data, isLoading } = useClaims({ limit: 30 })
  const { data: stats }     = useInsuranceStats()
  const resubmit             = useResubmitClaim()

  return (
    <div className="space-y-4 page-enter">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Claims this month" value={stats?.total ?? 0} icon={<Shield size={20}/>} color="blue" />
        <KpiCard label="Approved" value={(stats?.byStatus ?? []).find((s:any)=>s.status==='APPROVED')?.count ?? 0}
          icon={<CheckCircle size={20}/>} color="green" />
        <KpiCard label="Pending" value={(stats?.byStatus ?? []).find((s:any)=>s.status==='PENDING')?.count ?? 0}
          icon={<Clock size={20}/>} color="amber" />
        <KpiCard label="Rejected" value={(stats?.byStatus ?? []).find((s:any)=>s.status==='REJECTED')?.count ?? 0}
          icon={<XCircle size={20}/>} color="red" />
      </div>

      <div className="flex justify-between items-center">
        <p className="text-sm text-text3">
          Outstanding: <span className="font-bold text-amber">KES {(stats?.outstanding ?? 0).toLocaleString('en-KE')}</span>
        </p>
        <Button variant="primary" icon={<Plus size={16}/>} onClick={() => setModalOpen(true)}>
          New Claim
        </Button>
      </div>

      <Card padding={false}>
        <Table
          loading={isLoading}
          rowKey={(r: any) => r.claim_no}
          emptyMsg="No claims found"
          data={data?.data ?? []}
          columns={[
            { key:'claim_no', header:'Claim ID', render:(c:any)=><span className="font-bold text-blue">{c.claim_no}</span> },
            { key:'patient_name', header:'Patient' },
            { key:'insurer', header:'Insurer', render:(c:any)=><Badge variant="info">{c.insurer}</Badge> },
            { key:'drug_dispensed', header:'Drug' },
            { key:'claim_value', header:'Value', render:(c:any)=>`KES ${Number(c.claim_value).toLocaleString('en-KE')}` },
            { key:'status', header:'Status', render:(c:any)=><Badge variant={STATUS_BADGE[c.status]}>{c.status}</Badge> },
            { key:'action', header:'', render:(c:any)=>
                c.status === 'REJECTED' ? (
                  <Button size="xs" variant="primary" loading={resubmit.isPending}
                    onClick={() => resubmit.mutate(c.claim_no)}>
                    Resubmit
                  </Button>
                ) : null,
            },
          ]}
        />
      </Card>

      <NewClaimModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  )
}

function NewClaimModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useCreateClaim()
  const { data: patients } = usePatients({ limit: 50 })
  const [form, setForm] = useState({
    patientId:'', prescriptionId:'', insurer:'NHIF',
    drugDispensed:'', claimValue:'', policyNo:'',
  })

  function set<K extends keyof typeof form>(k: K, v: string) { setForm(p => ({ ...p, [k]: v })) }

  async function handleSubmit() {
    if (!form.patientId || !form.prescriptionId || !form.drugDispensed || !form.claimValue) {
      return alert('Fill in all required fields')
    }
    await create.mutateAsync({
      patientId: form.patientId, prescriptionId: form.prescriptionId,
      insurer: form.insurer, drugDispensed: form.drugDispensed,
      claimValue: Number(form.claimValue), policyNo: form.policyNo || undefined,
    })
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="New insurance claim" icon={<Shield size={16}/>}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={create.isPending} onClick={handleSubmit}>Submit Claim</Button>
      </>}>
      <Select label="Patient *" value={form.patientId} onChange={e => set('patientId', e.target.value)}
        placeholder="Select patient"
        options={(patients?.data ?? []).map((p:any) => ({ value: p.id, label: `${p.firstName} ${p.lastName}` }))}
        className="mb-3" />
      <Input label="Prescription ID *" value={form.prescriptionId} onChange={e => set('prescriptionId', e.target.value)}
        placeholder="Rx UUID" className="mb-3" />
      <div className="grid grid-cols-2 gap-3 mb-3">
        <Select label="Insurer *" value={form.insurer} onChange={e => set('insurer', e.target.value)}
          options={[
            {value:'NHIF',label:'NHIF'},{value:'AAR',label:'AAR'},
            {value:'UAP',label:'UAP'},{value:'JUBILEE',label:'Jubilee'},
          ]} />
        <Input label="Claim value (KES) *" type="number" value={form.claimValue} onChange={e => set('claimValue', e.target.value)} />
      </div>
      <Input label="Drug dispensed *" value={form.drugDispensed} onChange={e => set('drugDispensed', e.target.value)} className="mb-3" />
      <Input label="Policy number" value={form.policyNo} onChange={e => set('policyNo', e.target.value)} />
    </Modal>
  )
}