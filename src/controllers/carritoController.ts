import { Request, Response } from 'express';
import { Types, isValidObjectId } from 'mongoose';
import * as carritoService from '../services/carritoService';
import { urlMiniatura } from '../utils/cloudinaryUrl';

const MAX_ITEMS = 30;
const MAX_CANTIDAD = 50;

const redondear = (monto: number) => Math.round(monto * 100) / 100;

// Valida los ítems que manda el cliente ([{ productoId, cantidad }]) y junta los repetidos sumando las cantidades.
// Devuelve la cantidad por id de producto, o el mensaje de error. Las mismas reglas para el carrito y el pedido
export function leerItems(
  valor: unknown,
  { minimo, fueraDeRango }: { minimo: number; fueraDeRango: string }
): Map<string, number> | string {
  if (!Array.isArray(valor) || valor.length < minimo || valor.length > MAX_ITEMS) return fueraDeRango;

  const cantidades = new Map<string, number>();
  for (const item of valor as unknown[]) {
    const { productoId, cantidad } = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>;
    if (typeof productoId !== 'string' || !isValidObjectId(productoId)) return 'Hay un producto con un id inválido';
    if (typeof cantidad !== 'number' || !Number.isInteger(cantidad) || cantidad < 1 || cantidad > MAX_CANTIDAD) {
      return `La cantidad de cada producto tiene que ser un entero entre 1 y ${MAX_CANTIDAD}`;
    }
    const id = new Types.ObjectId(productoId).toString();
    cantidades.set(id, (cantidades.get(id) ?? 0) + cantidad);
  }
  if ([...cantidades.values()].some((cantidad) => cantidad > MAX_CANTIDAD)) {
    return `No se pueden pedir más de ${MAX_CANTIDAD} unidades de un mismo producto`;
  }
  return cantidades;
}

// POST /api/carrito  { items: [{ productoId, cantidad }] }
// Cotiza el carrito con los precios de hoy y no guarda nada: el carrito vive en el navegador del cliente.
// Un producto pausado o eliminado no es un error: vuelve en noDisponibles para que la web lo saque
export async function cotizar(req: Request, res: Response) {
  const body: unknown = req.body;
  const cantidades = leerItems(typeof body === 'object' && body !== null && 'items' in body ? body.items : undefined, {
    minimo: 0,
    fueraDeRango: `El carrito tiene que ser una lista de hasta ${MAX_ITEMS} productos (items)`,
  });
  if (typeof cantidades === 'string') return res.status(400).json({ error: cantidades });

  const { items, noDisponibles, total } = await carritoService.cotizar(cantidades);
  res.json({
    items: items.map(({ producto, nombre, precio, cantidad, foto }) => ({
      productoId: String(producto),
      nombre,
      precio,
      cantidad,
      subtotal: redondear(precio * cantidad),
      portada: foto ? urlMiniatura(foto) : null,
    })),
    noDisponibles,
    cantidadTotal: items.reduce((suma, item) => suma + item.cantidad, 0),
    total,
  });
}
