import { Schema, model } from 'mongoose';
import { SIN_MAYUSCULAS_NI_ACENTOS } from './Producto';

// Qué es el producto (Tortas, Tartas, Alfajores…): una lista que arma el dueño desde la app (Más → Tipos). Es
// opcional en el producto y no reemplaza a la categoría, que es el gusto (Dulce, Salado…)

export const LARGO_NOMBRE_TIPO = { min: 2, max: 40 };
export const NOMBRE_TIPO_INVALIDO = `El nombre tiene que tener entre ${LARGO_NOMBRE_TIPO.min} y ${LARGO_NOMBRE_TIPO.max} caracteres`;

export interface ITipo {
  nombre: string;
}

const tipoSchema = new Schema<ITipo>(
  {
    nombre: {
      type: String,
      required: [true, 'Falta el nombre'],
      trim: true,
      minlength: [LARGO_NOMBRE_TIPO.min, NOMBRE_TIPO_INVALIDO],
      maxlength: [LARGO_NOMBRE_TIPO.max, NOMBRE_TIPO_INVALIDO],
    },
  },
  { timestamps: true }
);

// "Tortas" y "TORTAS" son el mismo tipo. En un índice, para que dos altas a la vez tampoco se cuelen
tipoSchema.index({ nombre: 1 }, { unique: true, collation: SIN_MAYUSCULAS_NI_ACENTOS });

export const Tipo = model<ITipo>('Tipo', tipoSchema);
