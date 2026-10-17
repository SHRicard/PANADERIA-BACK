import { Schema, model } from 'mongoose';
import { esFechaValida } from '../utils/fecha';
import { SIN_MAYUSCULAS_NI_ACENTOS } from './Producto';

// Lo que compra el dueño para producir (la harina, la manteca…), con lo que pagó: el historial de gastos

export const LARGO_NOMBRE_INSUMO = { min: 2, max: 60 };
export const NOMBRE_INSUMO_INVALIDO = `El nombre tiene que tener entre ${LARGO_NOMBRE_INSUMO.min} y ${LARGO_NOMBRE_INSUMO.max} caracteres`;

export const ACCIONES_LOG = ['creacion', 'actualizacion'] as const;
export type AccionLog = (typeof ACCIONES_LOG)[number];

export const CAMPOS_INSUMO = ['nombre', 'precio', 'fecha'] as const;
export type CampoInsumo = (typeof CAMPOS_INSUMO)[number];

/** Una entrada del historial: cómo quedó el insumo después del alta o de una actualización */
export interface ILogInsumo {
  accion: AccionLog;
  nombre: string;
  precio: number;
  /** El día de la compra, AAAA-MM-DD */
  fecha: string;
  /** Qué cambió respecto de la entrada anterior. En el alta, vacío */
  cambios: CampoInsumo[];
  /** Cuándo se registró en la app (no es el día de la compra) */
  registradoEn: Date;
}

export interface IInsumo {
  nombre: string;
  /** Lo que pagó en la última compra */
  precio: number;
  /** El día de la última compra, AAAA-MM-DD: un día de calendario, sin hora ni zona */
  fecha: string;
  /** El historial, la entrada más nueva primero. Lo arma insumosService: no se edita a mano */
  logs: ILogInsumo[];
}

const mayorQueCero = { validator: (valor: number) => valor > 0, message: 'El precio tiene que ser mayor que 0' };
const fechaValida = { validator: esFechaValida, message: 'La fecha tiene que ser AAAA-MM-DD' };

const logSchema = new Schema<ILogInsumo>(
  {
    accion: { type: String, enum: ACCIONES_LOG, required: true },
    nombre: { type: String, required: true },
    precio: { type: Number, required: true },
    fecha: { type: String, required: true },
    cambios: { type: [{ type: String, enum: CAMPOS_INSUMO }], default: [] },
    registradoEn: { type: Date, required: true },
  },
  {
    toJSON: {
      transform: (_doc, log) => ({
        id: String(log._id),
        accion: log.accion,
        nombre: log.nombre,
        precio: log.precio,
        fecha: log.fecha,
        cambios: log.cambios,
        registradoEn: log.registradoEn,
      }),
    },
  }
);

const insumoSchema = new Schema<IInsumo>(
  {
    nombre: {
      type: String,
      required: [true, 'Falta el nombre'],
      trim: true,
      minlength: [LARGO_NOMBRE_INSUMO.min, NOMBRE_INSUMO_INVALIDO],
      maxlength: [LARGO_NOMBRE_INSUMO.max, NOMBRE_INSUMO_INVALIDO],
    },
    precio: { type: Number, required: [true, 'Falta el precio'], validate: mayorQueCero },
    // Texto y no Date: es el día de la compra, y como Date a medianoche UTC se mostraría un día antes en Argentina
    fecha: { type: String, required: [true, 'Falta la fecha'], validate: fechaValida },
    logs: { type: [logSchema], default: [] },
  },
  { timestamps: true }
);

// Un insumo por nombre, sin importar mayúsculas ni acentos: "Harina 20 kg" y "HARINA 20 KG" son el mismo, y cada
// compra nueva se carga como una actualización (así queda en su historial). En un índice, para que dos altas a la vez
// tampoco se cuelen
insumoSchema.index({ nombre: 1 }, { unique: true, collation: SIN_MAYUSCULAS_NI_ACENTOS });

export const Insumo = model<IInsumo>('Insumo', insumoSchema);
