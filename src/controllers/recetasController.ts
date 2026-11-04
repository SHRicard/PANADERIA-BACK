import { Request, Response } from 'express';
import { Types, isValidObjectId } from 'mongoose';
import {
  esMultiplicadorValido,
  esRedondeoValido,
  LARGO_NOMBRE_INGREDIENTE,
  MAX_CANTIDAD_RECETA,
  MAX_INGREDIENTES_RECETA,
  MAX_RINDE,
  MAX_UNIDADES_A_HACER,
  MULTIPLICADOR_INVALIDO,
  REDONDEO_INVALIDO,
  UNIDADES_RECETA,
  UnidadReceta,
} from '../models/Receta';
import * as recetasService from '../services/recetasService';

const esUnidad = (valor: unknown): valor is UnidadReceta =>
  typeof valor === 'string' && (UNIDADES_RECETA as readonly string[]).includes(valor);

const esEnteroEntre = (valor: unknown, min: number, max: number): valor is number =>
  typeof valor === 'number' && Number.isInteger(valor) && valor >= min && valor <= max;

// Un ingrediente es un insumo ({ insumo, cantidad }: la unidad la pone el servidor según el insumo) o algo que no se
// compra, como el agua ({ nombre, unidad, cantidad }). El error dice en qué posición está, para marcarlo en la app
function leerIngrediente(valor: unknown, posicion: number): recetasService.IngredienteNuevo | string {
  const error = (mensaje: string) => `Ingrediente ${posicion}: ${mensaje}`;
  if (typeof valor !== 'object' || valor === null) return error('falta el insumo o el nombre');
  const { insumo, nombre, unidad, cantidad } = valor as Record<string, unknown>;

  if (cantidad === undefined || cantidad === null) return error('falta la cantidad');
  // Siempre enteros: nadie pesa 7,5 g ni usa medio huevo
  if (!esEnteroEntre(cantidad, 1, MAX_CANTIDAD_RECETA)) {
    return error(`la cantidad tiene que ser un número entero de 1 a ${MAX_CANTIDAD_RECETA}`);
  }

  if (insumo !== undefined && insumo !== null) {
    if (typeof insumo !== 'string' || !isValidObjectId(insumo)) return 'Uno de los insumos ya no existe: elegí otro';
    // Así el id queda escrito como lo guarda Mongo, para compararlo con los de la base
    return { insumo: String(new Types.ObjectId(insumo)), cantidad };
  }

  if (typeof nombre !== 'string' || !nombre.trim()) return error('falta el insumo o el nombre');
  // Los espacios de más no cuentan: "Agua  tibia" es "Agua tibia"
  const limpio = nombre.trim().replace(/\s+/g, ' ');
  if (limpio.length < LARGO_NOMBRE_INGREDIENTE.min || limpio.length > LARGO_NOMBRE_INGREDIENTE.max) {
    return error(`el nombre tiene que tener entre ${LARGO_NOMBRE_INGREDIENTE.min} y ${LARGO_NOMBRE_INGREDIENTE.max} caracteres`);
  }
  if (unidad === undefined || unidad === null) return error('falta la unidad');
  if (!esUnidad(unidad)) return error(`la unidad tiene que ser ${UNIDADES_RECETA.join(' o ')}`);
  return { insumo: null, nombre: limpio, unidad, cantidad };
}

// La receta lista para el servicio, o el mensaje de error. Valida igual que el esquema (o más estricto)
function leerReceta(body: unknown): recetasService.DatosReceta | string {
  const { rinde, ingredientes } = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;

  if (rinde === undefined || rinde === null) return 'Falta el rinde';
  if (!esEnteroEntre(rinde, 1, MAX_RINDE)) return `El rinde tiene que ser un número entero de 1 a ${MAX_RINDE}`;

  if (!Array.isArray(ingredientes) || ingredientes.length === 0) return 'La receta tiene que tener al menos un ingrediente';
  if (ingredientes.length > MAX_INGREDIENTES_RECETA) {
    return `La receta puede tener hasta ${MAX_INGREDIENTES_RECETA} ingredientes`;
  }

  const leidos: recetasService.IngredienteNuevo[] = [];
  for (const [indice, valor] of ingredientes.entries()) {
    const ingrediente = leerIngrediente(valor, indice + 1);
    if (typeof ingrediente === 'string') return ingrediente;
    leidos.push(ingrediente);
  }
  return { rinde, ingredientes: leidos };
}

// GET /api/recetas  (por nombre del producto, con su costo y sin los ingredientes)
export async function listar(_req: Request, res: Response) {
  res.json(await recetasService.listar());
}

// GET /api/recetas/:productoId  (404 si el producto todavía no tiene receta)
export async function detalle(req: Request<{ productoId: string }>, res: Response) {
  if (!isValidObjectId(req.params.productoId)) return res.status(404).json({ error: 'No encontrado' });
  res.json(await recetasService.obtener(req.params.productoId));
}

// GET /api/recetas/:productoId/produccion?unidades=24
// Cuánto hace falta de cada ingrediente para hacer esas unidades. Solo calcula: no guarda nada
export async function produccion(req: Request<{ productoId: string }>, res: Response) {
  if (!isValidObjectId(req.params.productoId)) return res.status(404).json({ error: 'No encontrado' });
  const { unidades } = req.query;
  if (unidades === undefined || unidades === '') return res.status(400).json({ error: 'Falta cuántas unidades vas a hacer' });
  // Solo dígitos: "2.5", "2e1", " 24" o ?unidades=1&unidades=2 no pasan
  const numero = typeof unidades === 'string' && /^\d+$/.test(unidades) ? Number(unidades) : NaN;
  if (!esEnteroEntre(numero, 1, MAX_UNIDADES_A_HACER)) {
    return res.status(400).json({ error: `Las unidades tienen que ser un número entero de 1 a ${MAX_UNIDADES_A_HACER}` });
  }

  res.json(await recetasService.paraHacer(req.params.productoId, numero));
}

// PUT /api/recetas/:productoId  { rinde, ingredientes: [{ insumo, cantidad } | { nombre, unidad, cantidad }] }
// La crea o la reemplaza entera
export async function guardar(req: Request<{ productoId: string }>, res: Response) {
  if (!isValidObjectId(req.params.productoId)) return res.status(404).json({ error: 'No encontrado' });
  const datos = leerReceta(req.body);
  if (typeof datos === 'string') return res.status(400).json({ error: datos });

  res.json(await recetasService.guardar(req.params.productoId, datos));
}

// PUT /api/recetas/:productoId/precio  { multiplicador, redondeo? }
// Le pone al producto el precio de la receta: lo que cuesta cada unidad × multiplicador, redondeado al peso o, con
// `redondeo` (10, 50, 100, 500 o 1000), al múltiplo de arriba. Sin `redondeo` (o null), al peso
export async function ponerPrecio(req: Request<{ productoId: string }>, res: Response) {
  if (!isValidObjectId(req.params.productoId)) return res.status(404).json({ error: 'No encontrado' });
  const { multiplicador, redondeo } = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>;
  if (multiplicador === undefined || multiplicador === null) return res.status(400).json({ error: 'Falta el multiplicador' });
  if (!esMultiplicadorValido(multiplicador)) return res.status(400).json({ error: MULTIPLICADOR_INVALIDO });
  const sinRedondeo = redondeo === undefined || redondeo === null;
  if (!sinRedondeo && !esRedondeoValido(redondeo)) return res.status(400).json({ error: REDONDEO_INVALIDO });

  res.json(await recetasService.ponerPrecio(req.params.productoId, multiplicador, sinRedondeo ? null : redondeo));
}

// DELETE /api/recetas/:productoId
export async function borrar(req: Request<{ productoId: string }>, res: Response) {
  if (!isValidObjectId(req.params.productoId)) return res.status(404).json({ error: 'No encontrado' });

  await recetasService.borrar(req.params.productoId);
  res.status(204).end();
}
