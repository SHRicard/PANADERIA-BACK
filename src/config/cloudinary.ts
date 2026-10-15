import { v2 as cloudinary } from 'cloudinary';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export default cloudinary;

/** Logo que se graba en las fotos al subirlas */
export interface Marca {
  /** public_id del logo en Cloudinary, por ejemplo "marca/logo" */
  publicId: string;
  posicion: 'centro' | 'esquina';
  /** Fracción del ancho de la foto */
  ancho: number;
  /** De 10 a 100 */
  opacidad: number;
}

export const ID_MARCA_POR_DEFECTO = 'marca/logo';

const CREDENCIALES = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'];

const leer = (nombre: string) => (process.env[nombre] ?? '').trim();

// Los problemas se juntan acá y se informan al arrancar: así se ven todos juntos y nunca con su valor
const problemasDeMarca: string[] = [];

function numeroEnRango(nombre: string, porDefecto: number, min: number, max: number, entero = false): number {
  const texto = leer(nombre);
  if (!texto) return porDefecto;
  const valor = Number(texto);
  if (Number.isFinite(valor) && valor >= min && valor <= max && (!entero || Number.isInteger(valor))) return valor;
  problemasDeMarca.push(`${nombre} tiene que ser un número${entero ? ' entero' : ''} entre ${min} y ${max}`);
  return porDefecto;
}

function leerMarcaDeProductos(): Marca | null {
  const posicion = leer('WATERMARK_POSICION').toLowerCase() || 'esquina';
  if (posicion !== 'centro' && posicion !== 'esquina') {
    problemasDeMarca.push('WATERMARK_POSICION tiene que ser "centro" o "esquina"');
  }
  const ancho = numeroEnRango('WATERMARK_ANCHO', 0.22, 0.1, 0.7);
  const opacidad = numeroEnRango('WATERMARK_OPACIDAD', 85, 10, 100, true);

  const publicId = leer('CLOUDINARY_WATERMARK_ID');
  if (!publicId) return null;
  return { publicId, posicion: posicion === 'centro' ? 'centro' : 'esquina', ancho, opacidad };
}

/** Marca de las fotos de productos (variables WATERMARK_*), o null si CLOUDINARY_WATERMARK_ID está vacía */
export const marcaProductos = leerMarcaDeProductos();

/** Las promos llevan el mismo logo, pero siempre en la esquina, más chico y más transparente */
export const marcaPromos: Marca | null = marcaProductos && {
  publicId: marcaProductos.publicId,
  posicion: 'esquina',
  ancho: 0.2,
  opacidad: 60,
};

/** Credenciales que faltan, con el nombre de la variable (nunca el valor) */
export function credencialesFaltantes(): string[] {
  return CREDENCIALES.filter((nombre) => !leer(nombre)).map((nombre) => `Falta ${nombre} en el .env`);
}

/** Lo que impide arrancar la API: credenciales que faltan y valores de WATERMARK_* fuera de rango */
export function problemasDeConfiguracion(): string[] {
  return [...credencialesFaltantes(), ...problemasDeMarca];
}

function datosDelError(e: unknown): { mensaje: string; codigo?: number } {
  // La API de administración envuelve el error en { error }; la de subida lo devuelve directo
  const error = typeof e === 'object' && e !== null && 'error' in e ? e.error : e;
  if (typeof error !== 'object' || error === null) return { mensaje: 'error desconocido' };
  const mensaje = 'message' in error && typeof error.message === 'string' ? error.message : 'error desconocido';
  const codigo = 'http_code' in error && typeof error.http_code === 'number' ? error.http_code : undefined;
  return { mensaje, codigo };
}

/**
 * Texto para loguear un error de Cloudinary. El error entero nunca se imprime: trae el secret en
 * request_options, y algunos mensajes repiten la api_key (por eso se tapa).
 */
export function describirErrorCloudinary(e: unknown): string {
  let { mensaje, codigo } = datosDelError(e);
  for (const clave of [leer('CLOUDINARY_API_KEY'), leer('CLOUDINARY_API_SECRET')]) {
    if (clave) mensaje = mensaje.replaceAll(clave, '***');
  }
  return codigo ? `${codigo} ${mensaje}` : mensaje;
}

/**
 * Si hay marca configurada, revisa que el logo exista en Cloudinary. Solo avisa, nunca corta el arranque:
 * sin el logo, Cloudinary rechaza las subidas con marca, pero el resto de la API anda.
 */
export async function comprobarMarca(): Promise<void> {
  if (!marcaProductos) return;
  try {
    await cloudinary.api.resource(marcaProductos.publicId);
  } catch (e) {
    if (datosDelError(e).codigo === 404) {
      console.warn(
        `⚠ El logo de la marca ("${marcaProductos.publicId}") no existe en Cloudinary: corré "npm run subir-marca". ` +
          'Hasta entonces no se van a poder subir fotos.'
      );
    } else {
      console.warn(`⚠ No se pudo comprobar el logo de la marca en Cloudinary: ${describirErrorCloudinary(e)}`);
    }
  }
}
