import { HydratedDocument, Types } from 'mongoose';
import { borrarDeCloudinary, enviarACloudinary } from '../middleware/upload';
import {
  CATEGORIAS,
  Categoria,
  IImagen,
  IProducto,
  IRecomendacion,
  MAX_IMAGENES_PRODUCTO,
  MAX_RECOMENDACIONES_PRODUCTO,
  Producto,
  SIN_MAYUSCULAS_NI_ACENTOS,
} from '../models/Producto';
import { Tipo } from '../models/Tipo';
import { ErrorHttp } from '../utils/errores';
import { Paginado } from '../utils/paginado';
import { regexSinAcentos } from '../utils/texto';

// Las fotos no se editan por acá: se suben aparte (Buffer[]) y se borran de a una.
// Las recomendaciones y su resumen tampoco: las deja la web y el dueño solo las borra
export type DatosProducto = Partial<
  Omit<IProducto, 'imagenes' | 'recomendaciones' | 'puntajePromedio' | 'cantidadRecomendaciones'>
>;

export type DatosRecomendacion = Omit<IRecomendacion, 'createdAt'>;

// Todas las respuestas traen el tipo como { _id, nombre }: el producto guarda solo el id. Si lo borraron, sale null
const CON_TIPO = { path: 'tipo', select: 'nombre' };

function borrarImagenes(imagenes: IImagen[]) {
  return Promise.all(imagenes.map((imagen) => borrarDeCloudinary(imagen.publicId)));
}

// De a 2: con 10 fotos todas juntas, Render (plan gratis) se queda corto de red y de memoria
const SUBIDAS_A_LA_VEZ = 2;

// Sube todas o ninguna, respetando el orden (la primera es la portada).
// Si una falla, no arranca las que faltan y borra las que ya se habían subido
async function subirImagenes(buffers: Buffer[]): Promise<IImagen[]> {
  const subidas: IImagen[] = [];
  let siguiente = 0;
  let fallo: { error: unknown } | undefined;

  async function subirLasQueQuedan() {
    while (!fallo && siguiente < buffers.length) {
      const indice = siguiente++;
      try {
        subidas[indice] = await enviarACloudinary(buffers[indice], 'productos');
      } catch (error) {
        fallo ??= { error };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(SUBIDAS_A_LA_VEZ, buffers.length) }, subirLasQueQuedan));

  if (fallo) {
    await borrarImagenes(subidas.filter(Boolean));
    throw fallo.error;
  }
  return subidas;
}

// Responde con el nombre como está guardado y, si está pausado, lo avisa: es el caso del pan dulce en diciembre,
// que no aparece en "Activos" y hay que reactivarlo en vez de crearlo de nuevo
function nombreRepetido(otro?: { nombre: string; disponible: boolean }) {
  if (!otro) return new ErrorHttp(409, 'Ya existe un producto con ese nombre');
  const pausado = otro.disponible ? '' : ' Está pausado: activalo en vez de crear otro.';
  return new ErrorHttp(409, `Ya existe un producto con ese nombre: «${otro.nombre}».${pausado}`);
}

// También antes de subir fotos. Si lo borran justo después, el producto queda apuntando a un tipo que no existe
// y sale como sin tipo (null): no traba nada
async function revisarTipo(tipo: Types.ObjectId | null | undefined) {
  if (tipo && !(await Tipo.exists({ _id: tipo }))) throw new ErrorHttp(400, 'Ese tipo ya no existe: elegí otro');
}

// Antes de subir fotos, para no gastar la subida. El índice único igual lo frena si dos llegan a la vez
async function revisarNombreLibre(nombre: string, id?: string) {
  const filtro: Record<string, unknown> = { nombre };
  if (id) filtro._id = { $ne: id };
  const otro = await Producto.findOne(filtro).collation(SIN_MAYUSCULAS_NI_ACENTOS).select('nombre disponible');
  if (otro) throw nombreRepetido(otro);
}

const esNombreRepetido = (e: unknown) =>
  typeof e === 'object' && e !== null && 'code' in e && e.code === 11000 && 'keyPattern' in e &&
  typeof e.keyPattern === 'object' && e.keyPattern !== null && 'nombre' in e.keyPattern;

const productoLleno = () => new ErrorHttp(400, `Un producto puede tener hasta ${MAX_IMAGENES_PRODUCTO} fotos`);
// Tiene lugar si no existe la foto número 10 (índice 9)
const conLugar = (id: string) => ({ _id: id, [`imagenes.${MAX_IMAGENES_PRODUCTO - 1}`]: { $exists: false } });

async function errorSinLugar(id: string) {
  return (await Producto.exists({ _id: id })) ? productoLleno() : new ErrorHttp(404, 'No encontrado');
}

// Valida antes de subir, así un dato inválido no deja fotos huérfanas en Cloudinary,
// y si igual falla al guardar, borra las que acaba de subir
async function guardarConImagenes(producto: HydratedDocument<IProducto>, buffers: Buffer[]) {
  await producto.validate();
  const subidas = await subirImagenes(buffers);
  producto.imagenes.push(...subidas);
  try {
    await producto.save();
  } catch (e) {
    await borrarImagenes(subidas);
    throw esNombreRepetido(e) ? nombreRepetido() : e;
  }
  return producto.populate(CON_TIPO);
}

export interface FiltrosProductos {
  /** Una parte del nombre, sin importar mayúsculas ni acentos */
  buscar?: string;
  categoria?: Categoria;
  tipo?: Types.ObjectId;
  /** true = activos, false = pausados */
  disponible?: boolean;
}

function filtroDe({ buscar, categoria, tipo, disponible }: FiltrosProductos) {
  const filtro: Record<string, unknown> = {};
  if (buscar) filtro.nombre = regexSinAcentos(buscar);
  if (categoria) filtro.categoria = categoria;
  if (tipo) filtro.tipo = tipo;
  if (disponible !== undefined) filtro.disponible = disponible;
  return filtro;
}

// El orden de las listas: como la lista de gustos (Dulce, Salado…) y por nombre dentro de cada uno
const ORDEN_CATEGORIA = { $indexOfArray: [CATEGORIAS, '$categoria'] };

// Una página, ordenada como la lista de gustos y por nombre dentro de cada uno.
// Va el _id al final para que el orden no cambie entre páginas cuando dos se llaman igual
export async function listar(filtros: FiltrosProductos, { pagina, limite }: Paginado) {
  const filtro = filtroDe(filtros);

  const [encontrados, totalProductos] = await Promise.all([
    Producto.aggregate<IProducto>([
      { $match: filtro },
      { $addFields: { ordenCategoria: ORDEN_CATEGORIA } },
      { $sort: { ordenCategoria: 1, nombre: 1, _id: 1 } },
      { $skip: (pagina - 1) * limite },
      { $limit: limite },
      // Las recomendaciones van solo en el detalle: en la lista alcanza con puntajePromedio y cantidadRecomendaciones
      { $project: { ordenCategoria: 0, 'imagenes.publicId': 0, recomendaciones: 0 } },
    ]).collation(SIN_MAYUSCULAS_NI_ACENTOS), // "árbol" junto a "Arroz", no después de la Z
    Producto.countDocuments(filtro),
  ]);
  // hydrate: para que cada foto salga con el toJSON del esquema ({ id, url, miniatura }).
  // Con la proyección no le pone "recomendaciones: []" por defecto, que haría parecer que no tiene
  const productos = encontrados.map((producto) => Producto.hydrate(producto, { recomendaciones: 0 }));
  // Los tipos de toda la página, en una sola consulta
  await Producto.populate(productos, CON_TIPO);
  return {
    productos,
    pagina,
    limite,
    totalProductos,
    totalPaginas: Math.ceil(totalProductos / limite),
  };
}

export interface TipoDeSeccion {
  _id: Types.ObjectId;
  nombre: string;
}

export interface Seccion {
  /** null = los productos sin tipo */
  tipo: TipoDeSeccion | null;
  productos: HydratedDocument<IProducto>[];
}

// La carta de la web: todos los que coinciden, sin paginar, agrupados por tipo. Es UNA consulta: el $lookup trae el
// tipo de cada producto y Mongo los ordena por su nombre (con la collation, como GET /api/tipos), los sin tipo al
// final, y dentro de cada tipo como listar. Acá solo se cortan en secciones
export async function listarSecciones(filtros: FiltrosProductos): Promise<Seccion[]> {
  const encontrados = await Producto.aggregate<Omit<IProducto, 'tipo'> & { tipo: TipoDeSeccion | null }>([
    { $match: filtroDe(filtros) },
    {
      $lookup: {
        from: Tipo.collection.name,
        localField: 'tipo',
        foreignField: '_id',
        pipeline: [{ $project: { nombre: 1 } }],
        as: 'tipo',
      },
    },
    // Si el tipo ya no existe (lo borraron y el producto todavía tiene el id), va con los sin tipo
    { $set: { tipo: { $ifNull: [{ $first: '$tipo' }, null] }, ordenCategoria: ORDEN_CATEGORIA } },
    { $set: { sinTipo: { $eq: ['$tipo', null] } } },
    { $sort: { sinTipo: 1, 'tipo.nombre': 1, 'tipo._id': 1, ordenCategoria: 1, nombre: 1, _id: 1 } },
    { $project: { sinTipo: 0, ordenCategoria: 0, 'imagenes.publicId': 0, recomendaciones: 0 } },
  ]).collation(SIN_MAYUSCULAS_NI_ACENTOS);

  const secciones: Seccion[] = [];
  let tipoActual: string | undefined;
  for (const encontrado of encontrados) {
    // Vienen ordenados por tipo: cada vez que cambia, empieza otra sección
    const tipo = encontrado.tipo ? String(encontrado.tipo._id) : '';
    if (tipo !== tipoActual) {
      secciones.push({ tipo: encontrado.tipo, productos: [] });
      tipoActual = tipo;
    }
    // hydratedPopulatedDocs: el tipo que trajo el $lookup sale como si estuviera populado ({ _id, nombre })
    secciones[secciones.length - 1].productos.push(
      Producto.hydrate(encontrado, { recomendaciones: 0 }, { hydratedPopulatedDocs: true })
    );
  }
  return secciones;
}

// Todas las categorías, en orden, con cuántos productos activos tiene cada una
export async function contarPorCategoria() {
  const grupos = await Producto.aggregate<{ _id: string; cantidad: number }>([
    { $match: { disponible: true } },
    { $group: { _id: '$categoria', cantidad: { $sum: 1 } } },
  ]);
  const cantidades = new Map(grupos.map(({ _id, cantidad }) => [_id, cantidad]));
  return CATEGORIAS.map((nombre) => ({ nombre, cantidad: cantidades.get(nombre) ?? 0 }));
}

// Las opciones de los filtros de la web: los tipos y los gustos con al menos un producto activo, con cuántos tiene
// cada uno. Sin aplicar filtros, así al elegir uno los demás siguen apareciendo
export async function opcionesDeFiltros() {
  const [tipos, categorias] = await Promise.all([
    Producto.aggregate<TipoDeSeccion & { cantidad: number }>([
      { $match: { disponible: true, tipo: { $ne: null } } },
      { $group: { _id: '$tipo', cantidad: { $sum: 1 } } },
      { $lookup: { from: Tipo.collection.name, localField: '_id', foreignField: '_id', as: 'tipo' } },
      // Un tipo que ya no existe (algún producto todavía con su id) no sale
      { $unwind: '$tipo' },
      { $project: { nombre: '$tipo.nombre', cantidad: 1 } },
      { $sort: { nombre: 1, _id: 1 } },
    ]).collation(SIN_MAYUSCULAS_NI_ACENTOS),
    contarPorCategoria(),
  ]);
  return { tipos, categorias: categorias.filter(({ cantidad }) => cantidad > 0) };
}

// El dueño ve el producto aunque esté pausado (el catálogo público no)
export async function obtener(id: string) {
  const producto = await Producto.findById(id).populate(CON_TIPO);
  if (!producto) throw new ErrorHttp(404, 'No encontrado');
  return producto;
}

// Para el catálogo público: solo si está activo
export async function obtenerDisponible(id: string) {
  const producto = await Producto.findOne({ _id: id, disponible: true }).select('-imagenes.publicId').populate(CON_TIPO);
  if (!producto) throw new ErrorHttp(404, 'No encontrado');
  return producto;
}

export async function crear(datos: DatosProducto, imagenes: Buffer[]) {
  if (datos.nombre) await revisarNombreLibre(datos.nombre);
  await revisarTipo(datos.tipo);
  return guardarConImagenes(new Producto(datos), imagenes);
}

// Edita los datos y suma las fotos nuevas a las que ya tiene
export async function editar(id: string, datos: DatosProducto, imagenesNuevas: Buffer[]) {
  const producto = await Producto.findById(id);
  if (!producto) throw new ErrorHttp(404, 'No encontrado');

  if (producto.imagenes.length + imagenesNuevas.length > MAX_IMAGENES_PRODUCTO) {
    throw new ErrorHttp(
      400,
      `Un producto puede tener hasta ${MAX_IMAGENES_PRODUCTO} fotos y este ya tiene ${producto.imagenes.length}`
    );
  }

  if (datos.nombre) await revisarNombreLibre(datos.nombre, id);
  await revisarTipo(datos.tipo);
  producto.set(datos);
  return guardarConImagenes(producto, imagenesNuevas);
}

// Agrega UNA foto. Es lo que usa el front para subir en segundo plano, de a una o dos a la vez:
// el tope se revisa en la misma operación que la agrega, así dos pedidos simultáneos no lo pasan
export async function agregarImagen(id: string, buffer: Buffer) {
  // Antes de subir, para no gastar la subida si ya no hay lugar
  if (!(await Producto.exists(conLugar(id)))) throw await errorSinLugar(id);

  const imagen = { _id: new Types.ObjectId(), ...(await enviarACloudinary(buffer, 'productos')) };
  const producto = await Producto.findOneAndUpdate(
    conLugar(id),
    { $push: { imagenes: imagen } },
    { returnDocument: 'after', projection: { imagenes: { $elemMatch: { _id: imagen._id } } } }
  );
  if (!producto) {
    // Mientras se subía, lo borraron o se llenó con otras fotos
    await borrarDeCloudinary(imagen.publicId);
    throw await errorSinLugar(id);
  }
  return producto.imagenes[0];
}

// Pasa la foto al primer lugar. Es una sola operación (atómica): si la cola del front está subiendo
// otras fotos de este producto en ese momento, no se pisan. ❌ No lo pases a leer-reordenar-guardar
export async function hacerPortada(id: string, imagenId: string) {
  const foto = new Types.ObjectId(imagenId);
  const esLaFoto = { $eq: ['$$imagen._id', foto] };
  const producto = await Producto.findOneAndUpdate(
    { _id: id, 'imagenes._id': foto },
    [
      {
        $set: {
          imagenes: {
            $concatArrays: [
              { $filter: { input: '$imagenes', as: 'imagen', cond: esLaFoto } },
              { $filter: { input: '$imagenes', as: 'imagen', cond: { $not: [esLaFoto] } } },
            ],
          },
        },
      },
    ],
    // El pipeline (array) va directo a Mongo: por eso el id se convierte a mano arriba
    { returnDocument: 'after', updatePipeline: true }
  ).populate(CON_TIPO);
  if (!producto) throw new ErrorHttp(404, 'No encontrado');
  return producto;
}

export async function borrar(id: string) {
  const producto = await Producto.findByIdAndDelete(id);
  if (!producto) throw new ErrorHttp(404, 'No encontrado');
  await borrarImagenes(producto.imagenes);
}

// Primero la saca del producto y recién después la borra de Cloudinary: nunca queda apuntando a una foto borrada
export async function borrarImagen(id: string, imagenId: string) {
  // Con "imagenes.$" Mongo trae solo la foto que coincide
  const producto = await Producto.findOne({ _id: id, 'imagenes._id': imagenId }, { 'imagenes.$': 1 });
  const imagen = producto?.imagenes[0];
  if (!imagen) throw new ErrorHttp(404, 'No encontrado');

  await Producto.updateOne({ _id: id }, { $pull: { imagenes: { _id: imagenId } } });
  await borrarDeCloudinary(imagen.publicId);
}

// Recalcula el resumen con las recomendaciones que quedaron, en la misma operación que las cambia
const RECALCULAR_RESUMEN = {
  $set: {
    puntajePromedio: { $round: [{ $avg: '$recomendaciones.puntaje' }, 1] },
    cantidadRecomendaciones: { $size: '$recomendaciones' },
  },
};

// Una sola operación (atómica): la pone primera, descarta las que pasan del tope y recalcula el promedio.
// Si llegan dos a la vez, ninguna pisa a la otra. ❌ No lo pases a leer-agregar-guardar.
// Solo productos activos: uno pausado no sale en el catálogo
export async function agregarRecomendacion(id: string, datos: DatosRecomendacion) {
  const nueva = { _id: new Types.ObjectId(), ...datos, createdAt: new Date() };
  const producto = await Producto.findOneAndUpdate(
    { _id: id, disponible: true },
    [
      {
        $set: {
          recomendaciones: {
            $slice: [
              // $literal: el texto lo escribe cualquiera, y en un pipeline un "$nombre" se leería como un campo
              { $concatArrays: [[{ $literal: nueva }], { $ifNull: ['$recomendaciones', []] }] },
              MAX_RECOMENDACIONES_PRODUCTO,
            ],
          },
        },
      },
      RECALCULAR_RESUMEN,
    ],
    {
      returnDocument: 'after',
      updatePipeline: true,
      // Que alguien comente no es una edición del producto
      timestamps: false,
      projection: { recomendaciones: { $elemMatch: { _id: nueva._id } }, puntajePromedio: 1, cantidadRecomendaciones: 1 },
    }
  );
  if (!producto) throw new ErrorHttp(404, 'No encontrado');
  return {
    recomendacion: producto.recomendaciones[0],
    puntajePromedio: producto.puntajePromedio,
    cantidadRecomendaciones: producto.cantidadRecomendaciones,
  };
}

// También en una sola operación: la saca y recalcula el promedio
export async function borrarRecomendacion(id: string, recomendacionId: string) {
  // El pipeline va directo a Mongo: por eso el id se convierte a mano
  const recomendacion = new Types.ObjectId(recomendacionId);
  const resultado = await Producto.updateOne(
    { _id: id, 'recomendaciones._id': recomendacion },
    [
      {
        $set: {
          recomendaciones: {
            $filter: { input: '$recomendaciones', as: 'r', cond: { $ne: ['$$r._id', recomendacion] } },
          },
        },
      },
      RECALCULAR_RESUMEN,
    ],
    { updatePipeline: true, timestamps: false }
  );
  if (resultado.matchedCount === 0) throw new ErrorHttp(404, 'No encontrado');
}
