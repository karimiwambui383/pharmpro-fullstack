// ════════════════════════════════════════════════════════════
// apps/web/src/pages/prescriptions/NewPrescriptionPage.tsx
//
// Production note: drug selection triggers a real-time safety
// pre-check via /prescriptions/pre-check as soon as patient +
// at least one drug are selected, debounced 400ms to avoid
// hammering the safety engine on every keystroke.
// ════════════════════════════════════════════════════════════
import { useState, useEffect }   from 'react'
import { useNavigate }           from 'react-router-dom'
import { ArrowLeft, Plus, X, Pill, User } from 'lucide-react'
import { usePatients }           from '../../api/patients.api'
import { useDrugs }              from '../../api/drugs.api'
import { usePreCheck, useCreatePrescription } from '../../api/prescriptions.api'
import { useDebouncedValue }     from '../../hooks/useDebouncedValue'
import { Card, CardHeader }      from '../../components/ui/Card'
import { Button }                from '../../components/ui/Button'
import { Input }                 from '../../components/ui/Input'
import { Select }                from '../../components/ui/Select'
import { SearchInput }           from '../../components/ui/SearchInput'
import { SafetyWarningPanel }    from '../../components/ui/SafetyWarningPanel'

interface RxItem {
  drugId:    string
  name:      string
  dose:      string
  route:     string
  frequency: string
  duration:  number
  quantity:  number
}

export default function NewPrescriptionPage() {
  const navigate = useNavigate()

  // Patient selection
  const [patientId,   setPatientId]   = useState('')
  const [patientName, setPatientName] = useState('')
  const [patientQ,     setPatientQ]   = useState('')
  const debouncedPatientQ = useDebouncedValue(patientQ, 300)
  const { data: patientResults } = usePatients({ q: debouncedPatientQ || undefined, limit: 8 })

  // Drug search for adding items
  const [drugQ, setDrugQ] = useState('')
  const debouncedDrugQ    = useDebouncedValue(drugQ, 300)
  const { data: drugResults } = useDrugs({ q: debouncedDrugQ || undefined, limit: 8 })

  const [items, setItems] = useState<RxItem[]>([])

  // Prescriber + admin fields
  const [doctorName,      setDoctorName]      = useState('')
  const [doctorLicenseNo, setDoctorLicenseNo] = useState('')
  const [diagnosis,       setDiagnosis]       = useState('')
  const [priority,        setPriority]        = useState('NORMAL')
  const [insurance,       setInsurance]       = useState('Self-pay')
  const [notes,           setNotes]           = useState('')
  const [refillsAllowed,  setRefillsAllowed]  = useState(0)

  // Safety pre-check
  const preCheck       = usePreCheck()
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const drugIds         = items.map(i => i.drugId)
  const debouncedDrugIds = useDebouncedValue(JSON.stringify(drugIds), 400)

  useEffect(() => {
    if (!patientId || items.length === 0) return
    preCheck.mutate({ patientId, drugIds: JSON.parse(debouncedDrugIds) })
  }, [patientId, debouncedDrugIds])

  const createRx = useCreatePrescription()

  function addDrug(drug: any) {
    if (items.some(i => i.drugId === drug.id)) return
    setItems(prev => [...prev, {
      drugId: drug.id, name: drug.genericName,
      dose: '', route: 'ORAL', frequency: '', duration: 7, quantity: 1,
    }])
    setDrugQ('')
  }

  function updateItem(idx: number, patch: Partial<RxItem>) {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, ...patch } : it))
  }

  function removeItem(idx: number) {
    setItems(prev => prev.filter((_, i) => i !== idx))
  }

  async function handleSubmit() {
    if (!patientId)      { return alert('Select a patient') }
    if (!doctorName)     { return alert('Doctor name required') }
    if (items.length===0){ return alert('Add at least one drug') }
    if (items.some(i => !i.dose || !i.frequency || !i.quantity)) {
      return alert('All drugs need dose, frequency, and quantity')
    }

    const warnings = preCheck.data?.warnings ?? []
    const required = warnings.filter((w: any) => w.requiresOverride)
    const missing  = required.filter((w: any) => !overrides[w.type])
    if (missing.length > 0) {
      return alert(`${missing.length} safety warning(s) require acknowledgment before submitting`)
    }

    const result = await createRx.mutateAsync({
      patientId, doctorName, doctorLicenseNo, diagnosis,
      priority, insurance, refillsAllowed, notes,
      items: items.map(i => ({
        drugId: i.drugId, dose: i.dose, route: i.route,
        frequency: i.frequency, duration: i.duration,
        durationUnit: 'DAYS', quantity: i.quantity,
      })),
    })

    navigate(`/prescriptions/${result.prescription.id}`)
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4 page-enter">
      <button
        onClick={() => navigate('/prescriptions')}
        className="flex items-center gap-1.5 text-sm text-text3 hover:text-text2 mb-1"
      >
        <ArrowLeft size={14} /> Back to prescriptions
      </button>

      <Card>
        <CardHeader title="Patient" icon={<User size={16}/>} />
        {!patientId ? (
          <>
            <SearchInput
              value={patientQ} onChange={e => setPatientQ(e.target.value)}
              placeholder="Search patient by name, phone, NHIF..."
              containerClass="mb-3"
            />
            <div className="space-y-1.5 max-h-48 overflow-y-auto scrollbar-thin">
              {(patientResults?.data ?? []).map((p: any) => (
                <button
                  key={p.id}
                  onClick={() => { setPatientId(p.id); setPatientName(`${p.firstName} ${p.lastName}`) }}
                  className="w-full flex items-center gap-3 p-2.5 rounded-lg border border-border
                             hover:bg-surface text-left transition-all"
                >
                  <div className="w-8 h-8 rounded-full bg-blue-lt text-blue flex items-center
                                  justify-center text-xs font-bold flex-shrink-0">
                    {p.firstName[0]}{p.lastName[0]}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-bold">{p.firstName} {p.lastName}</p>
                    <p className="text-xs text-text3">
                      {p.insurance ?? 'Self-pay'}
                      {p.allergies?.length > 0 && <span className="text-red ml-1.5">⚠ allergy on file</span>}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="flex items-center justify-between p-3 bg-blue-lt rounded-lg">
            <span className="text-sm font-bold text-blue">{patientName}</span>
            <button onClick={() => { setPatientId(''); setPatientName('') }}
              className="text-blue"><X size={16} /></button>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Prescriber & clinical details" icon={<Pill size={16}/>} />
        <div className="grid grid-cols-2 gap-3 mb-3">
          <Input label="Doctor name *" value={doctorName} onChange={e => setDoctorName(e.target.value)} />
          <Input label="License no." value={doctorLicenseNo} onChange={e => setDoctorLicenseNo(e.target.value)} />
        </div>
        <Input label="Diagnosis" value={diagnosis} onChange={e => setDiagnosis(e.target.value)}
          className="mb-3" />
        <div className="grid grid-cols-3 gap-3">
          <Select label="Priority" value={priority} onChange={e => setPriority(e.target.value)}
            options={[
              { value:'NORMAL',    label:'Normal' },
              { value:'URGENT',    label:'Urgent' },
              { value:'EMERGENCY', label:'Emergency' },
            ]} />
          <Select label="Insurance" value={insurance} onChange={e => setInsurance(e.target.value)}
            options={[
              { value:'Self-pay', label:'Self-pay' },
              { value:'NHIF',     label:'NHIF' },
              { value:'AAR',      label:'AAR' },
              { value:'UAP',      label:'UAP' },
            ]} />
          <Input type="number" label="Refills allowed" value={refillsAllowed}
            onChange={e => setRefillsAllowed(Number(e.target.value))} />
        </div>
      </Card>

      <Card>
        <CardHeader title="Drugs" icon={<Pill size={16}/>} />
        <SearchInput
          value={drugQ} onChange={e => setDrugQ(e.target.value)}
          placeholder="Search drug to add..."
          containerClass="mb-3"
        />
        {drugQ && (drugResults?.data ?? []).length > 0 && (
          <div className="space-y-1 mb-3 max-h-40 overflow-y-auto scrollbar-thin
                          border border-border rounded-lg p-1.5">
            {drugResults!.data.map((d: any) => (
              <button
                key={d.id} onClick={() => addDrug(d)}
                className="w-full flex items-center justify-between p-2 rounded-lg
                           hover:bg-surface text-left text-sm"
              >
                <span>{d.genericName} <span className="text-text3">({d.brandName})</span></span>
                <Plus size={14} className="text-blue" />
              </button>
            ))}
          </div>
        )}

        <div className="space-y-3">
          {items.map((item, idx) => (
            <div key={item.drugId} className="border border-border rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold">{item.name}</span>
                <button onClick={() => removeItem(idx)} className="text-text3 hover:text-red">
                  <X size={14} />
                </button>
              </div>
              <div className="grid grid-cols-4 gap-2">
                <Input placeholder="Dose e.g. 500mg" value={item.dose}
                  onChange={e => updateItem(idx, { dose: e.target.value })} />
                <Select value={item.route} onChange={e => updateItem(idx, { route: e.target.value })}
                  options={[
                    { value:'ORAL', label:'Oral' }, { value:'IV', label:'IV' },
                    { value:'IM', label:'IM' }, { value:'TOPICAL', label:'Topical' },
                  ]} />
                <Input placeholder="Frequency" value={item.frequency}
                  onChange={e => updateItem(idx, { frequency: e.target.value })} />
                <Input type="number" placeholder="Qty" value={item.quantity}
                  onChange={e => updateItem(idx, { quantity: Number(e.target.value) })} />
              </div>
            </div>
          ))}
          {items.length === 0 && (
            <p className="text-center text-text3 text-sm py-4">No drugs added yet</p>
          )}
        </div>
      </Card>

      {/* Safety warnings */}
      {preCheck.data?.warnings?.length > 0 && (
        <Card>
          <SafetyWarningPanel
            warnings={preCheck.data.warnings}
            overrides={overrides}
            onOverride={(type, reason) => setOverrides(prev => ({ ...prev, [type]: reason }))}
          />
        </Card>
      )}

      <div className="flex justify-end gap-3 pb-4">
        <Button variant="ghost" onClick={() => navigate('/prescriptions')}>Cancel</Button>
        <Button variant="primary" loading={createRx.isPending} onClick={handleSubmit}>
          Create Prescription
        </Button>
      </div>
    </div>
  )
}