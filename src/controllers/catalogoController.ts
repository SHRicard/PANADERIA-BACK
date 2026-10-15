import { Request, Response } from 'express';
import { HydratedDocument, isValidObjectId } from 'mongoose';
import { IProducto } from '../models/Producto';
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

// GET /api/catalogo?buscar=&categoria=&pagina=1&limite=20  (solo los activos)
export async function listar(req: Request, res: Response) {
  const filtros = leerFiltros(req.query);
  if (typeof filtros === 'string') return res.status(400).json({ error: filtros });

  const pagina = await productosService.listar({ ...filtros, disponible: true }, leerPaginado(req.query));
  res.json({ ...pagina, productos: pagina.productos.map(resumen) });
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
