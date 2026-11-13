import { Schema, model } from 'mongoose';
import { DIAS_LOGS } from './Log';

// Cómo se ve el catálogo público, en el orden en que los muestra la app del dueño
export const ESTILOS_CATALOGO = ['vidriera', 'carta', 'dia-navidad', 'noche-navidad'] as const;
export type EstiloCatalogo = (typeof ESTILOS_CATALOGO)[number];

// Claro u oscuro: el que usa el dueño en su app es el que ven todos los clientes en la web (lo pidió el 2026-11-13)
export const TEMAS = ['claro', 'oscuro'] as const;
export type Tema = (typeof TEMAS)[number];

// Lo que el dueño les escribe a los clientes en el cartel. Vacío, la web pone uno por defecto
export const MAX_MENSAJE_CERRADO = 280;

// Hasta cuántos productos por día puede poner el dueño como referencia de la agenda
export const MAX_PRODUCTOS_POR_DIA = 1000;
export const PRODUCTOS_POR_DIA_INVALIDO = `Los productos por día tienen que ser un número entero de 1 a ${MAX_PRODUCTOS_POR_DIA}`;

// Lo que el dueño elige desde la app y tiene que ver la web (y la referencia de su agenda, que solo usa la app)
export interface IAjustes {
  estiloCatalogo: EstiloCatalogo;
  // Cerrado por un tiempo (vacaciones, fuerza mayor): la web muestra el cartel y no toma pedidos
  cerrado: boolean;
  mensajeCerrado: string;
  // Cuántos productos por día puede preparar, más o menos: pinta los puntos de la agenda (agendaService). Es solo una
  // referencia: el sistema no cierra ningún día solo, el dueño lo marca como «Agenda llena». null = todavía no lo puso
  productosPorDia: number | null;
  // El tema de la app del dueño, que también pinta la web
  tema: Tema;
}

// Mientras el dueño no cambie nada no hay documento: valen estos. Un ajuste nuevo se suma con su valor por
// defecto, así el documento que ya existe sigue valiendo (Mongoose lo completa al leerlo)
export const AJUSTES_POR_DEFECTO: IAjustes = {
  estiloCatalogo: 'carta',
  cerrado: false,
  mensajeCerrado: '',
  productosPorDia: null,
  tema: 'claro',
};

// Hay un solo documento y tiene este _id fijo: así dos cambios al mismo tiempo (el primero de todos,
// con upsert) no pueden crear dos documentos, porque el _id es único
export const ID_AJUSTES = 'web';

// Cada cuántos días se borran solos los logs (logsService). Va en este documento pero NO es de la web: es privado,
// no está en IAjustes y no sale en GET /api/ajustes (ajustesService.datos arma la respuesta campo por campo)
export interface IAjustesPrivados {
  diasLogs?: number | null;
}

const ajustesSchema = new Schema<IAjustes & IAjustesPrivados & { _id: string }>(
  {
    _id: { type: String },
    estiloCatalogo: { type: String, enum: ESTILOS_CATALOGO, default: AJUSTES_POR_DEFECTO.estiloCatalogo },
    cerrado: { type: Boolean, default: AJUSTES_POR_DEFECTO.cerrado },
    mensajeCerrado: {
      type: String,
      trim: true,
      maxlength: [MAX_MENSAJE_CERRADO, `El mensaje puede tener hasta ${MAX_MENSAJE_CERRADO} caracteres`],
      default: AJUSTES_POR_DEFECTO.mensajeCerrado,
    },
    productosPorDia: {
      type: Number,
      default: AJUSTES_POR_DEFECTO.productosPorDia,
      min: [1, PRODUCTOS_POR_DIA_INVALIDO],
      max: [MAX_PRODUCTOS_POR_DIA, PRODUCTOS_POR_DIA_INVALIDO],
      // Los validadores propios corren también con null: null es «sin referencia»
      validate: { validator: (valor: number | null) => valor === null || Number.isInteger(valor), message: PRODUCTOS_POR_DIA_INVALIDO },
    },
    tema: { type: String, enum: TEMAS, default: AJUSTES_POR_DEFECTO.tema },
    diasLogs: { type: Number, enum: [...DIAS_LOGS, null], default: null },
  },
  { timestamps: true }
);

export const Ajustes = model('Ajustes', ajustesSchema, 'ajustes');
