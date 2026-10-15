import { Schema, model } from 'mongoose';

export interface IPromo {
  titulo: string;
  texto?: string;
  imagenUrl: string;
  imagenPublicId: string;
}

const promoSchema = new Schema<IPromo>(
  {
    titulo: { type: String, required: true, trim: true },
    texto: { type: String, trim: true },
    imagenUrl: { type: String, required: true },
    imagenPublicId: { type: String, required: true },
  },
  { timestamps: true }
);

export const Promo = model<IPromo>('Promo', promoSchema);
