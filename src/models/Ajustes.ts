import { Schema, model } from 'mongoose';

// Cómo se ve el catálogo público, en el orden en que los muestra la app del dueño
export const ESTILOS_CATALOGO = ['vidriera', 'carta', 'dia-navidad', 'noche-navidad'] as const;
export type EstiloCatalogo = (typeof ESTILOS_CATALOGO)[number];

// Lo que el dueño les escribe a los clientes en el cartel. Vacío, la web pone uno por defecto
export const MAX_MENSAJE_CERRADO = 280;

// Lo que el dueño elige desde la app y tiene que ver la web
export interface IAjustes {
  estiloCatalogo: EstiloCatalogo;
  // Cerrado por un tiempo (vacaciones, fuerza mayor): la web muestra el cartel y no toma pedidos
  cerrado: boolean;
  mensajeCerrado: string;
}

// Mientras el dueño no cambie nada no hay documento: valen estos. Un ajuste nuevo se suma con su valor por
// defecto, así el documento que ya existe sigue valiendo (Mongoose lo completa al leerlo)
export const AJUSTES_POR_DEFECTO: IAjustes = {
  estiloCatalogo: 'carta',
  cerrado: false,
  mensajeCerrado: '',
};

// Hay un solo documento y tiene este _id fijo: así dos cambios al mismo tiempo (el primero de todos,
// con upsert) no pueden crear dos documentos, porque el _id es único
export const ID_AJUSTES = 'web';

const ajustesSchema = new Schema<IAjustes & { _id: string }>(
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
  },
  { timestamps: true }
);

export const Ajustes = model('Ajustes', ajustesSchema, 'ajustes');
