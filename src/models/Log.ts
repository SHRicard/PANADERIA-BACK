import { Schema, Types, model } from 'mongoose';

// Cómo terminó la petición: exito (2xx/3xx), aviso (4xx o el cliente cortó antes de la respuesta), error (5xx)
export const NIVELES_LOG = ['exito', 'aviso', 'error'] as const;
export type NivelLog = (typeof NIVELES_LOG)[number];

// Por qué una petición parece un ataque (logsService.motivoSospechoso). Muchas seguidas de una IP → email a los admins
export const MOTIVOS_SOSPECHOSOS = [
  'login-fallido',
  'recuperacion-fallida',
  'limite-superado',
  'sin-autorizacion',
  'ruta-inexistente',
  'origen-no-permitido',
] as const;
export type MotivoSospechoso = (typeof MOTIVOS_SOSPECHOSOS)[number];

// Cada cuántos días se borran solos (lo elige el dueño): semana, 15 días o mes. null = solo a mano
export const DIAS_LOGS = [7, 15, 30] as const;
export type DiasLogs = (typeof DIAS_LOGS)[number];

/**
 * Una petición a la API (lo pidió el dueño el 2026-11-13: ver quién usa la API, desde qué IP, y enterarse de un ataque).
 * ❌ Sin body, query ni headers: ahí viajan nombres y teléfonos de clientes, el token y las contraseñas. El nombre de quien
 * hizo un pedido no se copia: se guarda el id del pedido y se busca al leer, así borrar los logs no toca los pedidos
 */
export interface ILog {
  ip: string;
  metodo: string;
  /** Sin query */
  ruta: string;
  /** La ruta con los ids y las fechas como :id y :fecha, para agrupar: /api/catalogo/:id */
  apartado: string;
  /** null si el cliente cortó antes de la respuesta */
  codigo: number | null;
  nivel: NivelLog;
  /** El error que se respondió (el mismo de la línea de la terminal) */
  mensaje?: string;
  ms: number;
  /** Si venía con un token de admin válido: la app del dueño, no un cliente */
  admin: boolean;
  sospechoso?: MotivoSospechoso;
  /** El pedido que se creó con esta petición (POST /api/pedidos) */
  pedido?: Types.ObjectId;
  /** Cuándo lo borra Mongo solo (índice TTL). Sin él, queda hasta que el dueño borre todo */
  expiraEn?: Date;
  createdAt: Date;
}

const logSchema = new Schema<ILog>(
  {
    ip: { type: String, required: true },
    metodo: { type: String, required: true },
    ruta: { type: String, required: true },
    apartado: { type: String, required: true },
    codigo: { type: Number, default: null },
    nivel: { type: String, enum: NIVELES_LOG, required: true },
    mensaje: { type: String },
    ms: { type: Number, required: true, min: 0 },
    admin: { type: Boolean, default: false },
    sospechoso: { type: String, enum: MOTIVOS_SOSPECHOSOS },
    pedido: { type: Schema.Types.ObjectId, ref: 'Pedido' },
    expiraEn: { type: Date },
  },
  // Un log no se edita: solo la fecha en que pasó
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false }
);

// Mongo borra cada log cuando llega su expiraEn (revisa una vez por minuto)
logSchema.index({ expiraEn: 1 }, { expireAfterSeconds: 0 });
logSchema.index({ createdAt: -1 });
logSchema.index({ ip: 1, createdAt: -1 });

export const Log = model<ILog>('Log', logSchema, 'logs');
