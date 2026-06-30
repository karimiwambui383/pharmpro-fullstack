// ════════════════════════════════════════════════════════════
// apps/web/src/store/cart.store.ts
// POS cart — Zustand with discount + patient + payment method
// ════════════════════════════════════════════════════════════
import { create }      from 'zustand'

export interface CartItem {
  drugId:      string
  inventoryId: string
  name:        string
  batchNo:     string
  unitPrice:   number
  quantity:    number
  maxQty:      number
  subtotal:    number
}

interface CartState {
  items:          CartItem[]
  patientId:      string | null
  patientName:    string | null
  discountPct:    number
  paymentMethod:  string
  prescriptionId: string | null
  addItem:        (item: Omit<CartItem, 'subtotal'>) => void
  removeItem:     (inventoryId: string) => void
  updateQty:      (inventoryId: string, qty: number) => void
  setPatient:     (id: string, name: string) => void
  clearPatient:   () => void
  setDiscount:    (pct: number) => void
  setPayment:     (method: string) => void
  setPrescription:(id: string | null) => void
  clear:          () => void
  totals:         () => { subtotal: number; discount: number; vat: number; total: number }
}

export const useCartStore = create<CartState>((set, get) => ({
  items:          [],
  patientId:      null,
  patientName:    null,
  discountPct:    0,
  paymentMethod:  'CASH',
  prescriptionId: null,

  addItem: (item) => set(s => {
    const existing = s.items.find(i => i.inventoryId === item.inventoryId)
    if (existing) {
      if (existing.quantity >= item.maxQty) return s
      return {
        items: s.items.map(i =>
          i.inventoryId === item.inventoryId
            ? { ...i, quantity: i.quantity + 1, subtotal: (i.quantity + 1) * i.unitPrice }
            : i,
        ),
      }
    }
    return {
      items: [...s.items, { ...item, quantity: 1, subtotal: item.unitPrice }],
    }
  }),

  removeItem: (inventoryId) => set(s => ({
    items: s.items.filter(i => i.inventoryId !== inventoryId),
  })),

  updateQty: (inventoryId, qty) => set(s => ({
    items: s.items.map(i =>
      i.inventoryId === inventoryId
        ? { ...i, quantity: qty, subtotal: qty * i.unitPrice }
        : i,
    ).filter(i => i.quantity > 0),
  })),

  setPatient:     (id, name) => set({ patientId: id, patientName: name }),
  clearPatient:   ()         => set({ patientId: null, patientName: null }),
  setDiscount:    (pct)      => set({ discountPct: pct }),
  setPayment:     (method)   => set({ paymentMethod: method }),
  setPrescription:(id)       => set({ prescriptionId: id }),

  clear: () => set({
    items:[], patientId:null, patientName:null,
    discountPct:0, paymentMethod:'CASH', prescriptionId:null,
  }),

  totals: () => {
    const { items, discountPct } = get()
    const subtotal  = items.reduce((s, i) => s + i.subtotal, 0)
    const discount  = Number((subtotal * discountPct / 100).toFixed(2))
    const net       = subtotal - discount
    const vat       = Number((net * 0.16).toFixed(2))
    const total     = Number((net + vat).toFixed(2))
    return { subtotal, discount, vat, total }
  },
}))





