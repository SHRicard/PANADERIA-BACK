import { NextFunction, Request, Response } from 'express';
import { verificarToken } from '../services/authService';

export function requiereAdmin(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  try {
    verificarToken(header.slice(7));
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido o vencido' });
  }
}
