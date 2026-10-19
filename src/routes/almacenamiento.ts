import { Router } from 'express';
import * as almacenamientoController from '../controllers/almacenamientoController';
import { requiereAdmin } from '../middleware/auth';

// Ruta PRIVADA: el uso de la cuenta de Cloudinary solo lo ve el dueño (en la app, Más → Almacenamiento)
const router = Router();
router.use(requiereAdmin);

router.get('/', almacenamientoController.obtener);
router.get('/archivos', almacenamientoController.listarArchivos);

export default router;
