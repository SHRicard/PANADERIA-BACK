import { HydratedDocument } from 'mongoose';
import { borrarDeCloudinary, enviarACloudinary } from '../middleware/upload';
import { IImagen, IProducto, MAX_IMAGENES_PRODUCTO, Producto } from '../models/Producto';
import { ErrorHttp } from '../utils/errores';

// Las fotos no se editan por acá: se suben aparte (Buffer[]) y se borran de a una
export type DatosProducto = Partial<Omit<IProducto, 'imagenes'>>;

function borrarImagenes(imagenes: IImagen[]) {
  return Promise.all(imagenes.map((imagen) => borrarDeCloudinary(imagen.publicId)));
}

// Sube todas o ninguna: si una falla, borra las que ya se habían subido
async function subirImagenes(buffers: Buffer[]): Promise<IImagen[]> {
  const resultados = await Promise.allSettled(buffers.map((buffer) => enviarACloudinary(buffer, 'productos')));
  const subidas = resultados.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
  const fallida = resultados.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (fallida) {
    await borrarImagenes(subidas);
    throw fallida.reason;
  }
  return subidas;
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
    throw e;
  }
  return producto;
}

export function listar() {
  return Producto.find().sort({ categoria: 1, nombre: 1 });
}

export function crear(datos: DatosProducto, imagenes: Buffer[]) {
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

  producto.set(datos);
  return guardarConImagenes(producto, imagenesNuevas);
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
