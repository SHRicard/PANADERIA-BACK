import { Router } from 'express';
import * as insumosController from '../controllers/insumosController';
import { requiereAdmin } from '../middleware/auth';

// Rutas PRIVADAS: los gastos en insumos solo los ve el dueño (en la app, Más → Insumos)
const router = Router();
router.use(requiereAdmin);

router.get('/', insumosController.listar);
router.get('/:id', insumosController.detalle);
router.post('/', insumosController.crear);
router.put('/:id', insumosController.actualizar);

export default router;
