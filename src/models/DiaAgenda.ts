import { Schema, Types, model } from 'mongoose';
import { esFechaValida } from '../utils/fecha';
import { MAX_PRODUCTOS_POR_DIA } from './Ajustes';

// Lo que el dueño gestiona de un día de su agenda (los pedidos del día viven en los pedidos, por su fechaEntrega):
//   - llena: si lo marcó como «Agenda llena» desde la app. La web no lo deja elegir (también se cierra solo al llegar
//     a sus productos por día, el tope: eso se calcula, no se guarda acá).
//   - hechos: cuántos ya preparó de cada producto ese día, para su hoja de «Qué hay que hacer».
//   - quiereHacer: cuántos productos quiere hacer ese día, si es menos que su tope de siempre (un día que no se siente
//     bien). No cambia el tope: lo que falta para llegar se cuenta como ocupado (ver nivelDe en agendaService).
// Un documento por día, con la fecha como _id: dos toques a la vez no pueden crear dos. Solo existen los días que el
// dueño tocó; un día sin documento está abierto y sin nada hecho

export interface IHechoDelDia {
  producto: Types.ObjectId;
  /** Cuántos ya preparó. Puede quedar por arriba de lo pedido si después se cancela un pedido */
  cantidad: number;
}

export interface IDiaAgenda {
  /** El día, AAAA-MM-DD */
  _id: string;
  llena: boolean;
  hechos: IHechoDelDia[];
  /** Cuántos productos quiere hacer ese día. Sin el campo, los de siempre (productosPorDia de Ajustes) */
  quiereHacer?: number;
  createdAt: Date;
  updatedAt: Date;
}

/** El máximo que se puede anotar como hecho de un producto en un día (un pedido tiene hasta 30 productos de hasta 50) */
export const MAX_HECHOS = 1000;

const hechoSchema = new Schema<IHechoDelDia>(
  {
    producto: { type: Schema.Types.ObjectId, ref: 'Producto', required: true },
    cantidad: { type: Number, required: true, min: 1, max: MAX_HECHOS, validate: Number.isInteger },
  },
  { _id: false }
);

const diaAgendaSchema = new Schema<IDiaAgenda>(
  {
    _id: {
      type: String,
      validate: { validator: esFechaValida, message: 'El día tiene que ser una fecha AAAA-MM-DD' },
    },
    llena: { type: Boolean, default: false },
    hechos: { type: [hechoSchema], default: [] },
    // Opcional y sin default: los días que ya existen no lo tienen
    quiereHacer: { type: Number, min: 1, max: MAX_PRODUCTOS_POR_DIA, validate: Number.isInteger },
  },
  { timestamps: true }
);

// La web busca los días llenos de un rango
diaAgendaSchema.index({ llena: 1, _id: 1 });

export const Agenda = model<IDiaAgenda>('Agenda', diaAgendaSchema, 'agenda');
