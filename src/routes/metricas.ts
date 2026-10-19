import { Router } from 'express';
import * as metricasController from '../controllers/metricasController';
import { requiereAdmin } from '../middleware/auth';

// Ruta PRIVADA: las ventas, los gastos y los clientes del negocio solo los ve el dueño
const router = Router();
router.use(requiereAdmin);

router.get('/productos', metricasController.productos);
router.get('/gustos', metricasController.gustos);
router.get('/pedidos', metricasController.pedidos);
router.get('/clientes', metricasController.clientes);
router.get('/insumos', metricasController.insumos);
router.get('/balance', metricasController.balance);

export default router;
