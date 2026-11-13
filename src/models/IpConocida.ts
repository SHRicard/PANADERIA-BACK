import { Schema, model } from 'mongoose';

export const LARGO_NOMBRE_IP = { min: 2, max: 60 } as const;
export const NOMBRE_IP_INVALIDO = `El nombre tiene que tener de ${LARGO_NOMBRE_IP.min} a ${LARGO_NOMBRE_IP.max} letras`;

/**
 * El nombre que el dueño le pone a una IP («Juan», «yo desde casa»). Es una pista, no una prueba: la mayoría de las IP
 * cambian (los celulares, seguido) y muchos comparten la misma. No se borra con los logs: es una anotación del dueño
 */
export interface IIpConocida {
  ip: string;
  nombre: string;
}

const ipConocidaSchema = new Schema<IIpConocida>(
  {
    ip: { type: String, required: true, unique: true, trim: true },
    nombre: {
      type: String,
      required: true,
      trim: true,
      minlength: [LARGO_NOMBRE_IP.min, NOMBRE_IP_INVALIDO],
      maxlength: [LARGO_NOMBRE_IP.max, NOMBRE_IP_INVALIDO],
    },
  },
  { timestamps: true }
);

export const IpConocida = model<IIpConocida>('IpConocida', ipConocidaSchema, 'ips_conocidas');
