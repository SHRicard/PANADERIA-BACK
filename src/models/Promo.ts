import { Schema, model } from 'mongoose';
import { urlMiniatura, urlOptimizada } from '../utils/cloudinaryUrl';

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
  {
    timestamps: true,
    // En todas las respuestas: sin imagenPublicId (es interno) y con las URLs listas para mostrar
    toJSON: {
      transform: (_doc, { imagenPublicId: _publicId, ...promo }) => ({
        ...promo,
        imagenUrl: urlOptimizada(promo.imagenUrl),
        miniatura: urlMiniatura(promo.imagenUrl),
      }),
    },
  }
);

export const Promo = model<IPromo>('Promo', promoSchema);
