import { Router } from 'express';
import * as recetasController from '../controllers/recetasController';
import { requiereAdmin } from '../middleware/auth';

// Rutas PRIVADAS: la receta de cada producto (con qué insumos se hace y cuánto cuesta cada unidad) solo la ve el dueño
const router = Router();
router.use(requiereAdmin);

router.get('/', recetasController.listar);
router.get('/:productoId', recetasController.detalle);
// Cuánto hace falta de cada ingrediente para hacer N unidades (solo calcula)
router.get('/:productoId/produccion', recetasController.produccion);
router.put('/:productoId', recetasController.guardar);
// El precio de venta del producto, a partir de lo que cuesta hacerlo
router.put('/:productoId/precio', recetasController.ponerPrecio);
router.delete('/:productoId', recetasController.borrar);

export default router;
