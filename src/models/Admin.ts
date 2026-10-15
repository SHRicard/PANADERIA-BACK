import { Schema, model } from 'mongoose';

// Código de recuperación de contraseña en curso: se guarda hasheado y se borra al usarlo
export interface IRecuperacion {
  codigoHash: string;
  venceEn: Date;
  intentos: number;
}

export interface IAdmin {
  usuario: string;
  passwordHash: string;
  email?: string;
  recuperacion?: IRecuperacion;
}

const recuperacionSchema = new Schema<IRecuperacion>(
  {
    codigoHash: { type: String, required: true },
    venceEn: { type: Date, required: true },
    intentos: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const adminSchema = new Schema<IAdmin>(
  {
    usuario: { type: String, required: true, unique: true, trim: true },
    passwordHash: { type: String, required: true },
    // Opcional para no romper el admin que ya existe: lo carga "npm run crear-admin" con ADMIN_EMAIL
    email: { type: String, trim: true, lowercase: true },
    recuperacion: { type: recuperacionSchema, default: undefined },
  },
  { timestamps: true }
);

export const Admin = model<IAdmin>('Admin', adminSchema);
