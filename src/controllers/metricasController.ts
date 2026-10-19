import { Request, Response } from 'express';
import * as metricasService from '../services/metricasService';
import { AGRUPACIONES, ORDENES_VENTAS, RangoDias } from '../services/metricasService';
import { esFechaValida } from '../utils/fecha';
import { leerPaginado } from '../utils/paginado';

// Lee un parámetro de una lista: undefined si no vino (o vino vacío), null si no es de la lista
function deLaLista<T extends string>(valor: unknown, lista: readonly T[]): T | undefined | null {
  if (valor === undefined || valor === '') return undefined;
  return typeof valor === 'string' && (lista as readonly string[]).includes(valor) ? (valor as T) : null;
}

// ?desde=AAAA-MM-DD&hasta=AAAA-MM-DD, días de Argentina y los dos opcionales. Devuelve el mensaje si está mal
function leerRango(query: Request['query']): RangoDias | string {
  const rango: RangoDias = {};
  for (const campo of ['desde', 'hasta'] as const) {
    const valor = query[campo];
    if (valor === undefined || valor === '') continue;
    if (typeof valor !== 'string' || !esFechaValida(valor)) return `${campo} tiene que ser una fecha AAAA-MM-DD`;
    rango[campo] = valor;
  }
  if (rango.desde && rango.hasta && rango.desde > rango.hasta) return 'desde no puede ser posterior a hasta';
  return rango;
}

const ORDEN_INVALIDO = `orden tiene que ser ${ORDENES_VENTAS.join(' o ')}`;
const AGRUPAR_INVALIDO = `agrupar tiene que ser ${AGRUPACIONES.slice(0, -1).join(', ')} o ${AGRUPACIONES.at(-1)}`;

// GET /api/metricas/productos?desde=&hasta=&orden=unidades|importe&pagina=1&limite=20  Los más vendidos
export async function productos(req: Request, res: Response) {
  const rango = leerRango(req.query);
  if (typeof rango === 'string') return res.status(400).json({ error: rango });
  const orden = deLaLista(req.query.orden, ORDENES_VENTAS);
  if (orden === null) return res.status(400).json({ error: ORDEN_INVALIDO });

  res.json(await metricasService.productosMasVendidos(rango, orden ?? 'unidades', leerPaginado(req.query)));
}

// GET /api/metricas/gustos?desde=&hasta=&orden=unidades|importe  Lo vendido de cada gusto
export async function gustos(req: Request, res: Response) {
  const rango = leerRango(req.query);
  if (typeof rango === 'string') return res.status(400).json({ error: rango });
  const orden = deLaLista(req.query.orden, ORDENES_VENTAS);
  if (orden === null) return res.status(400).json({ error: ORDEN_INVALIDO });

  res.json(await metricasService.gustosMasVendidos(rango, orden ?? 'unidades'));
}

// GET /api/metricas/pedidos?desde=&hasta=  Por estado, por origen, cancelaciones, ticket promedio y días de la semana
export async function pedidos(req: Request, res: Response) {
  const rango = leerRango(req.query);
  if (typeof rango === 'string') return res.status(400).json({ error: rango });

  res.json(await metricasService.resumenPedidos(rango));
}

// GET /api/metricas/clientes?desde=&hasta=  Los nuevos y los que vuelven
export async function clientes(req: Request, res: Response) {
  const rango = leerRango(req.query);
  if (typeof rango === 'string') return res.status(400).json({ error: rango });

  res.json(await metricasService.clientes(rango));
}

// GET /api/metricas/insumos?desde=&hasta=  En qué se gastó más y cuánto aumentó cada uno
export async function insumos(req: Request, res: Response) {
  const rango = leerRango(req.query);
  if (typeof rango === 'string') return res.status(400).json({ error: rango });

  res.json(await metricasService.insumos(rango));
}

// GET /api/metricas/balance?desde=&hasta=&agrupar=dia|semana|mes  Lo que entra, lo que sale y la ganancia
export async function balance(req: Request, res: Response) {
  const rango = leerRango(req.query);
  if (typeof rango === 'string') return res.status(400).json({ error: rango });
  const agrupar = deLaLista(req.query.agrupar, AGRUPACIONES);
  if (agrupar === null) return res.status(400).json({ error: AGRUPAR_INVALIDO });

  res.json(await metricasService.balance(rango, agrupar ?? 'mes'));
}
