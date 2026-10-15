import { Router } from 'express';
import * as catalogoController from '../controllers/catalogoController';

// Rutas PÚBLICAS: es lo que ve el cliente en el link que manda el jefe por WhatsApp
const router = Router();

router.get('/', catalogoController.listar);
router.get('/categorias', catalogoController.categorias); // antes de /:id, si no la toma como un id
router.get('/:id', catalogoController.detalle);

export default router;
