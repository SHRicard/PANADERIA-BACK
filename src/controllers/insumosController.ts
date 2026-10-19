import { Request, Response } from 'express';
import { isValidObjectId } from 'mongoose';
import {
  LARGO_NOMBRE_INSUMO,
  MAX_CANTIDAD_INSUMO,
  NOMBRE_INSUMO_INVALIDO,
  UNIDADES_INSUMO,
  UnidadInsumo,
} from '../models/Insumo';
import * as insumosService from '../services/insumosService';
import { esFechaValida, hoyEnArgentina } from '../utils/fecha';

const esUnidad = (valor: unknown): valor is UnidadInsumo =>
  typeof valor === 'string' && (UNIDADES_INSUMO as readonly string[]).includes(valor);

// Devuelve los datos listos para el servicio, o el mensaje de error. Valida igual que el esquema (o más estricto):
// la actualización es un pipeline y no pasa por los validadores de Mongoose.
// Al crear, nombre, precio, cantidad y unidad son obligatorios y la fecha, si no viene, es hoy. Al actualizar, solo lo
// que vino
function leerDatos(body: unknown, parcial: boolean): Partial<insumosService.DatosInsumo> | string {
  const campos = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const datos: Partial<insumosService.DatosInsumo> = {};

  if (!parcial || campos.nombre !== undefined) {
    if (typeof campos.nombre !== 'string' || !campos.nombre.trim()) return 'Falta el nombre';
    // Los espacios de más no cuentan: "HARINA  20 KG" es "HARINA 20 KG"
    const nombre = campos.nombre.trim().replace(/\s+/g, ' ');
    if (nombre.length < LARGO_NOMBRE_INSUMO.min || nombre.length > LARGO_NOMBRE_INSUMO.max) return NOMBRE_INSUMO_INVALIDO;
    datos.nombre = nombre;
  }

  if (!parcial || campos.precio !== undefined) {
    if (campos.precio === undefined || campos.precio === null) return 'Falta el precio';
    const { precio } = campos;
    if (typeof precio !== 'number' || !Number.isFinite(precio) || precio <= 0) {
      return 'El precio tiene que ser un número mayor que 0';
    }
    datos.precio = Math.round(precio * 100) / 100;
  }

  // Cantidad y unidad van juntas: "25" sin decir si son kilos o litros no sirve para comparar precios
  if (!parcial || campos.cantidad !== undefined || campos.unidad !== undefined) {
    const { cantidad, unidad } = campos;
    if (cantidad === undefined || cantidad === null) return 'Falta la cantidad';
    if (typeof cantidad !== 'number' || !Number.isFinite(cantidad) || cantidad <= 0 || cantidad > MAX_CANTIDAD_INSUMO) {
      return `La cantidad tiene que ser un número mayor que 0 y hasta ${MAX_CANTIDAD_INSUMO}`;
    }
    if (unidad === undefined || unidad === null) return 'Falta la unidad';
    if (!esUnidad(unidad)) return `La unidad tiene que ser ${UNIDADES_INSUMO.slice(0, -1).join(', ')} o ${UNIDADES_INSUMO.at(-1)}`;
    datos.cantidad = Math.round(cantidad * 1000) / 1000;
    datos.unidad = unidad;
  }

  if (campos.fecha !== undefined) {
    if (typeof campos.fecha !== 'string' || !esFechaValida(campos.fecha)) return 'La fecha tiene que ser AAAA-MM-DD';
    // Con AAAA-MM-DD, comparar el texto es comparar las fechas
    if (campos.fecha > hoyEnArgentina()) return 'La fecha de la compra no puede ser posterior a hoy';
    datos.fecha = campos.fecha;
  } else if (!parcial) {
    datos.fecha = hoyEnArgentina();
  }

  if (parcial && Object.keys(datos).length === 0) return 'No hay ningún cambio para guardar';
  return datos;
}

// GET /api/insumos  (sin el historial, por nombre)
export async function listar(_req: Request, res: Response) {
  res.json(await insumosService.listar());
}

// GET /api/insumos/:id  (con el historial)
export async function detalle(req: Request<{ id: string }>, res: Response) {
  if (!isValidObjectId(req.params.id)) return res.status(404).json({ error: 'No encontrado' });
  res.json(await insumosService.obtener(req.params.id));
}

// POST /api/insumos  { nombre, precio, cantidad, unidad, fecha? }
export async function crear(req: Request, res: Response) {
  const datos = leerDatos(req.body, false);
  if (typeof datos === 'string') return res.status(400).json({ error: datos });
  res.status(201).json(await insumosService.crear(datos as insumosService.DatosInsumo));
}

// PUT /api/insumos/:id  { nombre?, precio?, fecha?, cantidad? + unidad? }  Una compra nueva o una corrección: queda en el historial
export async function actualizar(req: Request<{ id: string }>, res: Response) {
  if (!isValidObjectId(req.params.id)) return res.status(404).json({ error: 'No encontrado' });
  const datos = leerDatos(req.body, true);
  if (typeof datos === 'string') return res.status(400).json({ error: datos });
  res.json(await insumosService.actualizar(req.params.id, datos));
}
