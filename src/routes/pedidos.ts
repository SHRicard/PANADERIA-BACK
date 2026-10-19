import express, { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import * as pedidosController from '../controllers/pedidosController';
import { requiereAdmin } from '../middleware/auth';

// POST / es PÚBLICA (la web, sin login). Las demás son PRIVADAS: requiereAdmin ruta por ruta
const router = Router();

// Parser propio con límite chico. Funciona porque index.ts monta este router antes del express.json() global
const leerJson = express.json({ limit: '10kb' });

const limitarPedidos = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Hiciste demasiados pedidos. Probá de nuevo en un rato.' },
});

router.post('/', limitarPedidos, leerJson, pedidosController.crear);
// El pedido que carga el dueño a mano: privado y sin el límite por IP del público
router.post('/manuales', requiereAdmin, leerJson, pedidosController.crearManual);

router.get('/', requiereAdmin, pedidosController.listar);
router.get('/:id', requiereAdmin, pedidosController.detalle);

// Cada paso del pedido: PUT lo registra y DELETE lo deshace (por si el dueño tocó por error)
router.put('/:id/sena', requiereAdmin, leerJson, pedidosController.registrarSena);
router.delete('/:id/sena', requiereAdmin, pedidosController.quitarSena);
router.put('/:id/entrega', requiereAdmin, pedidosController.registrarEntrega);
router.delete('/:id/entrega', requiereAdmin, pedidosController.quitarEntrega);
router.put('/:id/cancelacion', requiereAdmin, pedidosController.cancelar);
router.delete('/:id/cancelacion', requiereAdmin, pedidosController.quitarCancelacion);

export default router;
