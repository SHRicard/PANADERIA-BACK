import { Request, Response } from 'express';
import { isValidObjectId } from 'mongoose';
import { buscarCategoria, CATEGORIA_INVALIDA } from '../models/Producto';
import * as productosService from '../services/productosService';
import { leerPaginado } from '../utils/paginado';

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

// Un opcional se borra mandándolo vacío: null (JSON) o "" (multipart, donde todo es texto)
const estaVacio = (valor: unknown) => valor === null || (typeof valor === 'string' && valor.trim() === '');

// Devuelve los datos listos para guardar, o el mensaje de error.
// En una edición (parcial) solo se valida lo que vino; al crear, nombre, precio y categoría son obligatorios.
// Un opcional vacío queda en undefined: al crear no se guarda, y al editar se borra del producto
function leerDatos(body: unknown, parcial: boolean): productosService.DatosProducto | string {
  const campos = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const datos: productosService.DatosProducto = {};

  if (!parcial || campos.nombre !== undefined) {
    // Los espacios de más no cuentan: "TARTA  DE FRUTILLA" es "TARTA DE FRUTILLA"
    const nombre = typeof campos.nombre === 'string' ? campos.nombre.trim().replace(/\s+/g, ' ') : '';
    if (!nombre) return 'El nombre es obligatorio';
    datos.nombre = nombre;
  }
  if (!parcial || campos.precio !== undefined) {
    const precio = numeroMayorQueCero(campos.precio);
    if (precio === undefined) return 'El precio tiene que ser un número mayor que 0';
    datos.precio = precio;
  }
  if (!parcial || campos.categoria !== undefined) {
    const categoria = buscarCategoria(campos.categoria);
    if (!categoria) {
      return campos.categoria === undefined || estaVacio(campos.categoria) ? 'La categoría es obligatoria' : CATEGORIA_INVALIDA;
    }
    datos.categoria = categoria;
  }
  if (campos.pesoGramos !== undefined) {
    const peso = numeroMayorQueCero(campos.pesoGramos);
    if (peso === undefined && !estaVacio(campos.pesoGramos)) return 'El peso tiene que ser un número mayor que 0';
    datos.pesoGramos = peso;
  }
  if (campos.descripcion !== undefined) {
    datos.descripcion = estaVacio(campos.descripcion) ? undefined : String(campos.descripcion);
  }
  if (campos.disponible !== undefined) datos.disponible = campos.disponible === true || campos.disponible === 'true';
  const ingredientes = parsearIngredientes(campos.ingredientes);
  if (ingredientes !== undefined) datos.ingredientes = ingredientes;

  return datos;
}

function buffersDe(archivos: Request['files']): Buffer[] {
  return Array.isArray(archivos) ? archivos.map((archivo) => archivo.buffer) : [];
}

// ?buscar= (una parte del nombre) y ?categoria= : los usan la lista del dueño y el catálogo público
export function leerFiltros(query: Request['query']): productosService.FiltrosProductos | string {
  const filtros: productosService.FiltrosProductos = {};
  if (typeof query.buscar === 'string' && query.buscar.trim()) filtros.buscar = query.buscar.trim().slice(0, 50);
  if (query.categoria !== undefined && query.categoria !== '') {
    const categoria = buscarCategoria(query.categoria);
    if (!categoria) return CATEGORIA_INVALIDA;
    filtros.categoria = categoria;
  }
  return filtros;
}

// GET /api/productos?buscar=&categoria=&estado=activo|pausado&pagina=1&limite=20  (incluye los pausados)
export async function listar(req: Request, res: Response) {
  const filtros = leerFiltros(req.query);
  if (typeof filtros === 'string') return res.status(400).json({ error: filtros });

  const { estado } = req.query;
  if (estado !== undefined && estado !== '') {
    if (estado !== 'activo' && estado !== 'pausado') {
      return res.status(400).json({ error: 'estado tiene que ser activo o pausado' });
    }
    filtros.disponible = estado === 'activo';
  }

  res.json(await productosService.listar(filtros, leerPaginado(req.query)));
}

// GET /api/productos/:id  (el producto completo, aunque esté pausado)
export async function detalle(req: Request<{ id: string }>, res: Response) {
  if (!isValidObjectId(req.params.id)) return res.status(404).json({ error: 'No encontrado' });

  res.json(await productosService.obtener(req.params.id));
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

// POST /api/productos/:id/imagenes  (multipart/form-data, UNA foto en el campo "imagen")
// Para que el front suba en segundo plano: de a una por pedido, con hasta 2 pedidos a la vez
export async function agregarImagen(req: Request<{ id: string }>, res: Response) {
  if (!isValidObjectId(req.params.id)) return res.status(404).json({ error: 'No encontrado' });
  if (!req.file) return res.status(400).json({ error: 'Falta la foto (campo "imagen")' });

  res.status(201).json(await productosService.agregarImagen(req.params.id, req.file.buffer));
}

// PUT /api/productos/:id/portada  { imagenId }  (pasa esa foto al primer lugar)
export async function cambiarPortada(req: Request<{ id: string }>, res: Response) {
  const imagenId: unknown = req.body?.imagenId;
  if (typeof imagenId !== 'string') return res.status(400).json({ error: 'Falta la foto que va de portada (imagenId)' });
  if (!isValidObjectId(req.params.id) || !isValidObjectId(imagenId)) return res.status(404).json({ error: 'No encontrado' });

  res.json(await productosService.hacerPortada(req.params.id, imagenId));
}

// DELETE /api/productos/:id/imagenes/:imagenId  (borra una sola foto)
export async function borrarImagen(req: Request<{ id: string; imagenId: string }>, res: Response) {
  const { id, imagenId } = req.params;
  if (!isValidObjectId(id) || !isValidObjectId(imagenId)) return res.status(404).json({ error: 'No encontrado' });

  await productosService.borrarImagen(id, imagenId);
  res.status(204).end();
}
