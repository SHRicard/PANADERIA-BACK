import { Types } from 'mongoose';
import { EstadoPedido, IPedido, Pedido } from '../models/Pedido';
import { hoyEnArgentina } from '../utils/fecha';
import * as metricasService from './metricasService';
import * as pedidosService from './pedidosService';

// Cuántos de los pedidos de hoy van en la lista: si hay más, se ven en la pestaña Pedidos
export const MAX_ULTIMOS_PEDIDOS = 10;

interface HoyAgregado {
  totales: { pedidos: number; vendido: number }[];
  ultimos: (IPedido & { _id: Types.ObjectId })[];
}

// Lo de hoy para el inicio de la app. Los pedidos de hoy son las VENTAS de hoy, con la misma cuenta que las métricas
// (hechos hoy en Argentina y no cancelados): vendido da lo mismo que los ingresos del balance de hoy. Los abiertos
// son los que siguen esperando la seña o la entrega, de cualquier día
export async function deHoy() {
  const fecha = hoyEnArgentina();
  const [[hoy], abiertos] = await Promise.all([
    Pedido.aggregate<HoyAgregado>([
      ...metricasService.ventasDelRango({ desde: fecha, hasta: fecha }),
      {
        $facet: {
          totales: [
            { $group: { _id: null, pedidos: { $sum: 1 }, vendido: { $sum: '$total' } } },
            { $set: { vendido: { $round: ['$vendido', 2] } } },
          ],
          ultimos: [{ $sort: { createdAt: -1, _id: -1 } }, { $limit: MAX_ULTIMOS_PEDIDOS }, { $unset: '_dia' }],
        },
      },
    ]),
    Pedido.aggregate<{ _id: EstadoPedido; cantidad: number }>([
      { $match: { estado: { $in: pedidosService.ABIERTOS } } },
      { $group: { _id: '$estado', cantidad: { $sum: 1 } } },
    ]),
  ]);

  const totales = hoy.totales[0] ?? { pedidos: 0, vendido: 0 };
  const contar = (estado: EstadoPedido) => abiertos.find((fila) => fila._id === estado)?.cantidad ?? 0;
  return {
    fecha,
    hoy: { pedidos: totales.pedidos, vendido: totales.vendido },
    abiertos: { pendiente: contar('pendiente'), confirmado: contar('confirmado') },
    ultimosPedidos: hoy.ultimos.map(pedidosService.completar),
  };
}
