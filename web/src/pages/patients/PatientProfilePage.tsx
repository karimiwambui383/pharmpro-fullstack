// ════════════════════════════════════════════════════════════
// apps/web/src/pages/patients/PatientProfilePage.tsx
// ════════════════════════════════════════════════════════════
import { useParams, useNavigate } from 'react-router-dom'
import { format }              from 'date-fns'
import {
  ArrowLeft, Phone, Shield, Droplet, AlertTriangle,
  Pill, FileText, Plus,
}                              from 'lucide-react'
import { usePatient, useAddAllergy } from '../../api/patients.api'
import { Card, CardHeader }    from '../../components/ui/Card'
import { Button }              from '../../components/ui/Button'
import { Badge }               from '../../components/ui/Badge'
import { Modal }               from '../../components/ui/Modal'
import { Input }               from '../../components/ui/Input'
import { Select }              from '../../components/ui/Select'
import { useState }            from 'react'

export default function PatientProfilePage() {
  const { id }   = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: p, isLoading } = usePatient(id!)
  const [allergyModal, setAllergyModal] = useState(false)

  if (isLoading) return <div className="shimmer h-96 rounded-xl" />
  if (!p) return <p className="text-text3">Patient not found</p>

  return (
    <div className="max-w-3xl mx-auto space-y-4 page-enter">
      <button onClick={() => navigate('/patients')}
        className="flex items-center gap-1.5 text-sm text-text3 hover:text-text2">
        <ArrowLeft size={14} /> Back to patients
      </button>

      {/* Hero */}
      <Card>
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-teal to-cyan-600
                          flex items-center justify-center text-xl font-extrabold text-white flex-shrink-0">
            {p.firstName[0]}{p.lastName[0]}
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-extrabold">{p.firstName} {p.lastName}</h2>
            <p className="text-sm text-text3">
              {p.id.slice(0,8)} · {p.dateOfBirth
                ? `${new Date().getFullYear() - new Date(p.dateOfBirth).getFullYear()} yrs`
                : 'DOB not recorded'} · {p.gender ?? '–'}
            </p>
            <div className="flex gap-1.5 mt-2 flex-wrap">
              {p.chronicConditions?.map((c: string) => <Badge key={c} variant="warning">{c}</Badge>)}
              {!p.chronicConditions?.length && <Badge variant="gray">No chronic conditions</Badge>}
            </div>
          </div>
          <Button variant="primary" onClick={() => navigate('/prescriptions/new')}>
            New Prescription
          </Button>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader title="Contact" icon={<Phone size={16}/>} />
          <p className="text-sm flex items-center gap-2 mb-1.5">
            <Phone size={13} className="text-text3" />
            {p.phone ?? <span className="text-text3 italic">no phone on file</span>}
          </p>
          <p className="text-sm flex items-center gap-2">
            <Shield size={13} className="text-text3" />
            {p.insurance ?? 'Self-pay'} {p.policyNo && `· ${p.policyNo}`}
          </p>
        </Card>
        <Card>
          <CardHeader title="Clinical" icon={<Droplet size={16}/>} />
          <p className="text-sm flex items-center gap-2 mb-1.5">
            <Droplet size={13} className="text-text3" />
            Blood group: {p.bloodGroup ?? 'Unknown'}
          </p>
          <p className="text-sm text-text2">
            Pregnancy status: {p.pregnancyStatus?.replace('_',' ') ?? 'Unknown'}
          </p>
        </Card>
      </div>

      {/* Allergies — always prominent */}
      <Card>
        <CardHeader
          title="Allergies"
          icon={<AlertTriangle size={16}/>}
          action={<Button size="xs" variant="ghost" icon={<Plus size={13}/>}
            onClick={() => setAllergyModal(true)}>Add</Button>}
        />
        {p.allergies?.length ? (
          <div className="space-y-2">
            {p.allergies.map((a: any) => (
              <div key={a.id} className="flex items-center justify-between p-2.5
                                         bg-red-lt rounded-lg border border-red/20">
                <div>
                  <p className="text-sm font-bold text-red">{a.allergen}</p>
                  {a.reaction && <p className="text-xs text-red/80">{a.reaction}</p>}
                </div>
                <Badge variant="danger">{a.severity}</Badge>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-text3">No known allergies recorded</p>
        )}
      </Card>

      {/* Recent prescriptions */}
      <Card>
        <CardHeader title="Prescription history" icon={<Pill size={16}/>} />
        {p.prescriptions?.length ? (
          <div className="space-y-2">
            {p.prescriptions.map((rx: any) => (
              <button
                key={rx.id} onClick={() => navigate(`/prescriptions/${rx.id}`)}
                className="w-full flex items-center justify-between p-2.5 rounded-lg
                           border border-border hover:bg-surface text-left transition-all"
              >
                <div>
                  <p className="text-sm font-bold text-blue">#{rx.rxNumber}</p>
                  <p className="text-xs text-text3">
                    {rx.items?.map((i: any) => i.drug.genericName).join(', ')}
                  </p>
                </div>
                <Badge variant={rx.status === 'DISPENSED' ? 'success' : 'info'}>
                  {rx.status.replace('_',' ')}
                </Badge>
              </button>
            ))}
          </div>
        ) : <p className="text-sm text-text3">No prescriptions yet</p>}
      </Card>

      {/* Clinical notes */}
      {p.clinicalNotes?.length > 0 && (
        <Card>
          <CardHeader title="Clinical notes" icon={<FileText size={16}/>} />
          <div className="space-y-2">
            {p.clinicalNotes.map((n: any) => (
              <div key={n.id} className="p-2.5 bg-surface rounded-lg">
                <p className="text-sm">{n.content}</p>
                <p className="text-xs text-text3 mt-1">
                  {n.createdBy.firstName} {n.createdBy.lastName} ·
                  {' '}{format(new Date(n.createdAt), 'd MMM yyyy')}
                </p>
              </div>
            ))}
          </div>
        </Card>
      )}

      <AddAllergyModal
        open={allergyModal} onClose={() => setAllergyModal(false)} patientId={p.id}
      />
    </div>
  )
}

function AddAllergyModal({ open, onClose, patientId }: { open: boolean; onClose: () => void; patientId: string }) {
  const addAllergy = useAddAllergy(patientId)
  const [allergen, setAllergen]   = useState('')
  const [type, setType]           = useState('DRUG')
  const [severity, setSeverity]   = useState('MODERATE')
  const [reaction, setReaction]   = useState('')

  async function handleSubmit() {
    if (!allergen.trim()) return alert('Allergen name required')
    await addAllergy.mutateAsync({ allergen, allergenType: type, severity, reaction })
    onClose()
    setAllergen(''); setReaction('')
  }

  return (
    <Modal
      open={open} onClose={onClose} title="Record allergy" icon={<AlertTriangle size={16}/>} size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="danger" loading={addAllergy.isPending} onClick={handleSubmit}>
            Record Allergy
          </Button>
        </>
      }
    >
      <Input label="Allergen *" value={allergen} onChange={e => setAllergen(e.target.value)}
        placeholder="e.g. Penicillin" className="mb-3" />
      <div className="grid grid-cols-2 gap-3 mb-3">
        <Select label="Type" value={type} onChange={e => setType(e.target.value)}
          options={[
            {value:'DRUG',label:'Drug'},{value:'FOOD',label:'Food'},
            {value:'ENVIRONMENTAL',label:'Environmental'},{value:'OTHER',label:'Other'},
          ]} />
        <Select label="Severity" value={severity} onChange={e => setSeverity(e.target.value)}
          options={[
            {value:'MILD',label:'Mild'},{value:'MODERATE',label:'Moderate'},
            {value:'SEVERE',label:'Severe'},{value:'LIFE_THREATENING',label:'Life-threatening'},
          ]} />
      </div>
      <Input label="Known reaction" value={reaction} onChange={e => setReaction(e.target.value)}
        placeholder="e.g. Anaphylaxis, rash" />
    </Modal>
  )
}