import { Router } from 'express';
import * as resumenController from '../controllers/resumenController';
import { requiereAdmin } from '../middleware/auth';

// Ruta PRIVADA: los pedidos del día y lo vendido solo los ve el dueño (en la app, el inicio)
const router = Router();
router.use(requiereAdmin);

router.get('/', resumenController.hoy);

export default router;
