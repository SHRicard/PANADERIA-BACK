import { Request, Response } from 'express';
import * as resumenService from '../services/resumenService';

// GET /api/resumen  Lo de hoy para el inicio de la app: los pedidos nuevos, lo vendido y los que siguen abiertos
export async function hoy(_req: Request, res: Response) {
  res.json(await resumenService.deHoy());
}
