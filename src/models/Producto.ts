import { Schema, model } from 'mongoose';

export const MAX_IMAGENES_PRODUCTO = 5;

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
  categoria?: string;
  disponible: boolean;
  /** La primera es la portada */
  imagenes: IImagen[];
}

// Un precio o un peso en 0 o negativo es un error de carga
const mayorQueCero = { validator: (valor: number) => valor > 0, message: '{PATH} tiene que ser mayor que 0' };

// Cada foto tiene su _id para poder borrarla sola. publicId es interno: no sale en ninguna respuesta
const imagenSchema = new Schema<IImagen>(
  {
    url: { type: String, required: true },
    publicId: { type: String, required: true },
  },
  {
    toJSON: {
      transform: (_doc, { publicId: _publicId, ...visible }) => visible,
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
    categoria: { type: String, trim: true },
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

export const Producto = model<IProducto>('Producto', productoSchema);
