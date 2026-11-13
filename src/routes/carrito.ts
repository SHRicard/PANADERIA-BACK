import express, { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import * as carritoController from '../controllers/carritoController';

// Ruta PÚBLICA: la web cotiza el carrito del cliente, sin login
const router = Router();

// La web la llama cada vez que el cliente cambia el carrito: un límite generoso, pero que corte un abuso. 300 y no 100:
// lo comparten los que salen por la misma IP (un wifi, los datos del celular) y cada ráfaga de «+» es una consulta
const limitarCotizaciones = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Demasiadas consultas del carrito. Probá de nuevo en unos minutos.' },
});

// Parser propio con límite chico. Funciona porque index.ts monta este router antes del express.json() global
router.post('/', limitarCotizaciones, express.json({ limit: '10kb' }), carritoController.cotizar);

export default router;
