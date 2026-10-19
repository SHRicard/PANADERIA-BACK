import { Types } from 'mongoose';
import cloudinary, { describirErrorCloudinary } from '../config/cloudinary';
import { IImagen, IProducto, Producto } from '../models/Producto';
import { miniaturaDePromo, Promo, TipoPromo } from '../models/Promo';
import { urlMiniatura } from '../utils/cloudinaryUrl';
import { ErrorHttp } from '../utils/errores';
import { Paginado } from '../utils/paginado';

/** Qué tan cerca está la cuenta de Cloudinary del límite de créditos del plan */
export const NIVELES_USO = ['ok', 'atencion', 'critico', 'excedido'] as const;
export type NivelUso = (typeof NIVELES_USO)[number];

// Desde qué porcentaje de créditos usados empieza cada nivel. Cloudinary aconseja cambiar de plan si se usa
// el 80% o más todo el tiempo, y si se pasa del 100% termina deshabilitando la cuenta: no se suben ni se ven
// las fotos del catálogo
const PORCENTAJE_ATENCION = 75;
const PORCENTAJE_CRITICO = 90;
const PORCENTAJE_EXCEDIDO = 100;

export interface UsoCloudinary {
  /** Nombre del plan, por ejemplo "Free" */
  plan: string;
  nivel: NivelUso;
  /** El límite del plan. Un crédito = 1 GB guardado, 1 GB entregado o 1000 transformaciones */
  creditos: { usados: number; limite: number; restantes: number; porcentaje: number };
  /** Lo guardado ahora (fotos, videos y sus versiones) */
  almacenamiento: { bytes: number; creditos: number };
  /** Lo entregado en los últimos 30 días (las fotos que se ven en la web y en la app) */
  anchoDeBanda: { bytes: number; creditos: number };
  /** Versiones generadas en los últimos 30 días (marca de agua, miniaturas, formatos) */
  transformaciones: { cantidad: number; creditos: number };
  /** Fotos y videos subidos */
  archivos: number;
  /** Versiones generadas de esos archivos */
  derivados: number;
  /** Día del último cálculo de Cloudinary (AAAA-MM-DD): no actualiza los números en el momento */
  actualizadoAl: string | null;
  /** Cuándo le preguntó este servidor a Cloudinary (la respuesta se guarda unos minutos) */
  consultadoEn: string;
}

const NO_SE_PUDO_CONSULTAR = 'No se pudo consultar el uso de Cloudinary. Probá de nuevo en unos minutos.';

const objeto = (valor: unknown): Record<string, unknown> =>
  typeof valor === 'object' && valor !== null ? (valor as Record<string, unknown>) : {};

const numero = (valor: unknown) => (typeof valor === 'number' && Number.isFinite(valor) ? valor : 0);

const redondear = (valor: number) => Math.round(valor * 100) / 100;

// Cloudinary a veces informa créditos negativos en un rubro (un ajuste suyo, ya descontado del total):
// en el desglose cuentan como 0
const creditosDelRubro = (rubro: Record<string, unknown>) => redondear(Math.max(0, numero(rubro.credits_usage)));

function nivelDe(porcentaje: number): NivelUso {
  if (porcentaje >= PORCENTAJE_EXCEDIDO) return 'excedido';
  if (porcentaje >= PORCENTAJE_CRITICO) return 'critico';
  if (porcentaje >= PORCENTAJE_ATENCION) return 'atencion';
  return 'ok';
}

function armarUso(respuesta: unknown): UsoCloudinary {
  const datos = objeto(respuesta);
  const totales = objeto(datos.credits);
  const limite = numero(totales.limit);
  // Los planes viejos de Cloudinary miden cada rubro por separado, sin créditos: no hay contra qué medir
  if (limite <= 0) {
    console.error('Cloudinary no informó el límite de créditos del plan');
    throw new ErrorHttp(502, NO_SE_PUDO_CONSULTAR);
  }
  const usados = Math.max(0, numero(totales.usage));
  const porcentaje = redondear((usados / limite) * 100);
  const almacenamiento = objeto(datos.storage);
  const anchoDeBanda = objeto(datos.bandwidth);
  const transformaciones = objeto(datos.transformations);

  return {
    plan: typeof datos.plan === 'string' ? datos.plan : 'Desconocido',
    nivel: nivelDe(porcentaje),
    creditos: { usados: redondear(usados), limite, restantes: redondear(Math.max(0, limite - usados)), porcentaje },
    almacenamiento: { bytes: numero(almacenamiento.usage), creditos: creditosDelRubro(almacenamiento) },
    anchoDeBanda: { bytes: numero(anchoDeBanda.usage), creditos: creditosDelRubro(anchoDeBanda) },
    transformaciones: { cantidad: numero(transformaciones.usage), creditos: creditosDelRubro(transformaciones) },
    archivos: numero(datos.resources),
    derivados: numero(datos.derived_resources),
    actualizadoAl: typeof datos.last_updated === 'string' ? datos.last_updated : null,
    consultadoEn: new Date().toISOString(),
  };
}

// Cloudinary recalcula estos números cada tanto y su API de administración permite 500 consultas por hora
// en el plan gratis: la respuesta se guarda unos minutos, así abrir la pantalla seguido no gasta consultas.
// Si Render reinicia se pierde, y la próxima vez se vuelve a preguntar
const DURACION_CACHE_MS = 10 * 60 * 1000;
let enCache: { uso: UsoCloudinary; venceEn: number } | null = null;
// Dos pedidos a la vez comparten la misma consulta
let consultaEnCurso: Promise<UsoCloudinary> | null = null;

async function consultar(): Promise<UsoCloudinary> {
  let respuesta: unknown;
  try {
    respuesta = await cloudinary.api.usage();
  } catch (e) {
    console.error(`No se pudo consultar el uso de Cloudinary: ${describirErrorCloudinary(e)}`);
    throw new ErrorHttp(502, NO_SE_PUDO_CONSULTAR);
  }
  const uso = armarUso(respuesta);
  enCache = { uso, venceEn: Date.now() + DURACION_CACHE_MS };
  return uso;
}

export function obtener(): Promise<UsoCloudinary> {
  if (enCache && enCache.venceEn > Date.now()) return Promise.resolve(enCache.uso);
  consultaEnCurso ??= consultar().finally(() => {
    consultaEnCurso = null;
  });
  return consultaEnCurso;
}

// ── Lo que ocupa cada archivo, para que el dueño elija qué borrar ────────────────────────────────

/** De dónde sale el archivo: una foto de un producto o el archivo de una promo */
export const ORIGENES_ARCHIVO = ['producto', 'promo'] as const;
export type OrigenArchivo = (typeof ORIGENES_ARCHIVO)[number];

interface DatosDelArchivo {
  bytes: number;
  miniatura: string;
  /** Cuándo se subió a Cloudinary (ISO) */
  subidoEn: string;
}

/** Se borra con DELETE /api/productos/:productoId/imagenes/:imagenId */
export interface FotoDeProducto extends DatosDelArchivo {
  origen: 'producto';
  productoId: string;
  imagenId: string;
  /** El nombre del producto */
  nombre: string;
  /** Si es la primera foto del producto */
  portada: boolean;
  /** false = el producto está pausado */
  disponible: boolean;
}

/** Se borra con DELETE /api/promos/:promoId (la promo entera: tiene un solo archivo) */
export interface ArchivoDePromo extends DatosDelArchivo {
  origen: 'promo';
  promoId: string;
  titulo: string;
  tipo: TipoPromo;
}

export type ArchivoAlmacenado = FotoDeProducto | ArchivoDePromo;

export interface ListaArchivos {
  /** Lo que más ocupa primero */
  archivos: ArchivoAlmacenado[];
  pagina: number;
  limite: number;
  totalArchivos: number;
  totalPaginas: number;
  /** Lo que ocupan todos (con el filtro de origen), no solo los de esta página */
  totalBytes: number;
}

const NO_SE_PUDO_MEDIR = 'No se pudo consultar cuánto ocupa cada archivo en Cloudinary. Probá de nuevo en unos minutos.';

// Lo que ocupa un archivo no cambia nunca (cada subida tiene su propio publicId, y no se pisan): se le pregunta
// a Cloudinary una sola vez por archivo y se recuerda mientras el servidor esté prendido. Así la lista se puede
// pedir seguido (y de a páginas) sin gastar consultas de la API de administración, salvo por lo recién subido
const medidos = new Map<string, { bytes: number; subidoEn: string }>();

// Lo máximo que acepta resources_by_ids por consulta
const IDS_POR_CONSULTA = 100;

async function medir(publicIds: string[], tipo: 'image' | 'video'): Promise<void> {
  const faltan = publicIds.filter((publicId) => !medidos.has(publicId));
  for (let i = 0; i < faltan.length; i += IDS_POR_CONSULTA) {
    try {
      const { resources } = await cloudinary.api.resources_by_ids(faltan.slice(i, i + IDS_POR_CONSULTA), {
        resource_type: tipo,
      });
      for (const recurso of resources) {
        medidos.set(recurso.public_id, { bytes: recurso.bytes, subidoEn: recurso.created_at });
      }
    } catch (e) {
      console.error(`No se pudo medir los archivos en Cloudinary: ${describirErrorCloudinary(e)}`);
      throw new ErrorHttp(502, NO_SE_PUDO_MEDIR);
    }
  }
}

// Con lean, las fotos traen su _id (el id de la foto en las respuestas), que IImagen no declara
type ProductoConFotos = Pick<IProducto, 'nombre' | 'disponible'> & {
  _id: Types.ObjectId;
  imagenes: (IImagen & { _id: Types.ObjectId })[];
};

export async function listarArchivos(origen: OrigenArchivo | undefined, { pagina, limite }: Paginado): Promise<ListaArchivos> {
  const [productos, promos] = await Promise.all([
    origen === 'promo' ? [] : Producto.find({}, { nombre: 1, disponible: 1, imagenes: 1 }).lean<ProductoConFotos[]>(),
    origen === 'producto' ? [] : Promo.find({}, { titulo: 1, tipo: 1, archivoUrl: 1, archivoPublicId: 1 }).lean(),
  ]);

  await Promise.all([
    medir(productos.flatMap(({ imagenes }) => imagenes.map(({ publicId }) => publicId)), 'image'),
    medir(promos.filter(({ tipo }) => tipo === 'imagen').map(({ archivoPublicId }) => archivoPublicId), 'image'),
    medir(promos.filter(({ tipo }) => tipo === 'video').map(({ archivoPublicId }) => archivoPublicId), 'video'),
  ]);

  // Un archivo que la base tiene pero Cloudinary no (lo borraron a mano) no se puede medir: no sale
  const archivos: ArchivoAlmacenado[] = [];
  for (const producto of productos) {
    producto.imagenes.forEach((imagen, indice) => {
      const medida = medidos.get(imagen.publicId);
      if (!medida) return;
      archivos.push({
        origen: 'producto',
        productoId: String(producto._id),
        imagenId: String(imagen._id),
        nombre: producto.nombre,
        portada: indice === 0,
        disponible: producto.disponible,
        bytes: medida.bytes,
        miniatura: urlMiniatura(imagen.url),
        subidoEn: medida.subidoEn,
      });
    });
  }
  for (const promo of promos) {
    const medida = medidos.get(promo.archivoPublicId);
    if (!medida) continue;
    archivos.push({
      origen: 'promo',
      promoId: String(promo._id),
      titulo: promo.titulo,
      tipo: promo.tipo,
      bytes: medida.bytes,
      miniatura: miniaturaDePromo(promo),
      subidoEn: medida.subidoEn,
    });
  }

  // Lo que más ocupa primero; a igual tamaño, lo más nuevo. Así el orden es estable entre páginas
  archivos.sort((a, b) => b.bytes - a.bytes || b.subidoEn.localeCompare(a.subidoEn));

  return {
    archivos: archivos.slice((pagina - 1) * limite, pagina * limite),
    pagina,
    limite,
    totalArchivos: archivos.length,
    totalPaginas: Math.ceil(archivos.length / limite),
    totalBytes: archivos.reduce((total, { bytes }) => total + bytes, 0),
  };
}
