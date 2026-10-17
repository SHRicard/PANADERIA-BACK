import type { ImageTransformationOptions, UploadApiOptions, UploadApiResponse } from 'cloudinary';
import multer from 'multer';
import cloudinary, { describirErrorCloudinary, Marca, marcaProductos, marcaPromos } from '../config/cloudinary';
import { MAX_IMAGENES_PRODUCTO } from '../models/Producto';
import type { TipoPromo } from '../models/Promo';
import { ErrorHttp } from '../utils/errores';

export const MB_POR_IMAGEN = 10;
export const MB_POR_VIDEO = 50;
const CAMPO_ARCHIVO_PROMO = 'archivo';

// La imagen se recibe en memoria y se envía directo a Cloudinary (no se guarda en disco)
const opciones: multer.Options = {
  storage: multer.memoryStorage(),
  limits: { fileSize: MB_POR_IMAGEN * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new ErrorHttp(400, 'Solo se permiten imágenes'));
    }
    cb(null, true);
  },
};

// Una imagen en el campo "imagen" (las fotos de productos que el front sube de a una)
export const subirImagen = multer(opciones).single('imagen');

// Varias imágenes en el campo "imagenes" (crear o editar un producto con todas sus fotos juntas)
export const subirImagenes = multer(opciones).array('imagenes', MAX_IMAGENES_PRODUCTO);

// Una foto o un video en el campo "archivo" (las promos). Multer tiene un solo límite por archivo: este es el del video
// y el de la foto lo revisa promosController. Un video de 15 s entra holgado en memoria
export const subirArchivoPromo = multer({
  ...opciones,
  limits: { fileSize: MB_POR_VIDEO * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/') && !file.mimetype.startsWith('video/')) {
      return cb(new ErrorHttp(400, 'Solo se permiten fotos o videos'));
    }
    cb(null, true);
  },
}).single(CAMPO_ARCHIVO_PROMO);

// Los mensajes de Multer vienen en inglés ("File too large"): estos son los que ve el dueño
export function mensajeDeMulter(error: multer.MulterError): string {
  if (error.code === 'LIMIT_FILE_SIZE') {
    return error.field === CAMPO_ARCHIVO_PROMO
      ? `Un video puede pesar hasta ${MB_POR_VIDEO} MB y una foto, hasta ${MB_POR_IMAGEN} MB`
      : `Cada imagen puede pesar hasta ${MB_POR_IMAGEN} MB`;
  }
  if (error.code === 'LIMIT_UNEXPECTED_FILE') {
    return (
      'Sobran archivos o vienen en un campo que no corresponde ("imagen" lleva una sola foto; ' +
      `"imagenes", hasta ${MAX_IMAGENES_PRODUCTO}; "${CAMPO_ARCHIVO_PROMO}", la foto o el video de una promo)`
    );
  }
  return 'No se pudo leer el archivo';
}

// En un overlay, las "/" del public_id se escriben con ":"; fl_relative hace que el ancho sea una fracción de la foto
// (o del video)
function pasosDeMarca(marca: Marca | null): ImageTransformationOptions[] {
  if (!marca) return [];
  return [
    { overlay: marca.publicId.replaceAll('/', ':'), width: marca.ancho, flags: 'relative', opacity: marca.opacidad },
    marca.posicion === 'centro'
      ? { flags: 'layer_apply', gravity: 'center' }
      : { flags: 'layer_apply', gravity: 'south_east', x: 20, y: 20 },
  ];
}

// Transformación ENTRANTE: Cloudinary la aplica antes de guardar y no conserva la original,
// así que la foto que queda guardada ya tiene la marca grabada (no se puede pedir sin marca por URL)
function transformacionAlSubir(marca: Marca | null): ImageTransformationOptions[] {
  return [{ width: 1200, crop: 'limit' }, ...pasosDeMarca(marca), { quality: 'auto' }];
}

const TRANSFORMACIONES = {
  productos: transformacionAlSubir(marcaProductos),
  promos: transformacionAlSubir(marcaPromos),
};

// Los videos de promos, también con la marca grabada: el lado más largo hasta 1280 (720p, vertical u horizontal),
// que alcanza para un estado de WhatsApp y gasta bastante menos que un 1080p
const TRANSFORMACION_VIDEO_PROMO = [{ width: 1280, height: 1280, crop: 'limit' }, ...pasosDeMarca(marcaPromos), { quality: 'auto' }];

const QUE_SE_SUBE = {
  image: { log: 'una foto', usuario: 'la foto' },
  video: { log: 'un video', usuario: 'el video' },
};

function subir(buffer: Buffer, recurso: 'image' | 'video', parametros: UploadApiOptions) {
  return new Promise<UploadApiResponse>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({ ...parametros, resource_type: recurso }, (error, result) => {
      if (error || !result) {
        console.error(`Cloudinary rechazó ${QUE_SE_SUBE[recurso].log}: ${describirErrorCloudinary(error)}`);
        return reject(new ErrorHttp(502, `No se pudo subir ${QUE_SE_SUBE[recurso].usuario}. Probá de nuevo en unos minutos.`));
      }
      resolve(result);
    });
    stream.end(buffer);
  });
}

export async function enviarACloudinary(buffer: Buffer, carpeta: keyof typeof TRANSFORMACIONES) {
  const resultado = await subir(buffer, 'image', { folder: `panaderia/${carpeta}`, transformation: TRANSFORMACIONES[carpeta] });
  return { url: resultado.secure_url, publicId: resultado.public_id };
}

// Las promos se comparten en el estado de WhatsApp: la foto se guarda como .jpg y el video como .mp4, formatos que
// WhatsApp acepta siempre (un .webp, por ejemplo, lo toma como sticker). Así la URL guardada es la que se descarga
// para compartir, sin transformaciones de entrega
export async function enviarPromoACloudinary(buffer: Buffer, tipo: TipoPromo) {
  const video = tipo === 'video';
  const resultado = await subir(buffer, video ? 'video' : 'image', {
    folder: 'panaderia/promos',
    format: video ? 'mp4' : 'jpg',
    transformation: video ? TRANSFORMACION_VIDEO_PROMO : TRANSFORMACIONES.promos,
    // Subir y procesar un video puede llevar más que el minuto que espera el SDK por defecto
    ...(video && { timeout: 180_000 }),
  });
  const { duration } = resultado;
  return {
    url: resultado.secure_url,
    publicId: resultado.public_id,
    duracionSegundos: typeof duration === 'number' ? Math.round(duration * 10) / 10 : undefined,
  };
}

// Copia una foto que YA está en nuestro Cloudinary, sin volver a grabarle la marca (ya la tiene).
// La usa el script de productos de ejemplo: cada producto necesita su propia copia, porque al eliminar
// un producto se borran sus fotos de Cloudinary y una foto compartida dejaría sin foto a los demás
export async function copiarEnCloudinary(url: string, carpeta: keyof typeof TRANSFORMACIONES) {
  // Solo fotos propias: una de afuera no tiene la marca de agua
  if (!url.startsWith(`https://res.cloudinary.com/${cloudinary.config().cloud_name}/image/upload/`)) {
    throw new Error('Solo se pueden copiar fotos de nuestro Cloudinary');
  }
  try {
    const resultado = await cloudinary.uploader.upload(url, { folder: `panaderia/${carpeta}`, resource_type: 'image' });
    return { url: resultado.secure_url, publicId: resultado.public_id };
  } catch (error) {
    console.error(`Cloudinary no pudo copiar una foto: ${describirErrorCloudinary(error)}`);
    throw new Error('No se pudo copiar la foto en Cloudinary');
  }
}

// Si falla no corta la operación (la foto ya salió de la base), pero queda en el log con su publicId
// para poder borrarla a mano y que no quede huérfana.
// Un video se borra con recurso "video": con el de imagen, Cloudinary responde "not found" sin error y quedaría huérfano
export async function borrarDeCloudinary(publicId?: string, recurso: 'image' | 'video' = 'image') {
  if (!publicId) return;
  try {
    // invalidate: la CDN deja de servirla en unos minutos, en vez de cuando venza su caché
    await cloudinary.uploader.destroy(publicId, { invalidate: true, resource_type: recurso });
  } catch (e) {
    console.error(`No se pudo borrar de Cloudinary ${QUE_SE_SUBE[recurso].usuario} "${publicId}": ${describirErrorCloudinary(e)}`);
  }
}
