import { Schema, Types, model } from 'mongoose';

// La receta de un producto: con qué insumos se hace y cuántas unidades rinde. Con eso se calcula al vuelo lo que
// cuesta hacer cada unidad, con el último precio de cada insumo. Es privada: solo la ve el dueño en la app.
// No es Producto.ingredientes: esa es la lista pública de nombres que sale en el catálogo, y no se toca

// El dueño pesa todo, también los líquidos (1 l de leche ≈ 1 kg): un insumo en kg o en l se carga en gramos, y uno
// por unidad (los huevos), en unidades
export const UNIDADES_RECETA = ['g', 'unidad'] as const;
export type UnidadReceta = (typeof UNIDADES_RECETA)[number];

export const MAX_INGREDIENTES_RECETA = 50;
// 100 kg o 100.000 unidades por ingrediente
export const MAX_CANTIDAD_RECETA = 100000;
export const MAX_RINDE = 10000;
// Hasta cuántas unidades se puede calcular de una vez cuánto hace falta de cada ingrediente (no se guarda nada)
export const MAX_UNIDADES_A_HACER = 10000;
export const LARGO_NOMBRE_INGREDIENTE = { min: 2, max: 60 };
export const NOMBRE_INGREDIENTE_INVALIDO = `El nombre tiene que tener entre ${LARGO_NOMBRE_INGREDIENTE.min} y ${LARGO_NOMBRE_INGREDIENTE.max} caracteres`;

// Por cuánto multiplica el dueño lo que cuesta cada unidad para ponerle el precio de venta: con ×3, lo que cuesta
// $ 400 se vende a $ 1200. Mayor que 1 (con ×1 no gana nada), hasta 10 y con un decimal como mucho (×2,5)
export const MAX_MULTIPLICADOR = 10;
export const MULTIPLICADOR_INVALIDO = `El multiplicador tiene que ser mayor que 1 y hasta ${MAX_MULTIPLICADOR}, con un decimal como mucho (por ejemplo, 2,5)`;
export const esMultiplicadorValido = (valor: unknown): valor is number =>
  typeof valor === 'number' &&
  valor > 1 &&
  valor <= MAX_MULTIPLICADOR &&
  // 2.3 * 10 da 23.000000000000004: se compara con un margen
  Math.abs(valor * 10 - Math.round(valor * 10)) < 1e-9;

// A qué múltiplo se puede redondear el precio que sale de la receta, siempre para arriba (lo pidió el dueño el
// 2026-11-04: ×2 daba $ 11.691 y lo quería en $ 12.000). La app ofrece solo los que no lo suben más de un 10 %
export const REDONDEOS = [10, 50, 100, 500, 1000] as const;
export const REDONDEO_INVALIDO = `El redondeo tiene que ser uno de estos: ${REDONDEOS.join(', ')}`;
export const esRedondeoValido = (valor: unknown): valor is number =>
  typeof valor === 'number' && (REDONDEOS as readonly number[]).includes(valor);

export interface IIngredienteReceta {
  /** El insumo que usa. null = algo que no se compra (el agua): cuesta 0, pero queda en la receta */
  insumo: Types.ObjectId | null;
  /** Solo en los que no son un insumo: el de un insumo sale del insumo, así renombrarlo cambia todas las recetas */
  nombre?: string;
  /** Siempre entero: nadie pesa 7,5 g ni usa medio huevo */
  cantidad: number;
  /** En los de un insumo, la pone el servicio según la unidad del insumo (kg o l → g; unidad → unidad) */
  unidad: UnidadReceta;
}

export interface IReceta {
  /** Una receta por producto */
  producto: Types.ObjectId;
  /** Cuántas unidades salen (1 kg de masa = 50 chipás). Siempre en unidades, nunca en docenas */
  rinde: number;
  ingredientes: IIngredienteReceta[];
  /**
   * El último multiplicador con el que el dueño le puso el precio al producto desde la receta, para proponérselo la
   * próxima vez. No existe hasta la primera vez (sin valor por defecto: las recetas de antes no lo tienen)
   */
  multiplicador?: number;
  /** El redondeo que usó esa vez (uno de REDONDEOS). No existe si lo dejó al peso */
  redondeo?: number;
}

const entero = (min: number, max: number, mensaje: string) => ({
  validator: (valor: number) => Number.isInteger(valor) && valor >= min && valor <= max,
  message: mensaje,
});

const ingredienteSchema = new Schema<IIngredienteReceta>(
  {
    insumo: { type: Schema.Types.ObjectId, ref: 'Insumo', default: null },
    nombre: {
      type: String,
      trim: true,
      required: [
        function (this: IIngredienteReceta) {
          return !this.insumo;
        },
        'Falta el nombre',
      ],
      minlength: [LARGO_NOMBRE_INGREDIENTE.min, NOMBRE_INGREDIENTE_INVALIDO],
      maxlength: [LARGO_NOMBRE_INGREDIENTE.max, NOMBRE_INGREDIENTE_INVALIDO],
    },
    cantidad: {
      type: Number,
      required: [true, 'Falta la cantidad'],
      validate: entero(1, MAX_CANTIDAD_RECETA, `La cantidad tiene que ser un número entero de 1 a ${MAX_CANTIDAD_RECETA}`),
    },
    unidad: { type: String, enum: UNIDADES_RECETA, required: [true, 'Falta la unidad'] },
  },
  // La lista se reemplaza entera en cada cambio: un id por ingrediente no serviría de nada
  { _id: false }
);

const recetaSchema = new Schema<IReceta>(
  {
    producto: { type: Schema.Types.ObjectId, ref: 'Producto', required: true },
    rinde: {
      type: Number,
      required: [true, 'Falta el rinde'],
      validate: entero(1, MAX_RINDE, `El rinde tiene que ser un número entero de 1 a ${MAX_RINDE}`),
    },
    ingredientes: {
      type: [ingredienteSchema],
      validate: {
        validator: (lista: IIngredienteReceta[]) => lista.length >= 1 && lista.length <= MAX_INGREDIENTES_RECETA,
        message: `La receta tiene que tener de 1 a ${MAX_INGREDIENTES_RECETA} ingredientes`,
      },
    },
    multiplicador: { type: Number, validate: { validator: esMultiplicadorValido, message: MULTIPLICADOR_INVALIDO } },
    redondeo: { type: Number, validate: { validator: esRedondeoValido, message: REDONDEO_INVALIDO } },
  },
  { timestamps: true }
);

// Una sola receta por producto: en un índice, para que dos guardados a la vez no creen dos
recetaSchema.index({ producto: 1 }, { unique: true });
// Para saber qué recetas usan un insumo (no se le puede cambiar la unidad mientras alguna lo use)
recetaSchema.index({ 'ingredientes.insumo': 1 });

export const Receta = model<IReceta>('Receta', recetaSchema);
