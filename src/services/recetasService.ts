import { Types } from 'mongoose';
import { IInsumo, Insumo, UnidadInsumo } from '../models/Insumo';
import { Producto } from '../models/Producto';
import { IIngredienteReceta, IReceta, Receta, UnidadReceta } from '../models/Receta';
import { ErrorHttp } from '../utils/errores';
import { olvidarCatalogo } from './productosService';
import { sinAcentos } from '../utils/texto';

export type IngredienteNuevo =
  | { insumo: string; cantidad: number }
  | { insumo: null; nombre: string; unidad: UnidadReceta; cantidad: number };

export interface DatosReceta {
  rinde: number;
  ingredientes: IngredienteNuevo[];
}

const SIN_RECETA = 'Este producto todavía no tiene receta';
const SIN_COSTO = 'No se pudo calcular lo que cuesta algún ingrediente: revisá sus insumos';
// Del producto, la receta trae el nombre y el precio de venta (para compararlo con lo que cuesta hacerlo)
const CAMPOS_PRODUCTO = 'nombre precio';

type InsumoParaCosto = Pick<IInsumo, 'nombre' | 'precio' | 'cantidad' | 'unidad'> & { _id: Types.ObjectId };
type DatosProducto = { _id: Types.ObjectId; nombre: string; precio: number };
type ProductoPoblado = DatosProducto | null;

// El dueño pesa todo, también los líquidos (1 l ≈ 1 kg): kg y l se cargan en gramos, y lo que va por unidad, en unidades
export const unidadEnReceta = (unidad: UnidadInsumo): UnidadReceta => (unidad === 'unidad' ? 'unidad' : 'g');

const redondear = (valor: number) => Math.round(valor * 100) / 100;

// Lo que cuesta un ingrediente con el ÚLTIMO precio del insumo (lo que costaría reponerlo hoy). Lo que no se compra
// (el agua) cuesta 0. null si no se puede calcular: el insumo ya no existe, no tiene cantidad, o su unidad no
// corresponde a la de la receta (no debería pasar: no se le puede cambiar la unidad mientras una receta lo use)
function costoDe(ingrediente: IIngredienteReceta, insumo: InsumoParaCosto | undefined): number | null {
  if (!ingrediente.insumo) return 0;
  if (!insumo?.cantidad || !insumo.unidad || unidadEnReceta(insumo.unidad) !== ingrediente.unidad) return null;
  // El precio es de toda la bolsa: 25 kg a $25.000 son $1 el gramo
  const cuantoTrae = insumo.unidad === 'unidad' ? insumo.cantidad : insumo.cantidad * 1000;
  return redondear((insumo.precio / cuantoTrae) * ingrediente.cantidad);
}

const insumosDe = (recetas: Pick<IReceta, 'ingredientes'>[]) =>
  buscarInsumos(recetas.flatMap((receta) => receta.ingredientes.flatMap((i) => (i.insumo ? [i.insumo] : []))));

async function buscarInsumos(ids: (Types.ObjectId | string)[]) {
  const insumos = ids.length
    ? await Insumo.find({ _id: { $in: ids } }).select('nombre precio cantidad unidad').lean<InsumoParaCosto[]>()
    : [];
  return new Map(insumos.map((insumo) => [String(insumo._id), insumo]));
}

// La receta como la ve la app: el nombre del insumo sale del insumo, y el costo se calcula cada vez (no se guarda),
// así una compra más cara de harina cambia el costo de todas las recetas que la usan
function armar(
  receta: IReceta & { createdAt: Date; updatedAt: Date },
  producto: DatosProducto,
  insumos: Map<string, InsumoParaCosto>
) {
  const ingredientes = receta.ingredientes.map((ingrediente) => {
    const insumo = ingrediente.insumo ? insumos.get(String(ingrediente.insumo)) : undefined;
    return {
      insumo: ingrediente.insumo ? String(ingrediente.insumo) : null,
      // Hoy no hay forma de borrar un insumo: el "ya no existe" es por las dudas
      nombre: ingrediente.insumo ? (insumo?.nombre ?? 'Insumo que ya no existe') : (ingrediente.nombre ?? ''),
      cantidad: ingrediente.cantidad,
      unidad: ingrediente.unidad,
      costo: costoDe(ingrediente, insumo),
    };
  });
  const costos = ingredientes.map((ingrediente) => ingrediente.costo);
  // El total es la suma de los costos tal como se muestran, así las cuentas de la pantalla cierran
  const costoTotal = costos.every((costo) => costo !== null)
    ? redondear(costos.reduce<number>((suma, costo) => suma + (costo ?? 0), 0))
    : null;
  return {
    producto: { _id: producto._id, nombre: producto.nombre, precio: producto.precio },
    rinde: receta.rinde,
    ingredientes,
    costoTotal,
    costoPorUnidad: costoTotal === null ? null : redondear(costoTotal / receta.rinde),
    multiplicador: receta.multiplicador ?? null,
    redondeo: receta.redondeo ?? null,
    createdAt: receta.createdAt,
    updatedAt: receta.updatedAt,
  };
}

type RecetaGuardada = IReceta & { createdAt: Date; updatedAt: Date };

// Todas las recetas, por nombre del producto, con su costo pero sin los ingredientes (van en el detalle)
export async function listar() {
  const recetas = await Receta.find()
    .populate<{ producto: ProductoPoblado }>('producto', CAMPOS_PRODUCTO)
    .lean<(Omit<RecetaGuardada, 'producto'> & { producto: ProductoPoblado })[]>();
  const insumos = await insumosDe(recetas);
  const porNombre = new Intl.Collator('es', { sensitivity: 'base' });

  return (
    recetas
      // Una receta cuyo producto se borró justo mientras se guardaba: no se muestra
      .flatMap((receta) => (receta.producto ? [{ receta, producto: receta.producto }] : []))
      .map(({ receta, producto }) => {
        const { ingredientes, ...resto } = armar({ ...receta, producto: producto._id }, producto, insumos);
        return { ...resto, cantidadIngredientes: ingredientes.length };
      })
      .sort((a, b) => porNombre.compare(a.producto.nombre, b.producto.nombre))
  );
}

async function buscar(productoId: string) {
  const receta = await Receta.findOne({ producto: productoId })
    .populate<{ producto: ProductoPoblado }>('producto', CAMPOS_PRODUCTO)
    .lean<Omit<RecetaGuardada, 'producto'> & { producto: ProductoPoblado }>();
  if (!receta?.producto) throw new ErrorHttp(404, SIN_RECETA);
  return { receta: { ...receta, producto: receta.producto._id }, producto: receta.producto };
}

export async function obtener(productoId: string) {
  const { receta, producto } = await buscar(productoId);
  return armar(receta, producto, await insumosDe([receta]));
}

// Cuánto hace falta de cada ingrediente para hacer `unidades` (lo pide el dueño: "tengo que hacer 24 chipás"). Cada
// cantidad se multiplica por unidades / rinde y se redondea PARA ARRIBA al entero: con una receta de 12 y 30 chipás
// (×2,5), 3 huevos pasan a 8, no a 7, porque es mejor que sobre a que falte. El costo es el de esas cantidades, con
// el último precio de cada insumo. No guarda nada
export async function paraHacer(productoId: string, unidades: number) {
  const { receta, producto } = await buscar(productoId);
  const ingredientes = receta.ingredientes.map((ingrediente) => ({
    ...ingrediente,
    // Primero la multiplicación (enteros, exacta) y después la división: 1000 × 24 / 12 da 2000 justo
    cantidad: Math.ceil((ingrediente.cantidad * unidades) / receta.rinde),
  }));
  const escalada = armar({ ...receta, ingredientes }, producto, await insumosDe([receta]));
  return {
    producto: escalada.producto,
    rinde: receta.rinde,
    unidades,
    // Cuántas veces la receta: 24 de una receta de 12 son 2. Con dos decimales (25 de 12 son 2,08)
    veces: redondear(unidades / receta.rinde),
    // Cuáles no daban justo y se redondearon para arriba (7,5 huevos → 8), para que la app lo diga en ese ingrediente
    ingredientes: escalada.ingredientes.map((ingrediente, indice) => ({
      ...ingrediente,
      redondeado: (receta.ingredientes[indice].cantidad * unidades) % receta.rinde !== 0,
    })),
    costoTotal: escalada.costoTotal,
  };
}

// La primera vez la crea y después la reemplaza entera. La unidad de cada insumo la pone el servidor, según el insumo
export async function guardar(productoId: string, datos: DatosReceta) {
  const producto = await Producto.findById(productoId).select(CAMPOS_PRODUCTO).lean<DatosProducto>();
  if (!producto) throw new ErrorHttp(404, 'No encontrado');

  const insumos = await buscarInsumos(datos.ingredientes.flatMap((i) => (i.insumo ? [i.insumo] : [])));

  const vistos = new Set<string>();
  const ingredientes: IIngredienteReceta[] = datos.ingredientes.map((nuevo) => {
    let ingrediente: IIngredienteReceta;
    let nombre: string;
    if (nuevo.insumo !== null) {
      const insumo = insumos.get(nuevo.insumo);
      if (!insumo) throw new ErrorHttp(400, 'Uno de los insumos ya no existe: elegí otro');
      // Sin saber cuánto trae la bolsa no se sabe si "1000" son gramos o unidades, ni cuánto cuesta
      if (!insumo.cantidad || !insumo.unidad) {
        throw new ErrorHttp(400, `Completá cuánto trae «${insumo.nombre}» (cantidad y unidad) antes de usarlo en una receta`);
      }
      nombre = insumo.nombre;
      ingrediente = { insumo: insumo._id, cantidad: nuevo.cantidad, unidad: unidadEnReceta(insumo.unidad) };
    } else {
      nombre = nuevo.nombre;
      ingrediente = { insumo: null, nombre: nuevo.nombre, cantidad: nuevo.cantidad, unidad: nuevo.unidad };
    }
    // El mismo insumo dos veces, o "Agua" y "agua": se suma la cantidad en una sola línea
    const clave = sinAcentos(nombre.trim());
    if (vistos.has(clave)) throw new ErrorHttp(400, `«${nombre}» está dos veces en la receta: sumá las cantidades en uno`);
    vistos.add(clave);
    return ingrediente;
  });

  // Con el índice único en producto, dos guardados a la vez no crean dos recetas (Mongo reintenta el upsert)
  const receta = await Receta.findOneAndUpdate(
    { producto: producto._id },
    { $set: { rinde: datos.rinde, ingredientes } },
    { upsert: true, returnDocument: 'after', runValidators: true }
  ).lean<RecetaGuardada>();
  if (!receta) throw new Error('No se pudo guardar la receta');
  return armar(receta, producto, insumos);
}

/** El precio de venta: lo que cuesta cada unidad por el multiplicador, redondeado al peso. La app hace la misma cuenta */
export const precioDeVenta = (costoPorUnidad: number, multiplicador: number) => Math.round(costoPorUnidad * multiplicador);

/** Al múltiplo de `redondeo` de arriba ($ 11.691 con 1000 → $ 12.000): nunca gana menos de lo que eligió */
export const redondearPrecio = (precio: number, redondeo: number) => Math.ceil(precio / redondeo) * redondeo;

// Le pone al producto el precio que sale de su receta: lo que cuesta HOY cada unidad (con el último precio de cada
// insumo) por el multiplicador que eligió el dueño y, si quiere, redondeado para arriba. El multiplicador y el
// redondeo quedan en la receta, para proponérselos la próxima vez (por ejemplo, cuando aumenta la harina)
export async function ponerPrecio(productoId: string, multiplicador: number, redondeo: number | null) {
  const receta = await obtener(productoId);
  if (receta.costoPorUnidad === null) throw new ErrorHttp(409, SIN_COSTO);
  const exacto = precioDeVenta(receta.costoPorUnidad, multiplicador);
  // Una receta de cosas que no se compran (o casi gratis) da $ 0, y el producto no puede costar 0. Se mira antes de
  // redondear: si no, $ 0,40 × 2 con redondeo de 10 pasaría como $ 10
  if (exacto <= 0) {
    throw new ErrorHttp(409, 'Con lo que cuesta esta receta, el precio da $ 0: ponelo a mano desde Editar producto');
  }
  const precio = redondeo === null ? exacto : redondearPrecio(exacto, redondeo);

  const producto = await Producto.findByIdAndUpdate(productoId, { $set: { precio } }, { returnDocument: 'after', runValidators: true })
    .select(CAMPOS_PRODUCTO)
    .lean<DatosProducto>();
  if (!producto) throw new ErrorHttp(404, 'No encontrado');
  // El precio sale en la carta
  olvidarCatalogo();
  // Elegir el precio no es editar la receta: no le cambia updatedAt
  await Receta.updateOne(
    { producto: producto._id },
    redondeo === null ? { $set: { multiplicador }, $unset: { redondeo: 1 } } : { $set: { multiplicador, redondeo } },
    { timestamps: false, runValidators: true }
  );
  // Con el costo con el que se calculó el precio (si justo cambió un insumo, la próxima consulta trae el nuevo)
  return { ...receta, producto: { _id: producto._id, nombre: producto.nombre, precio: producto.precio }, multiplicador, redondeo };
}

export async function borrar(productoId: string) {
  const { deletedCount } = await Receta.deleteOne({ producto: productoId });
  if (deletedCount === 0) throw new ErrorHttp(404, SIN_RECETA);
}

// Los productos cuyas recetas usan este insumo, por nombre: no se le puede cambiar la unidad mientras alguna lo use
export async function productosQueUsan(insumoId: string) {
  const recetas = await Receta.find({ 'ingredientes.insumo': insumoId })
    .select('producto')
    .populate<{ producto: { nombre: string } | null }>('producto', 'nombre')
    .lean<{ producto: { nombre: string } | null }[]>();
  const porNombre = new Intl.Collator('es', { sensitivity: 'base' });
  return recetas.flatMap((receta) => (receta.producto ? [receta.producto.nombre] : [])).sort(porNombre.compare);
}
