import { Types } from 'mongoose';
import { Producto } from '../models/Producto';

export interface ItemCotizado {
  producto: Types.ObjectId;
  nombre: string;
  precio: number;
  categoria: string;
  cantidad: number;
  /** La url guardada de la primera foto, si tiene */
  foto?: string;
}

// Nombre, precio y total salen de la base, nunca de lo que manda el cliente. La usan el carrito (para mostrarlo)
// y el pedido (para guardarlo): así el total que ve el cliente en el carrito es el mismo que después tiene el pedido.
// incluirPausados es solo para el pedido manual del dueño: puede anotar un producto pausado (el pan dulce que le
// encargan en octubre). El cliente nunca: un pausado no se puede pedir desde la web
export async function cotizar(cantidades: Map<string, number>, { incluirPausados = false } = {}) {
  const ids = [...cantidades.keys()];
  const filtro = incluirPausados ? { _id: { $in: ids } } : { _id: { $in: ids }, disponible: true };
  const productos = await Producto.find(filtro).select({
    nombre: 1,
    precio: 1,
    categoria: 1,
    imagenes: { $slice: 1 },
  });
  const porId = new Map(productos.map((producto) => [producto.id as string, producto]));

  const items: ItemCotizado[] = [];
  for (const [id, cantidad] of cantidades) {
    const producto = porId.get(id);
    if (producto) {
      const { nombre, precio, categoria } = producto;
      items.push({ producto: producto._id, nombre, precio, categoria, cantidad, foto: producto.imagenes[0]?.url });
    }
  }

  return {
    items,
    // Pausados (salvo incluirPausados), eliminados o que nunca existieron
    noDisponibles: ids.filter((id) => !porId.has(id)),
    total: Math.round(items.reduce((suma, item) => suma + item.precio * item.cantidad, 0) * 100) / 100,
  };
}
