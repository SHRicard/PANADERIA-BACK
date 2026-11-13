import { Router } from 'express';
import * as agendaController from '../controllers/agendaController';
import { requiereAdmin } from '../middleware/auth';

// Ruta PRIVADA: la agenda del dueño. Lo que ve el cliente (los días que puede elegir) sale de POST /api/carrito
const router = Router();
router.use(requiereAdmin);

router.get('/', agendaController.delMes);
router.get('/:fecha/productos', agendaController.productosDelDia);
router.put('/:fecha/productos/:productoId', agendaController.anotarHechos);
router.put('/:fecha/cierre', agendaController.marcarLlena);
router.delete('/:fecha/cierre', agendaController.quitarLlena);
router.put('/:fecha/quiere-hacer', agendaController.elegirQuiereHacer);
router.delete('/:fecha/quiere-hacer', agendaController.quitarQuiereHacer);

export default router;
