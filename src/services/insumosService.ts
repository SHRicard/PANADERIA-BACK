import { PipelineStage, Types } from 'mongoose';
import { CAMPOS_INSUMO, IInsumo, Insumo, UNIDADES_INSUMO, UnidadInsumo } from '../models/Insumo';
import { SIN_MAYUSCULAS_NI_ACENTOS } from '../models/Producto';
import { ErrorHttp } from '../utils/errores';
import * as recetasService from './recetasService';

export type DatosInsumo = Pick<IInsumo, 'nombre' | 'precio' | 'fecha' | 'cantidad' | 'unidad'>;

const NO_ENCONTRADO = 'No encontrado';

const esNombreRepetido = (e: unknown) =>
  typeof e === 'object' && e !== null && 'code' in e && e.code === 11000 && 'keyPattern' in e &&
  typeof e.keyPattern === 'object' && e.keyPattern !== null && 'nombre' in e.keyPattern;

// El 409 dice cómo está guardado el otro: "harina 20 kg" choca con «HARINA 20 KG»
async function nombreRepetido(nombre: string) {
  const otro = await Insumo.findOne({ nombre }).collation(SIN_MAYUSCULAS_NI_ACENTOS).select('nombre').lean();
  const cual = otro ? `: «${otro.nombre}». Para cargar una compra nueva, actualizá ese` : '';
  return new ErrorHttp(409, `Ya existe un insumo con ese nombre${cual}`);
}

// "Chipá", "Chipá y Pan casero", "Chipá, Pan casero y Pizza"
const enLista = (nombres: string[]) =>
  nombres.length === 1 ? nombres[0] : `${nombres.slice(0, -1).join(', ')} y ${nombres.at(-1)}`;

// El 409 dice qué recetas lo usan, así el dueño sabe de dónde sacarlo
async function unidadEnUso(id: string, productos: string[]) {
  const insumo = await Insumo.findById(id).select('nombre').lean();
  if (!insumo) return new ErrorHttp(404, NO_ENCONTRADO);
  const recetas =
    productos.length === 1
      ? `lo usa la receta de ${productos[0]}. Sacalo de esa receta primero`
      : `lo usan las recetas de ${enLista(productos)}. Sacalo de esas recetas primero`;
  return new ErrorHttp(409, `No se puede cambiar la unidad de «${insumo.nombre}»: ${recetas}`);
}

// Las unidades a las que se puede pasar un insumo que está en alguna receta: las que en la receta se cargan igual
// (kg y l van los dos en gramos; unidad, en unidades)
const unidadesCompatibles = (unidad: UnidadInsumo) =>
  UNIDADES_INSUMO.filter((otra) => recetasService.unidadEnReceta(otra) === recetasService.unidadEnReceta(unidad));

// La lista, sin el historial (va en el detalle), por nombre
export async function listar() {
  return Insumo.find().select('-logs').sort({ nombre: 1, _id: 1 }).collation(SIN_MAYUSCULAS_NI_ACENTOS);
}

// Con todo el historial, la entrada más nueva primero
export async function obtener(id: string) {
  const insumo = await Insumo.findById(id);
  if (!insumo) throw new ErrorHttp(404, NO_ENCONTRADO);
  return insumo;
}

// El alta ya deja la primera entrada del historial
export async function crear(datos: DatosInsumo) {
  try {
    return await Insumo.create({ ...datos, logs: [{ accion: 'creacion', ...datos, cambios: [], registradoEn: new Date() }] });
  } catch (e) {
    throw esNombreRepetido(e) ? await nombreRepetido(datos.nombre) : e;
  }
}

// Cambia lo que viene (normalmente, una compra nueva: precio, fecha y, si cambió, cantidad y unidad) y suma al historial cómo quedó y qué cambió.
// Es UNA operación (pipeline): el cambio y su entrada en el historial no se pueden separar, y dos actualizaciones
// a la vez no se pisan. ❌ No lo pases a leer-cambiar-guardar. Si lo que vino es igual a lo guardado, no hay entrada
// nueva ni cambia updatedAt. El pipeline no pasa por los validadores: el controller valida antes
export async function actualizar(id: string, cambios: Partial<DatosInsumo>) {
  const nuevo = (campo: keyof DatosInsumo) => (cambios[campo] !== undefined ? { $literal: cambios[campo] } : `$${campo}`);
  const huboCambios = { $gt: [{ $size: '$_cambios' }, 0] };

  const pipeline: PipelineStage.Set[] = [
    {
      // Qué campos cambian de verdad. $literal: el nombre lo escribe el dueño, y un "$precio" se leería como un campo
      $set: {
        _cambios: {
          $concatArrays: CAMPOS_INSUMO.filter((campo) => cambios[campo] !== undefined).map((campo) => ({
            $cond: [{ $ne: [`$${campo}`, { $literal: cambios[campo] }] }, [campo], []],
          })),
        },
      },
    },
    {
      $set: {
        nombre: nuevo('nombre'),
        precio: nuevo('precio'),
        fecha: nuevo('fecha'),
        // Un insumo de antes que no la tiene y no la recibe sigue sin tenerla: "$cantidad" de un campo que no existe no lo crea
        cantidad: nuevo('cantidad'),
        unidad: nuevo('unidad'),
        logs: {
          $cond: [
            huboCambios,
            {
              $concatArrays: [
                [
                  {
                    _id: { $literal: new Types.ObjectId() },
                    accion: 'actualizacion',
                    nombre: nuevo('nombre'),
                    precio: nuevo('precio'),
                    fecha: nuevo('fecha'),
                    cantidad: nuevo('cantidad'),
                    unidad: nuevo('unidad'),
                    cambios: '$_cambios',
                    registradoEn: '$$NOW',
                  },
                ],
                '$logs',
              ],
            },
            '$logs',
          ],
        },
        updatedAt: { $cond: [huboCambios, '$$NOW', '$updatedAt'] },
      },
    },
  ];

  // Mientras una receta lo use, no se le puede cambiar la unidad: sus cantidades están en gramos o en unidades según
  // esa unidad (1000 g de harina no son 1000 unidades). Si ninguna lo usa, se puede corregir, y un insumo de antes
  // que no la tiene nunca está en una receta. El cambio va condicionado en el mismo filtro del update
  const usanElInsumo = cambios.unidad ? await recetasService.productosQueUsan(id) : [];
  const filtro =
    cambios.unidad && usanElInsumo.length
      ? { _id: id, unidad: { $in: unidadesCompatibles(cambios.unidad) } }
      : { _id: id };

  try {
    const insumo = await Insumo.findOneAndUpdate(filtro, [...pipeline, { $unset: '_cambios' }], {
      updatePipeline: true,
      returnDocument: 'after',
      // updatedAt lo pone el pipeline: solo si hubo cambios
      timestamps: false,
    });
    if (!insumo) throw usanElInsumo.length ? await unidadEnUso(id, usanElInsumo) : new ErrorHttp(404, NO_ENCONTRADO);
    return insumo;
  } catch (e) {
    throw esNombreRepetido(e) && cambios.nombre ? await nombreRepetido(cambios.nombre) : e;
  }
}
