import { Router } from 'express';
import * as datosPagoController from '../controllers/datosPagoController';
import { requiereAdmin } from '../middleware/auth';

// GET PÚBLICO: la web le muestra al cliente a dónde transferir. PUT y DELETE PRIVADOS: los carga el dueño desde la app
const router = Router();

router.get('/', datosPagoController.obtener);
router.put('/', requiereAdmin, datosPagoController.guardar);
router.delete('/', requiereAdmin, datosPagoController.borrar);

export default router;
