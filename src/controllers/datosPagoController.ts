import { Request, Response } from 'express';
import {
  ALIAS_INVALIDO,
  BILLETERA_INVALIDA,
  CBU_INVALIDO,
  esCbuValido,
  FORMATO_ALIAS,
  IDatosPago,
  LARGO_BILLETERA,
  LARGO_NOMBRE_COMPLETO,
  NOMBRE_COMPLETO_INVALIDO,
} from '../models/DatosPago';
import * as datosPagoService from '../services/datosPagoService';

// Los espacios de más no cuentan: "Juan  Pérez " es "Juan Pérez"
const texto = (valor: unknown) => (typeof valor === 'string' ? valor.trim().replace(/\s+/g, ' ') : '');

const entre = (valor: string, { min, max }: { min: number; max: number }) => valor.length >= min && valor.length <= max;

// Los cuatro son obligatorios. Devuelve los datos listos para guardar, o el mensaje de error
function leerDatos(body: unknown): IDatosPago | string {
  const campos = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;

  const nombreCompleto = texto(campos.nombreCompleto);
  if (!nombreCompleto) return 'Falta el nombre completo';
  if (!entre(nombreCompleto, LARGO_NOMBRE_COMPLETO)) return NOMBRE_COMPLETO_INVALIDO;

  const alias = texto(campos.alias);
  if (!alias) return 'Falta el alias';
  if (!FORMATO_ALIAS.test(alias)) return ALIAS_INVALIDO;

  // Como lo copie el dueño, con espacios o guiones entre los números: se guardan solo los números.
  // Tiene que llegar como texto: como número se perderían los ceros del principio
  if (campos.cbu === undefined || campos.cbu === null || campos.cbu === '') return 'Falta el CBU o CVU';
  const cbu = typeof campos.cbu === 'string' ? campos.cbu.replace(/[\s-]/g, '') : '';
  if (!esCbuValido(cbu)) return CBU_INVALIDO;

  const billetera = texto(campos.billetera);
  if (!billetera) return 'Falta la billetera';
  if (!entre(billetera, LARGO_BILLETERA)) return BILLETERA_INVALIDA;

  return { nombreCompleto, alias, cbu, billetera };
}

// GET /api/datos-pago  (pública: la web se los muestra al cliente después de hacer el pedido)
export async function obtener(_req: Request, res: Response) {
  res.json(await datosPagoService.obtener());
}

// PUT /api/datos-pago  { nombreCompleto, alias, cbu, billetera }  (siempre los cuatro)
export async function guardar(req: Request, res: Response) {
  const datos = leerDatos(req.body);
  if (typeof datos === 'string') return res.status(400).json({ error: datos });

  res.json(await datosPagoService.guardar(datos));
}

// DELETE /api/datos-pago  (la web deja de mostrarlos)
export async function borrar(_req: Request, res: Response) {
  await datosPagoService.borrar();
  res.status(204).end();
}
