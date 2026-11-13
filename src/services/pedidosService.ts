import { PipelineStage, Types } from 'mongoose';
import { Cliente, ICliente } from '../models/Cliente';
import { EstadoPedido, IItemPedido, IPedido, OrigenPedido, Pedido } from '../models/Pedido';
import { ErrorHttp } from '../utils/errores';
import { Paginado } from '../utils/paginado';
import * as agendaService from './agendaService';
import * as ajustesService from './ajustesService';
import * as carritoService from './carritoService';

export interface DatosPedido {
  nombre: string;
  /** Ya normalizado con normalizarTelefono */
  telefono: string;
  /** Cantidad por id de producto (leerItems) */
  cantidades: Map<string, number>;
  nota?: string;
  /** Si quiere que se lo manden. Si no lo dice, lo pasa a retirar */
  conEnvio: boolean;
  /** Para qué día es (AAAA-MM-DD) */
  fechaEntrega: string;
  /** La clave del intento de la web: el mismo intento no crea dos pedidos */
  intento?: string;
}

/** El pedido que carga el dueño a mano: lo mismo, más la seña si el cliente ya la transfirió */
export interface DatosPedidoManual extends DatosPedido {
  montoSena?: number;
}

type Cotizacion = Awaited<ReturnType<typeof carritoService.cotizar>>;

const NO_ENCONTRADO = 'No encontrado';

// Seña, entrega y cancelación solo mientras el pedido sigue abierto
export const ABIERTOS: EstadoPedido[] = ['pendiente', 'confirmado'];

// Al deshacer una entrega o una cancelación, vuelve a como estaba: confirmado si tiene seña, si no pendiente.
// Mira si existe la seña, no su monto: una de 0 (confirmado sin seña) también vuelve a confirmado
const VOLVER_A_ABIERTO: PipelineStage.Set = {
  $set: { estado: { $cond: [{ $eq: [{ $type: '$sena' }, 'object'] }, 'confirmado', 'pendiente'] } },
};

const redondear = (monto: number) => Math.round(monto * 100) / 100;

const senaMayorQueTotal = (total: number) =>
  new ErrorHttp(400, `La seña no puede ser más que el total del pedido ($${total.toLocaleString('es-AR')})`);

// Lo que se agrega al responder: el saldo (lo que falta cobrar al entregar: el total menos la seña, si la pagó),
// que se calcula y no se guarda; el origen de los pedidos anteriores a ese campo, que son todos de la web, y si el
// dueño lo vio: los anteriores a ese campo, sí (si no, la app los mostraría todos como nuevos). Y el envío: los
// anteriores a ese campo son retiro. La fecha de entrega, null en los anteriores a la agenda (hasta migrar-fecha-entrega)
export function completar<
  T extends Pick<IPedido, 'total' | 'sena'> & {
    origen?: OrigenPedido;
    visto?: boolean;
    conEnvio?: boolean;
    fechaEntrega?: string;
  },
>(pedido: T) {
  return {
    ...pedido,
    origen: pedido.origen ?? 'web',
    visto: pedido.visto ?? true,
    conEnvio: pedido.conEnvio ?? false,
    fechaEntrega: pedido.fechaEntrega ?? null,
    saldo: redondear(pedido.total - (pedido.sena?.monto ?? 0)),
  };
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

// Lo que comparten el pedido de la web y el manual: el cliente se crea o se actualiza por teléfono, y nombre,
// precio, categoría y total salen de la cotización (de la base), nunca de lo que mande el front
async function guardar(
  { nombre, telefono, nota, conEnvio, fechaEntrega }: DatosPedido,
  cotizacion: Cotizacion,
  extra: Pick<IPedido, 'origen'> & { visto: boolean } & Partial<Pick<IPedido, 'estado' | 'sena' | 'intento'>>
) {
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

  return Pedido.create({
    cliente: cliente._id,
    clienteNombre: nombre,
    clienteTelefono: telefono,
    items,
    total: cotizacion.total,
    nota,
    conEnvio,
    fechaEntrega,
    ...extra,
  });
}

// Lo que lee el cliente si manda el pedido con el negocio cerrado (tenía la web abierta de antes)
export const NEGOCIO_CERRADO = 'Por ahora no estamos tomando pedidos. ¡Volvé a mirar en unos días!';

// El pedido del cliente desde la web. Si hay productos pausados o eliminados no lo crea: devuelve cuáles son.
// Con el negocio cerrado responde 409: la web ya muestra el cartel, pero una pestaña abierta de antes podía mandarlo.
// La fecha pasa por las reglas de la agenda, con la anticipación de la misma cotización (la que vio en el carrito)
export async function crear(datos: DatosPedido) {
  // El mismo intento ya se guardó (doble toque, o se cortó la conexión después de guardarlo): ese pedido, sin revisar
  // nada más (el día pudo llenarse justo con él)
  const repetido = datos.intento ? await Pedido.findOne({ intento: datos.intento }) : null;
  if (repetido) return { pedido: repetido };
  if (await ajustesService.estaCerrado()) throw new ErrorHttp(409, NEGOCIO_CERRADO);
  const cotizacion = await carritoService.cotizar(datos.cantidades);
  if (cotizacion.noDisponibles.length > 0) return { noDisponibles: cotizacion.noDisponibles };
  await agendaService.revisarFechaDelCliente(datos.fechaEntrega, cotizacion.anticipacionHoras);
  // Es lo que la app le marca al dueño como nuevo hasta que lo abre y toca «Marcar como visto»
  try {
    return { pedido: await guardar(datos, cotizacion, { origen: 'web', visto: false, intento: datos.intento }) };
  } catch (error) {
    // Dos pedidos con el mismo intento a la vez: el índice único deja pasar uno solo, y el otro responde ese
    const ganador = esClaveRepetida(error) && datos.intento ? await Pedido.findOne({ intento: datos.intento }) : null;
    if (ganador) return { pedido: ganador };
    throw error;
  }
}

const esClaveRepetida = (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;

// El pedido que carga el dueño (le escribieron por WhatsApp, se lo pidieron en persona): las mismas reglas que el
// de la web, pero puede incluir productos pausados y la fecha es libre (sin las reglas de la agenda: pudo arreglar
// cualquier día con el cliente, también uno marcado como lleno). Si ya cobró la seña, entra confirmado. Responde el detalle
export async function crearManual({ montoSena, ...datos }: DatosPedidoManual) {
  const cotizacion = await carritoService.cotizar(datos.cantidades, { incluirPausados: true });
  if (cotizacion.noDisponibles.length > 0) return { noDisponibles: cotizacion.noDisponibles };
  if (montoSena !== undefined && montoSena > cotizacion.total) throw senaMayorQueTotal(cotizacion.total);

  const conSena = montoSena !== undefined && { estado: 'confirmado' as const, sena: { monto: montoSena, pagadaEn: new Date() } };
  // Lo cargó el dueño: ya lo vio
  const pedido = await guardar(datos, cotizacion, { origen: 'manual', visto: true, ...conSena });
  return { pedido: await obtener(pedido.id) };
}

export interface FiltroPedidos {
  estado?: EstadoPedido;
  /** Los de un día de la agenda */
  fechaEntrega?: string;
}

// Del más nuevo al más viejo
export async function listar({ estado, fechaEntrega }: FiltroPedidos, { pagina, limite }: Paginado) {
  const filtro = { ...(estado && { estado }), ...(fechaEntrega && { fechaEntrega }) };
  const [pedidos, totalPedidos] = await Promise.all([
    Pedido.find(filtro)
      .sort({ createdAt: -1 })
      .skip((pagina - 1) * limite)
      .limit(limite)
      .lean(),
    Pedido.countDocuments(filtro),
  ]);
  return {
    pedidos: pedidos.map(completar),
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
  return completar({ ...pedido, cliente });
}

// Cada acción es UNA operación condicionada al estado: si dos llegan a la vez (dos toques, la app y la compu),
// la segunda no pisa a la primera. ❌ No las pases a leer-revisar-guardar.

// Confirma la seña (pasa a confirmado; 0 = sin seña) o corrige su monto. La fecha queda la de la primera
// seña mayor que 0: si lo confirmó sin seña y después el cliente transfirió, la fecha es la de la transferencia
export async function registrarSena(id: string, monto: number) {
  const actualizado = await Pedido.findOneAndUpdate(
    // total >= monto en el mismo filtro: la seña nunca pasa del total
    { _id: id, estado: { $in: ABIERTOS }, total: { $gte: monto } },
    [
      {
        $set: {
          estado: 'confirmado',
          sena: { monto, pagadaEn: { $cond: [{ $gt: ['$sena.monto', 0] }, '$sena.pagadaEn', '$$NOW'] } },
        },
      },
    ],
    { updatePipeline: true }
  );
  if (!actualizado) {
    const pedido = await Pedido.findById(id).select('estado total').lean();
    if (pedido && ABIERTOS.includes(pedido.estado)) throw senaMayorQueTotal(pedido.total);
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

// Visto lo marca el dueño desde el detalle (y lo desmarca, por si tocó sin querer). No cambia el estado ni updatedAt:
// verlo no es editarlo. Marcar uno que ya estaba visto no es un error: los dos toques dejan lo mismo
export async function marcarVisto(id: string, visto: boolean) {
  const actualizado = await Pedido.findByIdAndUpdate(id, { $set: { visto } }, { timestamps: false });
  if (!actualizado) throw new ErrorHttp(404, NO_ENCONTRADO);
  return obtener(id);
}

// El cliente cambió de idea (le escribió «mejor mandámelo»): solo mientras el pedido sigue abierto, como los
// productos. Marcar lo que ya estaba no es un error: los dos toques dejan lo mismo
export async function cambiarEnvio(id: string, conEnvio: boolean) {
  const actualizado = await Pedido.findOneAndUpdate({ _id: id, estado: { $in: ABIERTOS } }, { $set: { conEnvio } });
  if (!actualizado) {
    throw await noSePudo(id, {
      entregado: 'El pedido ya está entregado: no se puede cambiar el envío',
      cancelado: 'El pedido está cancelado: no se puede cambiar el envío',
    });
  }
  return obtener(id);
}

// El cliente le escribió para cambiar el día: solo mientras el pedido sigue abierto, como el envío y los productos.
// Sin las reglas de la agenda: lo arregló el dueño con el cliente
export async function cambiarFechaEntrega(id: string, fechaEntrega: string) {
  const actualizado = await Pedido.findOneAndUpdate({ _id: id, estado: { $in: ABIERTOS } }, { $set: { fechaEntrega } });
  if (!actualizado) {
    throw await noSePudo(id, {
      entregado: 'El pedido ya está entregado: no se puede cambiar la fecha',
      cancelado: 'El pedido está cancelado: no se puede cambiar la fecha',
    });
  }
  return obtener(id);
}

const EDICION_CERRADA: Partial<Record<EstadoPedido, string>> = {
  entregado: 'El pedido ya está entregado: no se pueden cambiar sus productos',
  cancelado: 'El pedido está cancelado: no se pueden cambiar sus productos',
};

// El cliente le escribió al dueño para sumar algo, sacar algo o cambiar cantidades: la app manda la lista completa y
// reemplaza la del pedido. Lo que ya estaba conserva el precio con el que se pidió, aunque cambie la cantidad (una
// línea por producto: las métricas cuentan los pedidos de cada producto con esa regla). Lo nuevo entra con el precio
// de hoy y, como en el pedido manual, puede ser un producto pausado. Si un producto que ya estaba se borró del
// catálogo, su línea sigue valiendo: es una copia
export async function editarItems(id: string, cantidades: Map<string, number>) {
  const pedido = await Pedido.findById(id).select('estado items').lean();
  if (!pedido) throw new ErrorHttp(404, NO_ENCONTRADO);
  if (!ABIERTOS.includes(pedido.estado)) {
    throw new ErrorHttp(409, EDICION_CERRADA[pedido.estado] ?? `El pedido está ${pedido.estado}`);
  }

  const anteriores = new Map(pedido.items.map((item) => [String(item.producto), item]));
  const nuevos = new Map([...cantidades].filter(([producto]) => !anteriores.has(producto)));
  const cotizacion = nuevos.size > 0 ? await carritoService.cotizar(nuevos, { incluirPausados: true }) : null;
  if (cotizacion && cotizacion.noDisponibles.length > 0) return { noDisponibles: cotizacion.noDisponibles };
  const cotizados = new Map(cotizacion?.items.map((item) => [String(item.producto), item]));

  // En el orden en que los manda la app
  const items: IItemPedido[] = [];
  for (const [producto, cantidad] of cantidades) {
    const base = anteriores.get(producto) ?? cotizados.get(producto);
    if (!base) continue;
    const { nombre, precio, categoria } = base;
    items.push({ producto: base.producto, nombre, precio, categoria, cantidad });
  }
  const total = redondear(items.reduce((suma, item) => suma + item.precio * item.cantidad, 0));

  // El estado y la seña se revisan en el mismo filtro: una entrega, una cancelación o una seña que llegue entre la
  // lectura y la escritura no se pisa. Los ítems no hace falta: la app manda la lista completa y gana la última
  const actualizado = await Pedido.findOneAndUpdate(
    {
      _id: id,
      estado: { $in: ABIERTOS },
      $or: [{ sena: { $exists: false } }, { 'sena.monto': { $lte: total } }],
    },
    { items, total },
    { runValidators: true }
  );
  if (!actualizado) {
    const ahora = await Pedido.findById(id).select('estado sena').lean();
    if (!ahora) throw new ErrorHttp(404, NO_ENCONTRADO);
    if (ahora.sena && ABIERTOS.includes(ahora.estado)) {
      throw new ErrorHttp(
        409,
        `La seña ($${ahora.sena.monto.toLocaleString('es-AR')}) es más que el nuevo total ($${total.toLocaleString('es-AR')}): corregila antes de sacar productos`
      );
    }
    throw new ErrorHttp(409, EDICION_CERRADA[ahora.estado] ?? `El pedido está ${ahora.estado}`);
  }
  return { pedido: await obtener(id) };
}
