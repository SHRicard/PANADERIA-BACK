import { HydratedDocument, Types } from 'mongoose';
import { borrarDeCloudinary, enviarACloudinary } from '../middleware/upload';
import {
  CATEGORIAS,
  Categoria,
  IImagen,
  IProducto,
  MAX_IMAGENES_PRODUCTO,
  Producto,
  SIN_MAYUSCULAS_NI_ACENTOS,
} from '../models/Producto';
import { ErrorHttp } from '../utils/errores';
import { Paginado } from '../utils/paginado';
import { regexSinAcentos } from '../utils/texto';

// Las fotos no se editan por acá: se suben aparte (Buffer[]) y se borran de a una
export type DatosProducto = Partial<Omit<IProducto, 'imagenes'>>;

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
  return producto;
}

export interface FiltrosProductos {
  /** Una parte del nombre, sin importar mayúsculas ni acentos */
  buscar?: string;
  categoria?: Categoria;
  /** true = activos, false = pausados */
  disponible?: boolean;
}

// Una página, ordenada como la lista de categorías (Panes, Facturas…) y por nombre dentro de cada una.
// Va el _id al final para que el orden no cambie entre páginas cuando dos se llaman igual
export async function listar({ buscar, categoria, disponible }: FiltrosProductos, { pagina, limite }: Paginado) {
  const filtro: Record<string, unknown> = {};
  if (buscar) filtro.nombre = regexSinAcentos(buscar);
  if (categoria) filtro.categoria = categoria;
  if (disponible !== undefined) filtro.disponible = disponible;

  const [encontrados, totalProductos] = await Promise.all([
    Producto.aggregate<IProducto>([
      { $match: filtro },
      { $addFields: { ordenCategoria: { $indexOfArray: [CATEGORIAS, '$categoria'] } } },
      { $sort: { ordenCategoria: 1, nombre: 1, _id: 1 } },
      { $skip: (pagina - 1) * limite },
      { $limit: limite },
      { $project: { ordenCategoria: 0, 'imagenes.publicId': 0 } },
    ]).collation(SIN_MAYUSCULAS_NI_ACENTOS), // "árbol" junto a "Arroz", no después de la Z
    Producto.countDocuments(filtro),
  ]);
  return {
    // hydrate: para que cada foto salga con el toJSON del esquema ({ id, url, miniatura })
    productos: encontrados.map((producto) => Producto.hydrate(producto)),
    pagina,
    limite,
    totalProductos,
    totalPaginas: Math.ceil(totalProductos / limite),
  };
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

// El dueño ve el producto aunque esté pausado (el catálogo público no)
export async function obtener(id: string) {
  const producto = await Producto.findById(id);
  if (!producto) throw new ErrorHttp(404, 'No encontrado');
  return producto;
}

// Para el catálogo público: solo si está activo
export async function obtenerDisponible(id: string) {
  const producto = await Producto.findOne({ _id: id, disponible: true }).select('-imagenes.publicId');
  if (!producto) throw new ErrorHttp(404, 'No encontrado');
  return producto;
}

export async function crear(datos: DatosProducto, imagenes: Buffer[]) {
  if (datos.nombre) await revisarNombreLibre(datos.nombre);
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
  );
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
