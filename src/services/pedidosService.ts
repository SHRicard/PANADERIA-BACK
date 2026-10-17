import { PipelineStage, Types } from 'mongoose';
import { Cliente, ICliente } from '../models/Cliente';
import { EstadoPedido, IItemPedido, IPedido, Pedido } from '../models/Pedido';
import { ErrorHttp } from '../utils/errores';
import { Paginado } from '../utils/paginado';
import * as carritoService from './carritoService';

export interface DatosPedido {
  nombre: string;
  /** Ya normalizado con normalizarTelefono */
  telefono: string;
  /** Cantidad por id de producto (leerItems) */
  cantidades: Map<string, number>;
  nota?: string;
}

const NO_ENCONTRADO = 'No encontrado';

// Seña, entrega y cancelación solo mientras el pedido sigue abierto
const ABIERTOS: EstadoPedido[] = ['pendiente', 'confirmado'];

// Al deshacer una entrega o una cancelación, vuelve a como estaba: confirmado si tiene seña, si no pendiente
const VOLVER_A_ABIERTO: PipelineStage.Set = {
  $set: { estado: { $cond: [{ $gt: ['$sena.monto', 0] }, 'confirmado', 'pendiente'] } },
};

const redondear = (monto: number) => Math.round(monto * 100) / 100;

// Lo que falta cobrar al entregar: el total menos la seña, si la pagó. Se calcula, no se guarda
function conSaldo<T extends Pick<IPedido, 'total' | 'sena'>>(pedido: T) {
  return { ...pedido, saldo: redondear(pedido.total - (pedido.sena?.monto ?? 0)) };
}

// Una acción no encontró el pedido en un estado que la permita: ¿no existe (404) o está en otro estado (409)?
async function noSePudo(id: string, mensajes: Partial<Record<EstadoPedido, string>>) {
  const pedido = await Pedido.findById(id).select('estado').lean();
  if (!pedido) return new ErrorHttp(404, NO_ENCONTRADO);
  return new ErrorHttp(409, mensajes[pedido.estado] ?? `El pedido está ${pedido.estado}`);
}

// Lo mismo para deshacer: si existe, es que no estaba en el estado que se quiere deshacer
async function sinEstado(id: string, mensaje: string) {
  return (await Pedido.exists({ _id: id })) ? new ErrorHttp(409, mensaje) : new ErrorHttp(404, NO_ENCONTRADO);
}

// Nombre, precio, categoría y total salen de la base, con la misma cuenta que el carrito.
// Si hay productos pausados o eliminados no lo crea: devuelve cuáles son
export async function crear({ nombre, telefono, cantidades, nota }: DatosPedido) {
  const cotizacion = await carritoService.cotizar(cantidades);
  if (cotizacion.noDisponibles.length > 0) return { noDisponibles: cotizacion.noDisponibles };

  const items: IItemPedido[] = cotizacion.items.map((item) => ({
    producto: item.producto,
    nombre: item.nombre,
    precio: item.precio,
    categoria: item.categoria,
    cantidad: item.cantidad,
  }));

  const cliente = await Cliente.findOneAndUpdate(
    { telefono },
    { nombre },
    { upsert: true, returnDocument: 'after', runValidators: true }
  );
  if (!cliente) throw new Error('No se pudo registrar el cliente');

  const pedido = await Pedido.create({
    cliente: cliente._id,
    clienteNombre: nombre,
    clienteTelefono: telefono,
    items,
    total: cotizacion.total,
    nota,
  });
  return { pedido };
}

// Del más nuevo al más viejo
export async function listar(estado: EstadoPedido | undefined, { pagina, limite }: Paginado) {
  const filtro = estado ? { estado } : {};
  const [pedidos, totalPedidos] = await Promise.all([
    Pedido.find(filtro)
      .sort({ createdAt: -1 })
      .skip((pagina - 1) * limite)
      .limit(limite)
      .lean(),
    Pedido.countDocuments(filtro),
  ]);
  return {
    pedidos: pedidos.map(conSaldo),
    pagina,
    limite,
    totalPedidos,
    totalPaginas: Math.ceil(totalPedidos / limite),
  };
}

// Con los datos del cliente y cuántos pedidos tiene
export async function obtener(id: string) {
  const pedido = await Pedido.findById(id)
    .populate<{ cliente: (ICliente & { _id: Types.ObjectId; createdAt: Date }) | null }>(
      'cliente',
      'nombre telefono createdAt'
    )
    .lean();
  if (!pedido) throw new ErrorHttp(404, NO_ENCONTRADO);

  const cliente = pedido.cliente
    ? { ...pedido.cliente, cantidadPedidos: await Pedido.countDocuments({ cliente: pedido.cliente._id }) }
    : null;
  return conSaldo({ ...pedido, cliente });
}

// Cada acción es UNA operación condicionada al estado: si dos llegan a la vez (dos toques, la app y la compu),
// la segunda no pisa a la primera. ❌ No las pases a leer-revisar-guardar.

// Confirma la seña (pasa a confirmado) o corrige su monto. La fecha queda la de la primera confirmación
export async function registrarSena(id: string, monto: number) {
  const actualizado = await Pedido.findOneAndUpdate(
    // total >= monto en el mismo filtro: la seña nunca pasa del total
    { _id: id, estado: { $in: ABIERTOS }, total: { $gte: monto } },
    [{ $set: { estado: 'confirmado', sena: { monto, pagadaEn: { $ifNull: ['$sena.pagadaEn', '$$NOW'] } } } }],
    { updatePipeline: true }
  );
  if (!actualizado) {
    const pedido = await Pedido.findById(id).select('estado total').lean();
    if (pedido && ABIERTOS.includes(pedido.estado)) {
      throw new ErrorHttp(400, `La seña no puede ser más que el total del pedido ($${pedido.total.toLocaleString('es-AR')})`);
    }
    throw await noSePudo(id, {
      entregado: 'El pedido ya está entregado: no se puede cambiar la seña',
      cancelado: 'El pedido está cancelado: no se puede cambiar la seña',
    });
  }
  return obtener(id);
}

// Por si la confirmó por error: vuelve a pendiente
export async function quitarSena(id: string) {
  const actualizado = await Pedido.findOneAndUpdate(
    { _id: id, estado: 'confirmado' },
    { estado: 'pendiente', $unset: { sena: 1 } }
  );
  if (!actualizado) {
    throw await noSePudo(id, {
      pendiente: 'El pedido no tiene una seña confirmada',
      entregado: 'El pedido ya está entregado: no se puede quitar la seña',
      cancelado: 'El pedido está cancelado: no se puede quitar la seña',
    });
  }
  return obtener(id);
}

// También sin seña: el cliente puede pagar todo al retirar
export async function registrarEntrega(id: string) {
  const actualizado = await Pedido.findOneAndUpdate(
    { _id: id, estado: { $in: ABIERTOS } },
    { estado: 'entregado', entregadoEn: new Date() }
  );
  if (!actualizado) {
    throw await noSePudo(id, {
      entregado: 'El pedido ya está entregado',
      cancelado: 'El pedido está cancelado: no se puede entregar',
    });
  }
  return obtener(id);
}

// Por si lo marcó entregado por error
export async function quitarEntrega(id: string) {
  const actualizado = await Pedido.findOneAndUpdate(
    { _id: id, estado: 'entregado' },
    [VOLVER_A_ABIERTO, { $unset: 'entregadoEn' }],
    { updatePipeline: true }
  );
  if (!actualizado) throw await sinEstado(id, 'El pedido no está entregado');
  return obtener(id);
}

// La seña, si tenía, queda registrada: puede haber que devolverla
export async function cancelar(id: string) {
  const actualizado = await Pedido.findOneAndUpdate(
    { _id: id, estado: { $in: ABIERTOS } },
    { estado: 'cancelado', canceladoEn: new Date() }
  );
  if (!actualizado) {
    throw await noSePudo(id, {
      entregado: 'El pedido ya está entregado: no se puede cancelar',
      cancelado: 'El pedido ya está cancelado',
    });
  }
  return obtener(id);
}

// Por si lo canceló por error
export async function quitarCancelacion(id: string) {
  const actualizado = await Pedido.findOneAndUpdate(
    { _id: id, estado: 'cancelado' },
    [VOLVER_A_ABIERTO, { $unset: 'canceladoEn' }],
    { updatePipeline: true }
  );
  if (!actualizado) throw await sinEstado(id, 'El pedido no está cancelado');
  return obtener(id);
}
