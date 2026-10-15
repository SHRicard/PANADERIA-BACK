import { Request, Response } from 'express';
import { isValidObjectId } from 'mongoose';
import * as productosService from '../services/productosService';

// Los ingredientes pueden llegar como JSON ('["harina","sal"]') o separados por coma ('harina, sal')
function parsearIngredientes(valor: unknown): string[] | undefined {
  if (valor === undefined) return undefined;
  if (Array.isArray(valor)) return valor.map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof valor !== 'string') return [];
  try {
    const json: unknown = JSON.parse(valor);
    if (Array.isArray(json)) return json.map(String).map((s) => s.trim()).filter(Boolean);
  } catch {
    /* no era JSON, se trata como texto separado por comas */
  }
  return valor.split(',').map((s) => s.trim()).filter(Boolean);
}

// Con multipart todo llega como texto ("1500"); con JSON, como número
function numeroMayorQueCero(valor: unknown): number | undefined {
  const numero = typeof valor === 'number' ? valor : typeof valor === 'string' && valor.trim() ? Number(valor) : NaN;
  return Number.isFinite(numero) && numero > 0 ? numero : undefined;
}

// Devuelve los datos listos para guardar, o el mensaje de error.
// En una edición (parcial) solo se valida lo que vino; al crear, nombre y precio son obligatorios
function leerDatos(body: unknown, parcial: boolean): productosService.DatosProducto | string {
  const campos = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const datos: productosService.DatosProducto = {};

  if (!parcial || campos.nombre !== undefined) {
    const nombre = typeof campos.nombre === 'string' ? campos.nombre.trim() : '';
    if (!nombre) return 'El nombre es obligatorio';
    datos.nombre = nombre;
  }
  if (!parcial || campos.precio !== undefined) {
    const precio = numeroMayorQueCero(campos.precio);
    if (precio === undefined) return 'El precio tiene que ser un número mayor que 0';
    datos.precio = precio;
  }
  if (campos.pesoGramos !== undefined && campos.pesoGramos !== '') {
    const peso = numeroMayorQueCero(campos.pesoGramos);
    if (peso === undefined) return 'El peso tiene que ser un número mayor que 0';
    datos.pesoGramos = peso;
  }
  if (campos.descripcion !== undefined) datos.descripcion = String(campos.descripcion);
  if (campos.categoria !== undefined) datos.categoria = String(campos.categoria);
  if (campos.disponible !== undefined) datos.disponible = campos.disponible === true || campos.disponible === 'true';
  const ingredientes = parsearIngredientes(campos.ingredientes);
  if (ingredientes !== undefined) datos.ingredientes = ingredientes;

  return datos;
}

function buffersDe(archivos: Request['files']): Buffer[] {
  return Array.isArray(archivos) ? archivos.map((archivo) => archivo.buffer) : [];
}

// GET /api/productos  (todos, incluso no disponibles)
export async function listar(_req: Request, res: Response) {
  res.json(await productosService.listar());
}

// POST /api/productos  (multipart/form-data; fotos opcionales en el campo "imagenes", la primera es la portada)
export async function crear(req: Request, res: Response) {
  const datos = leerDatos(req.body, false);
  if (typeof datos === 'string') return res.status(400).json({ error: datos });

  res.status(201).json(await productosService.crear(datos, buffersDe(req.files)));
}

// PUT /api/productos/:id  (JSON o multipart/form-data; las fotos nuevas se suman a las que ya tiene)
export async function editar(req: Request<{ id: string }>, res: Response) {
  if (!isValidObjectId(req.params.id)) return res.status(404).json({ error: 'No encontrado' });
  const datos = leerDatos(req.body, true);
  if (typeof datos === 'string') return res.status(400).json({ error: datos });

  res.json(await productosService.editar(req.params.id, datos, buffersDe(req.files)));
}

// DELETE /api/productos/:id  (también borra sus fotos de Cloudinary)
export async function borrar(req: Request<{ id: string }>, res: Response) {
  if (!isValidObjectId(req.params.id)) return res.status(404).json({ error: 'No encontrado' });

  await productosService.borrar(req.params.id);
  res.status(204).end();
}

// DELETE /api/productos/:id/imagenes/:imagenId  (borra una sola foto)
export async function borrarImagen(req: Request<{ id: string; imagenId: string }>, res: Response) {
  const { id, imagenId } = req.params;
  if (!isValidObjectId(id) || !isValidObjectId(imagenId)) return res.status(404).json({ error: 'No encontrado' });

  await productosService.borrarImagen(id, imagenId);
  res.status(204).end();
}
