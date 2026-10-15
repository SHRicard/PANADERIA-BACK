import { Router } from 'express';
import * as productosController from '../controllers/productosController';
import { requiereAdmin } from '../middleware/auth';
import { subirImagenes } from '../middleware/upload';

// Rutas PRIVADAS (solo el jefe, con token)
const router = Router();
router.use(requiereAdmin);

router.get('/', productosController.listar);
router.post('/', subirImagenes, productosController.crear);
router.put('/:id', subirImagenes, productosController.editar);
router.delete('/:id', productosController.borrar);
router.delete('/:id/imagenes/:imagenId', productosController.borrarImagen);

export default router;
