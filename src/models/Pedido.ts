import { Schema, Types, model } from 'mongoose';

export const ESTADOS_PEDIDO = ['pendiente', 'confirmado', 'entregado', 'cancelado'] as const;
export type EstadoPedido = (typeof ESTADOS_PEDIDO)[number];

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
  nota?: string;
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
    nota: { type: String, trim: true, maxlength: 300 },
  },
  { timestamps: true }
);

pedidoSchema.index({ estado: 1, createdAt: -1 });

export const Pedido = model<IPedido>('Pedido', pedidoSchema);
