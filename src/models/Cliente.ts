import { Schema, model } from 'mongoose';

export interface ICliente {
  telefono: string;
  nombre: string;
}

// El cliente no tiene login ni rol: se identifica por su teléfono
const clienteSchema = new Schema<ICliente>(
  {
    // Siempre normalizado en E.164 con normalizarTelefono (utils/telefono.ts)
    telefono: { type: String, required: true, unique: true },
    // El último nombre que usó al hacer un pedido
    nombre: { type: String, required: true, trim: true, minlength: 2, maxlength: 60 },
  },
  { timestamps: true }
);

export const Cliente = model<ICliente>('Cliente', clienteSchema);
