// ════════════════════════════════════════════════════════════
// apps/web/src/api/prescriptions.api.ts
// ════════════════════════════════════════════════════════════
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api }   from '../lib/api'
import toast     from 'react-hot-toast'

const BASE = '/prescriptions'

export function usePrescriptions(params?: Record<string, any>) {
  return useQuery({
    queryKey: ['prescriptions', params],
    queryFn:  () => api.get(BASE, { params }).then(r => r.data),
    refetchInterval: 30_000, // auto-refresh queue every 30s
  })
}

export function usePrescription(id: string) {
  return useQuery({
    queryKey: ['prescriptions', id],
    queryFn:  () => api.get(`${BASE}/${id}`).then(r => r.data.data),
    enabled:  !!id,
  })
}

export function useQueueStats() {
  return useQuery({
    queryKey:        ['prescriptions', 'queue-stats'],
    queryFn:         () => api.get(`${BASE}/queue-stats`).then(r => r.data.data),
    refetchInterval: 15_000, // refresh every 15s
    staleTime:       10_000,
  })
}

export function usePreCheck() {
  return useMutation({
    mutationFn: (data: { patientId: string; drugIds: string[] }) =>
      api.post(`${BASE}/pre-check`, data).then(r => r.data.data),
  })
}

export function useCreatePrescription() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: any) => api.post(BASE, data).then(r => r.data.data),
    onSuccess:  (result) => {
      qc.invalidateQueries({ queryKey: ['prescriptions'] })
      const warnings = result.safetyResult?.warnings ?? []
      if (warnings.length > 0) {
        toast(`⚠ Prescription created with ${warnings.length} safety warning(s)`, {
          duration: 8000, icon: '⚠️',
        })
      } else {
        toast.success('Prescription created successfully')
      }
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed'),
  })
}

export function useVerifyPrescription() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.patch(`${BASE}/${id}/verify`).then(r => r.data.data),
    onSuccess:  (_, id) => {
      qc.invalidateQueries({ queryKey: ['prescriptions'] })
      qc.invalidateQueries({ queryKey: ['prescriptions', id] })
      toast.success('Prescription verified')
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Verification failed'),
  })
}

export function useDispensePrescription() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      api.post(`${BASE}/${id}/dispense`, data).then(r => r.data.data),
    onSuccess: (result, { id }) => {
      qc.invalidateQueries({ queryKey: ['prescriptions'] })
      qc.invalidateQueries({ queryKey: ['prescriptions', id] })
      qc.invalidateQueries({ queryKey: ['inventory'] })
      toast.success('Prescription dispensed. Receipt sent.')
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Dispense failed'),
  })
}

export function useUpdatePrescriptionStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`${BASE}/${id}/status`, { status }).then(r => r.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['prescriptions'] })
      toast.success('Status updated')
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed'),
  })
}

export function useCancelPrescription() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.patch(`${BASE}/${id}/cancel`, { reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['prescriptions'] })
      toast.success('Prescription cancelled')
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Cancel failed'),
  })
}


