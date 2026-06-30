// ════════════════════════════════════════════════════════════
// apps/web/src/pages/prescriptions/PrescriptionDetail.tsx
//
// This is where the real dispense action happens — the most
// safety-critical screen in the app.
//
// Production notes:
// - Re-fetches prescription on mount (no stale safety data)
// - Inventory picker per item shows only batches with stock > 0,
//   sorted by soonest expiry first (FEFO — first-expiry-first-out)
// - Dispense button disabled until every required override is
//   acknowledged AND every item has a selected batch
// - Optimistic UI is intentionally avoided here — dispensing
//   must wait for server confirmation before showing success
// ════════════════════════════════════════════════════════════
import { useState, useMemo }   from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { format }              from 'date-fns'
import {
  ArrowLeft, User, Pill, FileText, Check,
  AlertTriangle, Clock, ShieldAlert,
}                              from 'lucide-react'
import {
  usePrescription, useDispensePrescription, useVerifyPrescription,
  useCancelPrescription,
}                              from '../../api/prescriptions.api'
import { useInventory }        from '../../api/inventory.api'
import { Card, CardHeader }    from '../../components/ui/Card'
import { Button }              from '../../components/ui/Button'
import { Badge }               from '../../components/ui/Badge'
import { Modal }               from '../../components/ui/Modal'
import { SafetyWarningPanel }  from '../../components/ui/SafetyWarningPanel'

const STATUS_BADGE: Record<string, any> = {
  PENDING_VERIFICATION:'gray', VERIFIED:'info', PROCESSING:'warning',
  READY:'success', DISPENSED:'purple', CANCELLED:'danger', ON_HOLD:'warning',
}

export default function PrescriptionDetail() {
  const { id }   = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: rx, isLoading } = usePrescription(id!)

  const verify   = useVerifyPrescription()
  const cancel   = useCancelPrescription()
  const dispense = useDispensePrescription()

  const [dispenseModalOpen, setDispenseModalOpen] = useState(false)
  // Map of prescriptionItemId -> selected inventoryId
  const [selectedBatches, setSelectedBatches] = useState<Record<string, string>>({})
  const [overrides, setOverrides]             = useState<Record<string, string>>({})

  // Fetch inventory for each drug in the prescription (only when modal opens)
  const drugIds = rx?.items?.map((i: any) => i.drugId) ?? []
  const { data: invData } = useInventory({
    limit: 200, // safety cap — branch inventory is bounded
  })

  const batchesByDrug = useMemo(() => {
    const map: Record<string, any[]> = {}
    for (const inv of invData?.data ?? []) {
      if (!drugIds.includes(inv.drugId) || inv.quantityOnHand <= 0) continue
      if (!map[inv.drugId]) map[inv.drugId] = []
      map[inv.drugId].push(inv)
    }
    // FEFO — sort each drug's batches by soonest expiry
    for (const drugId in map) {
      map[drugId].sort((a, b) =>
        new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime(),
      )
    }
    return map
  }, [invData, drugIds])

  if (isLoading) return <div className="shimmer h-96 rounded-xl" />
  if (!rx) return <p className="text-text3">Prescription not found</p>

  const warnings        = rx.interactionWarnings ?? []
  const requiredOverrides = warnings.filter((w: any) => w.requiresOverride)
  const allOverridden    = requiredOverrides.every((w: any) => overrides[w.type])
  const allBatchesPicked = rx.items.every((i: any) =>
    i.dispensedQty >= i.quantity || selectedBatches[i.id],
  )

  async function handleDispense() {
    const itemsToDispense = rx.items
      .filter((i: any) => i.dispensedQty < i.quantity && selectedBatches[i.id])
      .map((i: any) => ({
        prescriptionItemId: i.id,
        inventoryId:        selectedBatches[i.id],
        quantityDispensed:  i.quantity - i.dispensedQty,
      }))

    if (itemsToDispense.length === 0) return

    await dispense.mutateAsync({
      id: rx.id,
      data: {
        items: itemsToDispense,
        overriddenWarnings: Object.entries(overrides).map(([type, reason]) => ({ type, reason })),
      },
    })
    setDispenseModalOpen(false)
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4 page-enter">
      <button
        onClick={() => navigate('/prescriptions')}
        className="flex items-center gap-1.5 text-sm text-text3 hover:text-text2"
      >
        <ArrowLeft size={14} /> Back to prescriptions
      </button>

      {/* Header card */}
      <Card>
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-lg font-extrabold text-text">#{rx.rxNumber}</h2>
              <Badge variant={STATUS_BADGE[rx.status]}>{rx.status.replace('_',' ')}</Badge>
              {rx.priority !== 'NORMAL' && (
                <Badge variant="danger">{rx.priority}</Badge>
              )}
            </div>
            <p className="text-sm text-text2 mt-1">
              {rx.patient.firstName} {rx.patient.lastName} ·
              {' '}{rx.patient.phone ?? 'no phone on file'}
            </p>
            <p className="text-xs text-text3 mt-0.5">
              Created {format(new Date(rx.createdAt), 'd MMM yyyy, HH:mm')} by prescriber {rx.doctorName}
            </p>
          </div>
          <div className="flex gap-2">
            {rx.status === 'PENDING_VERIFICATION' && (
              <Button variant="primary" loading={verify.isPending}
                onClick={() => verify.mutate(rx.id)}>
                Verify
              </Button>
            )}
            {['VERIFIED','PROCESSING'].includes(rx.status) && (
              <Button variant="success" icon={<Check size={15}/>}
                onClick={() => setDispenseModalOpen(true)}>
                Dispense
              </Button>
            )}
            {!['DISPENSED','CANCELLED'].includes(rx.status) && (
              <Button variant="danger"
                onClick={() => {
                  const reason = window.prompt('Cancellation reason:')
                  if (reason) cancel.mutate({ id: rx.id, reason })
                }}>
                Cancel
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* Patient allergies — always visible, never buried */}
      {rx.patient.allergies?.length > 0 && (
        <div className="bg-red-lt border border-red/30 rounded-xl p-4">
          <div className="flex items-center gap-2 text-red font-bold text-sm mb-2">
            <ShieldAlert size={16} /> Documented allergies
          </div>
          <div className="flex flex-wrap gap-2">
            {rx.patient.allergies.map((a: any) => (
              <Badge key={a.id} variant="danger">
                {a.allergen} ({a.severity})
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Diagnosis + notes */}
      {(rx.diagnosis || rx.notes) && (
        <Card>
          <CardHeader title="Clinical notes" icon={<FileText size={16}/>} />
          {rx.diagnosis && <p className="text-sm mb-2"><strong>Diagnosis:</strong> {rx.diagnosis}</p>}
          {rx.notes && <p className="text-sm text-text2">{rx.notes}</p>}
        </Card>
      )}

      {/* Drug items */}
      <Card>
        <CardHeader title="Medications" icon={<Pill size={16}/>} />
        <div className="space-y-2.5">
          {rx.items.map((item: any) => {
            const fullyDispensed = item.dispensedQty >= item.quantity
            return (
              <div key={item.id} className={`p-3 rounded-lg border ${
                fullyDispensed ? 'border-green/30 bg-green-lt' : 'border-border bg-surface'
              }`}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-bold">{item.drug.genericName} — {item.dose}</p>
                    <p className="text-xs text-text3 mt-0.5">
                      {item.route} · {item.frequency} · {item.duration} {item.durationUnit?.toLowerCase()}
                      {item.specialInstructions && ` · ${item.specialInstructions}`}
                    </p>
                  </div>
                  <Badge variant={fullyDispensed ? 'success' : 'gray'}>
                    {item.dispensedQty}/{item.quantity} dispensed
                  </Badge>
                </div>
              </div>
            )
          })}
        </div>
      </Card>

      {/* Refills */}
      {rx.refillsAllowed > 0 && (
        <Card>
          <CardHeader title="Refills" icon={<Clock size={16}/>} />
          <p className="text-sm">
            {rx.refillsUsed} of {rx.refillsAllowed} refills used
          </p>
          {rx.refills?.map((r: any) => (
            <p key={r.id} className="text-xs text-text3 mt-1">
              Refill #{r.refillNumber} — {format(new Date(r.dispensedAt), 'd MMM yyyy')}
            </p>
          ))}
        </Card>
      )}

      {/* ══ DISPENSE MODAL ══ */}
      <Modal
        open={dispenseModalOpen}
        onClose={() => setDispenseModalOpen(false)}
        title="Dispense prescription"
        icon={<Pill size={16}/>}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDispenseModalOpen(false)}>Cancel</Button>
            <Button
              variant="success" icon={<Check size={15}/>}
              loading={dispense.isPending}
              disabled={!allOverridden || !allBatchesPicked}
              onClick={handleDispense}
            >
              Confirm & Dispense
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {/* Safety warnings shown again at dispense time */}
          {warnings.length > 0 && (
            <SafetyWarningPanel
              warnings={warnings}
              overrides={overrides}
              onOverride={(type, reason) => setOverrides(prev => ({ ...prev, [type]: reason }))}
            />
          )}

          {/* Batch selection per drug — FEFO order */}
          <div>
            <p className="text-xs font-bold text-text3 uppercase tracking-wider mb-2">
              Select batch for each item
            </p>
            <div className="space-y-3">
              {rx.items
                .filter((i: any) => i.dispensedQty < i.quantity)
                .map((item: any) => {
                  const batches = batchesByDrug[item.drugId] ?? []
                  return (
                    <div key={item.id} className="border border-border rounded-lg p-3">
                      <p className="text-sm font-bold mb-2">
                        {item.drug.genericName} — need {item.quantity - item.dispensedQty} units
                      </p>
                      {batches.length === 0 ? (
                        <p className="text-xs text-red font-bold">
                          ⚠ No stock available for this drug
                        </p>
                      ) : (
                        <div className="space-y-1.5">
                          {batches.map(b => (
                            <label
                              key={b.id}
                              className={`flex items-center justify-between p-2 rounded-lg border
                                         cursor-pointer transition-all text-sm
                                ${selectedBatches[item.id] === b.id
                                  ? 'border-blue bg-blue-lt'
                                  : 'border-border hover:bg-surface'}`}
                            >
                              <div className="flex items-center gap-2">
                                <input
                                  type="radio"
                                  checked={selectedBatches[item.id] === b.id}
                                  onChange={() => setSelectedBatches(prev => ({ ...prev, [item.id]: b.id }))}
                                />
                                <span>Batch {b.batchNo}</span>
                                <span className="text-text3 text-xs">
                                  exp. {format(new Date(b.expiryDate), 'MMM yyyy')}
                                </span>
                              </div>
                              <span className="text-text3 text-xs">{b.quantityOnHand} avail.</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
            </div>
          </div>
        </div>
      </Modal>
    </div>
  )
}