import { Schema, model } from 'mongoose';

// Cómo se ve el catálogo público, en el orden en que los muestra la app del dueño
export const ESTILOS_CATALOGO = ['vidriera', 'carta'] as const;
export type EstiloCatalogo = (typeof ESTILOS_CATALOGO)[number];

// Lo que el dueño elige desde la app y tiene que ver la web
export interface IAjustes {
  estiloCatalogo: EstiloCatalogo;
}

// Mientras el dueño no cambie nada no hay documento: valen estos
export const AJUSTES_POR_DEFECTO: IAjustes = { estiloCatalogo: 'carta' };

// Hay un solo documento y tiene este _id fijo: así dos cambios al mismo tiempo (el primero de todos,
// con upsert) no pueden crear dos documentos, porque el _id es único
export const ID_AJUSTES = 'web';

const ajustesSchema = new Schema<IAjustes & { _id: string }>(
  {
    _id: { type: String },
    estiloCatalogo: { type: String, enum: ESTILOS_CATALOGO, default: AJUSTES_POR_DEFECTO.estiloCatalogo },
  },
  { timestamps: true }
);

export const Ajustes = model('Ajustes', ajustesSchema, 'ajustes');
