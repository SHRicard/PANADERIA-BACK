import { Request, Response } from 'express';
import {
  ESTILOS_CATALOGO,
  EstiloCatalogo,
  IAjustes,
  MAX_MENSAJE_CERRADO,
  MAX_PRODUCTOS_POR_DIA,
  PRODUCTOS_POR_DIA_INVALIDO,
  TEMAS,
  Tema,
} from '../models/Ajustes';
import * as ajustesService from '../services/ajustesService';

const esEstiloCatalogo = (valor: unknown): valor is EstiloCatalogo =>
  typeof valor === 'string' && (ESTILOS_CATALOGO as readonly string[]).includes(valor);

const esTema = (valor: unknown): valor is Tema => typeof valor === 'string' && (TEMAS as readonly string[]).includes(valor);

const esProductosPorDia = (valor: unknown): valor is number | null =>
  valor === null ||
  (typeof valor === 'number' && Number.isInteger(valor) && valor >= 1 && valor <= MAX_PRODUCTOS_POR_DIA);

// GET /api/ajustes  (pública: la web lee cómo mostrar el catálogo y si el negocio está cerrado)
export async function obtener(_req: Request, res: Response) {
  res.json(await ajustesService.obtener());
}

// PATCH /api/ajustes  { estiloCatalogo?, cerrado?, mensajeCerrado?, productosPorDia?, tema? }  Solo cambia lo que viene
export async function actualizar(req: Request, res: Response) {
  const body: unknown = req.body;
  const { estiloCatalogo, cerrado, mensajeCerrado, productosPorDia, tema } = (typeof body === 'object' && body !== null ? body : {}) as Record<
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

  // null lo saca: la agenda vuelve a mostrarse sin colores
  if (productosPorDia !== undefined) {
    if (!esProductosPorDia(productosPorDia)) return res.status(400).json({ error: PRODUCTOS_POR_DIA_INVALIDO });
    cambios.productosPorDia = productosPorDia;
  }

  // El tema de la app del dueño: la web se pinta igual
  if (tema !== undefined) {
    if (!esTema(tema)) return res.status(400).json({ error: `El tema tiene que ser uno de: ${TEMAS.join(', ')}` });
    cambios.tema = tema;
  }

  if (Object.keys(cambios).length === 0) return res.status(400).json({ error: 'No hay ningún ajuste para cambiar' });

  res.json(await ajustesService.actualizar(cambios));
}
