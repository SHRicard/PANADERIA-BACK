import { Request, Response } from 'express';
import { isValidObjectId } from 'mongoose';
import { LARGO_NOMBRE_TIPO, NOMBRE_TIPO_INVALIDO } from '../models/Tipo';
import * as tiposService from '../services/tiposService';

// El nombre listo para guardar, o el mensaje de error. Los espacios de más no cuentan: "Tortas  heladas" es "Tortas heladas"
function leerNombre(body: unknown): { nombre: string } | string {
  const { nombre } = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  if (typeof nombre !== 'string' || !nombre.trim()) return 'Falta el nombre';
  const limpio = nombre.trim().replace(/\s+/g, ' ');
  if (limpio.length < LARGO_NOMBRE_TIPO.min || limpio.length > LARGO_NOMBRE_TIPO.max) return NOMBRE_TIPO_INVALIDO;
  return { nombre: limpio };
}

// GET /api/tipos  (por nombre, cada uno con cantidadProductos)
export async function listar(_req: Request, res: Response) {
  res.json(await tiposService.listar());
}

// POST /api/tipos  { nombre }
export async function crear(req: Request, res: Response) {
  const datos = leerNombre(req.body);
  if (typeof datos === 'string') return res.status(400).json({ error: datos });

  res.status(201).json(await tiposService.crear(datos.nombre));
}

// PUT /api/tipos/:id  { nombre }
export async function renombrar(req: Request<{ id: string }>, res: Response) {
  if (!isValidObjectId(req.params.id)) return res.status(404).json({ error: 'No encontrado' });
  const datos = leerNombre(req.body);
  if (typeof datos === 'string') return res.status(400).json({ error: datos });

  res.json(await tiposService.renombrar(req.params.id, datos.nombre));
}

// DELETE /api/tipos/:id  (los productos que lo usaban quedan sin tipo)
export async function borrar(req: Request<{ id: string }>, res: Response) {
  if (!isValidObjectId(req.params.id)) return res.status(404).json({ error: 'No encontrado' });

  await tiposService.borrar(req.params.id);
  res.status(204).end();
}
