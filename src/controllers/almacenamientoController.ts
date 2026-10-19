import { Request, Response } from 'express';
import * as almacenamientoService from '../services/almacenamientoService';
import { ORIGENES_ARCHIVO, OrigenArchivo } from '../services/almacenamientoService';
import { leerPaginado } from '../utils/paginado';

const esOrigen = (valor: unknown): valor is OrigenArchivo =>
  typeof valor === 'string' && (ORIGENES_ARCHIVO as readonly string[]).includes(valor);

// GET /api/almacenamiento  Cuánto del plan de Cloudinary está usado y qué tan cerca está del límite
export async function obtener(_req: Request, res: Response) {
  res.json(await almacenamientoService.obtener());
}

// GET /api/almacenamiento/archivos?origen=producto|promo&pagina=1&limite=20  Lo que más ocupa primero
export async function listarArchivos(req: Request, res: Response) {
  const { origen } = req.query;
  if (origen !== undefined && origen !== '' && !esOrigen(origen)) {
    return res.status(400).json({ error: `origen tiene que ser ${ORIGENES_ARCHIVO.join(' o ')}` });
  }

  res.json(await almacenamientoService.listarArchivos(esOrigen(origen) ? origen : undefined, leerPaginado(req.query)));
}
