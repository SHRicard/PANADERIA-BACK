import { Request, Response } from 'express';
import { HydratedDocument, isValidObjectId } from 'mongoose';
import { IProducto, LARGO_AUTOR, MAX_TEXTO_RECOMENDACION, PUNTAJE_MAXIMO } from '../models/Producto';
import * as productosService from '../services/productosService';
import { urlMiniatura } from '../utils/cloudinaryUrl';
import { leerPaginado } from '../utils/paginado';
import { leerFiltros } from './productosController';

// En la lista va solo la portada en miniatura; todas las fotos van en el detalle
function resumen(producto: HydratedDocument<IProducto>) {
  const { imagenes: _imagenes, ...datos } = producto.toJSON();
  const [portada] = producto.imagenes;
  return { ...datos, portada: portada ? urlMiniatura(portada.url) : null, cantidadImagenes: producto.imagenes.length };
}

// GET /api/catalogo?buscar=&categoria=&tipo=&pagina=1&limite=20  (solo los activos)
export async function listar(req: Request, res: Response) {
  const filtros = leerFiltros(req.query);
  if (typeof filtros === 'string') return res.status(400).json({ error: filtros });

  const pagina = await productosService.listar({ ...filtros, disponible: true }, leerPaginado(req.query));
  res.json({ ...pagina, productos: pagina.productos.map(resumen) });
}

// GET /api/catalogo/secciones?tipo=&categoria=&buscar=  (la carta: todos los activos que coinciden, sin paginar,
// agrupados por tipo; los sin tipo van al final, con "tipo": null)
export async function secciones(req: Request, res: Response) {
  const filtros = leerFiltros(req.query);
  if (typeof filtros === 'string') return res.status(400).json({ error: filtros });

  const grupos = await productosService.listarSecciones({ ...filtros, disponible: true });
  res.json({
    secciones: grupos.map(({ tipo, productos }) => ({ tipo, productos: productos.map(resumen) })),
    totalProductos: grupos.reduce((total, { productos }) => total + productos.length, 0),
  });
}

// GET /api/catalogo/filtros  (los tipos y los gustos que tienen productos activos, con cuántos tiene cada uno)
export async function opcionesDeFiltros(_req: Request, res: Response) {
  res.json(await productosService.opcionesDeFiltros());
}

// GET /api/catalogo/categorias  (las de la lista fija, en orden, con cuántos productos activos tiene cada una)
export async function categorias(_req: Request, res: Response) {
  res.json(await productosService.contarPorCategoria());
}

// GET /api/catalogo/:id  (con todas las fotos: { id, url, miniatura })
export async function detalle(req: Request<{ id: string }>, res: Response) {
  if (!isValidObjectId(req.params.id)) return res.status(404).json({ error: 'No encontrado' });

  res.json(await productosService.obtenerDisponible(req.params.id));
}

// El puntaje es obligatorio; el texto y el nombre, opcionales (vacíos no se guardan)
function leerRecomendacion(body: unknown): productosService.DatosRecomendacion | string {
  const { puntaje, texto, autor } = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;

  if (typeof puntaje !== 'number' || !Number.isInteger(puntaje) || puntaje < 1 || puntaje > PUNTAJE_MAXIMO) {
    return `El puntaje tiene que ser un número entero del 1 al ${PUNTAJE_MAXIMO}`;
  }
  const datos: productosService.DatosRecomendacion = { puntaje };

  if (texto !== undefined && texto !== null) {
    if (typeof texto !== 'string' || texto.trim().length > MAX_TEXTO_RECOMENDACION) {
      return `El texto puede tener hasta ${MAX_TEXTO_RECOMENDACION} caracteres`;
    }
    if (texto.trim()) datos.texto = texto.trim();
  }

  if (autor !== undefined && autor !== null) {
    const nombre = typeof autor === 'string' ? autor.trim().replace(/\s+/g, ' ') : undefined;
    if (nombre === undefined || (nombre && (nombre.length < LARGO_AUTOR.min || nombre.length > LARGO_AUTOR.max))) {
      return `El nombre tiene que tener entre ${LARGO_AUTOR.min} y ${LARGO_AUTOR.max} caracteres`;
    }
    if (nombre) datos.autor = nombre;
  }
  return datos;
}

// POST /api/catalogo/:id/recomendaciones  { puntaje, texto?, autor? }  (cualquiera, sin login; solo productos activos)
export async function recomendar(req: Request<{ id: string }>, res: Response) {
  if (!isValidObjectId(req.params.id)) return res.status(404).json({ error: 'No encontrado' });
  const datos = leerRecomendacion(req.body);
  if (typeof datos === 'string') return res.status(400).json({ error: datos });

  res.status(201).json(await productosService.agregarRecomendacion(req.params.id, datos));
}
