import express, { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import * as carritoController from '../controllers/carritoController';

// Ruta PÚBLICA: la web cotiza el carrito del cliente, sin login
const router = Router();

// La web la llama cada vez que el cliente cambia el carrito: un límite generoso, pero que corte un abuso
const limitarCotizaciones = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 100,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Demasiadas consultas del carrito. Probá de nuevo en unos minutos.' },
});

// Parser propio con límite chico. Funciona porque index.ts monta este router antes del express.json() global
router.post('/', limitarCotizaciones, express.json({ limit: '10kb' }), carritoController.cotizar);

export default router;
