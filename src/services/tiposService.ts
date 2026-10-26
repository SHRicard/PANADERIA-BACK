import { HydratedDocument, Types } from 'mongoose';
import { Producto, SIN_MAYUSCULAS_NI_ACENTOS } from '../models/Producto';
import { ITipo, Tipo } from '../models/Tipo';
import { ErrorHttp } from '../utils/errores';

const NO_ENCONTRADO = 'No encontrado';

const esNombreRepetido = (e: unknown) =>
  typeof e === 'object' && e !== null && 'code' in e && e.code === 11000 && 'keyPattern' in e &&
  typeof e.keyPattern === 'object' && e.keyPattern !== null && 'nombre' in e.keyPattern;

// El 409 dice cómo está guardado el otro: "tortas" choca con «Tortas»
async function nombreRepetido(nombre: string) {
  const otro = await Tipo.findOne({ nombre }).collation(SIN_MAYUSCULAS_NI_ACENTOS).select('nombre').lean();
  return new ErrorHttp(409, otro ? `Ya existe un tipo con ese nombre: «${otro.nombre}»` : 'Ya existe un tipo con ese nombre');
}

// Todas las respuestas traen cuántos productos lo usan (activos y pausados): la app lo avisa antes de borrarlo
const conCantidad = (tipo: HydratedDocument<ITipo>, cantidadProductos: number) => ({ ...tipo.toJSON(), cantidadProductos });

// Por nombre, con cuántos productos tiene cada uno (calculado al vuelo, sin contadores guardados)
export async function listar() {
  const [tipos, grupos] = await Promise.all([
    Tipo.find().sort({ nombre: 1, _id: 1 }).collation(SIN_MAYUSCULAS_NI_ACENTOS),
    Producto.aggregate<{ _id: Types.ObjectId; cantidad: number }>([
      { $match: { tipo: { $ne: null } } },
      { $group: { _id: '$tipo', cantidad: { $sum: 1 } } },
    ]),
  ]);
  const cantidades = new Map(grupos.map(({ _id, cantidad }) => [String(_id), cantidad]));
  return tipos.map((tipo) => conCantidad(tipo, cantidades.get(String(tipo._id)) ?? 0));
}

export async function crear(nombre: string) {
  try {
    return conCantidad(await Tipo.create({ nombre }), 0);
  } catch (e) {
    throw esNombreRepetido(e) ? await nombreRepetido(nombre) : e;
  }
}

// Los productos guardan el id: el nombre nuevo sale en todos sin tocarlos
export async function renombrar(id: string, nombre: string) {
  let tipo: HydratedDocument<ITipo> | null;
  try {
    tipo = await Tipo.findByIdAndUpdate(id, { nombre }, { returnDocument: 'after', runValidators: true });
  } catch (e) {
    throw esNombreRepetido(e) ? await nombreRepetido(nombre) : e;
  }
  if (!tipo) throw new ErrorHttp(404, NO_ENCONTRADO);
  return conCantidad(tipo, await Producto.countDocuments({ tipo: tipo._id }));
}

// Los productos que lo usaban quedan sin tipo (es opcional): no se borra ninguno. Primero se borra el tipo, así
// productosService ya no deja asignarlo mientras se limpian los productos
export async function borrar(id: string) {
  const tipo = await Tipo.findByIdAndDelete(id);
  if (!tipo) throw new ErrorHttp(404, NO_ENCONTRADO);
  await Producto.updateMany({ tipo: tipo._id }, { $set: { tipo: null } });
}
