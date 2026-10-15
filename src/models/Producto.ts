import { Schema, model } from 'mongoose';
import { urlMiniatura, urlOptimizada } from '../utils/cloudinaryUrl';
import { sinAcentos } from '../utils/texto';

export const MAX_IMAGENES_PRODUCTO = 10;

// La categoría es el GUSTO del producto: una lista fija, en el orden en que se muestran, para que
// nunca haya "Dulce" y "dulse". Con esto se van a armar las métricas de qué gusto se vende más.
// Para sumar uno, agregalo acá. Renombrar o quitar uno que ya se usa obliga a migrar sus productos
export const CATEGORIAS = ['Dulce', 'Salado', 'Agridulce', 'Ácido', 'Amargo', 'Picante'] as const;
export type Categoria = (typeof CATEGORIAS)[number];

export const CATEGORIA_INVALIDA = `La categoría tiene que ser una de: ${CATEGORIAS.join(', ')}`;

// Compara textos en español sin importar mayúsculas ni acentos ("Tarta de limón" = "TARTA DE LIMON").
// La ñ sigue siendo distinta de la n
export const SIN_MAYUSCULAS_NI_ACENTOS = { locale: 'es', strength: 1 } as const;

// Acepta "dulce" o "ACIDO" y devuelve cómo se guarda; undefined si no es de la lista
export function buscarCategoria(valor: unknown): Categoria | undefined {
  if (typeof valor !== 'string') return undefined;
  const buscada = sinAcentos(valor.trim().replace(/\s+/g, ' '));
  return CATEGORIAS.find((categoria) => sinAcentos(categoria) === buscada);
}

export interface IImagen {
  url: string;
  publicId: string;
}

export interface IProducto {
  nombre: string;
  descripcion?: string;
  ingredientes: string[];
  pesoGramos?: number;
  precio: number;
  categoria: Categoria;
  /** false = pausado (por ejemplo, el pan dulce fuera de temporada): no sale en el catálogo ni se puede pedir */
  disponible: boolean;
  /** La primera es la portada */
  imagenes: IImagen[];
}

// Un precio o un peso en 0 o negativo es un error de carga
const mayorQueCero = { validator: (valor: number) => valor > 0, message: '{PATH} tiene que ser mayor que 0' };

// Cada foto tiene su _id para poder borrarla sola
const imagenSchema = new Schema<IImagen>(
  {
    url: { type: String, required: true },
    publicId: { type: String, required: true },
  },
  {
    // Así sale cada foto en TODAS las respuestas, públicas y privadas: sin publicId (es interno)
    // y con las URLs listas para mostrar
    toJSON: {
      transform: (_doc, imagen) => ({
        id: String(imagen._id),
        url: urlOptimizada(imagen.url),
        miniatura: urlMiniatura(imagen.url),
      }),
    },
  }
);

const productoSchema = new Schema<IProducto>(
  {
    nombre: { type: String, required: true, trim: true },
    descripcion: { type: String, trim: true },
    ingredientes: { type: [String], default: [] },
    pesoGramos: { type: Number, validate: mayorQueCero },
    precio: { type: Number, required: true, validate: mayorQueCero },
    categoria: {
      type: String,
      required: [true, 'La categoría es obligatoria'],
      enum: { values: CATEGORIAS, message: CATEGORIA_INVALIDA },
    },
    disponible: { type: Boolean, default: true },
    imagenes: {
      type: [imagenSchema],
      default: [],
      validate: {
        validator: (imagenes: IImagen[]) => imagenes.length <= MAX_IMAGENES_PRODUCTO,
        message: `Un producto puede tener hasta ${MAX_IMAGENES_PRODUCTO} fotos`,
      },
    },
  },
  { timestamps: true }
);

// Dos productos no pueden llamarse igual, sin importar mayúsculas ni acentos: las métricas por producto se leen
// por nombre, y "Tarta de frutilla" y "TARTA DE FRUTILLA" partirían las ventas en dos. Va en un índice (y no
// solo en una consulta antes de guardar) para que dos altas al mismo tiempo tampoco puedan colarse
productoSchema.index({ nombre: 1 }, { unique: true, collation: SIN_MAYUSCULAS_NI_ACENTOS });

export const Producto = model<IProducto>('Producto', productoSchema);
