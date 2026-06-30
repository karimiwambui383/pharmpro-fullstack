// ════════════════════════════════════════════════════════════
// apps/web/src/api/insurance.api.ts
// (was missing — needed by InsurancePage)
// ════════════════════════════════════════════════════════════
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api }  from '../lib/api'
import toast    from 'react-hot-toast'

const BASE = '/insurance'

export function useClaims(params?: Record<string, any>) {
  return useQuery({
    queryKey: ['insurance', params],
    queryFn:  () => api.get(BASE, { params }).then(r => r.data),
    staleTime:60_000,
  })
}

export function useInsuranceStats() {
  return useQuery({
    queryKey: ['insurance', 'stats'],
    queryFn:  () => api.get(`${BASE}/stats`).then(r => r.data.data),
    staleTime:60_000,
  })
}

export function useCreateClaim() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: any) => api.post(BASE, data).then(r => r.data.data),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['insurance'] })
      toast.success('Claim submitted')
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed'),
  })
}

export function useUpdateClaimStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ claimNo, data }: { claimNo: string; data: any }) =>
      api.patch(`${BASE}/${claimNo}/status`, data).then(r => r.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['insurance'] })
      toast.success('Claim status updated')
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed'),
  })
}

export function useResubmitClaim() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (claimNo: string) => api.post(`${BASE}/${claimNo}/resubmit`).then(r => r.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['insurance'] })
      toast.success('Claim resubmitted')
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed'),
  })
}


