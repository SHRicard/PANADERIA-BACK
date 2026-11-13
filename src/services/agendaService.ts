import { Types } from 'mongoose';
import { Agenda } from '../models/DiaAgenda';
import { IPedido, Pedido } from '../models/Pedido';
import { ErrorHttp } from '../utils/errores';
import { diaEnArgentina, diasEntre, fechaCorta, finDeMes, hoyEnArgentina, sumarDias } from '../utils/fecha';
import * as ajustesService from './ajustesService';

// ── Las reglas del cliente (la web). El dueño no tiene ninguna: puede anotar cualquier día ───────────

// Si faltan estos días o menos para fin de mes, el cliente ya puede elegir del mes siguiente (el 23/11 sí, el 22/11 no)
export const DIAS_PARA_ABRIR_EL_MES_SIGUIENTE = 7;

export const AGENDA_LLENA = 'Ese día tenemos la agenda llena: elegí otro';

// Con cuántos días se puede encargar: 24 hs = 1 (mañana), 48 hs = 2 (pasado). Se cuentan días, no horas exactas: el
// 11/11 a las 23 hs, mañana ya vale. Nunca para hoy, aunque un producto tuviera 0 hs
export const diasDeAnticipacion = (horas: number) => Math.max(1, Math.ceil(horas / 24));

export interface RangoDeEntrega {
  /** El primer día que puede elegir */
  desde: string;
  /** El último */
  hasta: string;
  /**
   * Los días del rango que la web no ofrece, en orden: los que el dueño marcó como «Agenda llena» y los que llegaron a
   * sus productos por día (el tope)
   */
  diasLlenos: string[];
}

// Los días cerrados para el cliente: marcados por el dueño, o que llegaron al tope
async function diasCerradosEntre(desde: string, hasta: string): Promise<string[]> {
  const { dias } = await diasDelRango(desde, hasta);
  return dias.filter((dia) => dia.llena || dia.tope).map((dia) => dia.fecha);
}

// Lo que el dueño eligió para cada día del rango: si lo marcó como «Agenda llena» y cuántos quiere hacer. Solo los
// días que tocó
async function elegidoEntre(desde: string, hasta: string) {
  const dias = await Agenda.find({
    _id: { $gte: desde, $lte: hasta },
    $or: [{ llena: true }, { quiereHacer: { $exists: true } }],
  })
    .select('llena quiereHacer')
    .lean();
  return new Map(dias.map((dia) => [dia._id, { llena: dia.llena ?? false, quiereHacer: dia.quiereHacer ?? null }]));
}

// Los días que el cliente puede elegir para un carrito: desde mañana o pasado (según el producto que más demora) hasta
// fin de mes, o hasta fin del mes siguiente si faltan 7 días o menos. Si todos los días del rango están cerrados
// (marcados o en el tope), se suma el mes siguiente. La usan el carrito (para armar el calendario) y el pedido (para revisarlo): nunca difieren
export async function rangoDeEntrega(anticipacionHoras: number): Promise<RangoDeEntrega> {
  const hoy = hoyEnArgentina();
  const desde = sumarDias(hoy, diasDeAnticipacion(anticipacionHoras));

  let hasta = finDeMes(hoy);
  if (diasEntre(hoy, hasta) <= DIAS_PARA_ABRIR_EL_MES_SIGUIENTE) hasta = finDeMes(sumarDias(hasta, 1));
  // Por si un producto se encarga con tanta anticipación que el primer día cae después (hoy todos son de 24 o 48 hs)
  if (desde > hasta) hasta = finDeMes(desde);

  let diasLlenos = await diasCerradosEntre(desde, hasta);
  if (diasLlenos.length > diasEntre(desde, hasta)) {
    hasta = finDeMes(sumarDias(hasta, 1));
    diasLlenos = await diasCerradosEntre(desde, hasta);
  }
  return { desde, hasta, diasLlenos };
}

// El pedido de la web: la fecha tiene que estar en el rango y no estar marcada. Fuera del rango es 400 (la web tenía
// el calendario de ayer abierto); marcada es 409 (el dueño la marcó mientras el cliente elegía)
export async function revisarFechaDelCliente(fecha: string, anticipacionHoras: number) {
  const { desde, hasta, diasLlenos } = await rangoDeEntrega(anticipacionHoras);
  if (fecha < desde) throw new ErrorHttp(400, `Para este pedido, el primer día que se puede elegir es el ${fechaCorta(desde)}`);
  if (fecha > hasta) throw new ErrorHttp(400, `Por ahora se puede pedir hasta el ${fechaCorta(hasta)}`);
  if (diasLlenos.includes(fecha)) throw new ErrorHttp(409, AGENDA_LLENA);
}

// Los días del rango que se están llenando (nivel medio: pasaron el 40 % del tope, sin llegar) y que el dueño no
// marcó: la web los muestra en amarillo con «Casi», para que el cliente no lo deje para último momento. Se pueden
// elegir. Sin los productos por día del dueño no hay niveles, así que no hay ninguno. Aparte de rangoDeEntrega: el
// pedido no la necesita para revisar la fecha
export async function diasCasiLlenos({ desde, hasta }: RangoDeEntrega): Promise<string[]> {
  const { dias } = await diasDelRango(desde, hasta);
  return dias.filter((dia) => !dia.llena && dia.nivel === 'medio').map((dia) => dia.fecha);
}

// ── La agenda del dueño ──────────────────────────────────────────────────────────────────────────────

// Qué tan lleno está cada día contra los productos por día del dueño, que son su tope (lo pidió el dueño): bajo
// («Libre», verde) hasta el 40 %; medio («Casi», amarillo) por arriba del 40 % sin llegar; alto («Llena», rojo) desde
// el 100 %. Con 25: hasta 10 libre, de 11 a 24 casi, 25 o más llena. En el tope, la web deja de ofrecer el día solo,
// como si el dueño lo hubiera marcado (el dueño puede seguir cargando pedidos a mano)
export const NIVELES_AGENDA = ['bajo', 'medio', 'alto'] as const;
export type NivelAgenda = (typeof NIVELES_AGENDA)[number];
const HASTA_LIBRE = 40;
const TOPE = 100;

// Un día en que el dueño quiere hacer menos (quiereHacer, lo pidió el dueño el 2026-11-13): el tope sigue siendo el
// de siempre y lo que no quiere hacer se cuenta como ocupado. Con 25 y quiere hacer 3: 22 ocupados, así que arranca en
// «Casi» (88 %) y con 3 productos pedidos llega al tope. Si baja poco (20 de 25), las mismas cuentas lo pueden dejar
// en «Libre». Sin productos por día, el tope de ese día es lo que quiere hacer
function nivelDe(productos: number, productosPorDia: number | null, quiereHacer: number | null): NivelAgenda | null {
  const tope = productosPorDia ?? quiereHacer;
  if (tope === null) return null;
  const noQuiereHacer = quiereHacer === null ? 0 : Math.max(0, tope - quiereHacer);
  const porcentaje = ((productos + noQuiereHacer) / tope) * 100;
  return porcentaje >= TOPE ? 'alto' : porcentaje > HASTA_LIBRE ? 'medio' : 'bajo';
}

export interface DiaAgenda {
  fecha: string;
  /** Pedidos no cancelados para ese día (también los pendientes sin seña y los manuales) */
  pedidos: number;
  /** La suma de las cantidades de esos pedidos: un pack de 50 chipás es 1, 3 tartas son 3 */
  productos: number;
  /** null mientras el dueño no ponga sus productos por día */
  nivel: NivelAgenda | null;
  /** Si el dueño lo marcó como «Agenda llena» */
  llena: boolean;
  /** Cuántos productos quiere hacer ese día, si eligió menos que los de siempre; null = los de siempre */
  quiereHacer: number | null;
  /** Si llegó a los productos por día del dueño: la web tampoco lo ofrece, aunque no esté marcado */
  tope: boolean;
}

// Calculado al vuelo, sin contadores guardados: cancelar un pedido libera su lugar solo
async function diasDelRango(desde: string, hasta: string) {
  const [ocupacion, elegido, { productosPorDia }] = await Promise.all([
    Pedido.aggregate<{ _id: string; pedidos: number; productos: number }>([
      { $match: { fechaEntrega: { $gte: desde, $lte: hasta }, estado: { $ne: 'cancelado' } } },
      { $group: { _id: '$fechaEntrega', pedidos: { $sum: 1 }, productos: { $sum: { $sum: '$items.cantidad' } } } },
    ]),
    elegidoEntre(desde, hasta),
    ajustesService.obtener(),
  ]);

  const porDia = new Map(ocupacion.map((dia) => [dia._id, dia]));
  const dias: DiaAgenda[] = [];
  for (let fecha = desde; fecha <= hasta; fecha = sumarDias(fecha, 1)) {
    const { pedidos = 0, productos = 0 } = porDia.get(fecha) ?? {};
    const { llena = false, quiereHacer = null } = elegido.get(fecha) ?? {};
    const nivel = nivelDe(productos, productosPorDia, quiereHacer);
    dias.push({ fecha, pedidos, productos, nivel, llena, quiereHacer, tope: nivel === 'alto' });
  }
  return { productosPorDia, dias };
}

// Todos los días del mes (AAAA-MM), también los que no tienen pedidos
// Todos los días del mes (AAAA-MM), también los que no tienen pedidos. Cada uno con `faltan`: lo que le queda por
// preparar (el circulito de la agenda del dueño)
export async function delMes(mes: string) {
  const desde = `${mes}-01`;
  const hasta = finDeMes(desde);
  const [{ productosPorDia, dias }, faltan] = await Promise.all([diasDelRango(desde, hasta), faltanPorDia(desde, hasta)]);
  return { mes, productosPorDia, dias: dias.map((dia) => ({ ...dia, faltan: faltan.get(dia.fecha) ?? 0 })) };
}

// Lo que le queda por preparar a cada día del rango: de los pedidos que falta entregar (pendientes y confirmados),
// cada producto menos lo que el dueño anotó como hecho (nunca menos de 0), sumado. La misma cuenta que la hoja
// «Qué hay que hacer» (productosDelDia), para todo el mes de una vez. Solo la usa la agenda: la web no la necesita
async function faltanPorDia(desde: string, hasta: string): Promise<Map<string, number>> {
  const [pedidos, anotados] = await Promise.all([
    Pedido.aggregate<{ _id: { fecha: string; producto: Types.ObjectId }; cantidad: number }>([
      { $match: { fechaEntrega: { $gte: desde, $lte: hasta }, estado: { $in: ['pendiente', 'confirmado'] } } },
      { $unwind: '$items' },
      { $group: { _id: { fecha: '$fechaEntrega', producto: '$items.producto' }, cantidad: { $sum: '$items.cantidad' } } },
    ]),
    Agenda.find({ _id: { $gte: desde, $lte: hasta }, 'hechos.0': { $exists: true } }).select('hechos').lean(),
  ]);

  const hechos = new Map<string, number>();
  for (const dia of anotados) for (const hecho of dia.hechos) hechos.set(`${dia._id}|${String(hecho.producto)}`, hecho.cantidad);

  const faltan = new Map<string, number>();
  for (const { _id, cantidad } of pedidos) {
    const resto = Math.max(0, cantidad - (hechos.get(`${_id.fecha}|${String(_id.producto)}`) ?? 0));
    faltan.set(_id.fecha, (faltan.get(_id.fecha) ?? 0) + resto);
  }
  return faltan;
}

// El botón «Agenda llena»: marcarlo (o desmarcarlo) dos veces no es un error, los dos toques dejan lo mismo. Puede ser
// cualquier día, también uno lleno de pedidos o uno pasado: el dueño no tiene reglas. Responde el día como en delMes
export async function marcarLlena(fecha: string, llena: boolean): Promise<DiaAgenda> {
  // Con _id = la fecha, el upsert no puede crear dos documentos para el mismo día. Desmarcarlo no borra el día: puede
  // tener anotado lo que ya se hizo
  await Agenda.updateOne({ _id: fecha }, { $set: { llena } }, { upsert: true, runValidators: true });
  const { dias } = await diasDelRango(fecha, fecha);
  return dias[0];
}

// Cuántos productos quiere hacer ese día (null = los de siempre). Ponerlo dos veces no es un error. Puede ser
// cualquier día, también uno que ya tiene más pedidos: esos se quedan y el día pasa a lleno. Responde el día como en delMes
export async function elegirQuiereHacer(fecha: string, quiereHacer: number | null): Promise<DiaAgenda> {
  const cambio = quiereHacer === null ? { $unset: { quiereHacer: 1 } } : { $set: { quiereHacer } };
  await Agenda.updateOne({ _id: fecha }, cambio, { upsert: true, runValidators: true });
  const { dias } = await diasDelRango(fecha, fecha);
  return dias[0];
}

interface PedidoDelDia {
  productoId: string;
  nombre: string;
  cantidad: number;
  sinSena: number;
}

export interface ProductoDelDia extends PedidoDelDia {
  /** Cuántos ya preparó el dueño (lo anota en la hoja). Nunca más que `cantidad` */
  hechos: number;
  /** Lo que falta: cantidad − hechos */
  faltan: number;
  /** Ya hizo todos */
  listo: boolean;
}

// Lo que hay que preparar un día: los productos de todos sus pedidos que falta entregar (pendientes y confirmados),
// sumados, sin importar de quién son (los entregados ya se hicieron y los cancelados no van), con cuántos ya hizo el
// dueño. Primero lo que falta, del que más hay que hacer al que menos; al final los listos; si empatan, por nombre
export async function productosDelDia(fecha: string) {
  const [pedidos, dia] = await Promise.all([pedidosDelDia(fecha), Agenda.findById(fecha).select('hechos').lean()]);
  const hechosDe = new Map((dia?.hechos ?? []).map((hecho) => [String(hecho.producto), hecho.cantidad]));

  const productos: ProductoDelDia[] = pedidos.filas
    .map((fila) => {
      const hechos = Math.min(hechosDe.get(fila.productoId) ?? 0, fila.cantidad);
      return { ...fila, hechos, faltan: fila.cantidad - hechos, listo: hechos >= fila.cantidad };
    })
    .sort((a, b) => Number(a.listo) - Number(b.listo) || b.cantidad - a.cantidad || a.nombre.localeCompare(b.nombre, 'es'));

  return {
    fecha,
    pedidos: pedidos.cantidad,
    total: productos.reduce((suma, producto) => suma + producto.cantidad, 0),
    hechos: productos.reduce((suma, producto) => suma + producto.hechos, 0),
    productos,
  };
}

// Cuántos hizo de un producto ese día: el número que queda (no lo que suma), así dos toques seguidos no se pisan. Con 0
// se borra. Puede ser cualquier producto y cualquier día: el dueño no tiene reglas. Responde la hoja entera
export async function anotarHechos(fecha: string, productoId: string, cantidad: number) {
  const producto = new Types.ObjectId(productoId);
  // Solo de lo que hay que preparar ese día: un producto que no está en sus pedidos no se anota (0 sí: es borrarlo,
  // también si el pedido se canceló después de anotarlo)
  if (cantidad > 0) {
    const enLosPedidos = await Pedido.exists({
      fechaEntrega: fecha,
      estado: { $in: ['pendiente', 'confirmado'] },
      'items.producto': producto,
    });
    if (!enLosPedidos) throw new ErrorHttp(404, 'Ese producto no está en los pedidos de ese día');
  }
  await Agenda.updateOne({ _id: fecha }, { $pull: { hechos: { producto } } }, { upsert: true });
  if (cantidad > 0) {
    await Agenda.updateOne({ _id: fecha }, { $push: { hechos: { producto, cantidad } } }, { runValidators: true });
  }
  return productosDelDia(fecha);
}


async function pedidosDelDia(fecha: string) {
  const filas = await Pedido.aggregate<PedidoDelDia>([
    { $match: { fechaEntrega: fecha, estado: { $in: ['pendiente', 'confirmado'] } } },
    { $unwind: '$items' },
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: '$items.producto',
        nombre: { $first: '$items.nombre' },
        cantidad: { $sum: '$items.cantidad' },
        sinSena: { $sum: { $cond: [{ $eq: ['$estado', 'pendiente'] }, '$items.cantidad', 0] } },
      },
    },
    { $project: { _id: 0, productoId: { $toString: '$_id' }, nombre: 1, cantidad: 1, sinSena: 1 } },
  ]);
  const cantidad = await Pedido.countDocuments({ fechaEntrega: fecha, estado: { $in: ['pendiente', 'confirmado'] } });
  return { filas, cantidad };
}

// La fecha que se les pone a los pedidos de antes de la agenda (migrar-fecha-entrega) y a los de ejemplo
// (sembrar-pedidos), con lo que se sabe de cada uno. Lo eligió el dueño: entregado, el día que se entregó; confirmado,
// el día de la seña; cancelado, el día que se hizo; pendiente (o uno raro, sin esos datos), el día que se hizo más la
// anticipación del producto que más demora
export function fechaDeUnPedidoViejo(
  pedido: Pick<IPedido, 'estado' | 'createdAt' | 'entregadoEn' | 'sena'>,
  anticipacionHoras: number
): string {
  if (pedido.estado === 'entregado' && pedido.entregadoEn) return diaEnArgentina(pedido.entregadoEn);
  if (pedido.estado === 'confirmado' && pedido.sena?.pagadaEn) return diaEnArgentina(pedido.sena.pagadaEn);
  if (pedido.estado === 'cancelado') return diaEnArgentina(pedido.createdAt);
  return sumarDias(diaEnArgentina(pedido.createdAt), diasDeAnticipacion(anticipacionHoras));
}
