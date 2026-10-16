import { Request, Response } from 'express';
import { ESTILOS_CATALOGO, EstiloCatalogo, IAjustes } from '../models/Ajustes';
import * as ajustesService from '../services/ajustesService';

const esEstiloCatalogo = (valor: unknown): valor is EstiloCatalogo =>
  typeof valor === 'string' && (ESTILOS_CATALOGO as readonly string[]).includes(valor);

// GET /api/ajustes  (pública: la web lee cómo mostrar el catálogo)
export async function obtener(_req: Request, res: Response) {
  res.json(await ajustesService.obtener());
}

// PATCH /api/ajustes  { estiloCatalogo }  Solo cambia lo que viene
export async function actualizar(req: Request, res: Response) {
  const body: unknown = req.body;
  const { estiloCatalogo } = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const cambios: Partial<IAjustes> = {};

  if (estiloCatalogo !== undefined) {
    if (!esEstiloCatalogo(estiloCatalogo)) {
      return res.status(400).json({ error: `El estilo del catálogo tiene que ser uno de: ${ESTILOS_CATALOGO.join(', ')}` });
    }
    cambios.estiloCatalogo = estiloCatalogo;
  }
  if (Object.keys(cambios).length === 0) return res.status(400).json({ error: 'No hay ningún ajuste para cambiar' });

  res.json(await ajustesService.actualizar(cambios));
}
