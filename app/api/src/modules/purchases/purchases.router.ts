// ════════════════════════════════════════════════════════════
// modules/purchases/purchases.router.ts
// ════════════════════════════════════════════════════════════
import { Router }               from 'express'
import { purchasesController }  from './purchases.controller'
import { authenticate }         from '../../middleware/authenticate'
import { authorize }            from '../../middleware/authorize'

const router = Router()
router.use(authenticate)

// Suppliers
router.get ('/suppliers',       purchasesController.listSuppliers.bind(purchasesController))
router.post('/suppliers',
  authorize(['SUPER_ADMIN','STORE_MANAGER']),
  purchasesController.createSupplier.bind(purchasesController),
)
router.get ('/suppliers/:id',   purchasesController.getSupplier.bind(purchasesController))

// Purchase orders
router.get ('/stats',           purchasesController.getStats.bind(purchasesController))
router.get ('/',                purchasesController.search.bind(purchasesController))
router.post('/',
  authorize(['SUPER_ADMIN','PHARMACIST','STORE_MANAGER']),
  purchasesController.create.bind(purchasesController),
)
router.get ('/:id',             purchasesController.findById.bind(purchasesController))
router.patch('/:id/send',
  authorize(['SUPER_ADMIN','STORE_MANAGER']),
  purchasesController.send.bind(purchasesController),
)
router.post('/:id/receive',
  authorize(['SUPER_ADMIN','PHARMACIST','STORE_MANAGER','TECHNICIAN']),
  purchasesController.receiveItems.bind(purchasesController),
)
router.patch('/:id/cancel',
  authorize(['SUPER_ADMIN','STORE_MANAGER']),
  purchasesController.cancel.bind(purchasesController),
)

export default router