import { PipelineStage, Types } from 'mongoose';
import { IInsumo, Insumo, UnidadInsumo } from '../models/Insumo';
import { ESTADOS_PEDIDO, EstadoPedido, ORIGENES_PEDIDO, OrigenPedido, Pedido } from '../models/Pedido';
import { CATEGORIAS, SIN_MAYUSCULAS_NI_ACENTOS } from '../models/Producto';
import { hoyEnArgentina, ZONA_ARGENTINA } from '../utils/fecha';
import { Paginado } from '../utils/paginado';

// Las métricas se calculan al vuelo sobre los pedidos y los insumos: no hay contadores guardados que se puedan
// desfasar. Una VENTA es un pedido que no se canceló, y cuenta el día en que se hizo (en Argentina): si después se
// cancela, deja de sumar sola. Lo que se gastó en insumos sale del historial de cada uno (ver comprasDe)

/** Días de calendario en Argentina, AAAA-MM-DD, los dos incluidos. Sin uno de los dos, no hay límite de ese lado */
export interface RangoDias {
  desde?: string;
  hasta?: string;
}

/** Por qué se ordenan los rankings de productos y de gustos */
export const ORDENES_VENTAS = ['unidades', 'importe'] as const;
export type OrdenVentas = (typeof ORDENES_VENTAS)[number];

/** De a cuánto se agrupa la serie del balance. La semana empieza el lunes */
export const AGRUPACIONES = ['dia', 'semana', 'mes'] as const;
export type Agrupacion = (typeof AGRUPACIONES)[number];

export const DIAS_DE_LA_SEMANA = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'] as const;

const redondear = (valor: number) => Math.round(valor * 100) / 100;
const porcentaje = (parte: number, total: number) => (total > 0 ? redondear((parte / total) * 100) : 0);
const importeDelItem = { $multiply: ['$items.precio', '$items.cantidad'] };

const dentroDelRango = (dia: string, { desde, hasta }: RangoDias) => (!desde || dia >= desde) && (!hasta || dia <= hasta);

// ── Pedidos ─────────────────────────────────────────────────────────────────────────────────────────

// _dia: el día de Argentina (AAAA-MM-DD) en que se hizo el pedido. Render corre en UTC: a las 22 hs ya sería mañana
function pedidosDelRango({ desde, hasta }: RangoDias): PipelineStage[] {
  const dia: Record<string, string> = {};
  if (desde) dia.$gte = desde;
  if (hasta) dia.$lte = hasta;
  return [
    { $set: { _dia: { $dateToString: { date: '$createdAt', format: '%Y-%m-%d', timezone: ZONA_ARGENTINA } } } },
    ...(desde || hasta ? [{ $match: { _dia: dia } }] : []),
  ];
}

// Las ventas: los pedidos del rango que no se cancelaron (pendientes, confirmados y entregados)
export const ventasDelRango = (rango: RangoDias): PipelineStage[] => [
  { $match: { estado: { $ne: 'cancelado' } } },
  ...pedidosDelRango(rango),
];

const contarVentas = (rango: RangoDias) =>
  Pedido.aggregate<{ cantidad: number }>([...ventasDelRango(rango), { $count: 'cantidad' }]).then(
    ([fila]) => fila?.cantidad ?? 0
  );

// ── 1. Productos más vendidos ───────────────────────────────────────────────────────────────────────

export interface ProductoVendido {
  nombre: string;
  /** El id del producto en la última venta. Puede ya no existir (si se borró) */
  productoId: string;
  /** El gusto en la última venta */
  categoria: string;
  unidades: number;
  /** Lo que se vendió de ese producto: precio del momento × cantidad */
  importe: number;
  /** En cuántos pedidos salió */
  pedidos: number;
}

const ORDEN_DEL_RANKING: Record<OrdenVentas, Record<string, 1 | -1>> = {
  unidades: { unidades: -1, importe: -1, nombre: 1, _id: 1 },
  importe: { importe: -1, unidades: -1, nombre: 1, _id: 1 },
};

interface RankingAgregado {
  productos: (Omit<ProductoVendido, 'productoId'> & { productoId: Types.ObjectId })[];
  totales: { totalProductos: number; totalUnidades: number; totalImporte: number }[];
}

// Se agrupan por nombre, sin importar mayúsculas ni acentos (el nombre es único así justamente para esto): un
// producto borrado y vuelto a crear sigue sumando junto. Nombre, id y gusto son los de la última venta. Los totales
// son de todo el rango, no de la página
export async function productosMasVendidos(rango: RangoDias, orden: OrdenVentas, { pagina, limite }: Paginado) {
  const [[ranking], totalPedidos] = await Promise.all([
    Pedido.aggregate<RankingAgregado>([
      ...ventasDelRango(rango),
      { $unwind: '$items' },
      // Para que $first tome el nombre, el id y el gusto de la última venta
      { $sort: { createdAt: -1, _id: -1 } },
      {
        $group: {
          _id: '$items.nombre',
          nombre: { $first: '$items.nombre' },
          productoId: { $first: '$items.producto' },
          categoria: { $first: '$items.categoria' },
          unidades: { $sum: '$items.cantidad' },
          importe: { $sum: importeDelItem },
          // Un pedido no repite producto (leerItems junta las cantidades), así que cada ítem es un pedido distinto
          pedidos: { $sum: 1 },
        },
      },
      { $set: { importe: { $round: ['$importe', 2] } } },
      {
        $facet: {
          productos: [
            { $sort: ORDEN_DEL_RANKING[orden] },
            { $skip: (pagina - 1) * limite },
            { $limit: limite },
            { $project: { _id: 0 } },
          ],
          totales: [
            {
              $group: {
                _id: null,
                totalProductos: { $sum: 1 },
                totalUnidades: { $sum: '$unidades' },
                totalImporte: { $sum: '$importe' },
              },
            },
          ],
        },
      },
      // La collation hace que el $group junte "Pan dulce" con "pan dulce", y ordena los empates por nombre en español
    ]).collation(SIN_MAYUSCULAS_NI_ACENTOS),
    contarVentas(rango),
  ]);

  const totales = ranking?.totales[0] ?? { totalProductos: 0, totalUnidades: 0, totalImporte: 0 };
  return {
    desde: rango.desde ?? null,
    hasta: rango.hasta ?? null,
    orden,
    totalPedidos,
    totalUnidades: totales.totalUnidades,
    totalImporte: redondear(totales.totalImporte),
    productos: (ranking?.productos ?? []).map(
      (producto): ProductoVendido => ({ ...producto, productoId: String(producto.productoId) })
    ),
    pagina,
    limite,
    totalProductos: totales.totalProductos,
    totalPaginas: Math.ceil(totales.totalProductos / limite),
  };
}

// ── 2. Gustos más vendidos ──────────────────────────────────────────────────────────────────────────

// Todos los gustos de la lista, aunque no se hayan vendido (en 0), y al final los que ya no están en la lista pero
// tienen ventas viejas. Los empates quedan en el orden de CATEGORIAS
export async function gustosMasVendidos(rango: RangoDias, orden: OrdenVentas) {
  const [filas, totalPedidos] = await Promise.all([
    Pedido.aggregate<{ _id: string; unidades: number; importe: number; pedidos: number }>([
      ...ventasDelRango(rango),
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.categoria',
          unidades: { $sum: '$items.cantidad' },
          importe: { $sum: importeDelItem },
          // Un pedido puede llevar varios productos del mismo gusto: se cuenta una vez
          pedidos: { $addToSet: '$_id' },
        },
      },
      { $set: { pedidos: { $size: '$pedidos' } } },
    ]),
    contarVentas(rango),
  ]);

  const porGusto = new Map(filas.map((fila) => [fila._id, fila]));
  const lista: readonly string[] = CATEGORIAS;
  const otros = filas.map((fila) => fila._id).filter((gusto) => !lista.includes(gusto));
  const [primero, segundo] = orden === 'unidades' ? (['unidades', 'importe'] as const) : (['importe', 'unidades'] as const);
  const gustos = [...lista, ...otros]
    .map((gusto) => {
      const fila = porGusto.get(gusto);
      return { gusto, unidades: fila?.unidades ?? 0, importe: redondear(fila?.importe ?? 0), pedidos: fila?.pedidos ?? 0 };
    })
    .sort((a, b) => b[primero] - a[primero] || b[segundo] - a[segundo]);

  return {
    desde: rango.desde ?? null,
    hasta: rango.hasta ?? null,
    orden,
    totalPedidos,
    totalUnidades: gustos.reduce((suma, gusto) => suma + gusto.unidades, 0),
    totalImporte: redondear(gustos.reduce((suma, gusto) => suma + gusto.importe, 0)),
    gustos,
  };
}

// ── 3 a 6 y 13. Pedidos: por estado, por origen, cancelaciones, ticket promedio y días de la semana ────

interface ResumenAgregado {
  porEstado: { _id: EstadoPedido; cantidad: number }[];
  porOrigen: { _id: OrigenPedido; cantidad: number }[];
  porDia: { _id: number; cantidad: number }[];
  ventas: { cantidad: number; importe: number }[];
}

// Todos los pedidos que se hicieron en el rango, con el estado que tienen hoy. El ticket promedio es solo de las
// ventas (sin los cancelados)
export async function resumenPedidos(rango: RangoDias) {
  const [resumen] = await Pedido.aggregate<ResumenAgregado>([
    ...pedidosDelRango(rango),
    {
      $facet: {
        porEstado: [{ $group: { _id: '$estado', cantidad: { $sum: 1 } } }],
        // Los pedidos de antes de que existiera origen no lo tienen: eran todos de la web
        porOrigen: [{ $group: { _id: { $ifNull: ['$origen', 'web'] }, cantidad: { $sum: 1 } } }],
        // 1 = domingo … 7 = sábado, en Argentina
        porDia: [{ $group: { _id: { $dayOfWeek: { date: '$createdAt', timezone: ZONA_ARGENTINA } }, cantidad: { $sum: 1 } } }],
        ventas: [
          { $match: { estado: { $ne: 'cancelado' } } },
          { $group: { _id: null, cantidad: { $sum: 1 }, importe: { $sum: '$total' } } },
        ],
      },
    },
  ]);

  const contar = <T extends string>(claves: readonly T[], filas: { _id: T; cantidad: number }[]) =>
    Object.fromEntries(claves.map((clave) => [clave, filas.find((fila) => fila._id === clave)?.cantidad ?? 0])) as Record<
      T,
      number
    >;
  const porEstado = contar(ESTADOS_PEDIDO, resumen.porEstado);
  const totalPedidos = Object.values<number>(porEstado).reduce((suma, cantidad) => suma + cantidad, 0);
  const ventas = resumen.ventas[0] ?? { cantidad: 0, importe: 0 };
  const porDia = new Map(resumen.porDia.map((fila) => [fila._id, fila.cantidad]));

  return {
    desde: rango.desde ?? null,
    hasta: rango.hasta ?? null,
    totalPedidos,
    porEstado,
    porOrigen: contar(ORIGENES_PEDIDO, resumen.porOrigen),
    porcentajeCancelados: porcentaje(porEstado.cancelado, totalPedidos),
    ticketPromedio: ventas.cantidad > 0 ? redondear(ventas.importe / ventas.cantidad) : 0,
    // De lunes a domingo. $dayOfWeek da 2 = lunes … 7 = sábado y 1 = domingo
    porDiaDeLaSemana: DIAS_DE_LA_SEMANA.map((dia, indice) => ({ dia, pedidos: porDia.get(((indice + 1) % 7) + 1) ?? 0 })),
  };
}

// ── 12. Clientes nuevos y los que vuelven ───────────────────────────────────────────────────────────

// De los clientes que compraron en el rango (sin contar pedidos cancelados): nuevos = su primera compra fue en el
// rango; recurrentes = ya habían comprado antes. Sin desde, todos son nuevos: conVariosPedidos dice cuántos
// compraron más de una vez en el rango
export async function clientes(rango: RangoDias) {
  const { desde, hasta } = rango;
  const condiciones = [...(desde ? [{ $gte: ['$_dia', desde] }] : []), ...(hasta ? [{ $lte: ['$_dia', hasta] }] : [])];
  const [fila] = await Pedido.aggregate<{ totalClientes: number; nuevos: number; conVariosPedidos: number }>([
    { $match: { estado: { $ne: 'cancelado' } } },
    ...pedidosDelRango({}),
    {
      $group: {
        _id: '$cliente',
        primeraCompra: { $min: '$_dia' },
        enElRango: { $sum: { $cond: [{ $and: condiciones }, 1, 0] } },
      },
    },
    { $match: { enElRango: { $gt: 0 } } },
    {
      $group: {
        _id: null,
        totalClientes: { $sum: 1 },
        nuevos: { $sum: { $cond: [desde ? { $gte: ['$primeraCompra', desde] } : true, 1, 0] } },
        conVariosPedidos: { $sum: { $cond: [{ $gte: ['$enElRango', 2] }, 1, 0] } },
      },
    },
  ]);

  const { totalClientes, nuevos, conVariosPedidos } = fila ?? { totalClientes: 0, nuevos: 0, conVariosPedidos: 0 };
  return {
    desde: desde ?? null,
    hasta: hasta ?? null,
    totalClientes,
    nuevos,
    recurrentes: totalClientes - nuevos,
    conVariosPedidos,
  };
}

// ── Compras de insumos ──────────────────────────────────────────────────────────────────────────────

interface Compra {
  /** El día de la compra, AAAA-MM-DD */
  fecha: string;
  /** Lo que pagó */
  precio: number;
  /** Cuánto vino, en su unidad. null en las compras cargadas antes de que existiera */
  cantidad: number | null;
  unidad: UnidadInsumo | null;
  /** precio / cantidad: lo que salió el kilo, el litro o la unidad. null si no tiene cantidad */
  precioPorUnidad: number | null;
}

type DatosDeCompra = Pick<IInsumo, 'fecha' | 'precio' | 'cantidad' | 'unidad'>;

const compraDe = ({ fecha, precio, cantidad, unidad }: DatosDeCompra): Compra => ({
  fecha,
  precio,
  cantidad: cantidad ?? null,
  unidad: unidad ?? null,
  precioPorUnidad: cantidad && unidad ? redondear(precio / cantidad) : null,
});

// El historial no dice si una actualización fue una compra nueva o una corrección: se deduce. El alta y cada
// actualización que cambió la fecha son compras; una que no cambió la fecha (el precio mal cargado, el nombre)
// corrige la última. Corregir una fecha mal cargada cuenta como otra compra: el dueño eligió no guardar el motivo.
// Del más viejo al más nuevo por fecha (y por orden de carga dentro del mismo día)
function comprasDe(insumo: DatosDeCompra & Pick<IInsumo, 'logs'>): Compra[] {
  if (insumo.logs.length === 0) return [compraDe(insumo)];
  const compras: Compra[] = [];
  // logs va del más nuevo al más viejo
  for (const log of [...insumo.logs].reverse()) {
    const compra = compraDe(log);
    if (log.accion === 'creacion' || log.cambios.includes('fecha') || compras.length === 0) compras.push(compra);
    else compras[compras.length - 1] = compra;
  }
  return compras.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));
}

const insumosConCompras = async () =>
  (await Insumo.find().select('nombre precio fecha cantidad unidad logs').lean()).map((insumo) => ({
    insumoId: String(insumo._id),
    nombre: insumo.nombre,
    compras: comprasDe(insumo),
  }));

// ── 10 y 11. Insumos: en qué se gasta más y cuánto aumentó cada uno ─────────────────────────────────

// En %. Por kilo, litro o unidad si las dos compras dicen cuánto vino en la misma unidad (10 kg a 20.000 y después
// 25 kg a 25.000 es −50%). Si ninguna lo dice (las cargadas antes), por precio: se asume la misma presentación.
// Si solo una lo dice, o en otra unidad, no se pueden comparar
function variacionEntre(anterior: Compra, ultima: Compra): number | null {
  if (anterior.cantidad && ultima.cantidad) {
    if (anterior.unidad !== ultima.unidad) return null;
    const antes = anterior.precio / anterior.cantidad;
    return porcentaje(ultima.precio / ultima.cantidad - antes, antes);
  }
  if (anterior.cantidad === null && ultima.cantidad === null) return porcentaje(ultima.precio - anterior.precio, anterior.precio);
  return null;
}

// Solo los insumos con alguna compra en el rango, del que más se gastó al que menos. La variación compara la última
// compra del rango con la anterior a ella, aunque sea de antes del rango: "la harina estaba 25.000 y ahora 30.000"
export async function insumos(rango: RangoDias) {
  const filas = (await insumosConCompras())
    .map(({ insumoId, nombre, compras }) => {
      const enElRango = compras.filter((compra) => dentroDelRango(compra.fecha, rango));
      if (enElRango.length === 0) return null;
      const ultimaCompra = enElRango[enElRango.length - 1];
      const compraAnterior = compras[compras.lastIndexOf(ultimaCompra) - 1] ?? null;
      return {
        insumoId,
        nombre,
        gastado: redondear(enElRango.reduce((suma, compra) => suma + compra.precio, 0)),
        compras: enElRango.length,
        ultimaCompra,
        compraAnterior,
        /** En %: cuánto subió (o bajó, negativo) la última compra respecto de la anterior. null si no se puede comparar */
        variacion: compraAnterior ? variacionEntre(compraAnterior, ultimaCompra) : null,
        /** Las compras del rango, de la más vieja a la más nueva: para el gráfico de cómo fue cambiando */
        precios: enElRango,
      };
    })
    .filter((fila) => fila !== null)
    .sort((a, b) => b.gastado - a.gastado || a.nombre.localeCompare(b.nombre, 'es'));

  return {
    desde: rango.desde ?? null,
    hasta: rango.hasta ?? null,
    totalGastado: redondear(filas.reduce((suma, fila) => suma + fila.gastado, 0)),
    totalCompras: filas.reduce((suma, fila) => suma + fila.compras, 0),
    insumos: filas,
  };
}

// ── 7 a 9. Balance: lo que entra por ventas, lo que sale en insumos y la ganancia ───────────────────

const DIA_MS = 24 * 60 * 60 * 1000;

function sumarDias(dia: string, dias: number): string {
  return new Date(Date.parse(`${dia}T00:00:00Z`) + dias * DIA_MS).toISOString().slice(0, 10);
}

// El período de un día: el mismo día, el lunes de su semana (AAAA-MM-DD) o el mes (AAAA-MM)
function periodoDe(dia: string, agrupar: Agrupacion): string {
  if (agrupar === 'dia') return dia;
  if (agrupar === 'mes') return dia.slice(0, 7);
  const diaDeLaSemana = new Date(`${dia}T00:00:00Z`).getUTCDay(); // 0 = domingo
  return sumarDias(dia, -((diaDeLaSemana + 6) % 7));
}

// Ganancia = lo que entra por ventas − lo que sale en insumos. No cuenta los insumos que sobran: es la cuenta
// simple que pidió el dueño. La serie trae todos los períodos del rango, también los que dieron 0, hasta hoy
export async function balance(rango: RangoDias, agrupar: Agrupacion) {
  const [ventasPorDia, conCompras] = await Promise.all([
    Pedido.aggregate<{ _id: string; ingresos: number; porCobrar: number; pedidos: number }>([
      ...ventasDelRango(rango),
      {
        $group: {
          _id: '$_dia',
          ingresos: { $sum: '$total' },
          // Lo que falta cobrar de los que no se entregaron todavía: el total menos la seña, si la hay
          porCobrar: {
            $sum: {
              $cond: [{ $eq: ['$estado', 'entregado'] }, 0, { $subtract: ['$total', { $ifNull: ['$sena.monto', 0] }] }],
            },
          },
          pedidos: { $sum: 1 },
        },
      },
    ]),
    insumosConCompras(),
  ]);
  const comprasDelRango = conCompras.flatMap(({ compras }) => compras.filter((compra) => dentroDelRango(compra.fecha, rango)));

  const porPeriodo = new Map<string, { ingresos: number; gastos: number }>();
  const sumar = (dia: string, campo: 'ingresos' | 'gastos', monto: number) => {
    const periodo = periodoDe(dia, agrupar);
    const valores = porPeriodo.get(periodo) ?? { ingresos: 0, gastos: 0 };
    valores[campo] += monto;
    porPeriodo.set(periodo, valores);
  };
  ventasPorDia.forEach((fila) => sumar(fila._id, 'ingresos', fila.ingresos));
  comprasDelRango.forEach((compra) => sumar(compra.fecha, 'gastos', compra.precio));

  // Desde el comienzo del rango (o el primer día con datos) hasta su final, sin pasar de hoy
  const dias = [...ventasPorDia.map((fila) => fila._id), ...comprasDelRango.map((compra) => compra.fecha)].sort();
  const hoy = hoyEnArgentina();
  const inicio = rango.desde ?? dias[0];
  const fin = rango.hasta && rango.hasta < hoy ? rango.hasta : hoy;
  const periodos: string[] = [];
  for (let dia = inicio; dia && dia <= fin; dia = sumarDias(dia, 1)) {
    const periodo = periodoDe(dia, agrupar);
    if (periodos[periodos.length - 1] !== periodo) periodos.push(periodo);
  }

  const ingresos = redondear(ventasPorDia.reduce((suma, fila) => suma + fila.ingresos, 0));
  const gastos = redondear(comprasDelRango.reduce((suma, compra) => suma + compra.precio, 0));
  return {
    desde: rango.desde ?? null,
    hasta: rango.hasta ?? null,
    agrupar,
    ingresos,
    gastos,
    ganancia: redondear(ingresos - gastos),
    porCobrar: redondear(ventasPorDia.reduce((suma, fila) => suma + fila.porCobrar, 0)),
    pedidos: ventasPorDia.reduce((suma, fila) => suma + fila.pedidos, 0),
    compras: comprasDelRango.length,
    serie: periodos.map((periodo) => {
      const valores = porPeriodo.get(periodo) ?? { ingresos: 0, gastos: 0 };
      return {
        periodo,
        ingresos: redondear(valores.ingresos),
        gastos: redondear(valores.gastos),
        ganancia: redondear(valores.ingresos - valores.gastos),
      };
    }),
  };
}
