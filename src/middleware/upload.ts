import type { ImageTransformationOptions } from 'cloudinary';
import multer from 'multer';
import cloudinary, { describirErrorCloudinary, Marca, marcaProductos, marcaPromos } from '../config/cloudinary';
import { MAX_IMAGENES_PRODUCTO } from '../models/Producto';
import { ErrorHttp } from '../utils/errores';

const MB_POR_IMAGEN = 10;

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

// Una imagen en el campo "imagen" (promos, y las fotos de productos que el front sube de a una)
export const subirImagen = multer(opciones).single('imagen');

// Varias imágenes en el campo "imagenes" (crear o editar un producto con todas sus fotos juntas)
export const subirImagenes = multer(opciones).array('imagenes', MAX_IMAGENES_PRODUCTO);

// Los mensajes de Multer vienen en inglés ("File too large"): estos son los que ve el dueño
export function mensajeDeMulter(error: multer.MulterError): string {
  if (error.code === 'LIMIT_FILE_SIZE') return `Cada imagen puede pesar hasta ${MB_POR_IMAGEN} MB`;
  if (error.code === 'LIMIT_UNEXPECTED_FILE') {
    return `Sobran imágenes o vienen en un campo que no corresponde ("imagen" lleva una sola; "imagenes", hasta ${MAX_IMAGENES_PRODUCTO})`;
  }
  return 'No se pudo leer la imagen';
}

// Transformación ENTRANTE: Cloudinary la aplica antes de guardar y no conserva la original,
// así que la foto que queda guardada ya tiene la marca grabada (no se puede pedir sin marca por URL)
function transformacionAlSubir(marca: Marca | null): ImageTransformationOptions[] {
  const pasos: ImageTransformationOptions[] = [{ width: 1200, crop: 'limit' }];
  if (marca) {
    pasos.push(
      // En un overlay, las "/" del public_id se escriben con ":"; fl_relative hace que el ancho sea una fracción de la foto
      { overlay: marca.publicId.replaceAll('/', ':'), width: marca.ancho, flags: 'relative', opacity: marca.opacidad },
      marca.posicion === 'centro'
        ? { flags: 'layer_apply', gravity: 'center' }
        : { flags: 'layer_apply', gravity: 'south_east', x: 20, y: 20 }
    );
  }
  pasos.push({ quality: 'auto' });
  return pasos;
}

const TRANSFORMACIONES = {
  productos: transformacionAlSubir(marcaProductos),
  promos: transformacionAlSubir(marcaPromos),
};

export function enviarACloudinary(buffer: Buffer, carpeta: keyof typeof TRANSFORMACIONES) {
  return new Promise<{ url: string; publicId: string }>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: `panaderia/${carpeta}`,
        resource_type: 'image',
        transformation: TRANSFORMACIONES[carpeta],
      },
      (error, result) => {
        if (error || !result) {
          console.error(`Cloudinary rechazó una foto: ${describirErrorCloudinary(error)}`);
          return reject(new ErrorHttp(502, 'No se pudo subir la foto. Probá de nuevo en unos minutos.'));
        }
        resolve({ url: result.secure_url, publicId: result.public_id });
      }
    );
    stream.end(buffer);
  });
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
// para poder borrarla a mano y que no quede huérfana
export async function borrarDeCloudinary(publicId?: string) {
  if (!publicId) return;
  try {
    // invalidate: la CDN deja de servirla en unos minutos, en vez de cuando venza su caché
    await cloudinary.uploader.destroy(publicId, { invalidate: true });
  } catch (e) {
    console.error(`No se pudo borrar de Cloudinary la foto "${publicId}": ${describirErrorCloudinary(e)}`);
  }
}
