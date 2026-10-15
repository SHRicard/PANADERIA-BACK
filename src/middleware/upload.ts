import multer from 'multer';
import cloudinary from '../config/cloudinary';
import { MAX_IMAGENES_PRODUCTO } from '../models/Producto';
import { ErrorHttp } from '../utils/errores';

// La imagen se recibe en memoria y se envía directo a Cloudinary (no se guarda en disco)
const opciones: multer.Options = {
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB cada una
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new ErrorHttp(400, 'Solo se permiten imágenes'));
    }
    cb(null, true);
  },
};

// Una imagen en el campo "imagen" (promos)
export const subirImagen = multer(opciones).single('imagen');

// Varias imágenes en el campo "imagenes" (productos)
export const subirImagenes = multer(opciones).array('imagenes', MAX_IMAGENES_PRODUCTO);

// Los mensajes de Multer vienen en inglés ("File too large"): estos son los que ve el dueño
export function mensajeDeMulter(error: multer.MulterError): string {
  if (error.code === 'LIMIT_FILE_SIZE') return 'Cada imagen puede pesar hasta 5 MB';
  if (error.code === 'LIMIT_UNEXPECTED_FILE') {
    return `Sobran imágenes (máximo ${MAX_IMAGENES_PRODUCTO}) o vienen en un campo que no corresponde`;
  }
  return 'No se pudo leer la imagen';
}

export function enviarACloudinary(buffer: Buffer, carpeta: string) {
  return new Promise<{ url: string; publicId: string }>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: `panaderia/${carpeta}`,
        resource_type: 'image',
        transformation: [{ width: 1200, crop: 'limit', quality: 'auto', fetch_format: 'auto' }],
      },
      (error, result) => {
        if (error || !result) return reject(error ?? new Error('Falló la subida'));
        resolve({ url: result.secure_url, publicId: result.public_id });
      }
    );
    stream.end(buffer);
  });
}

export async function borrarDeCloudinary(publicId?: string) {
  if (publicId) await cloudinary.uploader.destroy(publicId).catch(() => undefined);
}
