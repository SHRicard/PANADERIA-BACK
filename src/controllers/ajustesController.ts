import { Request, Response } from 'express';
import { ESTILOS_CATALOGO, EstiloCatalogo, IAjustes, MAX_MENSAJE_CERRADO } from '../models/Ajustes';
import * as ajustesService from '../services/ajustesService';

const esEstiloCatalogo = (valor: unknown): valor is EstiloCatalogo =>
  typeof valor === 'string' && (ESTILOS_CATALOGO as readonly string[]).includes(valor);

// GET /api/ajustes  (pública: la web lee cómo mostrar el catálogo y si el negocio está cerrado)
export async function obtener(_req: Request, res: Response) {
  res.json(await ajustesService.obtener());
}

// PATCH /api/ajustes  { estiloCatalogo?, cerrado?, mensajeCerrado? }  Solo cambia lo que viene
export async function actualizar(req: Request, res: Response) {
  const body: unknown = req.body;
  const { estiloCatalogo, cerrado, mensajeCerrado } = (typeof body === 'object' && body !== null ? body : {}) as Record<
    string,
    unknown
  >;
  const cambios: Partial<IAjustes> = {};

  if (estiloCatalogo !== undefined) {
    if (!esEstiloCatalogo(estiloCatalogo)) {
      return res.status(400).json({ error: `El estilo del catálogo tiene que ser uno de: ${ESTILOS_CATALOGO.join(', ')}` });
    }
    cambios.estiloCatalogo = estiloCatalogo;
  }

  if (cerrado !== undefined) {
    if (typeof cerrado !== 'boolean') return res.status(400).json({ error: 'Cerrado tiene que ser true o false' });
    cambios.cerrado = cerrado;
  }

  if (mensajeCerrado !== undefined) {
    if (typeof mensajeCerrado !== 'string') return res.status(400).json({ error: 'El mensaje tiene que ser un texto' });
    const limpio = mensajeCerrado.trim();
    if (limpio.length > MAX_MENSAJE_CERRADO) {
      return res.status(400).json({ error: `El mensaje puede tener hasta ${MAX_MENSAJE_CERRADO} caracteres` });
    }
    cambios.mensajeCerrado = limpio;
  }

  if (Object.keys(cambios).length === 0) return res.status(400).json({ error: 'No hay ningún ajuste para cambiar' });

  res.json(await ajustesService.actualizar(cambios));
}
