import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import * as authController from '../controllers/authController';

// Todas PÚBLICAS: login y recuperación de contraseña
const router = Router();

const limitarRecuperar = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Pediste demasiados códigos. Probá de nuevo en un rato.' },
});

const limitarRestablecer = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Probá de nuevo en un rato.' },
});

router.post('/login', authController.login);
router.post('/recuperar', limitarRecuperar, authController.recuperar);
router.post('/restablecer', limitarRestablecer, authController.restablecer);

export default router;
