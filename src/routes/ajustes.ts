import { Router } from 'express';
import * as ajustesController from '../controllers/ajustesController';
import { requiereAdmin } from '../middleware/auth';

// GET PÚBLICO: la web lee cómo mostrar el catálogo. PATCH PRIVADO: lo cambia el dueño desde la app
const router = Router();

router.get('/', ajustesController.obtener);
router.patch('/', requiereAdmin, ajustesController.actualizar);

export default router;
