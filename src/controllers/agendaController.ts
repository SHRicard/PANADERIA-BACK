import { Request, Response } from 'express';
import { isValidObjectId } from 'mongoose';
import { MAX_PRODUCTOS_POR_DIA } from '../models/Ajustes';
import { MAX_HECHOS } from '../models/DiaAgenda';
import * as agendaService from '../services/agendaService';
import { esFechaValida, hoyEnArgentina } from '../utils/fecha';

const FORMATO_MES = /^\d{4}-(0[1-9]|1[0-2])$/;

// GET /api/agenda?mes=2026-11  Cada día del mes con sus pedidos, sus productos, qué tan lleno está, si está cerrado
// y cuánto le falta preparar (`faltan`).
// Sin mes (o con ?mes= vacío), el de hoy
export async function delMes(req: Request, res: Response) {
  const mes = req.query.mes === '' ? undefined : req.query.mes;
  if (mes !== undefined && (typeof mes !== 'string' || !FORMATO_MES.test(mes))) {
    return res.status(400).json({ error: 'mes tiene que ser AAAA-MM' });
  }
  res.json(await agendaService.delMes(mes ?? hoyEnArgentina().slice(0, 7)));
}

// PUT y DELETE /api/agenda/:fecha/cierre  El botón «Agenda llena»: la web deja de ofrecer ese día (DELETE lo vuelve a
// abrir). Responde el día como en la lista del mes
function marcar(llena: boolean) {
  return async (req: Request<{ fecha: string }>, res: Response) => {
    if (!esFechaValida(req.params.fecha)) return res.status(400).json({ error: 'La fecha tiene que ser un día AAAA-MM-DD' });
    res.json(await agendaService.marcarLlena(req.params.fecha, llena));
  };
}

// PUT /api/agenda/:fecha/quiere-hacer  { quiereHacer: 3 }  Cuántos productos quiere hacer el dueño ese día, si es menos
// que los de siempre: lo que no quiere hacer se cuenta como ocupado. DELETE vuelve a los de siempre. Responde el día
export async function elegirQuiereHacer(req: Request<{ fecha: string }>, res: Response) {
  if (!esFechaValida(req.params.fecha)) return res.status(400).json({ error: 'La fecha tiene que ser un día AAAA-MM-DD' });
  const body: unknown = req.body;
  const quiereHacer = typeof body === 'object' && body !== null && 'quiereHacer' in body ? body.quiereHacer : undefined;
  if (typeof quiereHacer !== 'number' || !Number.isInteger(quiereHacer) || quiereHacer < 1 || quiereHacer > MAX_PRODUCTOS_POR_DIA) {
    return res.status(400).json({ error: `quiereHacer tiene que ser un número entero de 1 a ${MAX_PRODUCTOS_POR_DIA}` });
  }
  res.json(await agendaService.elegirQuiereHacer(req.params.fecha, quiereHacer));
}

export async function quitarQuiereHacer(req: Request<{ fecha: string }>, res: Response) {
  if (!esFechaValida(req.params.fecha)) return res.status(400).json({ error: 'La fecha tiene que ser un día AAAA-MM-DD' });
  res.json(await agendaService.elegirQuiereHacer(req.params.fecha, null));
}

// GET /api/agenda/:fecha/productos  Lo que hay que preparar ese día: los productos de sus pedidos que falta entregar,
// sumados (no de quién son), con cuántos ya hizo el dueño.
// { fecha, pedidos, total, hechos, productos: [{ productoId, nombre, cantidad, sinSena, hechos, faltan, listo }] }
export async function productosDelDia(req: Request<{ fecha: string }>, res: Response) {
  if (!esFechaValida(req.params.fecha)) return res.status(400).json({ error: 'La fecha tiene que ser un día AAAA-MM-DD' });
  res.json(await agendaService.productosDelDia(req.params.fecha));
}

// PUT /api/agenda/:fecha/productos/:productoId  { hechos: 5 }  Cuántos ya hizo de ese producto ese día (el número que
// queda, no lo que suma; 0 lo borra). Responde la hoja entera, como el GET
export async function anotarHechos(req: Request<{ fecha: string; productoId: string }>, res: Response) {
  if (!esFechaValida(req.params.fecha)) return res.status(400).json({ error: 'La fecha tiene que ser un día AAAA-MM-DD' });
  if (!isValidObjectId(req.params.productoId)) return res.status(404).json({ error: 'No encontrado' });
  const body: unknown = req.body;
  const hechos = typeof body === 'object' && body !== null && 'hechos' in body ? body.hechos : undefined;
  if (typeof hechos !== 'number' || !Number.isInteger(hechos) || hechos < 0 || hechos > MAX_HECHOS) {
    // TEMPORAL: para ver qué manda la app (este cuerpo es solo { hechos }, sin datos de clientes)
    console.warn('[debug hechos]', req.headers['content-type'], typeof body, JSON.stringify(body));
    return res.status(400).json({ error: `hechos tiene que ser un número entero de 0 a ${MAX_HECHOS}` });
  }
  res.json(await agendaService.anotarHechos(req.params.fecha, req.params.productoId, hechos));
}

export const marcarLlena = marcar(true);
export const quitarLlena = marcar(false);
