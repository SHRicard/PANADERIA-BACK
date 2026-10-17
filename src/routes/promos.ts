import { Router } from 'express';
import * as promosController from '../controllers/promosController';
import { requiereAdmin } from '../middleware/auth';
import { subirArchivoPromo } from '../middleware/upload';

// Rutas PRIVADAS: la biblioteca de publicaciones del dueño (fotos y videos para su estado de WhatsApp).
// requiereAdmin va antes de Multer: sin token, el archivo ni se lee
const router = Router();
router.use(requiereAdmin);

router.get('/', promosController.listar);
router.post('/', subirArchivoPromo, promosController.crear);
router.patch('/:id', promosController.editar);
router.delete('/:id', promosController.borrar);
router.post('/:id/publicaciones', promosController.registrarPublicacion);

export default router;
