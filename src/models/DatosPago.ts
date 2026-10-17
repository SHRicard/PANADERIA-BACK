import { Schema, model } from 'mongoose';

// La cuenta a la que el cliente le transfiere al dueño. Es PÚBLICA a propósito: la web se la muestra
// al cliente después de hacer el pedido
export interface IDatosPago {
  /** El titular de la cuenta, como figura en el banco o la billetera */
  nombreCompleto: string;
  alias: string;
  /** CBU o CVU: 22 números. Texto y no número, para no perder los ceros del principio (los CVU empiezan con 000) */
  cbu: string;
  /** Dónde está la cuenta: Mercado Pago, Ualá, Banco Nación… */
  billetera: string;
}

export const LARGO_NOMBRE_COMPLETO = { min: 3, max: 80 };
export const LARGO_BILLETERA = { min: 2, max: 40 };
// Las reglas del BCRA: de 6 a 20 caracteres, solo letras sin acentos, números, puntos y guiones
export const FORMATO_ALIAS = /^[a-zA-Z0-9.-]{6,20}$/;

export const NOMBRE_COMPLETO_INVALIDO = `El nombre completo tiene que tener entre ${LARGO_NOMBRE_COMPLETO.min} y ${LARGO_NOMBRE_COMPLETO.max} caracteres`;
export const ALIAS_INVALIDO = 'El alias tiene que tener de 6 a 20 caracteres: letras sin acentos, números, puntos y guiones';
export const CBU_INVALIDO = 'El CBU o CVU no es válido: tiene que tener 22 números. Revisá que esté bien copiado';
export const BILLETERA_INVALIDA = `La billetera tiene que tener entre ${LARGO_BILLETERA.min} y ${LARGO_BILLETERA.max} caracteres`;

// Hay un solo documento y tiene este _id fijo (como Ajustes): así dos cambios al mismo tiempo
// (el primero de todos, con upsert) no pueden crear dos
export const ID_DATOS_PAGO = 'cuenta';

// Los dos dígitos verificadores del CBU, que también valen para el CVU. Atrapan casi todos los errores
// de tipeo: con un número mal copiado, el cliente le transferiría a otra cuenta
export function esCbuValido(cbu: string): boolean {
  if (!/^\d{22}$/.test(cbu)) return false;
  const verifica = (bloque: string, pesos: number[]) => {
    const suma = pesos.reduce((total, peso, i) => total + Number(bloque[i]) * peso, 0);
    return (10 - (suma % 10)) % 10 === Number(bloque[pesos.length]);
  };
  return (
    verifica(cbu.slice(0, 8), [7, 1, 3, 9, 7, 1, 3]) &&
    verifica(cbu.slice(8), [3, 9, 7, 1, 3, 9, 7, 1, 3, 9, 7, 1, 3])
  );
}

const datosPagoSchema = new Schema<IDatosPago & { _id: string }>(
  {
    _id: { type: String },
    nombreCompleto: {
      type: String,
      required: [true, 'Falta el nombre completo'],
      trim: true,
      minlength: [LARGO_NOMBRE_COMPLETO.min, NOMBRE_COMPLETO_INVALIDO],
      maxlength: [LARGO_NOMBRE_COMPLETO.max, NOMBRE_COMPLETO_INVALIDO],
    },
    alias: { type: String, required: [true, 'Falta el alias'], trim: true, match: [FORMATO_ALIAS, ALIAS_INVALIDO] },
    cbu: {
      type: String,
      required: [true, 'Falta el CBU o CVU'],
      validate: { validator: esCbuValido, message: CBU_INVALIDO },
    },
    billetera: {
      type: String,
      required: [true, 'Falta la billetera'],
      trim: true,
      minlength: [LARGO_BILLETERA.min, BILLETERA_INVALIDA],
      maxlength: [LARGO_BILLETERA.max, BILLETERA_INVALIDA],
    },
  },
  { timestamps: true }
);

export const DatosPago = model('DatosPago', datosPagoSchema, 'datos_pago');
