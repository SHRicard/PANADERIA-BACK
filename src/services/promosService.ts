import { borrarDeCloudinary, enviarPromoACloudinary } from '../middleware/upload';
import { IPromo, MAX_SEGUNDOS_VIDEO, Promo, TipoPromo } from '../models/Promo';
import { ErrorHttp } from '../utils/errores';

export type DatosPromo = Pick<IPromo, 'titulo' | 'texto'>;

/** Lo que se puede editar sin volver a subir el archivo. texto: null lo borra */
export interface CambiosPromo {
  titulo?: string;
  texto?: string | null;
}

const NO_ENCONTRADO = 'No encontrado';

// El celular y Cloudinary no miden la duración igual: un video de 15 s en el celular puede dar 15,2 acá
const MARGEN_SEGUNDOS = 0.5;

const borrarArchivo = (tipo: TipoPromo, publicId: string) =>
  borrarDeCloudinary(publicId, tipo === 'video' ? 'video' : 'image');

// Toda la biblioteca, la más nueva primero. Es chica (lo que el dueño comparte seguido): no se pagina
export async function listar() {
  return Promo.find().sort({ createdAt: -1, _id: -1 });
}

// Valida antes de subir, así un dato inválido no gasta la subida, y si igual falla al guardar,
// borra el archivo que acaba de subir
export async function crear(datos: DatosPromo, tipo: TipoPromo, archivo: Buffer) {
  const promo = new Promo({ ...datos, tipo });
  await promo.validate(['tipo', 'titulo', 'texto']);

  const { url, publicId, duracionSegundos } = await enviarPromoACloudinary(archivo, tipo);
  // La duración recién se sabe cuando Cloudinary lo procesa: el front la revisa antes, para no gastar la subida
  if (tipo === 'video' && (duracionSegundos === undefined || duracionSegundos > MAX_SEGUNDOS_VIDEO + MARGEN_SEGUNDOS)) {
    await borrarArchivo(tipo, publicId);
    const cuanto = duracionSegundos === undefined ? '' : ` y este dura ${Math.round(duracionSegundos)}`;
    throw new ErrorHttp(400, `El video puede durar hasta ${MAX_SEGUNDOS_VIDEO} segundos${cuanto}`);
  }

  promo.set({ archivoUrl: url, archivoPublicId: publicId, duracionSegundos });
  try {
    await promo.save();
  } catch (e) {
    await borrarArchivo(tipo, publicId);
    throw e;
  }
  return promo;
}

// Título y texto, sin tocar el archivo (por ejemplo, si cambió un precio que dice el texto)
export async function editar(id: string, { titulo, texto }: CambiosPromo) {
  const $set: Partial<DatosPromo> = {};
  if (titulo !== undefined) $set.titulo = titulo;
  if (typeof texto === 'string') $set.texto = texto;
  const cambios = texto === null ? { $set, $unset: { texto: 1 } } : { $set };

  const promo = await Promo.findByIdAndUpdate(id, cambios, { returnDocument: 'after', runValidators: true });
  if (!promo) throw new ErrorHttp(404, NO_ENCONTRADO);
  return promo;
}

// El dueño tocó Compartir. Con $inc, dos a la vez no pierden una. Compartir no es editar la promo: no toca updatedAt
export async function registrarPublicacion(id: string) {
  const promo = await Promo.findByIdAndUpdate(
    id,
    { $inc: { vecesPublicada: 1 }, $set: { ultimaPublicacion: new Date() } },
    { returnDocument: 'after', timestamps: false }
  );
  if (!promo) throw new ErrorHttp(404, NO_ENCONTRADO);
  return promo;
}

// Primero la saca de la base y recién después borra el archivo: nunca queda una promo apuntando a un archivo borrado
export async function borrar(id: string) {
  const promo = await Promo.findByIdAndDelete(id);
  if (!promo) throw new ErrorHttp(404, NO_ENCONTRADO);
  await borrarArchivo(promo.tipo, promo.archivoPublicId);
}
