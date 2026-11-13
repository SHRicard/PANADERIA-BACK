import { Schema, Types, model } from 'mongoose';
import { esFechaValida } from '../utils/fecha';

// pendiente: recién hecho, esperando la seña · confirmado: la seña está pagada · entregado · cancelado.
// El estado no se cambia directo: lo cambian la seña, la entrega y la cancelación (ver pedidosService)
export const ESTADOS_PEDIDO = ['pendiente', 'confirmado', 'entregado', 'cancelado'] as const;
export type EstadoPedido = (typeof ESTADOS_PEDIDO)[number];

// web: lo hizo el cliente desde la web · manual: lo cargó el dueño desde la app (un pedido por WhatsApp o en persona)
export const ORIGENES_PEDIDO = ['web', 'manual'] as const;
export type OrigenPedido = (typeof ORIGENES_PEDIDO)[number];

export const FECHA_ENTREGA_INVALIDA = 'La fecha de entrega tiene que ser un día AAAA-MM-DD';

/** La seña que transfirió el cliente. La confirma el dueño desde la app cuando ve la plata */
export interface ISena {
  monto: number;
  /** Cuándo la confirmó el dueño. Si después corrige el monto, no cambia */
  pagadaEn: Date;
}

export interface IItemPedido {
  producto: Types.ObjectId;
  nombre: string;
  precio: number;
  /** El gusto del producto (su categoría) al momento del pedido */
  categoria: string;
  cantidad: number;
}

export interface IPedido {
  cliente: Types.ObjectId;
  clienteNombre: string;
  clienteTelefono: string;
  items: IItemPedido[];
  total: number;
  estado: EstadoPedido;
  origen: OrigenPedido;
  /** true: el cliente quiere que se lo manden · false: lo pasa a retirar */
  conEnvio: boolean;
  /**
   * Para qué día es (AAAA-MM-DD). Lo elige el cliente en la web (con las reglas de agendaService) o el dueño (libre).
   * Opcional solo mientras dura la transición: los pedidos de antes no lo tienen hasta correr migrar-fecha-entrega
   */
  fechaEntrega?: string;
  nota?: string;
  /** Solo si el dueño confirmó la seña */
  sena?: ISena;
  entregadoEn?: Date;
  canceladoEn?: Date;
  /**
   * Si el dueño ya lo vio en la app: los de la web nacen sin ver (es lo que la app le marca como nuevo) y los manuales,
   * vistos (los cargó él). Los anteriores a este campo no lo tienen: salen como vistos (pedidosService.completar)
   */
  visto?: boolean;
  /**
   * La clave que arma la web para cada intento de confirmar (al azar). Si el mismo pedido llega dos veces (dos toques
   * a la vez, o se cortó la conexión después de guardarlo y el cliente volvió a confirmar), se responde el que ya estaba
   * en vez de crear otro. Los manuales y los de antes no la tienen
   */
  intento?: string;
  createdAt: Date;
  updatedAt: Date;
}

// nombre, precio y categoría son una copia del momento del pedido: el historial (y las métricas por gusto)
// no cambian si el producto se edita o se borra. La categoría va sin enum: si la lista cambia, lo viejo sigue valiendo
const itemSchema = new Schema<IItemPedido>(
  {
    producto: { type: Schema.Types.ObjectId, ref: 'Producto', required: true },
    nombre: { type: String, required: true, trim: true },
    precio: { type: Number, required: true, min: 0 },
    categoria: { type: String, required: true },
    cantidad: { type: Number, required: true, min: 1, max: 50 },
  },
  { _id: false }
);

const senaSchema = new Schema<ISena>(
  {
    monto: {
      type: Number,
      required: true,
      // 0 = confirmado sin seña
      validate: { validator: (monto: number) => monto >= 0, message: 'La seña no puede ser negativa' },
    },
    pagadaEn: { type: Date, required: true },
  },
  { _id: false }
);

const pedidoSchema = new Schema<IPedido>(
  {
    cliente: { type: Schema.Types.ObjectId, ref: 'Cliente', required: true, index: true },
    // Copia de los datos del cliente al momento del pedido
    clienteNombre: { type: String, required: true, trim: true },
    clienteTelefono: { type: String, required: true },
    items: {
      type: [itemSchema],
      validate: {
        validator: (items: IItemPedido[]) => items.length >= 1 && items.length <= 30,
        message: 'El pedido tiene que tener entre 1 y 30 productos',
      },
    },
    total: { type: Number, required: true, min: 0 },
    estado: { type: String, enum: ESTADOS_PEDIDO, default: 'pendiente' },
    // Los pedidos anteriores a este campo no lo tienen guardado: son todos de la web (pedidosService lo completa)
    origen: { type: String, enum: ORIGENES_PEDIDO, default: 'web' },
    // Los pedidos anteriores a este campo no lo tienen: antes no había envío, así que son retiro (el default de acá
    // al hidratar, y pedidosService.completar en las lecturas con lean)
    conEnvio: { type: Boolean, default: false },
    // Un día de calendario como texto, igual que Insumo.fecha: como Date se correría un día al mostrarlo en Argentina.
    // ⚠️ Transición: opcional hasta que la web y la app la manden siempre y se corra npm run migrar-fecha-entrega en las
    // dos bases. Recién después pasa a required (si no, los pedidos sin fecha no pasan la validación al guardarlos)
    fechaEntrega: {
      type: String,
      validate: { validator: esFechaValida, message: FECHA_ENTREGA_INVALIDA },
    },
    nota: { type: String, trim: true, maxlength: 300 },
    // Opcionales: los pedidos anteriores no los tienen. Que la seña no pase del total lo controla pedidosService
    sena: { type: senaSchema },
    entregadoEn: { type: Date },
    canceladoEn: { type: Date },
    // Sin default a propósito: Mongoose se lo pondría al leer los pedidos de antes, y saldrían todos como nuevos.
    // Lo pone pedidosService al crear
    visto: { type: Boolean },
    intento: { type: String },
  },
  { timestamps: true }
);

pedidoSchema.index({ estado: 1, createdAt: -1 });
// La agenda: lo de un día o de un mes
pedidoSchema.index({ fechaEntrega: 1 });
// Un solo pedido por intento de la web. Parcial: los manuales y los de antes no tienen la clave
pedidoSchema.index({ intento: 1 }, { unique: true, partialFilterExpression: { intento: { $type: 'string' } } });

export const Pedido = model<IPedido>('Pedido', pedidoSchema);
