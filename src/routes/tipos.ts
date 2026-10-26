import { Router } from 'express';
import * as tiposController from '../controllers/tiposController';
import { requiereAdmin } from '../middleware/auth';

// Rutas PRIVADAS: los tipos los arma el dueño en la app (Más → Tipos) para usarlos en sus productos
const router = Router();
router.use(requiereAdmin);

router.get('/', tiposController.listar);
router.post('/', tiposController.crear);
router.put('/:id', tiposController.renombrar);
router.delete('/:id', tiposController.borrar);

export default router;
