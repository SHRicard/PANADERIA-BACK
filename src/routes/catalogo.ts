import express, { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import * as catalogoController from '../controllers/catalogoController';

// Rutas PÚBLICAS: es lo que ve el cliente en el link que manda el jefe por WhatsApp
const router = Router();

// La deja cualquiera, sin login: el límite frena a quien quiera llenar un producto de recomendaciones
const limitarRecomendaciones = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Dejaste demasiadas recomendaciones. Probá de nuevo en un rato.' },
});

router.get('/', catalogoController.listar);
// Antes de /:id, si no las toma como un id
router.get('/categorias', catalogoController.categorias);
router.get('/secciones', catalogoController.secciones);
router.get('/filtros', catalogoController.opcionesDeFiltros);
router.get('/:id', catalogoController.detalle);
// Parser propio con límite chico. Funciona porque index.ts monta este router antes del express.json() global
router.post(
  '/:id/recomendaciones',
  limitarRecomendaciones,
  express.json({ limit: '10kb' }),
  catalogoController.recomendar
);

export default router;
